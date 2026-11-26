# How ReBeep Studio is built

For the curious and for contributors: the modules of `RBSTUDIO.EXE`, ReBeep's configuration program
(its first screen is the patch editor), and the design choices behind them. What a player sees is in
the [studio guide](../guide/studio.md); the hard rules for changing the code are in
[src/studio/AGENTS.md](../../src/studio/AGENTS.md).

## The modules

| Path | Role |
|---|---|
| `main.c` | The entry point, argument handling and the top-level flow (`/?`, `/BENCH`, `/DUMP:`, `/TRACE`, the detection log, splash and menu loop, the splash that loads the library, the Patch Editor flow menu → patch list → synth screen with Esc stepping back, the help, the save prompt and the Save dialog drawn over the synth screen, giving the chip, mouse and ReBeep back at exit) |
| `dos.c` · `dos.h` | Program folder from `argv[0]`; Ctrl+Break, Ctrl+C and critical-error handlers; `dos_hook` and `dos_restore`; file helpers (`dos_read_file`, `dos_make_dir`, `dos_each`, the safe save `dos_save_file`) |
| `patch.c` · `patch.h` | The patch model (`Patch`, `Voice`, `Op`: the editor's values, never registers) and the RBP text file: `patch_parse`, `patch_format`, `patch_read`, `patch_write`; `patch_carriers`, which operators a connection makes heard. The NASM parser in `startup/patch.asm` follows the same rules |
| `dice.c` · `dice.h` | Random and Mutate: a seedable xorshift32 (`dice_seed`, from the BIOS tick count at start), `dice_roll` (a whole voice) and `dice_mutate` (a few small steps); all the tuning is one table at the top |
| `library.c` · `library.h` | The patch library: `FACTORY\` beside the program, `USER\` and the other banks in the patches folder; `lib_open` and `lib_load` read it once, `lib_put` and `lib_drop` keep it right after a save; lookup, overrides, `name_valid`, `path_valid` for `PATCHES=` |
| `settings.c` · `settings.h` | `RBSTUDIO.CFG`, read only (`cfg_load`, `cfg_get`) |
| `log.c` · `log.h` | `RBSTUDIO.LOG`, replaced each run, each line committed at once (DOS `68h`) |
| `undo.c` · `undo.h` | Whole-`Patch` snapshots in far memory, 100 steps, redo, key-coalesced edits |
| `data/FACTORY/*.RBP` | The four factory patches; `targets.json` `files` ships them to `REBEEP\FACTORY\` |
| `opl.c` · `opl.h` | The OPL driver: detection, `opl_regs2`/`opl_regs4` (the one parameter-to-register mapping), live notes on every channel, `opl_sink` for tests, `/TRACE` write logging |
| `jingle.c` · `jingle.h` | The splash jingle on `FACTORY\BELL`, advanced by `jingle_poll` from the BIOS tick count |
| `rebeep.c` · `rebeep.h` | The resident ReBeep through AMIS (INT 2Dh): traps off (13h) at start, on (12h) at exit |
| `video.c` · `video.h` | The 80x25 back buffer, the flush to `B800:0000`, blink and cursor handling, the soft font's partial blocks; the `scr_*` screen layer (CP437 text, `SCR_KEEP` colours, boxes, the splash ramp, `scr_dump`); each call clips once and writes its run straight into the buffer |
| `roles.c` · `roles.h` | The one role table (a colour and a mono index per role) and the colour or mono view |
| `ansi.c` · `ansi.h` | `ansi_draw` for the `.ans` art, and `scr_remap_mono` (the shared mono remap) |
| `mouse.c` · `mouse.h` | INT 33h, used only when a driver answers; cells are pixels / 8 |
| `keys.c` · `keys.h` | The one table of key bindings (`id, ctx, scan, mods`), `key_lookup`, the piano's scan codes (`key_piano`) and the name row's characters (`key_name_char`); `HELP_ROWS[]`, the one place help page 1's text lives |
| `kbd.c` · `kbd.h` | The `INT 09h` handler: make and break codes, a key-state table, an event queue. E0-prefixed keys arrive as `KBD_EXT` codes, the fake shifts around Print Screen are dropped, Pause's `E1 1D 45 E1 9D C5` is swallowed, and a key's make repeats while it is held |
| `editor.c` · `editor.h` | The editor's logic, no drawing: rows and values (`editor_change`, `editor_bar`), the 4-OP variant, the name, the piano and its releases, undo, a key event or a click to an action (`editor_event`, `editor_press`), Random and Mutate (`editor_dice`), the Save dialog and its lines, reset (`editor_reset`), the leave and its save prompt (`editor_leave`, `editor_act`) |
| `scr_log.c` · `scr_spl.c` · `scr_menu.c` · `screens.h` | The detection log, the splash, the menu and its "coming soon" page |
| `scr_help.c` | The pop-up frame (`dim_under`, `window_draw`) and the two-page help (`help_draw`, `help_hit`, `help_detected`) |
| `scr_save.c` | The save prompt (`save_draw`, `save_hit`) and the Save dialog (`dialog_draw`, `dialog_hit`) |
| `scr_list.c` | The patch list: `list_draw` from the library for a view (All, or one bank), `list_scroll` (the window that keeps the selection and its bank heading in view), `list_item_at` (a click's row to an entry), the view switcher and paging |
| `scr_syn.c` | The synth screen, a port of the mockup's `synth()` for both variants, drawn in parts (`synth_draw`, `synth_redraw`; `synth_parts` says which parts differ between two Editors), and `synth_hit`, what a cell is for a click (it shares `top_layout` and the grid constants with the drawing) |
| `sample.c` | The fixed sample data (the fixed sample version, the sample detection, the sample patch list, patch 12 of 40 BRASS, the help's Detected line and log path) and the screen names `/DUMP:` can draw |
| `data/SPLASH.ANS` · `data/MENU.ANS` | The art; `targets.json` `files` ships them to `REBEEP\` |

## The library

- **Read once per run.** `lib_open` settles the folders and counts the `.RBP` files without reading any: the checks screen
  shows the count in an instant. `lib_load` reads them on the splash behind a `Loading patches` percentage, into one far
  block sized to the files (21 bytes an entry, about 25 KB for 1,151 patches). It holds at most 2,048 patches and, besides
  `FACTORY` and `USER`, 64 banks; the rest are logged and left out. Entering the Patch Editor reads nothing.
- **Order is the index.** `FACTORY`, `USER`, then banks by name, names sorted within each, so a bank's entries are
  contiguous: `lib_bank` and the patch list find a bank's ends by halving, and a row or a click is a sum over the banks, not
  a scan of the patches.
- **A save updates one entry.** `lib_put` lists the saved patch in its place (starting a bank in its sorted place when it is
  new) and `lib_drop` takes out a removed override; both keep the override marks right. Nothing rescans the folders.

## The editor and its saves

- **The editor draws nothing and owns the history.** `editor.c` holds the one `Undo`; `editor_open` clears it, silences every
  note and programs the voice. A change records its undo step after the fact (`undo_edit(before)`) only when the patch
  differs, with the key (row, operator) and `repeat` for a typematic repeat or a drag. Modifier state comes from the event
  stream (`Editor.mods`), not from `kbd_down`, so a Ctrl released before its key is read still counts. The piano plays from
  make codes: a key already lit is ignored (typematic). Every note is released on a patch switch, on a pop-up
  (`editor_release`) and at exit, so a missed break code never hangs a note.
- **One octave.** The patch's own octave is the only one: the piano's keys follow it (the Z row from C3 at octave 4) and
  Ctrl+Up and Ctrl+Down step it as an edit, like the octave row. Held notes are named from it.
- **Random and Mutate are one ordinary edit.** `editor_dice` rolls or nudges the variant shown, between two `undo_break`s,
  and commits it like any change. A roll starts every carrier loud and ends it after the release (floors on its Attack Rate,
  Output Level and Release Rate; a fast decay can still make a short pluck), rarely picks high feedback, and takes waveforms
  only up to the chip's limit; a mutation never changes the connection and never lowers a carrier past a floor. Held notes are
  not released: they take the new voice. The press then plays the last piano key (C4 until one is played) until F12 and F11
  are both up (`Editor.diceKeys`); a key the piano already holds is re-keyed and stays the piano's. A typematic repeat is
  dropped before the message clears. Never Ctrl+F12: 86Box sends Ctrl+Alt+Del to the guest on it, and DOSBox changes its
  speed on Ctrl+F11 and Ctrl+F12.
- **The open patch remembers its file.** `Editor.folder` and `file` say where it came from, so the Save dialog can say
  `Updates:` and the list can follow it.
- **The Save dialog is the one way to save.** Ctrl+S, and the prompt's Save, open it on the patch's name and bank (a `FACTORY`
  patch starts on `USER`). `dialog_plan` is the one place that decides: it fills the lines the dialog shows (`New patch`,
  `New bank`, `Updates`, `Replaces`, `Overrides`, `Matches`, `Removes`, `In games`) and, only when Enter is pressed and the
  lines allow it, writes or removes, so the dialog says what the save does. The rules, first match wins:
  - a bad name, or a bad, taken or reserved new-bank name, refuses (`FACTORY` and `USER` are reserved);
  - into `USER`, a patch equal to the `FACTORY` patch of its name removes `USER\<NAME>` (`Nothing to save` when there is none).
    This is the only place a player's file is deleted, and the `FACTORY` copy is read once per name;
  - a full list (2,048) refuses a patch that is not already listed;
  - else it writes `BANK\<NAME>.RBP` in any bank but `FACTORY`, which `lib_bank_path` refuses. A new bank's folder is made
    first (`dos_make_dir`). A file already there is replaced, and the line says so with a `!`.

  A refusal leaves the dialog open and Enter does nothing. A write goes through `dos_save_file`, then `lib_put`, and the
  open patch becomes the saved one. A failed write keeps the old file, closes the dialog, and `dos_write_why` picks the
  message (`Disk full`, `Read-only disk`, `Can't write <path>`).
- **The save prompt guards a leave.** `editor_leave` on a dirty patch opens it (`Editor.prompt`, `pend`) instead of leaving.
  Save opens the dialog for the same leave; the leave goes on only after a successful save or a Discard. Esc, Cancel, a click
  outside and a failed write drop it. The help, the prompt and the dialog take every key while open (`K_HELP`, `K_PROMPT`,
  `K_SAVE`), so every `K_SYNTH` and `K_GLOBAL` binding has a help row (`T_SAVE` checks).
- **The message area is wider when no note is held:** from column 33 (38 cells) instead of 45 (26 cells), because the save
  messages do not fit 26.

## The screens

- **Two mono rules.** Screens that came from the HTML mockup (synth, help, save prompt, Save dialog) take the role table's mono
  column. Screens that came from an `.ans` (splash, menu, detection log, patch list) draw standard-view indexes, and in mono
  every cell passes through `scr_remap_mono()` last, cells drawn on top of the art included (it moves only index 2, to 12).
- **Art colour order.** `ansi_draw` reads standard ANSI SGR (31 red, 34 blue, 33 yellow, 36 cyan). The project's art was
  packed in PC order (`30 + index`), so a new `.ans` drop is converted on the way in: inside `ESC[...m` only, swap 31/34,
  33/36, 41/44 and 43/46, every other byte (the SAUCE record too) unchanged. The converted file opens correctly in an ANSI
  editor and renders to the indexes the references hold.
- **One grid for both variants.** The 2-OP synth screen is the 4-OP one with wider slots (`cell()`'s `z`): the
  parameter-name column and operator 1's left edge sit at the same cells, the bars end one cell before each slot's rule.
  Never lay 2-OP out apart.
- **The envelope is integer maths.** `env_levels` in `scr_syn.c` is the mockup's envelope as whole numbers over a common
  denominator (no floating point, and no product past 32 bits: `round_scaled` divides by shift and subtract). The waveform
  is a table of 20 heights per shape. Both match the mockup.
- **The soft font.** On an EGA or VGA with a 14 or 16 line cell, `video_init` loads fifteen partial blocks (1 to 15 scanlines
  tall) with `INT 10h AX=1100h` over line-drawing codes no screen uses, so the envelope band draws heights of `4 * lines - 1`
  (63 on a VGA, 55 on an EGA) instead of half blocks. The reserved codes are `C7 CA CB CC CE CF D0` to `D8`
  (`VIDEO_BLOCK`): a screen must not draw them. `video_restore` puts the ROM font of that height back (`AX=1104h` or
  `1101h`) at exit, which replaces a code-page font `DISPLAY.SYS` had loaded.
- **The read-back.** The BIOS answering is not the font holding the blocks, so after the load `video_init` reads the fifteen
  glyphs back from the font in plane 2 (`A000:0000`, 32 bytes a code) and compares them with what it wrote. An EGA's
  sequencer and graphics controller are write-only, so the read sets the registers it needs, with interrupts off, and puts
  back the values the BIOS programs for text mode 3. It does not check that block 0 is the font on show. `T_FONT` runs under
  each DOSBox-X machine and pins 0 lines on a `cga`, 14 on an `ega` and 16 on a `vgaonly`, and that a ROM font put back
  reads as missing (`video_blocks_in_font`).
- **The fallback.** Any other card or cell height (CGA, MDA, an 8-line mode) keeps the half blocks with a lit rim, and so does a card where the read-back fails.
  `video_set_block_lines` chooses the path whatever the card.
- **The dump rule.** `/DUMP` draws the 16-line path on every card, so one set of reference screens holds for all of them;
  the half-block path is checked by `T_ENV`, not by a reference screen.
- **Dump mode** (`/DUMP:<screen> [/VIEW:MONO] /O:<file>`) touches only the art and the output, plays nothing, shows no
  mouse and uses `sample.c`'s data. An unknown screen exits 4 and writes nothing. Drawable: `detectlog`, `splash`,
  `splash-load`, `menu`, `patchlist`, `patchlist-bank`, `synth-4op`, `synth-2op`, `help1-4op`, `help2-4op`, `help1-2op`,
  `help2-2op`, `save-4op`, `save-2op`, `savedlg-4op` (a reference screen the program cannot draw fails the studio suite).
- **The patch list** shows a view: All, or one bank, and it comes back on the view you left. Paging moves a screenful in All
  and 12 entries in a bank.

## The OPL while the studio runs

Every register write goes through `opl_write` (the ports, or `opl_sink`, and `log_trace` under `/TRACE`) with the
status-read delays per chip that `opl.asm` uses. Switching between two- and four-operator voices keys every channel off
before `104h` changes. A four-operator voice does not play on an OPL2. `opl_shutdown` leaves `104h` and `105h` at 0; call
`rebeep_resume` after it so a resident ReBeep re-initialises.
