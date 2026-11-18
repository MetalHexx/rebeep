# tests

> DOS test programs, assembled from the same source as ReBeep.

## What's here

| Path | Role |
|---|---|
| `interpreter/` | Feeds scripted port-write sequences to the interpreter and checks the events. Runs headless in DOSBox-X |
| `exerciser/` | Plays known speaker cases through the real ports, for listening checks in 86Box |
| `vm/` | Unattended probes that boot `mirror-freedos` and report through `RESULT.TXT`. See [vm/AGENTS.md](vm/AGENTS.md) |

## Rules

- Interpreter test programs are `tests/interpreter/T_*.ASM`. `rebeep test run --suite interpreter`
  assembles each one and runs it headless in DOSBox-X.
- A DOS program's exit code never reaches the host, so each program writes `RESULT.TXT`:
  - `PASS <case>` for each passing case
  - `FAIL <case>: <detail>` for each failure (any line starting with `FAIL` counts)
  - `DONE <n>` as the **last** line, where n is the number of PASS and FAIL lines

  A missing or miscounted `DONE`, any `FAIL`, no results, or hitting the time limit fails the run.
- `interpreter/testlib.inc` is the shared helper library: `CASE "name"` ... `ENDCASE` brackets a
  case, `t_check` (AX = CX) and `t_checkd` (also BX = SI) record the first mismatch, and `t_done`
  prints `DONE <n>` last and exits. Only the first failed check of a case is reported, with its step number.
- `interpreter/t_interp.asm` (`T_INTERP.COM`) covers the speaker interpreter: LSB/MSB sequencing,
  divisor 0, LSB-only and MSB-only access, non-square mode, channel 0/1 and latch/read-back
  ignored, glide as a pitch event, control word mid-tone, direct toggling, the divisor range
  edges, `interp_sync`, on/off/on, and a 20-beep stepped pattern.
- `interpreter/t_opl.asm` (`T_OPL.COM`) covers the OPL target: real chip detection, block/F-number
  against the formula, and, through a recording sink, the key bit, channel-8-only writes, the OPL3
  `C0h` bits, volume and shutdown, once as an OPL2 and once as an OPL3.
- Listening check: `T_OPL /L` plays the faithful voice then each patch, one second each at 440 Hz.
  Build it with `rebeep test run --suite interpreter`, then run `build/tests/T_OPL.COM /L` in
  DOSBox-X once with `oplmode=opl2` and once with `opl3` (`-set sblaster,oplmode=opl2`), with sound on.
- The CLI's own unit tests live in `tools/test/`, not here.

## Pitfalls

- A test program is a `.COM`: `org 100h`, `jmp` past the included module and library, then the
  cases. Both include paths come from the suite (`tests/interpreter`, `src`, `src/include`).
- The suite runs DOSBox-X with `-set mixer,nosound=true`, not `-silent`: `-silent` removes the Sound
  Blaster, so no OPL is found at `388h`.
- CI runs the interpreter suite on `windows-latest` only, with `SDL_VIDEODRIVER` and
  `SDL_AUDIODRIVER` set to `dummy`. Locally it opens a DOSBox-X window briefly.

## Run / test

```sh
rebeep test run --suite interpreter
rebeep test run --suite vm      # opens 86Box; not part of --suite all
```

## Related

- [src/AGENTS.md](../src/AGENTS.md)
- [vm/AGENTS.md](vm/AGENTS.md)
