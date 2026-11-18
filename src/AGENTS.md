# src

> ReBeep's NASM source. The module folders are empty until the TSR is written.

## What's here

| Path | Role |
|---|---|
| `targets.json` | What `rebeep build run` assembles: name, source, output format |
| `rebeep.asm` | Entry point. A placeholder that prints its version today |
| `include/` | Shared constants and macros. `speaker.inc`: port numbers, port `61h` bits, interpreter modes and events, the translatable divisor range. `opl.inc`: OPL ports, register bases, channel 8's operator offsets |
| `startup/` | Checks, option parsing, help, going resident. Freed before going resident |
| `capture/` | QPI trap handler and port masking |
| `engine/` | Interpreter, OPL target and their state. `interp.asm` is the speaker interpreter, `opl.asm` the OPL render target |
| `hotkey/` | Keyboard hook |
| `resident/` | TSR identification and unload |
| `diag/qpichk.asm` | `QPICHK.COM`: reports whether Jemm's QPIEMU is up. Deployed to `D:\ENV\` and run by `BOOT.BAT` |

## Rules

- `engine/` assembles under `CPU 8086`. Only `capture/` and `startup/` may use 386 instructions.
- The source must assemble on NASM 3.02 and on NASM ≥ 2.16.
- Output names are 8.3, uppercase (`REBEEP.COM`).
- A new build target goes in `targets.json`, not in the CLI.

## Pitfalls

- Module files in `engine/` are included, not assembled alone: no `org`, state bytes live in the
  module, and each file sets its own `cpu` and includes `speaker.inc` (guarded, safe to repeat).
  The caller's `DS` must be the module's segment.
- The interpreter (`engine/interp.asm`) is register-based: `interp_reset`, `interp_sync`,
  `interp_write` (AL = byte, DX = port; out AL = event, AH = mode, BX = divisor). Each preserves
  every register but its outputs. It is 8086-only: a 386 instruction there fails the build.
- The OPL target (`engine/opl.asm`) plays one voice on channel 8 and writes only that channel's
  registers, global `01h` and (OPL3) `105h`. `opl_write` is the single path to the chip: define
  `OPL_TEST_SINK` as a label before the include and it jumps there instead of the ports.
- OPL3 pitfalls: `C0h` must carry `30h` (left/right) or the channel is silent in NEW mode, and
  `opl_pitch` must never clear the key bit or a glide retriggers. OPL2 has no square waveform, so the
  faithful voice is a 2:1 FM approximation (values documented in the file). Write delays are status
  reads, picked by chip (OPL2 6/35, OPL3 2/2).
- A PIT control word never changes the current tone or verdict. The new counting mode and pitch
  apply only when the count completes, and the first byte of an LSB-then-MSB count leaves the
  pitch alone. Without that, a mid-tone control word or half-written count would cut a tone.
- A count of 0 means 65536, which is out of the translatable range, so it is RAW.
- NASM rejects an out-of-range short conditional jump under `cpu 8086`; keep branches local.

## Run / test

```sh
rebeep build run --deploy
```

## Related

- [tests/AGENTS.md](../tests/AGENTS.md)
- [tools/AGENTS.md](../tools/AGENTS.md): `build run`
