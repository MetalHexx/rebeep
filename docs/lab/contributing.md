# Contributing

Thanks for helping. Here is what you need to know.

## Before you start

- **The biggest help right now is testing games.** Try ReBeep with your speaker-only games and
  file a [game report](https://github.com/MetalHexx/rebeep/issues/new?template=game-report.yml), or
  add a row to [compatibility](../guide/compatibility.md). No setup beyond the player guide.
- **Talk over a feature before you build it.** Open a
  [feature idea](https://github.com/MetalHexx/rebeep/issues/new?template=feature-idea.yml) to
  discuss it with the maintainer, [@MetalHexx](https://github.com/MetalHexx), so it fits the
  [roadmap](../roadmap.md). Bigger ideas are good to raise on
  [Discord](https://discord.gg/4wkPZnCfz) first. Bug fixes need no ask.

## Set up

[Lab setup](setup.md) takes a fresh clone to a booted DOS VM with ReBeep's
environment loaded. Below, `rebeep` stands for `node tools/rebeep.mjs`.

## Workflow

1. Fork, then branch from `main`.
2. Make the change. For anything DOS-side, run `rebeep build run --deploy`, then boot a VM.
3. Run the checks for what you changed:

   | Changed | Run |
   |---|---|
   | Anything | `rebeep repo check` |
   | `tools/` | `rebeep test run --suite tools` |
   | `src/` or `tests/` | Also `rebeep test run --suite interpreter` and `rebeep test run --suite vm` |
   | `src/studio/` or `tests/studio/` | Also `rebeep test run --suite studio` |
   | Docs | The rules and budgets in the root [AGENTS.md](../../AGENTS.md#10-writing-docs) |

   CI runs the tools, interpreter and studio suites, the build, a package dry run and the payload
   guard. It can't run 86Box, so the VM probes are yours to run before you push.
4. Open a pull request against `main`, as a draft until it's ready, and fill in the template: what
   you ran, and what you heard.

Releases are the maintainer's: [releasing](releasing.md).

## The studio

[ReBeep Studio](../architecture/studio.md) (`src/studio/`, `RBSTUDIO.EXE`) is C, built with Open Watcom, which `rebeep tool fetch
open-watcom` fetches ([setup](setup.md#1-prerequisites)). Its suite compiles each `tests/studio/T_*.C`
against the studio's modules, runs them in DOSBox-X, then checks every screen:

```sh
rebeep test run --suite studio
```

**The reference screens are the screen spec.** `tests/screens/<screen>.<view>.scr` (view `vga` or
`mono`) holds what each screen must draw, cell by cell. The suite has the studio draw every screen
with `RBSTUDIO /DUMP:<screen> [/VIEW:MONO] /O:<file>` (a switch for tests, not for players) and
compares the dump with its `.scr`. The format and the check are in
[tests/studio/AGENTS.md](../../tests/studio/AGENTS.md).

**To change a screen, edit its `.scr` first**, in the same change as the code, then make the studio
draw it. The studio's own [AGENTS.md](../../src/studio/AGENTS.md) has the drawing rules. A changed
screen also means new screenshots in the docs and on the site: the
[`update-site`](../../.claude/skills/update-site/SKILL.md) skill retakes them in 86Box.
`RBSTUDIO /BENCH` times the synth screen (a full redraw of the 4-OP and the 2-OP screen, a piano key pressed and released,
a value changed, the help opened), the library load, and the patch list over 2,048 entries (a draw, a click, PgDn), in
milliseconds per call, and writes the same lines to `BENCH.TXT`.

## Seeing what a game does

Load `REBEEPD.COM`, the trace build deployed beside `REBEEP.COM`, instead of ReBeep. It logs every
speaker step and OPL note, and `REBEEPD /D` writes the log to `D:\REBEEP\RBTRACE.TXT`. It is for
development only and never ships. The steps and the log format are in the `rebeep-dev` skill's
[trace reference](../../.claude/skills/rebeep-dev/references/trace.md).

## Game profiles

A profile in `src/factory/profiles/<NAME>/` comes with ReBeep: merged means shipped. To add one,
list its files in `src/targets.json` and add its folder to `release/INSTALL.BAT`, as for `GPC`;
`rebeep test run --suite tools` names anything left out. The `game-profile` skill, below, makes one
with you, and its [ship it](../../.claude/skills/game-profile/references/ship.md) page has every step.

## Commits

[Conventional Commits](https://www.conventionalcommits.org): `feat`, `fix`, `docs`, `test`,
`refactor`, `chore` or `ci`, scoped by area (`tools`, `env`, `src`, `tests`, `docs`). For example:

```
feat(tools): add disk list
fix(env): set the floppy type explicitly on slow-386sx
```

Never write `Co-Authored-By` or any other agent-harness attribution trailer on a commit or PR
description.

## Rules that keep the repo safe to publish

- **No payloads.** No DOS disk images, ROMs, emulator binaries, game files, disk images or
  archives. `rebeep repo check` scans the tree, the index and your commits, and CI runs it too.
- **Untrusted games stay in the VM.** Game files run only inside 86Box or on real hardware.
- **Zero npm dependencies.** The tooling is Node 22+ built-ins only.
- **Ask before adding a dependency.** A new library, tool or download needs the maintainer's OK
  first, and the PR says why: what it does, why the code can't do without it, and what else was
  tried.
- **Cross-platform.** Use `path.join`, no shell-specific commands. CI runs on Windows, Linux and
  macOS.
- **Pin every download.** Add it to `env/86box/manifest.json` with its SHA-256.

## Docs

- **A change to a command** updates its `--help` (generated from the spec), plus any doc or skill
  reference that mentions it, in the same PR.
- **Each folder's `AGENTS.md`** must stay true. The rules and budgets for every doc are in the root
  [AGENTS.md](../../AGENTS.md#10-writing-docs). Working with an AI agent? Its `update-docs` skill
  ([SKILL.md](../../.claude/skills/update-docs/SKILL.md)) applies them to your change.
- **Every user-visible change** adds a player-facing line under `## [Unreleased]` in
  [CHANGELOG.md](../../CHANGELOG.md).

## Report your host

The environment is verified on Windows. If you run it on Linux or macOS, add your result to the
**Verified on** table in [setup.md](setup.md), even if something broke. Say
what broke.

## Working with an AI agent

The repo ships skills for AI coding assistants, such as Claude Code, which picks them up from
`.claude/skills/`. Agents start at [AGENTS.md](../../AGENTS.md).

| Skill | What it does |
|---|---|
| [`rebeep-dev`](../../.claude/skills/rebeep-dev/SKILL.md) | Drives the lab through the `rebeep` CLI: environment, VMs, build and deploy, tests, D: files, the trace build, the lab's patch set |
| [`update-docs`](../../.claude/skills/update-docs/SKILL.md) | Keeps the docs and `AGENTS.md` files true before each commit |
| [`release`](../../.claude/skills/release/SKILL.md) | Cuts a release: the changelog from the branch's commits, your review of the notes, the checks, the merge and the publish |
| [`drive-dos-app`](../../.claude/skills/drive-dos-app/SKILL.md) | Drives a DOS program in a real DOSBox-X window, or a lab VM in 86Box, with typed keys and screenshots, for flows the headless checks cannot reach |
| [`update-site`](../../.claude/skills/update-site/SKILL.md) | Changes the product page with a live three-width preview, and retakes the ReBeep Studio screenshots |
| [`game-profile`](../../.claude/skills/game-profile/SKILL.md) | Makes or changes a game profile with you: logs the game, finds the events that tell its parts apart, checks that each rule fires, shapes the patches by ear |

Ask the agent to run `update-docs` before you commit; it applies the doc rules above to your change.
