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

To see what a game makes ReBeep do, load `REBEEPD.COM`, the trace build deployed beside
`REBEEP.COM`, instead of ReBeep. It logs every speaker step and OPL note, and `REBEEPD /D` writes the
log to `D:\REBEEP\RBTRACE.TXT`. It is for development only and never ships. The steps and the log
format are in the `rebeep-dev` skill's [trace reference](../.claude/skills/rebeep-dev/references/trace.md).

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

## Releasing

1. On a branch, run `rebeep version bump <major|minor|patch|X.Y.Z>`. It dates `[Unreleased]` and sets `package.json`.
2. Open a PR; CI runs `rebeep version check` and a package dry run.
3. Squash-merge. On `main`, the release workflow tags `vX.Y.Z` and publishes the GitHub Release.

## Before each release

The probes run on the final files, so do these in order on the release branch.

**Automatic:**

1. `rebeep version bump <X.Y.Z>`
2. `rebeep release create`, so the floppy carries the final `CHANGES.TXT`
3. `rebeep test run`
4. `rebeep test run --suite vm`: every probe, including the floppy and the samples
5. `rebeep version check --release`

**By a person.** These checks gate the merge. Run them before the release PR is marked ready, and
commit their results (the GPC row, the `slow-386sx` numbers) to the branch first. A failed check
means a fix on the branch, never a merge.

- **`mirror-msdos`:**
  - On the normal dev boot, which autoloads ReBeep, play Grand Prix Circuit
    (`D:\GAMES\GPC\GPAUTO\GPEGA.EXE`): its engine and effects come out of the OPL with the real
    speaker silent, in faithful mode and in a patch. No note may click, and the engine's rests are
    silent. After `REBEEP /R:0` the intro and the screen changes don't click (at `/R:1` they do:
    that is the game's own speaker sound). After `REBEEP /V:0 /R:0` the game must be silent. After
    `REBEEP /L:1` the rests are a low FM note.
  - At the DOS prompt, with `RBTEST /C:1`: Ctrl+Alt+B toggles between the OPL and the speaker, and
    Ctrl+Alt+N cycles the voice. GPC takes over the keyboard, so the hotkeys do nothing inside it.
  - Update the GPC row in [compatibility.md](compatibility.md).
  - Last, attach `build/release/rebeep-<v>-floppy.img` as A: from 86Box's Media menu, run
    `A:\INSTALL`, copy the MS-DOS samples over C:'s configs and reboot. Check that ReBeep loads from
    the sample config.
  - Quit 86Box, then run `rebeep vm reset mirror-msdos --yes` to put the VM back on its dev configs.
- **`mirror-freedos`:** GPC hangs there, so FreeDOS acceptance rests on RBTEST.
  - With ReBeep autoloaded, play RBTEST cases 0 to 9 by ear (`RBTEST /C:n`), especially case 4, the
    stepped beeps, and case 0, the same beeps keyed the way GPC keys them. Neither may click or
    crackle. Do it in faithful mode and in one patch.
  - The real speaker stays silent while the OPL plays.
  - Ctrl+Alt+B hands the tone to the speaker and back. Ctrl+Alt+N cycles the voice.
- **DOSBox-X:** run `T_OPL /L` with `oplmode=opl2` and again with `oplmode=opl3`, and confirm the
  OPL2 faithful voice sounds square-like. If you skip this, the `CHANGELOG.md` Known issues must say
  the OPL2 voice hasn't been checked by ear.
- **`slow-386sx`:** `RBTEST /B` with ReBeep loaded, then after `REBEEP /OFF`. Record the numbers in
  [how-it-works.md](how-it-works.md).

**After the merge publishes the release:** install the published zip or floppy on the real rig by
following `README.TXT`, and repeat the GPC checks. A failure there is fixed in a 0.1.x patch release.

## Report your host

The environment is verified on Windows. If you run it on Linux or macOS, add your result to the
**Verified on** table in [getting-started.md](getting-started.md), even if something broke. Say
what broke.
