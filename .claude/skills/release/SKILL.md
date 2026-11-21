---
name: release
description: Cut a ReBeep release from a branch to a published GitHub Release. Reads the branch's commits, offers to update docs the commits missed, picks the version with the user, writes a concise changelog and has the user review the release notes, bumps the version, runs the checks, walks the user through the checks by a person, and sees the merge and the publish through. Use when the user wants to release, ship, publish or tag a version, prepare a release PR, bump the version, write the changelog or release notes, or make a hotfix.
---

# release

The agent's procedure. **[docs/lab/releasing.md](../../../docs/lab/releasing.md)** owns the release
steps and the checks by a person, and [AGENTS.md](../../../AGENTS.md) the repo's rules. This skill
says what the agent does at each step.

| Need | Reference |
|---|---|
| The changelog rules | [references/changelog.md](references/changelog.md) |
| The package, the version on every surface, and the version and publish commands | [references/package.md](references/package.md) |

**Always:**

- **Merging into `main` publishes.** Never mark the PR ready, merge, push to `main` or use the
  admin bypass without the user's explicit go for this release.
- Talk in short steps, and lead with what the user must do or decide.
- **No agent attribution** in commits, the PR, the notes or the squash message. Before the PR is
  ready, grep `git log --format='%an %ae %cn %ce%n%B' origin/main..HEAD` and the PR body for
  `Co-Authored-By`, `Generated with`, `claude`, `anthropic`. Read each: `.claude/` paths match.

## 1. Read the branch

```sh
git fetch origin
git branch --show-current; gh pr list --head "$(git branch --show-current)" --state open
git log --no-merges --format='%h %s%n%b' origin/main..HEAD     # every commit to be released
git log --no-merges --format='%h %s' origin/main..HEAD -- '*.md' release/README.TXT
rebeep version show
```

- **Where you are.** On `main`? Branch first. A PR already open from this branch is the release
  PR: update it, never open a second. Its version already dated in `CHANGELOG.md`? The release was
  prepared earlier: the version is set (skip step 2), check the entry in step 3 rather than rewrite
  it, and skip the bump in step 4.
- Sort the commits by what a player would notice: new features, changes, fixes, removals. `test`,
  `ci`, `chore`, `refactor` and lab-only commits stay out of the changelog.
- **Docs check.** The second `git log` lists the commits that touched docs. If a `feat` or `fix`
  commit has no doc change of its own or after it, list those commits and offer to bring the docs
  up to date with the `update-docs` skill. Do it only once the user agrees, and commit it on the
  branch before going on.

## 2. Pick the version

Suggest one, then let the user choose:

| The branch has | Suggest |
|---|---|
| Only fixes | patch |
| New features or options | minor |
| A change that breaks a working setup (an option removed or renamed, a new requirement) | major; while the version is `0.x`, minor |

## 3. Write the changelog, and have the user review it

1. Rewrite `## [Unreleased]` from the commits, following [the changelog rules](references/changelog.md).
   Stay high level and concise: several commits for one feature make one bullet.
2. Check every link, as the rules say.
3. `rebeep release create`, then show the user `build/release/NOTES.md`. It is exactly what the
   GitHub Release will say. Wait for their OK or their edits.

## 4. Bump and run the automatic checks

```sh
rebeep version bump <patch|minor|major|X.Y.Z> --preview   # then the same with --yes
```

The bump dates the entry today and sets `package.json`. Already dated, because the release was
prepared earlier? Skip the bump, and fix the date on merge day (step 6). Then run section 2 of
`releasing.md`, check that every surface shows the same version ([lockstep](references/package.md#lockstep)),
commit `chore: release X.Y.Z`, push, and open or update the release PR as a draft.

## 5. The checks by a person

Hand the user `releasing.md` section 3 one machine at a time, real machine last. Record what they
report (game and machine rows in `docs/guide/compatibility.md`, the `slow-386sx` numbers in
`docs/architecture/how-it-works.md`) and commit it. A failure: fix it on the branch, then step 4.

## 6. Merge day

- The entry's date is today's. If not, edit the heading's date, then rerun step 4's checks.
- CI is green, the user has reviewed the notes (step 3), and the attribution scan (Always) is clean.
- Ask for the go, saying the scan is clean. On it, mark ready and squash-merge, or the user does.

## 7. After the merge

Watch it with `gh run list --workflow release.yml --limit 1`, then `gh run watch <id>`.

- Compare the release's `SHA256SUMS.txt` with `build/release/SHA256SUMS.txt`. A match means the
  downloads are the bytes that were tested.
- Have the user install the download by following `README.TXT`: ReBeep loads and names its version.
- Offer a short announcement for Discord, for the user to post.
- Half done? Re-run the workflow on `main` (`gh workflow run release.yml --ref main`); it never
  makes a second tag. Broken? Make a patch release. Never move or delete a published tag.

**Hotfix:** branch from `main`, fix, then steps 1 to 7 with a patch version. In step 5, run the
checks the fix touches, and the real machine.
