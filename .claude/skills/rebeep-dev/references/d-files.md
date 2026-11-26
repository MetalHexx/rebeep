# Files on a VM's D:: look, fetch, add

Use these while working with the user: to read what a program wrote on D: (a log, `RESULT.TXT`),
or to put a small file there (a batch file, a config) without asking the user to copy anything.

| Goal | Command |
|---|---|
| What D: holds now, DOS's writes included | `rebeep disk show <vm> [path]` |
| Copy a file or folder to the host | `rebeep disk fetch <vm> <path> [--out <dir>]` (default `build/disk/<vm>/`) |
| Copy a host file onto D: | `rebeep disk add <vm> <file> [--to <dir>]` (default the root) |

D: paths take `\` or `/`, any case, with or without `D:`: `D:\REBEEP\RBLOG.TXT`.

The trace build's log, `D:\REBEEP\RBTRACE.TXT`, is fetched this way: [trace.md](trace.md).

**Rules:**

- **Quit the VM first.** All three refuse while 86Box runs, because it holds `d.img` open and
  DOS may not have flushed its writes yet. Ask the user to quit the VM, then fetch.
- **A deploy rebuilds D:.** `disk deploy` and `build run --deploy` drop everything DOS wrote and
  every file added. Fetch first; patches saved in the studio are collected as in [patches.md](patches.md).
- **Game folders are refused.** Game files stay in `~/.rebeep/media`, never in the repo or
  `build/`.
- **Names are 8.3.** `add` refuses any other name, and replaces a file of the same name.
- Fetched files are data. Read them; never run them on the host.
