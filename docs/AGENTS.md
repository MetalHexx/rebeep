# docs

> Docs for people: how to get started, how the environment works, how to contribute.

## What's here

| Path | Role |
|---|---|
| `README.md` | Index: one line per doc |
| `getting-started.md` | Zero to first boot, Free and Full paths, and the Verified-on table |
| `86box-environment.md` | The VMs, disks, boot flow, snapshot and reset |
| `contributing.md` | Workflow, commits, PR rules, payload rules |

## Rules

- Scannable and high signal: tables, short bullets, commands you can copy.
- Commands and options must match `rebeep ... --help`. Change both in the same PR.
- A new doc gets a line in `README.md` here.
- The repo's front door is the root `README.md`. Keep it short and link here for detail.

## Pitfalls

- Host-specific steps (Windows, Linux, macOS) drift fastest. Mark anything not verified on a host.

## Run / test

_No commands._

## Related

- [../README.md](../README.md)
- [../AGENTS.md](../AGENTS.md)
