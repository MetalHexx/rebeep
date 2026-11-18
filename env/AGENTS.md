# env

> The definition of the 86Box test environment. Payloads live in `~/.rebeep`, never here.

## What's here

| Path | Role |
|---|---|
| `86box/manifest.json` | Every pinned tool: version, per-OS asset URL, SHA-256 and where the hash came from |
| `86box/profiles/<vm>/86box.cfg.tmpl` | The VM's 86Box config. Rendered on every `vm run` |
| `86box/profiles/<vm>/profile.json` | Disks, C: route (blank, build or clone), install media, required ROMs |
| `86box/dos/common/` | `BOOT.BAT` (loads QPIEMU on the dev menu entry), copied to `D:\ENV\` |
| `86box/dos/msdos622/` · `86box/dos/freedos/` | Each DOS's `CONFIG`/`AUTOEXEC` and its one-time `INSTALL.BAT` |

## Rules

- The cfg template is the only source. Settings changed in the 86Box GUI are lost on the next run.
- Never write `uuid` or `cpu_override` in a template: each makes 86Box open a dialog.
- Set `fdd_01_type` and `fdd_02_type` explicitly. An omitted type means a 360K drive.
- Everything under `86box/dos/` is CRLF (enforced by `.gitattributes`). Names are 8.3.
- **Pinning a tool:** download it once, hash it with SHA-256, cross-check the publisher's sums when
  they exist (`"sha256Source": "publisher"`), otherwise record our own (`"pinned"`). Commit the
  manifest.

## Pitfalls

- `%CONFIG%` is the menu block name in MS-DOS but a digit in FreeDOS. The boot files map it to
  `RBDEV` and test that instead.
- `FDCONFIG.SYS` needs its `SHELL=... /P=C:\FDAUTO.BAT` line, or FreeDOS runs `AUTOEXEC.BAT`.
- Install mode attaches no D:, so DOS Setup can't partition the wrong disk.
- A missing ROM makes 86Box silently switch machines. `profile.json` lists the ROMs `vm run`
  checks for.
- A new VM's first boot stops at "CMOS checksum error". Someone has to press F1 (injected keys
  don't reach 86Box). The NVR keeps it, and `vm snapshot` saves the NVR.
- FreeDOS's own `FREEDOS\BIN` has an older Jemm. `C:\JEMM` must stay first on `PATH`, and the boot
  files use full `C:\JEMM\` paths.
- `FDAPM POWEROFF` closes a FreeDOS VM, so FreeDOS boot checks can run unattended. MS-DOS 6.22 has
  no equivalent.

## Run / test

```sh
rebeep vm create <vm>
rebeep disk deploy
rebeep vm run <vm>
```

## Related

- [docs/86box-environment.md](../docs/86box-environment.md): the full guide
- [tools/AGENTS.md](../tools/AGENTS.md): the CLI that reads these files
