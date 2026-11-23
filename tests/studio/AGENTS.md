# studio tests

> C test programs for `RBSTUDIO.EXE`'s modules, compiled with Open Watcom and run headless in DOSBox-X.

## What's here

| Path | Role |
|---|---|
| `T_*.C` | One test program each (8.3 name). Compiled with `testlib.c` and every `src/studio/*.c` except `main.c` |
| `testlib.h` · `testlib.c` | The C mirror of `interpreter/testlib.inc`: `t_case`, `t_check`, `t_checkl`, `t_done` |
| `T_SMOKE.C` | Checks the generated version macros, a far-pointer round trip and a studio module (`video_put` clipping, `video_flush` to `B800`) |
| `T_PFILE.C` | The patch file: the staged factory files, round trips and every accepted or refused shape (the case list P05's `T_PATCH` shares) |
| `T_PLIST.C` | The library: a tree built on C: at run time; order, counts, lookup, overrides, 4-OP marks, name and path rules |
| `T_CFG.C` | `RBSTUDIO.CFG` reading, `PATCHES=` resolution, the log, and a safe save that fails on a read-only scratch file |
| `T_UNDO.C` | Undo and redo: coalescing, the 100-step cap, redo cleared by a new edit |
| `T_VOICE.C` | The OPL driver through `opl_sink`: the factory records, the 4-OP slots and bits, KSL and OL edges, octave shift, slot stealing, shutdown, tracing; detection on the real chip |
| `T_AMIS.C` | `rebeep.c` against a fake resident ReBeep on `INT 2Dh`: the signature, traps off and on, refused, already off, another program, no state block |
| `T_OPLKND.C` | Proves the OPL2 rerun: the OPL status port reads OPL3 on the default run and OPL2 on `/OPL2` |
| `T_LSCRL.C` | The patch list's scroll window (`list_scroll`), row hit-test (`list_item_at`) and override text for an 8-character name (`list_draw`) over a synthetic library |
| `T_EDIT.C` | The editor without drawing: value ranges and wrap, the Waveform limit by chip, the 4-OP variant from FM and AM, undo coalescing, the name, the piano and its releases, key events through the table, a bar's mouse values, PgUp/PgDn across folders |

## Rules

- `rebeep test run --suite studio` compiles each `T_*.C` into `build/studio-tests/<NAME>.EXE` with the same `compileExe`
  wrapper and flags as `build run`, with `tests/studio` on the include path, and runs it in DOSBox-X. The results use the
  `RESULT.TXT` protocol in [../AGENTS.md](../AGENTS.md); a program returns `t_done()` from `main`.
- **Studio headers are included by path:** `#include "../../src/studio/video.h"`. `src/studio` is not on the include
  path (its `dos.h` would shadow `<dos.h>`), so a plain `"video.h"` does not resolve.
- `t_case("name")` opens a case and closes the previous one; `t_check(ok, "what")` and `t_checkl(got, want, "what")`
  record the first failure of the case (`FAIL <case>: <what>: got N, want M`); `t_done()` prints `DONE <n>`.
- A first line of `/* SUITE: OPL2 */` runs the program a second time as an OPL2 card with the argument `/OPL2`; the
  first run uses DOSBox-X's default OPL3. The program reads `argv` for `/OPL2`. The suite passes DOSBox-X
  `-set "sblaster oplmode=opl2"` as one argument; `T_OPLKND.C` fails if that stops taking effect.
- The shipped `REBEEP/FACTORY` data files are staged as `FACTORY\` beside the program, so a test reads the real patches.
- Every module but `main.c` is linked into every program: no module may use a symbol defined in `main.c`.
- **Reference screens** are `tests/screens/<screen>.<view>.scr`, view `vga` or `mono`: one per screen, state and view. The
  format (UTF-8, LF): line 1 `# ReBeep reference screen: <screen>, <view>`, line 2 `# <sample state>`, `glyphs` and 25 rows
  of 80 characters (a CP437 byte as the character the VGA font draws, byte 0 a space), `fg` and 25 rows of 80 upper-case hex
  digits, `bg` and 25 more (8-F are the iCE bright backgrounds). Two cells match when the glyph and background are the same,
  and the foreground too unless the glyph is a space. The files are byte-for-byte copies of the project's exports; the
  exporters stay outside the repo, so a screen change edits its `.scr` first (see [src/studio/AGENTS.md](../../src/studio/AGENTS.md)).
- **The screen check** is the last step of the studio suite: it compiles `RBSTUDIO.EXE` into `build/studio-tests/`, stages the
  data files deployed under `REBEEP` beside it, runs one `DUMPS.BAT` (`RBSTUDIO /DUMP:<screen> [/VIEW:MONO] /O:Dnn.DMP` per
  reference) in one DOSBox-X start, and compares each 4000-byte dump (`tools/lib/screens.mjs`) with its `.scr`, failing with
  the first differing cells. A screen RBSTUDIO cannot draw yet exits 4 and is reported **pending**, a warning and not a pass, except the six it draws now (`detectlog`, `splash`, `menu`, `patchlist`, `synth-4op`, `synth-2op`), where pending fails; P04-T02 makes every pending reference a failure.

## Pitfalls

- Keep C89 and the studio's medium model; a program has the same 64 KB data group and 2 KB default stack as `RBSTUDIO`.
- A program that does not print `DONE` last, hits the 60 s DOSBox-X limit or writes no `RESULT.TXT` fails.

## Run / test

```sh
rebeep tool fetch open-watcom
rebeep test run --suite studio
```

## Related

- [../AGENTS.md](../AGENTS.md) · [src/studio/AGENTS.md](../../src/studio/AGENTS.md)
