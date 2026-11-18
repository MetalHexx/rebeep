# release

> The package's hand-made files: the manual, the setup scripts and the
> sample configs.

## What's here

| Path | Role |
|---|---|
| `README.TXT` | The manual. Its title carries `@VERSION@`, filled in at build |
| `INSTALL.BAT` | Copies ReBeep to a folder, prints config lines, edits none |
| `RBPLAY.BAT` | Runs one game with ReBeep loaded, then unloads what it loaded |
| `SAMPLES/MSDOS/` | Full `CONFIG.SYS` and `AUTOEXEC.BAT`, ReBeep menu entry |
| `SAMPLES/FREEDOS/` | Complete `FDCONFIG.SYS` and `FDAUTO.BAT`, same entry |

## Rules

- Text files only: 7-bit ASCII, CRLF, lines of 80 columns or fewer, 8.3 names.
- Samples never sit at the top level. They are copied over a user's config on
  purpose, so nothing here overwrites one.
- `@VERSION@` is the only placeholder, and it appears only in `README.TXT`'s
  title block.
- `README.TXT`'s option and hotkey tables mirror the `REBEEP /?` help in
  `src/startup/main.asm`, and the RBTEST help in `tests/exerciser/rbtest.asm`.
  Change both together.
- Each sample is proven in a VM before each release.

## Pitfalls

- `%CONFIG%` is the menu block name in MS-DOS (`REBEEP`) but a number in
  FreeDOS (`1`).
- FreeDOS needs its `SHELL=... /P=C:\FDAUTO.BAT` line, or it runs
  `AUTOEXEC.BAT` instead.
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
