# studio

> `RBSTUDIO.EXE`: the ReBeep tracker studio, a C program for DOS built with Open Watcom.

## What's here

| Path | Role |
|---|---|
| `main.c` | The entry point, argument handling and the top-level flow (`/?`, `/BENCH`, `/DUMP:`, the detection log, splash and menu loop, the Patch Editor flow menu → patch list → synth screen with Esc stepping back, giving the chip, mouse and ReBeep back at exit) |
| `dos.c` · `dos.h` | Program folder from `argv[0]`; Ctrl+Break, Ctrl+C and critical-error handlers; `dos_hook` and `dos_restore`; file helpers (`dos_read_file`, `dos_make_dir`, `dos_each`, the safe save `dos_save_file`) |
| `patch.c` · `patch.h` | The patch model (`Patch`, `Voice`, `Op`: the editor's values, never registers) and the RBP text file: `patch_parse`, `patch_format`, `patch_read`, `patch_write`. P05's NASM parser follows the same rules |
| `library.c` · `library.h` | The patch list: `FACTORY\` beside the program, `USER\` and packs in the patches folder; lookup, overrides, `name_valid`, `path_valid` for `PATCHES=` |
| `settings.c` · `settings.h` | `RBSTUDIO.CFG`, read only (`cfg_load`, `cfg_get`) |
| `log.c` · `log.h` | `RBSTUDIO.LOG`, replaced each run, each line committed at once (DOS `68h`) |
| `undo.c` · `undo.h` | Whole-`Patch` snapshots in far memory, 100 steps, redo, key-coalesced edits |
| `data/FACTORY/*.RBP` | The four factory patches; `targets.json` `files` ships them to `REBEEP\FACTORY\` |
| `opl.c` · `opl.h` | The OPL driver: detection, `opl_regs2`/`opl_regs4` (the one parameter-to-register mapping), live notes on every channel, `opl_sink` for tests, `/TRACE` write logging |
| `jingle.c` · `jingle.h` | The splash jingle on `FACTORY\BELL`, advanced by `jingle_poll` from the BIOS tick count |
| `rebeep.c` · `rebeep.h` | The resident ReBeep through AMIS (INT 2Dh): traps off (13h) at start, on (12h) at exit |
| `video.c` · `video.h` | The 80x25 back buffer, the flush to `B800:0000`, blink and cursor handling; the `scr_*` screen layer (CP437 text, `SCR_KEEP` colours, boxes, the splash ramp, `scr_dump`) |
| `roles.c` · `roles.h` | The one role table (a colour and a mono index per role) and the colour or mono view |
| `ansi.c` · `ansi.h` | `ansi_draw` for the `.ans` art, and `scr_remap_mono` (the shared mono remap) |
| `mouse.c` · `mouse.h` | INT 33h, used only when a driver answers; cells are pixels / 8 |
| `keys.c` · `keys.h` | The one table of key bindings (`id, ctx, scan, mods`) and `key_lookup` |
| `scr_log.c` · `scr_spl.c` · `scr_menu.c` · `screens.h` | The detection log, the splash, the menu and its "coming soon" page |
| `scr_list.c` | The patch list: `list_draw` from the library, `list_scroll` (the window that keeps the selection and its folder heading in view), `list_item_at` (a click's row to an entry) |
| `scr_syn.c` · `editor.h` | The synth screen, a port of the mockup's `synth()` for both variants (`synth_draw`); `Editor`, the state it draws and the editing keys will change |
| `sample.c` | The fixed sample data (version 0.1.0, the sample detection, the sample patch list, patch 12 of 40 BRASS) and the screen names `/DUMP:` can draw |
| `data/SPLASH.ANS` · `data/MENU.ANS` | The art; `targets.json` `files` ships them to `REBEEP\` |
| `kbd.c` · `kbd.h` | The `INT 09h` handler: make and break codes, a key-state table, an event queue |

## Rules

- **Build:** `rebeep build run` compiles every `*.c` here with `wcl` (`-bt=dos -mm -0 -os -w4`) and links one EXE.
  The `package.json` version reaches C through the generated `build/gen/version.h` (`REBEEP_VERSION`, `REBEEP_VER_MAJOR/MINOR/PATCH`).
- **Linking rule:** `rebeep test run --suite studio` links every module here except `main.c` into each test program
  (`tests/studio/T_*.C`, [tests/studio/AGENTS.md](../../tests/studio/AGENTS.md)). So no module may use a symbol defined in
  `main.c`, and `main.c` holds only the entry point, argument handling and the top-level flow.
- **8086 only, medium model** (far code, near data). The 64 KB data group must hold: big buffers (undo history, the
  patch list) go in far memory.
- **Every vector goes through `dos_hook()`**, and `dos_restore()` puts them all back. It runs at `atexit` and on the
  normal exit. A vector left pointing into a freed program hangs the machine on the next key press.
- **An interrupt handler** is `__interrupt __far`, calls nothing in the C library, sits inside
  `#pragma off (check_stack)` (it runs on the interrupted program's stack, which the stack limit doesn't describe), and ends with
  `_chain_intr(old)`. Port reads in it are inline (`#pragma aux`), not `inp`. It shares data with `main` only through
  `volatile` bytes and the single-producer queue.
- **Ctrl+Break and Ctrl+C do nothing; a critical error fails the call** (`INT 24h` returns `AL = 3`): a write to a
  read-only floppy returns an error to the program instead of "Abort, Retry, Fail".
- **The screen goes through `video_*`** into the back buffer, then one `video_flush`. Blink is off while running (bit 7 of
  an attribute is a bright background), back on at exit; the cursor is hidden and restored; the screen is cleared on exit.
- **Patch values are the editor's:** SL and OL are stored so bigger is louder; registers come only from the mapping in the
  sound module. A bad or unreadable patch file is left out of the list and logged with its reason, never fixed up.
- **Paths are untrusted:** `PATCHES=` passes `path_valid` (plain 8.3 components, no `..` or wildcards, 64 chars) or the
  default folder is used; every path built stays under the program or patches folder. `FACTORY` and `USER` are reserved names.
- **Big buffers are far or static:** the library entries (512) and undo history are `_fmalloc`ed; the path and I/O buffers in
  `library.c` and `patch.c` are static, because the stack is 2 KB.
- **Saves go through `dos_save_file`** (`NAME.$$$`, rename old to `.BAK`, rename new, delete `.BAK`): a full or read-only
  disk fails with the old file untouched.
- **The studio owns the OPL while it runs.** Every register write goes through `opl_write` (the ports, or `opl_sink`, and
  `log_trace` under `/TRACE`) with the status-read delays per chip that `opl.asm` uses. Switching between two- and
  four-operator voices keys every channel off before `104h` changes. A four-operator voice does not play on an OPL2.
  `opl_shutdown` leaves `104h` and `105h` at 0; call `rebeep_resume` after it so a resident ReBeep re-initialises.
- **The reference screens are the screen spec.** `tests/screens/<screen>.<view>.scr` (format in
  [tests/studio/AGENTS.md](../../tests/studio/AGENTS.md)) is what a screen must draw. A screen change edits its `.scr`
  first, in the same change as the code; the exporters that made the files stay outside the repo.
- **Two mono rules.** Screens that came from the HTML mockup (synth, help, save prompt) take the role table's mono column.
  Screens that came from an `.ans` (splash, menu, detection log, patch list) draw standard-view indexes, and in mono every
  cell passes through `scr_remap_mono()` last, cells drawn on top of the art included (it moves only index 2, to 12).
- **Art colour order.** `ansi_draw` reads standard ANSI SGR (31 red, 34 blue, 33 yellow, 36 cyan). The project's art was
  packed in PC order (`30 + index`), so a new `.ans` drop is converted on the way in: inside `ESC[...m` only, swap 31/34,
  33/36, 41/44 and 43/46, every other byte (the SAUCE record too) unchanged. The converted file opens correctly in an
  ANSI editor and renders to the indexes the references hold.
- **Dump mode** (`/DUMP:<screen> [/VIEW:MONO] /O:<file>`) touches only the art and the output, plays nothing, shows no
  mouse and uses `sample.c`'s data. An unknown screen exits 4 and writes nothing. Drawable now: `detectlog`, `splash`, `menu`,
  `patchlist`, `synth-4op`, `synth-2op`.
- **One grid for both variants.** The 2-OP synth screen is the 4-OP one with wider slots (`cell()`'s `z`): the parameter-name
  column and operator 1's left edge sit at the same cells, the bars end one cell before each slot's rule. Never lay 2-OP out apart.
- **The envelope is integer maths.** `env_levels` in `scr_syn.c` is the mockup's envelope as whole numbers over a common
  denominator (no floating point); the waveform is a table of 20 heights per shape. Keep both matching the mockup.
- A C literal with a CP437 glyph above 7Fh uses a hex escape in a literal of its own (`"\xFB" "  text"`), or the next
  hex digit joins the escape.
- Output names are 8.3, uppercase. Keep C89: declarations at the top of a block.

## Pitfalls

- **Never add this folder to the compiler's include path.** `dos.h` here would shadow `<dos.h>`; `"dos.h"` is found beside
  the including file, and `<dos.h>` still reaches Open Watcom's.
- `kbd` gets E0-prefixed keys as `KBD_EXT` codes, drops the fake shifts around Print Screen, and swallows Pause's
  `E1 1D 45 E1 9D C5`. A key's make repeats while it is held.
- The BIOS still sees every key, so `main` empties its buffer, or a full one beeps.
- The BIOS tick count at `0040:006Ch` is 18.2 Hz: `/BENCH` resolution is about 55 ms in total, so judge it over its 200 redraws.
- The stack is the linker default, 2 KB (`Stack size` in `build/RBSTUDIO.MAP`). Keep big arrays off it: static or far storage.

## Run / test

```sh
rebeep tool fetch open-watcom
rebeep build run --deploy
```

In DOSBox-X or on a VM: `RBSTUDIO`, `RBSTUDIO /BENCH` (writes `BENCH.TXT` in the current folder).
To watch a flow with typed keys and screenshots (menu, patch list, synth screen, Esc), see the [drive-dos-app skill](../../.claude/skills/drive-dos-app/SKILL.md).

## Related

- [src/AGENTS.md](../AGENTS.md)
- [tools/AGENTS.md](../../tools/AGENTS.md): the `open-watcom` tool and `lib/watcom`
