# VMs: create, install DOS, run, snapshot

| VM | C: comes from |
|---|---|
| `mirror-msdos` | Blank; you install MS-DOS 6.22 by hand |
| `mirror-freedos` | Built by script from the FreeDOS 1.4 packages |
| `slow-386sx` | Cloned from the `mirror-msdos` baseline |

| Goal | Command |
|---|---|
| List VMs and their state | `rebeep vm list` |
| Create a VM | `rebeep vm create <vm>` |
| Install DOS (A: + C:, no D:) | `rebeep vm run <vm> --install` |
| Run | `rebeep vm run <vm>` |
| Save a baseline | `rebeep vm snapshot <vm>` (VM must be stopped) |
| Back to the baseline | `rebeep vm reset <vm> --yes` |

The 86Box GUI's settings are not kept. Change the profile's `86box.cfg.tmpl` instead.
