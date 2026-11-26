# Releasing

How a version of ReBeep gets from a branch to a GitHub Release. The maintainer runs it, in this
order, on the release branch: the checks run on the final files.

## 1. Prepare the branch

1. Branch from `main`.
2. `rebeep version bump <major|minor|patch|X.Y.Z>`. It moves `[Unreleased]` in
   [CHANGELOG.md](../../CHANGELOG.md) under the new version, dated today, and sets `package.json`.
   `--preview` shows the change first.
3. Commit, push, and open the release PR as a draft.

## 2. Automatic checks

1. `rebeep release create`, so the floppy carries the final `CHANGES.TXT`
2. `rebeep test run`
3. `rebeep test run --suite vm`: every probe, including the floppy and the samples
4. `rebeep version check --release`

CI also runs `version check` and a package dry run on the PR.

## 3. Checks by a person

These gate the merge. A failed check means a fix on the branch, then section 2 again, never a
merge. Commit the results (the GPC and real hardware rows in [compatibility.md](../guide/compatibility.md),
the `slow-386sx` numbers in [how-it-works.md](../architecture/how-it-works.md)) before the PR is marked ready.

**`mirror-msdos`**, on the normal dev boot, which autoloads ReBeep. Play Grand Prix Circuit
(`D:\GAMES\GPC\GPAUTO\GPEGA.EXE`):

- [ ] In faithful mode and in a patch, the engine and effects come out of the OPL with the real
  speaker silent. No note clicks, and the engine's rests are silent.
- [ ] After `REBEEP /R:0` the intro and the screen changes don't click. At `/R:1` they do: that is
  the game's own speaker sound, not a failure.
- [ ] After `REBEEP /V:0 /R:0` the game is silent.
- [ ] After `REBEEP /L:1` the engine's rests are a low FM note.
- [ ] At the DOS prompt, with `RBTEST /C:1`, Ctrl+Alt+B toggles between the OPL and the speaker and
  Ctrl+Alt+N switches between the faithful voice and the loaded patch (load one with `REBEEP /P:FLUTE`).
  GPC takes over the keyboard, so the hotkeys do nothing inside it.
