# studio tests

> C test programs for `RBSTUDIO.EXE`'s modules, compiled with Open Watcom and run headless in DOSBox-X.

## What's here

| Path | Role |
|---|---|
| `T_*.C` | One test program each (8.3 name), compiled with `testlib.c` and every `src/studio/*.c` except `main.c`. Not listed: `T_SMOKE` (the build's smoke test), `T_UNDO`, `T_AMIS` (`rebeep.c` against a fake resident ReBeep) and `T_OPLKND` (proves the OPL2 rerun) |
| `testlib.h` · `testlib.c` | The C mirror of `interpreter/testlib.inc`: `t_case`, `t_check`, `t_checkl`, `t_done` |
| `T_PFILE.C` | The patch file: the staged factory files, round trips and every accepted or refused shape (the case list P05's `T_PATCH` shares) |
| `T_PLIST.C` | The library: a tree built on C: at run time; order, counts, lookup, overrides, 4-OP marks, name and path rules |
| `T_CFG.C` | `RBSTUDIO.CFG` reading, `PATCHES=` resolution, the log, and a safe save that fails on a read-only scratch file |
| `T_VOICE.C` | The OPL driver through `opl_sink`: the factory records, the 4-OP slots and bits, KSL and OL edges, octave shift, slot stealing, shutdown, tracing; detection on the real chip |
| `T_LSCRL.C` | The patch list's scroll window (`list_scroll`), row hit-test (`list_item_at`) and override text for an 8-character name (`list_draw`) over a synthetic library |
| `T_SAVE.C` | Saving over a tree built at run time: the Ctrl+S rules (factory, pack and user patches, override removal only when equal and never from a pack patch, a name edit as Save As), Save As validation, Reset to factory, the save prompt guarding a leave, a failed write that keeps the old file, the help's keys, and every non-piano binding documented by a help row |
| `T_EDIT.C` | The editor without drawing: value ranges and wrap, the Waveform limit by chip, the 4-OP variant from FM and AM, undo coalescing, the name, Random and Mutate with their held note, the piano and its releases, key events through the table, a bar's mouse values, PgUp/PgDn across folders |
| `T_DICE.C` | The dice: rolls stay in every range and the Waveform limit and give each carrier its floors, a seed repeats; a nudge keeps the connection, moves one to four values a small step and never takes a carrier below its floors |
| `T_REDRW.C` | The synth screen in parts: `synth_parts` and `synth_redraw` over the old screen against a fresh `synth_draw`, for each field the drawing reads, in both variants and views; the primitives' clipping and `SCR_KEEP` |

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
- **Reference screens** are `tests/screens/<screen>.<view>.scr`, view `vga` or `mono`: one per screen, state and view. The
  format (UTF-8, LF): line 1 `# ReBeep reference screen: <screen>, <view>`, line 2 `# <sample state>`, `glyphs` and 25 rows
  of 80 characters (a CP437 byte as the character the VGA font draws, byte 0 a space), `fg` and 25 rows of 80 upper-case hex
  digits, `bg` and 25 more (8-F are the iCE bright backgrounds). Two cells match when the glyph and background are the same,
  and the foreground too unless the glyph is a space. The files are byte-for-byte copies of the project's exports; the
  exporters stay outside the repo, so a screen change edits its `.scr` first (see [src/studio/AGENTS.md](../../src/studio/AGENTS.md)).
  **The one version exception:** the reference screens and `SAMPLE_VERSION` in `sample.c` hold a fixed sample version, so a version bump
  never changes them (`version check` skips only those); the shipped program takes `REBEEP_VERSION` from `package.json`.
- **The screen check** is the last step of the studio suite: it compiles `RBSTUDIO.EXE` into `build/studio-tests/`, stages the
  data files deployed under `REBEEP` beside it, runs one `DUMPS.BAT` (`RBSTUDIO /DUMP:<screen> [/VIEW:MONO] /O:Dnn.DMP` per
  reference) in one DOSBox-X start, and compares each 4000-byte dump (`tools/lib/screens.mjs`) with its `.scr`, failing with
  the first differing cells. A screen RBSTUDIO cannot draw exits 4 and fails the run. The whole set runs again under DOSBox-X's `machine=cga`, `ega` and `vgaonly` (reported as `SCREENS (cga)` and so on): the blink-off path differs on a CGA, so the attributes must still match. A dump cannot show whether blink is really off, so also look at a bright-background screen (the synth focus bar, the save prompt's buttons) in DOSBox-X under `machine=cga` and `ega`.

## Pitfalls

- Keep C89 and the studio's medium model; a program has the same 64 KB data group and 2 KB default stack as `RBSTUDIO`, and fails unless it prints `DONE` last and writes `RESULT.TXT` within DOSBox-X's 60 s.

## Run / test

```sh
rebeep tool fetch open-watcom
rebeep test run --suite studio
```

## Related

- [../AGENTS.md](../AGENTS.md) · [src/studio/AGENTS.md](../../src/studio/AGENTS.md)
