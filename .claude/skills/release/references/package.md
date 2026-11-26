# Release package

```sh
rebeep release create                 # build, then package
rebeep release create --skip-build    # package the current build/
```

Everything lands in `build/release/` (replaced on each run):

| File | What |
|---|---|
| `rebeep-<version>.zip` | The package, uppercase 8.3 paths, deflated |
| `rebeep-<version>-floppy.img` | The same files on a 1.44 MB FAT12 floppy |
| `SHA256SUMS.txt` | `<hex>  <file>` for both downloads |
| `release.json` | `{ version, targets: [{ name, sha256 }] }`, the SHA-256s of the packaged programs. The `vm` suite does not read it yet |
| `NOTES.md` | The changelog entry for the version (`Unreleased preview` when there is no dated entry), then a SHA-256 table |

**The package** is `REBEEP.COM`, `RBTEST.COM` and `RBSTUDIO.EXE` from `build/`; every `build.json` `files`
entry deployed to `REBEEP` or below it, at its path below `REBEEP` (`SPLASH.ANS`, `MENU.ANS`,
`FACTORY/*.RBP`); everything under `release/` except its `AGENTS.md` (`@VERSION@` in `README.TXT` and
`INSTALL.BAT` is filled in); and a generated `CHANGES.TXT` (dated versions up to the package version).

**Checks.** Every text must be ASCII, CRLF, at most 80 columns and have 8.3 names; `.COM`, `.EXE` and `.ANS`
files are binary (names only). A boot config (`CONFIG.SYS`, `AUTOEXEC.BAT`, `FDCONFIG.SYS`, `FDAUTO.BAT`) at the top
level is refused; the ones in `release/SAMPLES/` are fine. A built file that no longer matches `build.json` is
refused. All problems are listed at once. The floppy must also fit, pass `checkImage` and read back identical.

**The floppy boot sector** is `build/FDBOOT.BIN` (`src/diag/fdboot.asm`). Left in A:, the floppy hands the boot
to C: and asks for a key only when there is no bootable C:, so unattended probes can keep it attached.

## Versioning and publishing

```sh
rebeep version show                  # version, tag, whether the changelog dates it
rebeep version check                 # package.json, CHANGELOG.md and the tree agree
rebeep version bump minor --preview  # major|minor|patch|X.Y.Z; --yes to write
```

### Lockstep

`package.json` is the only place the version is written. Every surface reads it, and these check it:

| Surface | Checked by |
|---|---|
| The `CHANGELOG.md` heading; no version written anywhere else in the tree | `version check --release` |
| `REBEEP.COM` (load message, `/S`, `/?`), `README.TXT`, the `INSTALL` screens, `CHANGES.TXT`, the file names, the `NOTES.md` title | `release create`, which fails on a stale `REBEEP.COM` or an unfilled `@VERSION@` |
| The tag, `vX.Y.Z` | `release.yml`, through `version check --tag` |
| What the PC shows | The load message and the `INSTALL` menu, in the checks by a person |

`bump` moves `[Unreleased]` under `## [X.Y.Z] - <today>` and writes `package.json`; it never commits, tags or
pushes, and refuses an empty `[Unreleased]`. A version equal to the current one is the first release, while undated.

Flow: bump on a branch, open a PR, squash-merge. `.github/workflows/release.yml` runs on every push to `main` (and
`workflow_dispatch` there) and does nothing with no dated entry for the version, or when the tag and both downloads
exist. Otherwise it checks, fetches Open Watcom (the studio needs it), runs `release create` and `fsck.fat -n` on the
floppy, tags the commit (failing if the tag is on another commit) and creates the GitHub Release, or uploads with
`--clobber`. A re-run finishes a half-done release, never making a second tag. PR CI (`ci.yml`) runs `version check`
and `release create --skip-build` on every OS. The whole procedure: [docs/lab/releasing.md](../../../../docs/lab/releasing.md).

Code: `tools/lib/version.mjs`, `release.mjs` and their `tools/commands/`; `buildFloppy` (`fat.mjs`), `writeZip` (`zip.mjs`).
