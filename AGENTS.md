# AGENTS.md

> Orientation for AI agents and human contributors. Read this first; each folder's own
> `AGENTS.md` holds the detail for that folder.

## 1. Overview

ReBeep is a small DOS TSR, written in NASM, that catches what PC-speaker-only games send to the
speaker and plays it on a Sound Blaster's OPL2/OPL3 FM chip instead. It traps ports `42h`, `43h`
and `61h` through JEMM's QPIEMU module, so it needs a 386+ running JEMM. Players shape their own
FM patches in ReBeep Studio (`RBSTUDIO.EXE`), a C program built with Open Watcom.

The repo is also a starter kit. A cross-platform Node CLI, `rebeep`, fetches pinned tools, builds
86Box VMs (MS-DOS 6.22, FreeDOS, a slow 386SX, an EGA PC, a Hercules PC), deploys builds to a delivery disk,
and resets everything to vanilla.

## 2. Repo map

| Folder | What it holds | Guide |
|---|---|---|
| `src/` | ReBeep's NASM source, the C studio, the factory patches and profiles, and their build targets | [src/AGENTS.md](src/AGENTS.md) |
| `tests/` | DOS test programs: interpreter tests and the speaker exerciser | [tests/AGENTS.md](tests/AGENTS.md) |
| `env/` | The 86Box environment definition: tool manifest, VM profiles, DOS boot files | [env/AGENTS.md](env/AGENTS.md) |
| `release/` | The package's hand-made files: the manual, `INSTALL.BAT`, `RBPLAY.BAT`, sample configs | [release/AGENTS.md](release/AGENTS.md) |
| `tools/` | The `rebeep` CLI, its libraries and its unit tests | [tools/AGENTS.md](tools/AGENTS.md) |
| `site/` | The product page for the GitHub Pages site: plain HTML, CSS and JS | [site/AGENTS.md](site/AGENTS.md) |
| `docs/` | Human docs in three levels: `guide/` for players, `architecture/` for how it works, `lab/` for contributors | [docs/AGENTS.md](docs/AGENTS.md) |
| `.claude/skills/` | Agent skills: `rebeep-dev` (environment, VMs, build, CLI), `update-docs` (doc health), `release` (cutting a release, the changelog rules), `drive-dos-app` (a DOS program in DOSBox-X or a VM in 86Box, typed keys and screenshots), `update-site` (the product page's edit-and-preview loop, the studio screenshots) and `game-profile` (making or changing a game profile with the user: logging the game, finding its events, checking each rule, shaping the patches) | [rebeep-dev](.claude/skills/rebeep-dev/SKILL.md) · [update-docs](.claude/skills/update-docs/SKILL.md) · [release](.claude/skills/release/SKILL.md) · [drive-dos-app](.claude/skills/drive-dos-app/SKILL.md) · [update-site](.claude/skills/update-site/SKILL.md) · [game-profile](.claude/skills/game-profile/SKILL.md) |
| `.github/` | CI, release and Pages workflows, and the PR template | — |
| `build/` | Build output (ignored) | — |

## 3. Orient fast

```sh
node tools/rebeep.mjs                # list nouns
node tools/rebeep.mjs env status     # tools, media, VMs, baselines, running VMs
node tools/rebeep.mjs <noun> --help  # verbs for a noun
```

The environment lives **outside the repo**, in `~/.rebeep` (override with `REBEEP_HOME` or
`--home`). `npm link` puts `rebeep` on your PATH.

## 4. Commands

| Task | Command |
|---|---|
| Check the host | `rebeep env check` |
| Set up everything that can be | `rebeep env setup` (`npm run setup`) |
| Bring your own MS-DOS / game | `rebeep media add msdos622 <folder>` · `rebeep media add game <zip> --name GPC` |
| Install MS-DOS into a VM | `rebeep vm run mirror-msdos --install` |
| Run a VM | `rebeep vm run <vm>` |
| Build (the studio needs `rebeep tool fetch open-watcom` first, and a `tar` that reads xz) | `rebeep build run` (`npm run build`) |
| Build and put it on every D: | `rebeep build run --deploy` (`npm run deploy`) |
| Release package (zip, floppy, sums, notes in `build/release/`) | `rebeep release create` |
| Version and release (show, check, date `[Unreleased]` and set `package.json`) | `rebeep version show` · `check` · `bump <major\|minor\|patch\|X.Y.Z>` |
| Unit tests | `rebeep test run --suite tools` (`npm test`) |
| DOS tests: interpreter (DOSBox-X) · unattended VM probes (opens 86Box) | `rebeep test run --suite interpreter` · `rebeep test run --suite vm [--probe P_TSR]` |
| Save a VM baseline | `rebeep vm snapshot <vm>` |
| Back to the baseline | `rebeep vm reset <vm>` · `rebeep env reset` |
| Payload guard | `rebeep repo check` (`npm run check`) |
| Preview the product page (`http://127.0.0.1:8086/rebeep/`, reloads on save) | `rebeep site run [--offline]` (`npm run site`) |
| Build `build/site/`, stamped with the latest release · check it | `rebeep site create [--offline]` · `rebeep site check` |

## 5. Architecture

```mermaid
flowchart LR
  G[Real-mode game] -- "OUT/IN 42h, 43h, 61h" --> J[JEMM + QPIEMU trap]
  J --> C[Capture<br/>386+, resident]
  C --> I[Interpreter<br/>8086-compatible]
  I -- tone events --> O[OPL target<br/>OPL2/OPL3 at 388h]
  I -- untranslatable --> F[Fallback]
  C -- "forward, masked or not" --> H[Real PIT + speaker]
  F --> H
```

Dev loop: edit `src/` → `rebeep build run --deploy` → boot the VM (the dev entry autoloads the new
`REBEEP.COM`; `REBEEP /U` unloads it) → `D:\REBEEP\RBTEST /A /R` or a `vm` probe.

## 6. Hard rules

- **CPU boundary.** `src/engine/` assembles under `CPU 8086`, and the studio compiles for the 8086
  (`wcl -0`, medium model). Only `src/capture/` and `src/startup/` may use 386 instructions.
- **Pinned compilers.** The source assembles on the pinned NASM 3.02 and on NASM ≥ 2.16; the studio
  builds with the pinned Open Watcom snapshot.
- **No game-specific code.** Nothing in `src/` detects a game or behaves differently for one. A bug
  found in one game gets a fix that holds for any game, and a setting one game needs becomes a
  general option. Per-game advice lives in `docs/guide/compatibility.md`.
- **No payloads.** Never commit DOS images, ROMs, emulator binaries, game files, disk images or
  archives. `rebeep repo check` enforces this, and CI runs it.
- **The game is untrusted.** It runs only inside 86Box or on real hardware, never on the host. The
  CLI writes game files from the zip straight into the D: image and never extracts them.
- **D: is disposable.** It is regenerated on every deploy. Names on it are 8.3, uppercase.
- **DOS text files are CRLF.** `.BAT`, `.SYS` and `.TXT` under `env/86box/dos/` and `release/` (see
  `.gitattributes`).
- **Zero npm dependencies.** Tooling is Node ≥ 22 built-ins only.
- **Ask before adding a dependency.** Never install or add a library, tool, download or other
  external dependency without asking the operator first. An agreed one carries its reason in the
  PR ([contributing](docs/lab/contributing.md)).
- **Cross-platform.** Windows, Linux and macOS. Use `path.join`; never hard-code separators or
  shell-specific commands.
- **Pin every download** in `env/86box/manifest.json` with its SHA-256.

## 7. Testing

- `rebeep test run --suite tools` runs the CLI's `node --test` suites in `tools/test/`.
- `rebeep test run --suite interpreter` runs the DOS interpreter tests headless in DOSBox-X.
- `rebeep test run --suite studio` compiles and runs the studio's C tests in DOSBox-X, then checks each
  screen against its reference (`tests/screens/*.scr`, the screen spec: edit it first).
- `rebeep test run --suite vm` boots `mirror-freedos` for each `tests/vm/P_*.BAT` probe, unattended
  (see [tests/vm/AGENTS.md](tests/vm/AGENTS.md)). It opens 86Box and is not part of `--suite all`.
- Tests build their own fixtures in a temp folder; no binary fixtures are committed. In the VMs,
  `CHKDSK D:` must be clean after a deploy.

## 8. Commits & PRs

- Conventional Commits: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, scoped by area
  (`tools`, `env`, `src`, `tests`, `docs`, `site`), for example `feat(tools): add disk list`.
- **Never** write `Co-Authored-By` or any other agent attribution trailer on a commit or PR.
- PRs target `main` and open as drafts. Fill in the PR template.
- Update the affected `AGENTS.md`, skill reference and docs in the same PR as the code
  ([section 10](#10-writing-docs) has the doc rules and the pre-commit `update-docs` run).
- Every user-visible change adds a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md), in
  the same PR, following the [changelog rules](.claude/skills/release/references/changelog.md).

## 9. Security

- Downloads are verified against their pinned SHA-256 before use. Extraction rejects any path that
  escapes the target folder.
- Your own MS-DOS disks and games stay in `~/.rebeep/media/` and are never executed on the host.
- No secrets, tokens or personal paths in the repo.

## 10. Writing docs

Run the `update-docs` skill before every commit or PR; it applies these rules to the change. Each
doc has one job. When two docs need the same fact, one owns it and the others link to it.

| Doc | Job |
|---|---|
| `README.md` | The front door, for players: why, highlights, how in brief, what you need, install in brief, tested on, and the docs index. Build details live in `docs/` |
| `docs/guide/` | The player guide, for a DOS user with no dev tools: getting started, a real PC, 86Box, playing, ReBeep Studio, troubleshooting, compatibility, the reference. `reference.md` owns the option, hotkey and exit-code tables that `release/README.TXT` mirrors |
| `docs/architecture/` | How it works, for the curious: the design, the measured cost (`P_BENCH` numbers), the studio's modules, the GPC case study |
| `docs/roadmap.md` | Where ReBeep is headed: now, ideas, and how to help |
| `docs/lab/` | For contributors: lab setup and the Verified-on table, the 86Box lab (owns lab troubleshooting), contributing (the studio suite and its reference screens), releasing |
| `CHANGELOG.md` | Player-facing changes |
| Folder `AGENTS.md` | That folder's rules and pitfalls |
| CLI help | The source of truth for commands and options (`rebeep <noun> <verb> --help`) |

**Budgets.** Hold altitude and length. Over budget means compress, link out, or, only for a subfolder
with its own invariants, split into a nested `AGENTS.md`. Never raise a budget.

| Doc | Altitude | Budget |
|---|---|---|
| Folder `AGENTS.md` | Intent, invariants, pitfalls, how to run. Never a code walkthrough | ≤ 60 lines |
| Root `AGENTS.md` | Map, commands, hard rules, doc rules | ≤ 200 lines |
| `README.md` | Front door | ≤ 150 lines |
| `docs/**/*.md` | One level per page: guide, architecture or lab ([docs/AGENTS.md](docs/AGENTS.md) says who reads each and how to write for them) | ≤ 250 lines per page |
| Skill `SKILL.md` · skill reference | Routing and procedure; points to `AGENTS.md` | ≤ 100 · ≤ 60 lines |
| `CHANGELOG.md` | Players and features, never the code | One or two lines per bullet |

**Rules:**

- Every tracked, hand-written top-level folder has an `AGENTS.md`, linked from the map in section 2.
  `.claude/`, `.github/` and `build/` are exempt.
- Every folder `AGENTS.md` uses the template below, in that order.
- Scannable and high signal: tables, short bullets, commands you can copy.
- Write only what the code can't tell you: intent, invariants, pitfalls, how to run.
- Link, don't copy. Commands, options and paths match the code.
- Rewrite in place, and delete lines that stopped being true. Never append "Update:" or dated notes;
  history lives in git and `CHANGELOG.md`.
- Plans and ideas live only in `docs/roadmap.md`; no other doc carries a roadmap or status. No
  private paths, no references to planning documents, no agent attribution.
- A nested `AGENTS.md` is allowed only for a subfolder with its own invariants, and its parent
  links to it.

**`CHANGELOG.md`** follows the [changelog rules](.claude/skills/release/references/changelog.md): one
shape for every release, high level and player-facing, each bullet linked to its doc.

**Template:**

```markdown
# <folder>

> One-line purpose.

## What's here
| Path | Role |

## Rules
What must stay true.

## Pitfalls
Mistakes that did or will bite.

## Run / test
Folder-specific commands only.

## Related
Links.
```
