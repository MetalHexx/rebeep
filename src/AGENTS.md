# src

> ReBeep's NASM source. The module folders are empty until the TSR is written.

## What's here

| Path | Role |
|---|---|
| `targets.json` | What `rebeep build run` assembles: name, source, output format |
| `rebeep.asm` | Entry point. A placeholder that prints its version today |
| `include/` | Shared constants and macros |
| `startup/` | Checks, option parsing, help, going resident. Freed before going resident |
| `capture/` | QPI trap handler and port masking |
| `engine/` | Interpreter, OPL target and their state |
| `hotkey/` | Keyboard hook |
| `resident/` | TSR identification and unload |

## Rules

- `engine/` assembles under `CPU 8086`. Only `capture/` and `startup/` may use 386 instructions.
- The source must assemble on NASM 3.02 and on NASM ≥ 2.16.
- Output names are 8.3, uppercase (`REBEEP.COM`).
- A new build target goes in `targets.json`, not in the CLI.

## Pitfalls

_None recorded yet._

## Run / test

```sh
rebeep build run --deploy
```

## Related

- [tests/AGENTS.md](../tests/AGENTS.md)
- [tools/AGENTS.md](../tools/AGENTS.md): `build run`
