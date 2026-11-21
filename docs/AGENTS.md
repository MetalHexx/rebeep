# docs

> Docs for people: how to use ReBeep, how it works, what it is tested on, how to get started, how the environment works, how to contribute and how to release.

## What's here

| Path | Role |
|---|---|
| `usage.md` | The player reference: options, hotkeys, voices, exit codes, `RBTEST`, troubleshooting. `release/README.TXT` mirrors its tables |
| `how-it-works.md` | The design for curious readers, and the `RBTEST /B` numbers measured by `P_BENCH` |
| `compatibility.md` | Tested games and hardware, known conflicts |
| `gpc.md` | How GPC drives the speaker, ReBeep's handling, what still differs |
| `getting-started.md` | Zero to first boot, Free and Full paths, and the Verified-on table |
| `86box-environment.md` | The VMs, disks, boot flow, snapshot and reset |
| `contributing.md` | Set up, workflow and checks, commits, PR rules, payload rules |
| `images/` | Pictures the docs show. `rebeep-logo.png` is the README's logo, on a transparent background |
| `releasing.md` | The maintainer's release procedure, with the checks by a person that gate the merge |

## Rules

- Style, altitude and budgets: the root [AGENTS.md](../AGENTS.md) "Writing docs" section.
- A new doc gets a line in the root [README.md](../README.md)'s Documentation index, under Playing or Working on ReBeep.

## Pitfalls

- `usage.md` and `release/README.TXT` hold the same option, hotkey and exit-code tables. Change both together.
- The benchmark numbers in `how-it-works.md` come from `rebeep test run --suite vm --probe P_BENCH`. Re-measure when the trap code changes.
- Host-specific steps (Windows, Linux, macOS) drift fastest. Mark anything not verified on a host.

## Run / test

_No commands._

## Related

- [../README.md](../README.md)
- [../AGENTS.md](../AGENTS.md)
