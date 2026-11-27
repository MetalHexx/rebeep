# release

> The package's hand-made files: the manual, the setup scripts and the
> sample configs. The built programs and the studio's data are added to the
> package by `release create`.

## What's here

| Path | Role |
|---|---|
| `README.TXT` | The manual. Its title carries `@VERSION@`, filled in at build |
| `INSTALL.BAT` | Installs or updates ReBeep in a folder, from a menu or with `/I` and `/U`. Copies `RBSTUDIO.EXE`, the `.ANS` art and `FACTORY\PATCHES\` (replaced on update). Prints the config lines, edits none |
| `RBPLAY.BAT` | Runs one game with ReBeep loaded, then unloads ReBeep if it loaded it. QPIEMU stays loaded |
| `SAMPLES/MSDOS/` | Full `CONFIG.SYS` and `AUTOEXEC.BAT`, ReBeep menu entry |
| `SAMPLES/FREEDOS/` | Complete `FDCONFIG.SYS` and `FDAUTO.BAT`, same entry |
| `SAMPLES/RBSTUDIO.CFG` | The studio's settings file, commented out. A sample only: `INSTALL` never copies it |

## Rules

- Text files only: 7-bit ASCII, CRLF, lines of 80 columns or fewer, 8.3 names. `release create`
  adds the `.EXE` and `.ANS` files (binary) and the `.RBP` patches (text), which come from `build/`.
- `INSTALL` never touches `PATCHES\` or an `RBSTUDIO.CFG` that is already there, and never
  creates one: the studio works without it.
- Samples never sit at the top level. They are copied over a user's config on
  purpose, so nothing here overwrites one.
- `@VERSION@` is the only placeholder. It appears only in `README.TXT`'s title
  block and `INSTALL.BAT`'s screens; `release create` refuses one elsewhere.
- `README.TXT`'s tables mirror `docs/guide/reference.md`, the `REBEEP /?`
  help in `src/startup/main.asm`, and the RBTEST help in
  `tests/exerciser/rbtest.asm`. Its section 3 follows `docs/guide/real-pc.md`, and its section 5
  `docs/guide/studio.md`. Change them together.
- Each sample is proven in a VM before each release.

## Pitfalls

- `%CONFIG%` is the menu block name in MS-DOS (`REBEEP`) but a number in
  FreeDOS (`1`).
- FreeDOS needs its `SHELL=... /P=C:\FDAUTO.BAT` line, or it runs
  `AUTOEXEC.BAT` instead.
- `INSTALL`'s menu needs `CHOICE`, which MS-DOS 5 lacks. Probes call
  `INSTALL /I`: the menu would wait for a key.
- `RBPLAY` needs `JEMMEX` in `CONFIG.SYS`. It loads ReBeep and `QPIEMU`, not
  the memory manager.

## Run / test

```sh
git ls-files --eol release/     # every file: w/crlf
node tools/rebeep.mjs repo check
```

## Related

- [../AGENTS.md](../AGENTS.md): the repo map and the doc rules
- [../src/AGENTS.md](../src/AGENTS.md): the exit codes and options the README
  documents
