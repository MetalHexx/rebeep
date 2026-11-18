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
| `release.json` | `{ version, targets: [{ name, sha256 }] }`; the `vm` suite uses it to tell whether the floppy matches the current build |
| `NOTES.md` | The changelog entry for the version (`Unreleased preview` when there is no dated entry), then a SHA-256 table |

**The package** is `REBEEP.COM` and `RBTEST.COM` from `build/`, everything under `release/` except its
`AGENTS.md` (`@VERSION@` in `README.TXT` is replaced), and a generated `CHANGES.TXT` (dated versions up
to the package version, from `CHANGELOG.md`). The version is `package.json`'s.

**Checks.** Every text must be ASCII, CRLF, at most 80 columns and have 8.3 names. A boot config
(`CONFIG.SYS`, `AUTOEXEC.BAT`, `FDCONFIG.SYS`, `FDAUTO.BAT`) at the top level is refused; the ones in
`release/SAMPLES/` are fine. All problems are listed at once. The floppy must also fit, pass
`checkImage` and read back identical to the package.

**The floppy boot sector** is `build/FDBOOT.BIN` (`src/diag/fdboot.asm`). A floppy left in A: hands
the boot to C: (it reads the first hard disk's boot sector and jumps to it) and asks for a key only
when there is no bootable C:. Unattended probes can therefore keep it attached.

## Versioning and publishing

`package.json` is the only place the version is written; the build, the package and `CHANGES.TXT` read it.

```sh
rebeep version show                  # version, tag, whether the changelog dates it
rebeep version check                 # package.json, CHANGELOG.md and the tree agree
rebeep version bump minor --preview  # major|minor|patch|X.Y.Z; --yes to write
```

`bump` moves `[Unreleased]` under `## [X.Y.Z] - <today>` and writes `package.json`. It never commits, tags or
pushes. It refuses an empty `[Unreleased]`. An exact version equal to the current one is the first release,
allowed only while it has no dated entry. `check --release --tag vX.Y.Z` also needs a dated, non-empty entry
and a matching tag.

Flow: bump on a branch, open a PR, squash-merge. `.github/workflows/release.yml` runs on every push to `main`
(and `workflow_dispatch` there): with no dated entry for the version it does nothing; if the tag and both
downloads already exist it does nothing; otherwise it checks, runs `release create`, runs `fsck.fat -n` on the
floppy, tags the commit (failing if the tag is on another commit) and creates the GitHub Release, or uploads
with `--clobber` when the release already exists. A re-run finishes a half-done release and never makes a
second tag. PR CI (`ci.yml`) runs `version check` and `release create --skip-build` on every OS.

Code: `tools/lib/version.mjs`, `tools/commands/version.mjs`, `tools/lib/release.mjs`,
`tools/commands/release.mjs`; `buildFloppy` in `tools/lib/fat.mjs`, `writeZip` in `tools/lib/zip.mjs`.
