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

Code: `tools/lib/release.mjs`, `tools/commands/release.mjs`; `buildFloppy` in `tools/lib/fat.mjs`,
`writeZip` in `tools/lib/zip.mjs`.
