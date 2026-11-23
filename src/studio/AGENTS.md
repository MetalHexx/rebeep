# studio

> `RBSTUDIO.EXE`: the ReBeep tracker studio, a C program for DOS built with Open Watcom.

## What's here

| Path | Role |
|---|---|
| `main.c` | Options (`/?`, `/BENCH`), the test screen, the Esc loop, the redraw benchmark |
| `dos.c` · `dos.h` | Program folder from `argv[0]`; Ctrl+Break, Ctrl+C and critical-error handlers; `dos_hook` and `dos_restore` |
| `video.c` · `video.h` | The 80x25 back buffer, the flush to `B800:0000`, blink and cursor handling |
| `kbd.c` · `kbd.h` | The `INT 09h` handler: make and break codes, a key-state table, an event queue |

## Rules

- **Build:** `rebeep build run` compiles every `*.c` here with `wcl` (`-bt=dos -mm -0 -os -w4`) and links one EXE.
  The `package.json` version reaches C through the generated `build/gen/version.h` (`REBEEP_VERSION`, `REBEEP_VER_MAJOR/MINOR/PATCH`).
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

## Related

- [src/AGENTS.md](../AGENTS.md)
- [tools/AGENTS.md](../../tools/AGENTS.md): the `open-watcom` tool and `lib/watcom`
