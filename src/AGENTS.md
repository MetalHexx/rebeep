# src

> ReBeep's NASM source (the resident TSR, its startup code, the speaker interpreter, the OPL target) and the C studio.

## What's here

| Path | Role |
|---|---|
| `targets.json` | What `rebeep build run` builds, plus an optional `files` list of data files under `src/` (`source` with an 8.3 upper-case base name, `deploy` one to four 8.3 folders such as `REBEEP/FACTORY/PATCHES`): copied to `build/files/` and put on D:. Each target: name, source, `format` (`bin` = one NASM file, `exe` = a folder of C files built with Open Watcom), optional `root` (`src`, the default, or `tests`), `deploy` folder, `autoload` (the deploy then writes `AUTOLOAD.FLG` beside it), `defines` (extra NASM `-D` names: `REBEEP_TRACE` builds `REBEEPD.COM`, dev-only, never packaged; `REBEEP.COM` is unchanged by it) |
| `rebeep.asm` | `REBEEP.COM`: the resident part, then `resident_end`, then the startup part |
| `resident/` | `data.asm`: `RB_STATE` (the loaded patch's records too), saved vectors, the private stack. `amis.asm`: the `INT 2Dh` handler and uninstall |
| `capture/` | `trap.asm`: QPI trap install and remove, the callback, the port semantics (masking, read view, OPL events). `trace.asm`: REBEEPD's log |
| `engine/` | `interp.asm` the speaker interpreter, `opl.asm` the OPL render target, `rules.asm` a game profile's rules, their table and the patch switch, `fx.asm` its effects on the effect voice |
| `hotkey/kbd.asm` | The `INT 09h` hook for the Ctrl+Alt keys |
| `startup/` | `main.asm`: options, checks, load, change, unload, messages. `patch.asm`: the `.RBP` parser. `files.asm`: program folder, `RBSTUDIO.CFG`, name rules, patch lookup, an INT 24h fail handler (`crit_on`/`crit_off`) around the file reads. `profile.asm`: `/G:`, the `.RBG` parser and loader. `opldet.asm`: `opl_detect`. `dump.asm`: `REBEEPD /D`. All freed when going resident |
| `include/` | `speaker.inc`, `opl.inc`: ports and registers. [amis.inc](include/amis.inc): the AMIS functions and `RB_STATE` layout. [profile.inc](include/profile.inc): the profile table and its limits. [exitcode.inc](include/exitcode.inc): the exit codes. `trace.inc`: REBEEPD's record. None is restated elsewhere |
| `studio/` · `factory/` | `RBSTUDIO.EXE`, ReBeep Studio (the configuration program), in C: rules in [studio/AGENTS.md](studio/AGENTS.md) · the defaults ReBeep ships: `patches/`, the factory patches |
| `diag/` | `qpichk.asm` → `QPICHK.COM`, reports whether QPIEMU is up (run by `BOOT.BAT`). `fdboot.asm` → `FDBOOT.BIN`, the release floppy's boot sector: hands the boot to C:, asks for a key only when C: has none |

## Rules

- **Resident below `resident_end`:** the engine's state, `RB_STATE`, the hook variables and the private stack; startup code and its data are freed. Its size is capped (`RESIDENT_MAX` in `rebeep.asm`): raise it only on purpose.
  **Nothing resident calls DOS:** uninstall reads the IVT directly; the command-line copy frees the memory.
- **QPI-only I/O.** On 42h, 43h and 61h the resident part uses QPI `1A00h`/`1A01h`/`1A04h`, never `IN`/`OUT`
  (a direct access traps again). The hotkey never executes `STI`; its one `61h` access is the speaker handoff.
- **Masking.** In `M_TONE` or `M_REST` (translation on) the real `61h` holds bit 1 clear, or the gate if the speaker rests
  high (`10`), so it never steps; `/R:0` holds bit 1 in every mode. `IN 61h` returns the game's bits 0-1; a change re-issues `61h`.
- The callback saves every register: QPIEMU restores only `ECX`, `EDX` and the flags. It pushes nothing on the caller's stack, which can be a small DOS one a game's interrupt landed on; it switches first (RBTEST `stack-footprint`).
- `engine/` assembles under `CPU 8086`; only `capture/` and `startup/` may use 386 (the CPU check must run on any CPU).
- NASM 3.02 and ≥ 2.16. Output names are 8.3, uppercase. A new build target goes in `targets.json`. The build defines
  `REBEEP_VERSION` and `REBEEP_VER_MAJOR/MINOR/PATCH` (`-D` for NASM, a generated `version.h` for C); `rebeep.asm` stops without them.
- **Manually verified only** (the VM can't produce them): CPU below 386 (exit 2), no OPL (4), speaker ports
  already trapped (5), a refused `/ON`. Each is its own short routine: `check_cpu`, `opl_detect`, `capture_install`.

## Pitfalls

- Included modules have no `org`, keep their state inside and set their own `cpu`. The caller's `DS`
  is the module's segment. `interp.asm` and `opl.asm` preserve every register but their outputs.
- `interp_sync` reports no event: if a tone was playing, call `fx_quiet`. Stack use: interpreter at most
  8 bytes, OPL target at most 16 (`T_OPL` checks), `fx.asm` 6 more (`T_FX`). `opl_write` is the one path to the chip (`OPL_TEST_SINK`).
- Each note on takes the other channel: 7 and 8, or a 4-OP voice's bank 1 pairs 0+3 and 1+4, keyed through the first channel. `opl_pitch` stays on its own and never clears the key bit, or a glide retriggers.
  The effect voice is opl.asm's second context (channel 6, or pair 2+5): only `fx.asm` calls `opl_ctx_swap`, and swaps back before it returns. `opl_set_voice` latches the mode (`opl_four`) and keys the old channels off before `104h` changes: nothing else reads `RB_STATE`, which already holds the new block. OPL3's `C0h` needs the left/right bits.
- A PIT control word never changes the current tone; the new mode and pitch apply when the count completes.
  Below 20 Hz (above `DIV_MAX`, or 0 = 65536) is `M_REST`, OPL keyed off, or `M_TONE` once `interp_low` is set (`/L:1`).
- While the traps are off the OPL belongs to the game: no OPL or `61h` write, and uninstall skips
  `opl_shutdown`. The hotkey then only updates `RB_STATE`. `/OFF` first undoes any masking; `/ON` resyncs.
- A command-line change writes only the fields it names (`/P:`: the whole patch block at once, interrupts off). Defaults apply on a plain load alone. `/P:` and `PATCH=` share one name rule (`spec_valid`); a patch that can't be used is a message and the faithful voice, never an exit code.
- NASM rejects an out-of-range short jump under `cpu 8086`; keep branches local. DOS `09h` returns `AL = '$'`.
- A profile's table is resident at its full size from the first load, so a later `/G:` always fits: raising a limit costs every player memory, and any change to the table bumps `PROF_LAYOUT`. Its rules see each game event, translation on or off, before `play_event`; a switch keeps a tone that sounds on in the new voice (`capture_voice_changed`). Every path that restarts or drops a tone goes through `fx_play` or `fx_quiet`, so an effect is never left sounding.

## Run / test

```sh
rebeep build run --deploy
rebeep test run --suite vm --probe P_TSR
```

## Related

- [tests/AGENTS.md](../tests/AGENTS.md) · [tools/AGENTS.md](../tools/AGENTS.md): `build run`
