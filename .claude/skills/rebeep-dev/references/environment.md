# Environment: setup, status, reset, clean, media

The environment home is `~/.rebeep` (override with `REBEEP_HOME` or `--home`).

| Goal | Command |
|---|---|
| Is the host ready? | `rebeep env check` |
| What's installed and running? | `rebeep env status` |
| Fetch tools, create VMs, deploy D: | `rebeep env setup` |
| Bring your own MS-DOS 6.22 | `rebeep media add msdos622 <folder with 3 .ima>` |
| Bring your own game | `rebeep media add game <zip> --name <NAME>` |
| Every VM back to its baseline | `rebeep env reset --preview`, then `--yes` |
| Delete tools, cache and VMs (keeps media and baselines) | `rebeep env clean --preview`, then `--yes` |
| Also delete media and baselines | `rebeep env clean --all --preview`, then `--yes` |

`env setup` is safe to re-run. It skips anything already done and says why it skipped a VM.
