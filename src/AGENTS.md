# src

> ReBeep's NASM source: the resident TSR, its startup code, the speaker interpreter and the OPL target.

## What's here

| Path | Role |
|---|---|
| `targets.json` | What `rebeep build run` assembles: name, source, format, optional `root` (`src`, the default, or `tests`), `deploy` folder, `autoload` (the deploy then writes `AUTOLOAD.FLG` beside it) |
| `rebeep.asm` | `REBEEP.COM`: the resident part, then `resident_end`, then the startup part |
| `resident/` | `data.asm`: `RB_STATE`, saved vectors, the private stack. `amis.asm`: the `INT 2Dh` handler and uninstall |
| `capture/trap.asm` | QPI trap install and remove, the callback, and the port semantics (masking, read view, OPL events) |
| `engine/` | `interp.asm` the speaker interpreter, `opl.asm` the OPL render target |
| `hotkey/kbd.asm` | The `INT 09h` hook for the Ctrl+Alt keys |
| `startup/main.asm` | Options, checks, load, change, unload, messages. Freed when going resident |
| `include/` | `speaker.inc`, `opl.inc`: ports and registers. [amis.inc](include/amis.inc): the AMIS functions and `RB_STATE` layout. [exitcode.inc](include/exitcode.inc): the exit codes. Neither is restated elsewhere |
| `diag/` | `qpichk.asm` → `QPICHK.COM`, reports whether QPIEMU is up (run by `BOOT.BAT`). `fdboot.asm` → `FDBOOT.BIN`, the release floppy's boot sector: hands the boot to C:, asks for a key only when C: has none |

## Rules

- **Resident below `resident_end`.** The engine's state, `RB_STATE`, the hook variables and the private stack
  all live in the resident part. Startup code and its data are freed.
- **Nothing resident calls DOS.** Uninstall reads the IVT directly; the command-line copy frees the memory.
- **QPI-only I/O.** On 42h, 43h and 61h the resident part uses QPI `1A00h`/`1A01h`/`1A04h`, never `IN`/`OUT`
  (a direct access traps again). The hotkey never executes `STI`; its one `61h` access is the speaker handoff.
- **Masking.** In `M_TONE` or `M_REST` (translation on) the real `61h` holds bit 1 clear, or the gate if the speaker rests
  high (`10`), so it never steps; `IN 61h` returns the game's bits 0-1. Entering or leaving them re-issues `61h` at once.
- The callback saves every register: QPIEMU restores only `ECX`, `EDX` and the flags.
- `engine/` assembles under `CPU 8086`; only `capture/` and `startup/` may use 386 (the CPU check must run on any CPU).
- NASM 3.02 and ≥ 2.16. Output names are 8.3, uppercase. A new build target goes in `targets.json`.
- The build defines `REBEEP_VERSION` and `REBEEP_VER_MAJOR/MINOR/PATCH`; `rebeep.asm` stops without them.
- **Manually verified only** (the VM can't produce them): CPU below 386 (exit 2), no OPL (4), speaker ports
  already trapped (5), a refused `/ON`. Each is its own short routine: `check_cpu`, `opl_detect`, `capture_install`.

## Pitfalls

- Included modules have no `org`, keep their state inside and set their own `cpu`. The caller's `DS`
  is the module's segment. `interp.asm` and `opl.asm` preserve every register but their outputs.
- `interp_sync` reports no event: if a tone was playing, call `opl_note_off`. Stack use: interpreter at most
  8 bytes, OPL target at most 16 (`T_OPL` checks). `opl_write` is the one path to the chip (`OPL_TEST_SINK`).
- Each note on takes the other of channels 7 and 8; `opl_pitch` stays on its channel and never clears the key bit,
  or a glide retriggers. OPL3's `C0h` needs the left/right bits. OPL2's faithful voice is a 2:1 FM approximation.
- A PIT control word never changes the current tone; the new mode and pitch apply when the count completes.
  Below 20 Hz (above `DIV_MAX`, or 0 = 65536) is `M_REST`, OPL keyed off, or `M_TONE` once `interp_low` is set (`/L:1`).
- While the traps are off the OPL belongs to the game: no OPL or `61h` write, and uninstall skips
  `opl_shutdown`. The hotkey then only updates `RB_STATE`. `/OFF` first undoes any masking; `/ON` resyncs.
- A command-line change writes only the fields it names. Defaults apply on a plain load alone.
- NASM rejects an out-of-range short jump under `cpu 8086`; keep branches local. DOS `09h` returns `AL = '$'`.

## Run / test

```sh
rebeep build run --deploy
rebeep test run --suite vm --probe P_TSR
```

## Related

- [tests/AGENTS.md](../tests/AGENTS.md)
- [tools/AGENTS.md](../tools/AGENTS.md): `build run`
