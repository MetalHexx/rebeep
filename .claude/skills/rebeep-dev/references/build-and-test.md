# Build, deploy and test

| Goal | Command |
|---|---|
| Build everything in `src/targets.json` | `rebeep build run` |
| Build and write every VM's D: | `rebeep build run --deploy` |
| Rewrite D: without building | `rebeep disk deploy [vm]` |
| CLI unit tests | `rebeep test run --suite tools` |
| DOS interpreter tests (DOSBox-X) | `rebeep test run --suite interpreter` |
| Unattended VM probes (opens 86Box; builds first) | `rebeep test run --suite vm [--probe P_SMOKE] [--skip-build]` |

The vm suite boots `mirror-freedos` once per `tests/vm/P_*.BAT` probe (`P_SMOKE`, `P_EXER`, `P_TSR`,
`P_CAPT`, `P_BENCH`) and is not part of `--suite all`. Probe format and rules: `tests/vm/AGENTS.md`.
Re-run `P_BENCH` when the trap code changes and update the numbers in `docs/how-it-works.md`.

The loop: edit `src/` → `rebeep build run --deploy` → boot the VM (the dev entry autoloads the build)
→ `D:\REBEEP\RBTEST /A /R`.
