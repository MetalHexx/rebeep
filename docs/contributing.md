# Contributing

Thanks for helping. Here is what you need to know.

## Workflow

1. Fork, then branch from `main`.
2. Make the change. Use `rebeep build run --deploy` and a VM boot for anything DOS-side.
3. Run the checks:

   ```sh
   rebeep test run --suite tools
   rebeep repo check
   ```

4. Open a pull request against `main`, as a draft until it's ready, and fill in the template.

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

## Docs and agent docs

- **A change to a command** updates its `--help` (generated from the spec), plus any doc or skill
  reference that mentions it, in the same PR.
- **Each folder's `AGENTS.md`** must stay true. The rules for writing them are in the root
  [AGENTS.md](../AGENTS.md).

## Keeping docs healthy

Before you commit or open a PR, run the `update-docs` skill
([SKILL.md](../.claude/skills/update-docs/SKILL.md)). It maps your change to the docs it touches and
checks them against the rules and budgets in the root [AGENTS.md](../AGENTS.md#10-writing-docs).
Every user-visible change also adds a line under `## [Unreleased]` in [CHANGELOG.md](../CHANGELOG.md).

## Report your host

The environment is verified on Windows. If you run it on Linux or macOS, add your result to the
**Verified on** table in [getting-started.md](getting-started.md), even if something broke. Say
what broke.