- [ ] The studio: run `RBSTUDIO` from the menu to the patch list to the synth screen. Play a 2-OP patch and
  a 4-OP one (make a 4-OP variant of a factory patch and save it in `USER` with the Save dialog). Help pages 1 and 2, the
  save prompt and the Save dialog look right in colour and with `RBSTUDIO /VIEW:MONO`. Ctrl+S opens the Save dialog at
  once, with no further key (DOSBox-X can't show a DOS pause). After Esc out, `REBEEP /S` shows the traps on and RBTEST plays.
- [ ] On the synth screen, F12 rolls a new sound and plays the last note until it is released, holding it
  never rolls again, F11 changes the sound a little, and Ctrl+Z steps back through each press.
- [ ] The studio's splash and checks screens show the version, so retake the studio screenshots for the docs
  and the site on this build ([update-site](../../.claude/skills/update-site/references/studio-shots.md)).
- [ ] A four-operator patch: `REBEEP /P:<that USER patch>`, `REBEEP /S` says `(4-OP)`, and RBTEST case 1
  plays the fuller voice.
- [ ] Last, attach `build/release/rebeep-<v>-floppy.img` as A: from 86Box's Media menu, run
  `INSTALL` from A: and press `I`: the installed folder holds `RBSTUDIO.EXE`, `FACTORY\` and the art, and
  `RBSTUDIO` starts from it. Run `INSTALL` again and press `U`: it updates the copy. Copy the
  MS-DOS samples over C:'s configs and reboot: ReBeep loads from the sample config. Then quit 86Box
  and run `rebeep vm reset mirror-msdos --yes` to put the VM back on its dev configs.

**`ega-msdos`**, on the dev boot (the IBM EGA card, 640x350 text):

- [ ] `RBSTUDIO`: the synth screen's envelope is smooth at 56 heights, and the patch list, the help, the
  Save dialog and the save prompt look as on `mirror-msdos`. Quit: the DOS prompt has its own font back.

**`hercules-msdos`**, on the dev boot (a Hercules card, mono text):

- [ ] `RBSTUDIO` starts in its mono view by itself: the selected value, the menu row, the dialog buttons,
  held piano keys and the envelope can all be told apart. Quit: the DOS prompt and its cursor look normal.

**`mirror-freedos`**, with ReBeep autoloaded. GPC hangs there, so FreeDOS acceptance rests on RBTEST:

- [ ] RBTEST cases 0 to 9 by ear (`RBTEST /C:n`), in faithful mode and in one patch: nothing clicks
  or crackles, especially case 4, the stepped beeps, and case 0, the same beeps keyed the way GPC
  keys them. The real speaker stays silent while the OPL plays.
- [ ] Ctrl+Alt+B hands the tone to the speaker and back. After `REBEEP /P:FLUTE`, Ctrl+Alt+N makes
  `REBEEP /S` say `faithful voice (patch FACTORY\FLUTE loaded)`, and pressed again `patch FACTORY\FLUTE`.

**DOSBox-X:**

- [ ] `T_OPL /L` with `oplmode=opl2`, then with `oplmode=opl3`: the OPL2 faithful voice sounds
  square-like. If you skip this, the `CHANGELOG.md` Known issues must say the OPL2 voice hasn't been
  checked by ear.
- [ ] The splash jingle, by ear. Under `machine=cga` and then `machine=ega`, the synth screen, the help and the
  save prompt show bright backgrounds, not blinking text (a screen dump cannot show that blink is off).

**`slow-386sx`:**

- [ ] `RBTEST /B` with ReBeep loaded, then after `REBEEP /OFF`. Record the numbers in
  [how-it-works.md](../architecture/how-it-works.md).
- [ ] `RBSTUDIO /BENCH`, recorded in [how-it-works.md](../architecture/how-it-works.md#the-studio), and notes
  played on the synth screen keep up with the keys. With a few hundred patches, the splash's loading
  percentage moves and the patch list pages quickly.

**The real machine**, last. The VMs stand in for it, so it decides the release:

- [ ] Install the release candidate, `build/release/rebeep-<v>.zip` or `rebeep-<v>-floppy.img`, by
  following its `README.TXT`, Jemm included. Repeat the `mirror-msdos` GPC checks: they pass the
  same way.
- [ ] Race GPC to the end of a full race, with ReBeep loaded. Some faults only show after minutes of racing.
- [ ] Play a four-operator patch on its OPL3 by ear, and check the studio's look on its display.

## 4. Merge and publish

1. Mark the PR ready and squash-merge it.
2. On `main`, `.github/workflows/release.yml` checks the version, runs `release create`, checks the
   floppy with `fsck.fat -n`, tags `vX.Y.Z` and publishes the GitHub Release with the zip, the floppy
   and `SHA256SUMS.txt`. A re-run finishes a half-done release and never makes a second tag.

## 5. After the release

The workflow rebuilds the downloads on GitHub's Linux runner rather than copying the candidate. When
its `SHA256SUMS.txt` matches the candidate's, they are the bytes you tested. Either way, download the
zip or the floppy, install it by following `README.TXT`, and check that ReBeep loads. A failure is
fixed in a patch release.

Publishing also republishes the product page: the `pages` workflow runs after `release` completes on
`main` and stamps the new version into it. Open the live site, `https://metalhexx.github.io/rebeep/`,
and confirm it shows the new version and its download links.

## Working with an AI agent

The repo ships skills for AI coding assistants, such as Claude Code, which picks them up from
`.claude/skills/`. Agents start at [AGENTS.md](../../AGENTS.md).

| Skill | What it does |
|---|---|
| [`rebeep-dev`](../../.claude/skills/rebeep-dev/SKILL.md) | Drives the lab through the `rebeep` CLI: environment, VMs, build and deploy, tests, D: files, the trace build |
| [`update-docs`](../../.claude/skills/update-docs/SKILL.md) | Keeps the docs and `AGENTS.md` files true before each commit |
| [`release`](../../.claude/skills/release/SKILL.md) | Cuts a release: the changelog from the branch's commits, your review of the notes, the checks, the merge and the publish |
| [`drive-dos-app`](../../.claude/skills/drive-dos-app/SKILL.md) | Drives a DOS program in a real DOSBox-X window, or a lab VM in 86Box, with typed keys and screenshots, for flows the headless checks cannot reach |
| [`update-site`](../../.claude/skills/update-site/SKILL.md) | Changes the product page with a live three-width preview, and retakes the ReBeep Studio screenshots |

For this page, ask the agent to use the `release` skill. It follows the steps above, and asks you to
review the release notes before anything merges.
