# tests

> DOS test programs, assembled from the same source as ReBeep.

## What's here

| Path | Role |
|---|---|
| `interpreter/` | Feeds scripted port-write sequences to the interpreter and checks the events. Runs headless in DOSBox-X |
| `exerciser/` | `rbtest.asm` builds `RBTEST.COM`, the speaker exerciser. It ships to players in `REBEEP\` |
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
  case, `t_check` (AX = CX) and `t_checkd` (also BX = SI) record the first mismatch (reported with its
  step number), and `t_done` prints `DONE <n>` last and exits.
- `interpreter/t_interp.asm` (`T_INTERP.COM`) covers the speaker interpreter: port-write sequencing,
  ignored channels and commands, glide, direct toggling, range edges and `interp_sync`.
- `interpreter/t_opl.asm` (`T_OPL.COM`) covers the OPL target: real chip detection, block/F-number
  against the formula, and, through a recording sink, the key bit, channel-8-only writes, the OPL3
  `C0h` bits, volume and shutdown, once as an OPL2 and once as an OPL3. It also checks that every
  routine preserves its registers and uses at most 16 bytes of stack (depths print as an `INFO` line).
- Listening check: `T_OPL /L` plays each voice for a second at 440 Hz. Run `build/tests/T_OPL.COM /L`
  in DOSBox-X with sound on, once per `oplmode` (`-set sblaster,oplmode=opl2`, then `opl3`).
- `RBTEST.COM` plays speaker cases for listening, runs PASS/FAIL behaviour checks (optionally against
  ReBeep's state through AMIS), probes free memory and times a trapped write. `P_EXER` tests it without
  ReBeep, `P_CAPT` with it, `P_BENCH` times it (the numbers in `docs/how-it-works.md`); options: `RBTEST /?`.
- The CLI's own unit tests live in `tools/test/`, not here.

## Pitfalls

- A test program is a `.COM`: `org 100h`, `jmp` past the included module and library, then the
  cases. The three include paths come from the suite (`tests/interpreter`, `src`, `src/include`).
- RBTEST's own `OUT 61h` is trapped when ReBeep is loaded (that is the test). It shrinks its memory
  block first, or `AH=48h` would report about 0 free.
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
