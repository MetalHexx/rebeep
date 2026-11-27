# studio

> `RBSTUDIO.EXE`: ReBeep Studio, ReBeep's configuration program (its first screen is the patch editor), a C program for DOS built with Open Watcom.

## What's here

One `.c` and `.h` per module: DOS handlers, the patch model and library, the OPL driver, the video and screen layer, one
`scr_*.c` per screen, the editor (logic, no drawing), `sample.c` (the sample data `/DUMP:` draws) and `data/` (art).
Every module and its functions: [docs/architecture/studio.md](../../docs/architecture/studio.md).

## Rules

- **Build:** `rebeep build run` compiles every `*.c` here with `wcl` (`-bt=dos -mm -0 -os -w4`) and links one EXE; the
  `package.json` version reaches C through `build/gen/version.h` (`REBEEP_VERSION`, `REBEEP_VER_MAJOR/MINOR/PATCH`).
- **No module may use a symbol defined in `main.c`:** the studio suite links every other module into each test program.
- **8086 only, medium model** (far code, near data). The 64 KB data group must hold: big buffers (the library's 2,048 entries, undo
  history) are `_fmalloc`ed; path and I/O buffers are static, because the stack is 2 KB.
- **Every vector goes through `dos_hook()`**, and `dos_restore()` puts them back at `atexit` and on exit: a vector left pointing into a freed program hangs the next key press.
- **An interrupt handler** is `__interrupt __far`, calls nothing in the C library, sits inside `#pragma off (check_stack)` (it runs
  on the interrupted program's stack), and hands on to the old handler (`_chain_intr`, or a call when work follows, as in `kbd.c`). Port reads in it are inline (`#pragma aux`), not `inp`. It
  shares data with `main` only through `volatile` bytes and the single-producer queue.
- **Ctrl+Break and Ctrl+C do nothing; a critical error fails the call** (`INT 24h` returns `AL = 3`), never "Abort, Retry, Fail".
- **The screen goes through `video_*`** into the back buffer, then one `video_flush`. Blink is off while running (bit 7 of an
  attribute is a bright background), back on at exit; the cursor is hidden and restored (an EGA font load resets both, so they come after it); the screen is cleared on exit.
  The envelope's soft-font blocks own codes `C7 CA CB CC CE CF D0` to `D8` (`VIDEO_BLOCK`): no screen draws them.
- **Draw only what changed:** the synth screen is parts that own whole rows (`SD_*`, `synth_redraw`); `run_synth` drains every
  queued event, then draws `synth_parts(&drawn, ed)` once. A field the drawing reads goes into `synth_parts` (no path flags a part); `T_REDRW` checks it.
- **Patch values are the editor's:** SL and OL are stored so bigger is louder; registers come only from the mapping in the
  sound module. A bad or unreadable patch file is left out of the list and logged with its reason, never fixed up.
- **Paths are untrusted:** `PATCHES=` passes `path_valid` (plain 8.3 components, no `..` or wildcards, 64 chars) or the default
  folder is used; every path built stays under the program or patches folder. `FACTORY` and `USER` are reserved names.
- **Saves go through `dos_save_file`** (`NAME.$$$`, old to `.BAK`, rename new, delete `.BAK`): a failed write leaves the old file.
  The Save dialog writes any bank but `FACTORY` and deletes only a `USER` override equal to its factory patch ([the rules](../../docs/architecture/studio.md#the-editor-and-its-saves)).
- **The studio owns the OPL while it runs:** every register write goes through `opl_write`; call `rebeep_resume` after `opl_shutdown` ([why](../../docs/architecture/studio.md#the-opl-while-the-studio-runs)).
- **The reference screens are the screen spec** (`tests/screens/<screen>.<view>.scr`, format in [tests/studio/AGENTS.md](../../tests/studio/AGENTS.md)):
  a screen change edits its `.scr` first, in the same change as the code.
- **Screens and the editor:** the mono rules, art colour order, the one grid and the editor's rules are in
  [studio.md](../../docs/architecture/studio.md). `env_levels` is integer maths: no floating point.
- C89, declarations at the top of a block; output names 8.3, uppercase. A literal with a CP437 glyph above 7Fh puts the hex
  escape in a literal of its own (`"\xFB" "  text"`), or the next hex digit joins it.

## Pitfalls

- **Never add this folder to the compiler's include path.** `dos.h` here would shadow `<dos.h>`; `"dos.h"` is found beside
  the including file, and `<dos.h>` still reaches Open Watcom's.
- **No key may reach DOS,** which pauses on Ctrl+S (DOSBox-X doesn't): `kbd.c` empties the BIOS buffer after every key, so `getch`, `kbhit` and `INT 16h` see none. Names come from scan codes (US layout, like the piano).

## Run / test

```sh
rebeep tool fetch open-watcom
rebeep build run --deploy
```

In DOSBox-X or on a VM: `RBSTUDIO`, `RBSTUDIO /BENCH` (writes `BENCH.TXT`). To watch a flow with typed keys and screenshots, see the
[drive-dos-app skill](../../.claude/skills/drive-dos-app/SKILL.md).

## Related

- [src/AGENTS.md](../AGENTS.md) · [tools/AGENTS.md](../../tools/AGENTS.md): the `open-watcom` tool and `lib/watcom`
