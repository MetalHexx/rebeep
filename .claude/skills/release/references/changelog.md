# Changelog rules

`CHANGELOG.md` is for players. Each release's entry becomes the GitHub release notes (`NOTES.md`)
and part of the package's `CHANGES.TXT`, so every release must read the same, whoever writes it.

## Shape

- `## [Unreleased]` stays on top. A release is `## [X.Y.Z] - YYYY-MM-DD`, dated by
  `rebeep version bump`.
- `###` sections in this order, only those with lines: Added, Changed, Fixed, Removed, Known issues.
- One bullet per thing a player notices, opening with it in bold.
- Each bullet ends with a link to the doc that covers it, as a full
  `https://github.com/MetalHexx/rebeep/blob/main/<path>#<heading>` URL. Relative links break in the
  release notes. `CHANGES.TXT` keeps only the link text.

## Altitude

- High level and concise: one or two lines on what it does for the player.
- Say what the player gets or saw, never how the code does it: "**Hotkeys** now cycle the patches",
  not "refactored the trap handler". A fix says what went wrong for them: "**Long races** no
  longer crash on real PCs".
- Several commits for one feature make one bullet. Commits a player can't notice (tests, CI,
  refactors, lab tooling) stay out.
- A known issue says what to do about it.

## Text

- ASCII, apart from curly quotes and dashes, which `CHANGES.TXT` turns into ASCII. Anything else
  stops `rebeep release create`.
- Options and commands in backticks, as the player types them: `REBEEP /R:0`.

## Check the links

Each `blob/main/<path>#<heading>` must name a file on the branch and a heading in it; it resolves
on GitHub once the branch merges. Turn the heading into GitHub's anchor (lower case, punctuation
dropped, spaces to hyphens) and compare.

## Example

```markdown
### Added

- **Bell patch, brighter:** `/P:4` rings longer and cuts through engine noise
  ([playing](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/playing.md#pick-a-voice)).

### Fixed

- **Long races** no longer crash on real PCs
  ([compatibility](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/compatibility.md)).
```
