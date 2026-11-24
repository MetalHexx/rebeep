# How ReBeep Studio is built

For the curious and for contributors: the modules of `RBSTUDIO.EXE`, ReBeep's configuration program
(its first screen is the patch editor), and the design choices behind them. What a player sees is in
the [studio guide](../guide/studio.md); the hard rules for changing the code are in
[src/studio/AGENTS.md](../../src/studio/AGENTS.md).

## The modules

| Path | Role |
|---|---|
| `main.c` | The entry point, argument handling and the top-level flow (`/?`, `/BENCH`, `/DUMP:`, `/TRACE`, the detection log, splash and menu loop, the Patch Editor flow menu → patch list → synth screen with Esc stepping back, the help and the save prompt drawn over the synth screen, giving the chip, mouse and ReBeep back at exit) |
| `dos.c` · `dos.h` | Program folder from `argv[0]`; Ctrl+Break, Ctrl+C and critical-error handlers; `dos_hook` and `dos_restore`; file helpers (`dos_read_file`, `dos_make_dir`, `dos_each`, the safe save `dos_save_file`) |
| `patch.c` · `patch.h` | The patch model (`Patch`, `Voice`, `Op`: the editor's values, never registers) and the RBP text file: `patch_parse`, `patch_format`, `patch_read`, `patch_write`; `patch_carriers`, which operators a connection makes heard. The NASM parser in `startup/patch.asm` follows the same rules |
| `dice.c` · `dice.h` | Random and Mutate: a seedable xorshift32 (`dice_seed`, from the BIOS tick count at start), `dice_roll` (a whole voice) and `dice_mutate` (a few small steps); all the tuning is one table at the top |
| `library.c` · `library.h` | The patch list: `FACTORY\` beside the program, `USER\` and packs in the patches folder; lookup, overrides, `name_valid`, `path_valid` for `PATCHES=` |
| `settings.c` · `settings.h` | `RBSTUDIO.CFG`, read only (`cfg_load`, `cfg_get`) |
| `log.c` · `log.h` | `RBSTUDIO.LOG`, replaced each run, each line committed at once (DOS `68h`) |
| `undo.c` · `undo.h` | Whole-`Patch` snapshots in far memory, 100 steps, redo, key-coalesced edits |
| `data/FACTORY/*.RBP` | The four factory patches; `targets.json` `files` ships them to `REBEEP\FACTORY\` |
| `opl.c` · `opl.h` | The OPL driver: detection, `opl_regs2`/`opl_regs4` (the one parameter-to-register mapping), live notes on every channel, `opl_sink` for tests, `/TRACE` write logging |
| `jingle.c` · `jingle.h` | The splash jingle on `FACTORY\BELL`, advanced by `jingle_poll` from the BIOS tick count |
| `rebeep.c` · `rebeep.h` | The resident ReBeep through AMIS (INT 2Dh): traps off (13h) at start, on (12h) at exit |
| `video.c` · `video.h` | The 80x25 back buffer, the flush to `B800:0000`, blink and cursor handling; the `scr_*` screen layer (CP437 text, `SCR_KEEP` colours, boxes, the splash ramp, `scr_dump`); each call clips once and writes its run straight into the buffer |
| `roles.c` · `roles.h` | The one role table (a colour and a mono index per role) and the colour or mono view |
| `ansi.c` · `ansi.h` | `ansi_draw` for the `.ans` art, and `scr_remap_mono` (the shared mono remap) |
| `mouse.c` · `mouse.h` | INT 33h, used only when a driver answers; cells are pixels / 8 |
| `keys.c` · `keys.h` | The one table of key bindings (`id, ctx, scan, mods`), `key_lookup`, the piano's scan codes (`key_piano`) and the name row's characters (`key_name_char`); `HELP_ROWS[]`, the one place help page 1's text lives |
| `kbd.c` · `kbd.h` | The `INT 09h` handler: make and break codes, a key-state table, an event queue. E0-prefixed keys arrive as `KBD_EXT` codes, the fake shifts around Print Screen are dropped, Pause's `E1 1D 45 E1 9D C5` is swallowed, and a key's make repeats while it is held |
| `editor.c` · `editor.h` | The editor's logic, no drawing: rows and values (`editor_change`, `editor_bar`), the 4-OP variant, the name, the piano and its releases, undo, a key event or a click to an action (`editor_event`, `editor_press`), Random and Mutate (`editor_dice`), saving (`editor_save`, `editor_save_as`, `editor_reset`), the leave and its save prompt (`editor_leave`, `editor_act`) |
| `scr_log.c` · `scr_spl.c` · `scr_menu.c` · `screens.h` | The detection log, the splash, the menu and its "coming soon" page |
| `scr_help.c` | The pop-up frame (`dim_under`, `window_draw`) and the two-page help (`help_draw`, `help_hit`, `help_detected`) |
| `scr_save.c` | The save prompt (`save_draw`, `save_hit`) |
| `scr_list.c` | The patch list: `list_draw` from the library, `list_scroll` (the window that keeps the selection and its folder heading in view), `list_item_at` (a click's row to an entry) |
| `scr_syn.c` | The synth screen, a port of the mockup's `synth()` for both variants, drawn in parts (`synth_draw`, `synth_redraw`; `synth_parts` says which parts differ between two Editors), and `synth_hit`, what a cell is for a click (it shares `top_layout` and the grid constants with the drawing) |
| `sample.c` | The fixed sample data (the fixed sample version, the sample detection, the sample patch list, patch 12 of 40 BRASS, the help's Detected line and log path) and the screen names `/DUMP:` can draw |
| `data/SPLASH.ANS` · `data/MENU.ANS` | The art; `targets.json` `files` ships them to `REBEEP\` |

## The editor and its saves

- **The editor draws nothing and owns the history.** `editor.c` holds the one `Undo`; `editor_open` clears it, silences every
  note and programs the voice. A change records its undo step after the fact (`undo_edit(before)`) only when the patch
  differs, with the key (row, operator) and `repeat` for a typematic repeat or a drag. Modifier state comes from the event
  stream (`Editor.mods`), not from `kbd_down`, so a Ctrl released before its key is read still counts. The piano plays from
  make codes: a key already lit is ignored (typematic). Every note is released on focus to the name, on a patch switch, on a
  pop-up (`editor_release`) and at exit, so a missed break code never hangs a note.
- **Random and Mutate are one ordinary edit.** `editor_dice` rolls or nudges the variant shown, between two `undo_break`s,
  and commits it like any change, so saving follows the Ctrl+S rules below. A roll starts every carrier loud and ends it
  after the release (floors on its Attack Rate, Output Level and Release Rate; a fast decay can still make a short pluck),
  rarely picks high feedback, and takes waveforms only up to the chip's limit; a mutation never changes the connection and
  never lowers a carrier past a floor. Held notes are not released: they take the new voice. The press then plays the last
  piano key (C4 until one is played) until F12 and F11 are both up (`Editor.diceKeys`); a key the piano already holds is
  re-keyed and stays the piano's. A typematic repeat is dropped before the message clears. Never Ctrl+F12: 86Box sends
  Ctrl+Alt+Del to the guest on it, and DOSBox changes its speed on Ctrl+F11 and Ctrl+F12.
- **An edited name is only a name.** The row edits `Patch.name` in place; nothing renames the file the patch came from.
  `Editor.folder` and `file` say where the open patch came from.
- **Saves touch only `USER`, and never another `USER` patch.** The editor writes `USER\<NAME>.RBP` only. Ctrl+S, first match
  wins: an edited name is a Save As; a `USER` or `FACTORY` patch equal to the `FACTORY` patch of its name removes
  `USER\<NAME>` (the one place a player's file is deleted; a pack patch never does); a `FACTORY` or pack patch whose
  `USER\<NAME>` exists is refused; else write `USER\<NAME>`. Existence is checked on disk as well as in the list, so an
  unreadable `USER` file is never overwritten. After a save the list is rescanned (`lib_rescan`) and `pos` follows the open
  patch. A failed write keeps the old file and `dos_write_why` picks the message (`Disk full`, `Read-only disk`,
  `Can't write <path>`).
- **The save prompt guards a leave.** `editor_leave` on a dirty patch opens it (`Editor.prompt`, `pend`) instead of leaving;
  `editor_act` carries on from its buttons, and only a successful Save or Save As, or a Discard, goes on. A refused or failed
  save, or a cancelled Save As, drops the pending leave. The help and the prompt take every key while open (`K_HELP`,
  `K_PROMPT`); `K_NAME` holds the name row's Enter and Backspace, so every `K_SYNTH` and `K_GLOBAL` binding has a help row
  (`T_SAVE` checks).
- **The message area is wider when no note is held:** from column 33 (38 cells) instead of 45 (26 cells), because the save
  messages (`USER\SLAPBASS exists: use Save As`) do not fit 26.

## The screens

- **Two mono rules.** Screens that came from the HTML mockup (synth, help, save prompt) take the role table's mono column.
  Screens that came from an `.ans` (splash, menu, detection log, patch list) draw standard-view indexes, and in mono every
  cell passes through `scr_remap_mono()` last, cells drawn on top of the art included (it moves only index 2, to 12).
- **Art colour order.** `ansi_draw` reads standard ANSI SGR (31 red, 34 blue, 33 yellow, 36 cyan). The project's art was
  packed in PC order (`30 + index`), so a new `.ans` drop is converted on the way in: inside `ESC[...m` only, swap 31/34,
  33/36, 41/44 and 43/46, every other byte (the SAUCE record too) unchanged. The converted file opens correctly in an ANSI
  editor and renders to the indexes the references hold.
- **One grid for both variants.** The 2-OP synth screen is the 4-OP one with wider slots (`cell()`'s `z`): the
  parameter-name column and operator 1's left edge sit at the same cells, the bars end one cell before each slot's rule.
  Never lay 2-OP out apart.
- **The envelope is integer maths.** `env_levels` in `scr_syn.c` is the mockup's envelope as whole numbers over a common
  denominator (no floating point); the waveform is a table of 20 heights per shape. Both match the mockup.
- **Dump mode** (`/DUMP:<screen> [/VIEW:MONO] /O:<file>`) touches only the art and the output, plays nothing, shows no
  mouse and uses `sample.c`'s data. An unknown screen exits 4 and writes nothing. Drawable: `detectlog`, `splash`, `menu`,
  `patchlist`, `synth-4op`, `synth-2op`, `help1-4op`, `help2-4op`, `help1-2op`, `help2-2op`, `save-4op`, `save-2op` (a
  reference screen the program cannot draw fails the studio suite).

## The OPL while the studio runs

Every register write goes through `opl_write` (the ports, or `opl_sink`, and `log_trace` under `/TRACE`) with the
status-read delays per chip that `opl.asm` uses. Switching between two- and four-operator voices keys every channel off
before `104h` changes. A four-operator voice does not play on an OPL2. `opl_shutdown` leaves `104h` and `105h` at 0; call
`rebeep_resume` after it so a resident ReBeep re-initialises.
