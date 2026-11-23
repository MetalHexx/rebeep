# Build, deploy and test

| Goal | Command |
|---|---|
| Build everything in `src/targets.json` (NASM `bin` targets, Open Watcom `exe` targets) | `rebeep build run` |
| Build and write every VM's D: | `rebeep build run --deploy` |
| Rewrite D: without building | `rebeep disk deploy [vm]` |
| CLI unit tests | `rebeep test run --suite tools` |
| DOS interpreter tests (DOSBox-X) | `rebeep test run --suite interpreter` |
| Studio C tests: `tests/studio/T_*.C` compiled with the studio modules, run in DOSBox-X, then each `/DUMP` is compared with `tests/screens` (needs Open Watcom) | `rebeep test run --suite studio` |
| Unattended VM probes (opens 86Box; builds first) | `rebeep test run --suite vm [--probe P_SMOKE] [--skip-build]` |

The vm suite boots `mirror-freedos` once per `tests/vm/P_*.BAT` probe (`P_SMOKE`, `P_EXER`, `P_TSR`,
`P_CAPT`, `P_BENCH`) and is not part of `--suite all`. Probe format and rules: `tests/vm/AGENTS.md`.
Re-run `P_BENCH` when the trap code changes and update the numbers in `docs/architecture/how-it-works.md`.

`--suite all` runs tools, interpreter and studio. `src/targets.json` may also list data `files` (factory patches, art):
`build run` copies them to `build/files/<deploy>/` and the delivery puts them on D: at `<deploy>\`.
A `/* SUITE: OPL2 */` first line makes a studio test run again as an OPL2 card.

A C target (`RBSTUDIO.EXE`) needs the compiler: `rebeep tool fetch open-watcom` once (about 150 MB), or `REBEEP_WATCOM`.
`RBSTUDIO /BENCH` writes `BENCH.TXT`: the full-redraw time, run on the VM for the number that matters.

The loop: edit `src/` → `rebeep build run --deploy` → boot the VM (the dev entry autoloads the build)
→ `D:\REBEEP\RBTEST /A /R`.
