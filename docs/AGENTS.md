# docs

> Docs for people, in three levels: the player guide, how it works, and the lab for contributors.

## What's here

| Path | Level | Role |
|---|---|---|
| `guide/getting-started.md` | Guide | What ReBeep is, what you need, which setup to follow |
| `guide/real-pc.md` | Guide | Jemm, install, the boot menu entry, check, undo. `release/README.TXT` section 3 follows it |
| `guide/86box.md` | Guide | A player's own 86Box VM, then the real PC steps |
| `guide/playing.md` | Guide | Everyday use: RBPLAY, voices, muting, hotkeys, `/OFF`, unload |
| `guide/troubleshooting.md` | Guide | By symptom, then every message |
| `guide/compatibility.md` | Guide | Tested games (with game notes) and machines, conflicts with the command to run |
| `guide/studio.md` | Guide | ReBeep Studio for players: the screens, keys, patch folders and packs, saving, the settings file |
| `guide/reference.md` | Guide | Options, hotkeys, exit codes, RBSTUDIO, RBTEST. `release/README.TXT` and `REBEEP /?` mirror it |
| `architecture/how-it-works.md` | Architecture | The design, and the `P_BENCH` numbers |
| `architecture/gpc-case-study.md` | Architecture | How GPC drives the speaker, ReBeep's handling, what still differs |
| `lab/setup.md` | Lab | Clone to first VM boot, Free and Full paths, the Verified-on table |
| `lab/86box-lab.md` | Lab | The lab's VMs, disks, boot flow, snapshot and reset |
| `lab/contributing.md` | Lab | Workflow and checks, the studio suite and its screens, commits, PR and payload rules |
| `lab/releasing.md` | Lab | The release procedure and the checks by a person |
| `roadmap.md` | — | Where ReBeep is headed, and how to help. The only page with plans |
| `images/` | — | Pictures. `rebeep-logo.png` is the README's logo, on a transparent background |

## Rules

**Who reads these docs, and how we write for them.**
- **Guide:** a DOS gamer who is a little technical, as every DOS user was, but has never heard of
  QPIEMU. Memory managers, `CONFIG.SYS` and `AUTOEXEC.BAT` are part of the ticket, so teach them
  fully: whole examples, each line explained, how to undo.
- **Architecture:** the curious. Technical and exact: the design and its measured cost.
- **Lab:** contributors. Commands, the `rebeep` CLI, the VMs.
- **The voice:** concise and high signal. Steps first; tables and code blocks over prose; no filler;
  link, never repeat. Never paper over what a newcomer can't know: show the real command, not "turn
  that feature off". Complete but lean: a cold reader needs nothing else, and reads nothing extra.
- **The goal:** deliberate, good-looking docs, each page at one level.

**Guide pages:**
- Explain each term on first use, in a few words: TSR, FM chip, Jemm, QPIEMU, upper memory, boot menu.
- Every step is a command to copy, then what you should see.
- No `rebeep` CLI, Node or repo; architecture only as "want to know why?". Verified facts only.

**Everywhere:** style and budgets are in the root [AGENTS.md](../AGENTS.md) "Writing docs". A new
page gets a row here, and a line in its level's group of the [README](../README.md)'s index.

## Pitfalls

- `guide/reference.md`, `release/README.TXT` and `REBEEP /?` hold the same tables. Change all three.
- No version number in a doc: `rebeep version check` rejects one. Write `x.y.z`.
- `architecture/how-it-works.md`'s numbers come from `P_BENCH`. Re-measure them when the trap code changes.
- Host-specific lab steps (Windows, Linux, macOS) drift fastest. Mark anything not verified.

## Run / test

_No commands._

## Related

- [../README.md](../README.md) · [../AGENTS.md](../AGENTS.md)
