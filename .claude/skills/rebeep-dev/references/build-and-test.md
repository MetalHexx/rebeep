# Build, deploy and test

| Goal | Command |
|---|---|
| Build everything in `src/targets.json` | `rebeep build run` |
| Build and write every VM's D: | `rebeep build run --deploy` |
| Rewrite D: without building | `rebeep disk deploy [vm]` |
| CLI unit tests | `rebeep test run --suite tools` |
| DOS interpreter tests (DOSBox-X) | `rebeep test run --suite interpreter` |
| Unattended VM probes (opens 86Box; builds first) | `rebeep test run --suite vm [--probe P_SMOKE] [--skip-build]` |

The vm suite is not part of `--suite all`. Probe format and rules: `tests/vm/AGENTS.md`.

The loop: edit `src/` → `rebeep build run --deploy` → boot the VM → run `D:\REBEEP\REBEEP`.
