# tests

> DOS test programs, assembled from the same source as ReBeep.

## What's here

| Path | Role |
|---|---|
| `interpreter/` | Feeds scripted port-write sequences to the interpreter and checks the events. Runs headless in DOSBox-X |
| `studio/` | C test programs linked with the studio's own modules, run headless in DOSBox-X. See [studio/AGENTS.md](studio/AGENTS.md) |
| `exerciser/` | `rbtest.asm` builds `RBTEST.COM`, the speaker exerciser. It ships to players in `REBEEP\` |
| `vm/` | Unattended probes that boot `mirror-freedos` and report through `RESULT.TXT`. See [vm/AGENTS.md](vm/AGENTS.md) |

## Rules

- Interpreter test programs are `tests/interpreter/T_*.ASM`. `rebeep test run --suite interpreter`
  assembles each one and runs it headless in DOSBox-X.
- A DOS program's exit code never reaches the host, so each program writes `RESULT.TXT`: `PASS <case>`
  per passing case, `FAIL <case>: <detail>` per failure (any line starting with `FAIL` counts), and
  `DONE <n>` **last**, n the number of PASS and FAIL lines. A missing or miscounted `DONE`, any
  `FAIL`, no results, or hitting the time limit fails the run.
- `interpreter/testlib.inc` is the shared helper library: `CASE "name"` ... `ENDCASE` brackets a
  case, `t_check` (AX = CX) and `t_checkd` (also BX = SI) record the first mismatch (reported with its
  step number), and `t_done` prints `DONE <n>` last and exits.
- `interpreter/t_interp.asm` (`T_INTERP.COM`) covers the speaker interpreter: port-write sequencing,
  ignored channels and commands, glide, direct toggling, range edges, rests below 20 Hz and `interp_sync`.
- `interpreter/t_opl.asm` (`T_OPL.COM`) covers the OPL target: real chip detection, block/F-number
  against the formula, and, through a recording sink, the key bit, notes alternating over channels 7 and 8, `C0h`, volume,
  shutdown, a patch block's record (`E0h` held to 0-3 on an OPL2), octave shift and (OPL3) 4-OP voices; as an OPL2 and as an OPL3. Every routine must preserve its registers and use at most 16 bytes of stack (depths print as an `INFO` line).
- `interpreter/T_PATCH.ASM` (`T_PATCH.COM`) covers the startup part's `.RBP` parser, name rules, `RBSTUDIO.CFG` reader,
  patch lookup and INT 24h handler, on text buffers and on `FACTORY\` (the suite stages the factory files). Its cases are `patch.c`'s: both parsers take and refuse the same files.
- `interpreter/T_RULES.ASM` covers a game profile's rules (`engine/rules.asm`) and the patch switch, through a
  recording sink; `T_PROF.ASM` the `.RBG` parser (`startup/profile.asm`) on text buffers: its numbers, reasons and limits.
- Listening check: `T_OPL /L` plays the faithful voice, then the four factory records and, on an OPL3, a 4-OP patch, a second each. Run `build/tests/T_OPL.COM /L`
  in DOSBox-X with sound on, once per `oplmode` (`-set "sblaster oplmode=opl2"`, then `opl3`; one space-separated argument).
- `RBTEST.COM` plays speaker cases for listening, runs PASS/FAIL checks (with `/R`, against ReBeep's state through AMIS), probes free
  memory and times a trapped write. `P_EXER` tests it without ReBeep, `P_CAPT` with it, `P_TRACE` under REBEEPD, `P_BENCH` times it (`docs/architecture/how-it-works.md`); `RBTEST /?`.
- The CLI's own unit tests live in `tools/test/`, not here.

## Pitfalls

- A test program is a `.COM`: `org 100h`, `jmp` past the included module and library, then the cases. The suite sets the include paths (`tests/interpreter`, `src`, `src/include`).
- RBTEST's own `OUT 61h` is trapped when ReBeep is loaded (that is the test). It shrinks its memory
  block first, or `AH=48h` would report about 0 free.
- The suite runs DOSBox-X with `-set "mixer nosound=true"`, not `-silent`: `-silent` removes the Sound
  Blaster, so no OPL is found at `388h`.
- CI runs the interpreter and studio suites on `windows-latest` only, with `SDL_VIDEODRIVER` and
  `SDL_AUDIODRIVER` set to `dummy`. Locally they open a DOSBox-X window briefly.

## Run / test

```sh
rebeep test run --suite interpreter
rebeep test run --suite studio  # needs Open Watcom: rebeep tool fetch open-watcom
rebeep test run --suite vm      # opens 86Box; not part of --suite all
```

## Related

- [src/AGENTS.md](../src/AGENTS.md) · [studio/AGENTS.md](studio/AGENTS.md) · [vm/AGENTS.md](vm/AGENTS.md)
