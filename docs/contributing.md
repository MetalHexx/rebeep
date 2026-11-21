# Contributing

Thanks for helping. Here is what you need to know.

## Set up

[Getting started](getting-started.md) takes a fresh clone to a booted DOS VM with ReBeep's
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
   | Docs | The rules and budgets in the root [AGENTS.md](../AGENTS.md#10-writing-docs) |

   CI runs the tools and interpreter suites, the build, a package dry run and the payload guard. It
   can't run 86Box, so the VM probes are yours to run before you push.
4. Open a pull request against `main`, as a draft until it's ready, and fill in the template: what
   you ran, and what you heard.

Releases are the maintainer's: [releasing](releasing.md).

## Seeing what a game does

Load `REBEEPD.COM`, the trace build deployed beside `REBEEP.COM`, instead of ReBeep. It logs every
speaker step and OPL note, and `REBEEPD /D` writes the log to `D:\REBEEP\RBTRACE.TXT`. It is for
development only and never ships. The steps and the log format are in the `rebeep-dev` skill's
[trace reference](../.claude/skills/rebeep-dev/references/trace.md).

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
- **Cross-platform.** Use `path.join`, no shell-specific commands. CI runs on Windows, Linux and
  macOS.
- **Pin every download.** Add it to `env/86box/manifest.json` with its SHA-256.

## Docs

- **A change to a command** updates its `--help` (generated from the spec), plus any doc or skill
  reference that mentions it, in the same PR.
- **Each folder's `AGENTS.md`** must stay true. The rules and budgets for every doc are in the root
  [AGENTS.md](../AGENTS.md#10-writing-docs). Working with an AI agent? Its `update-docs` skill
  ([SKILL.md](../.claude/skills/update-docs/SKILL.md)) applies them to your change.
- **Every user-visible change** adds a player-facing line under `## [Unreleased]` in
  [CHANGELOG.md](../CHANGELOG.md).

## Report your host

The environment is verified on Windows. If you run it on Linux or macOS, add your result to the
**Verified on** table in [getting-started.md](getting-started.md), even if something broke. Say
what broke.
