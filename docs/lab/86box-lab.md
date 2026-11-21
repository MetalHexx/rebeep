# The 86Box lab

How the VMs are defined, what is on their disks, and how a boot loads Jemm, QPIEMU and ReBeep.

## Where things live

| Place | Holds |
|---|---|
| `env/86box/` (repo) | The definition: pinned tools, VM profiles, DOS boot files |
| `~/.rebeep/` (your home) | Everything else: tools, media, VM disks, baselines |

Override the home with `REBEEP_HOME=<path>` or `--home <path>`.

```
~/.rebeep/
├─ tools/<name>/<version>/   86Box, ROMs, Jemm, FreeDOS, NASM, DOSBox-X
├─ cache/                    verified downloads
├─ 86box/86box_global.cfg    an isolated 86Box global config
├─ media/                    your MS-DOS floppies and games
├─ vms/<vm>/                 86box.cfg, c.img, d.img, nvr/, floppy/
└─ baselines/<vm>/           c.img, nvr/, meta.json
```

## The VMs

| VM | Machine | CPU | RAM | Sound | C: |
|---|---|---|---|---|---|
| `mirror-msdos` | `ficpa2012` (FIC PA-2012, Socket 7) | Pentium MMX 233 | 16 MB | Sound Blaster Vibra 16S | blank; you install MS-DOS 6.22 |
| `mirror-freedos` | same | same | same | same | FreeDOS 1.4, built by script |
| `slow-386sx` | `awardsx` (Award 386SX) | 386SX/16 | 4 MB | same | a clone of the `mirror-msdos` baseline |

- **The rig.** The mirrors stand in for the real test rig, a FIC PA-2010 board (VIA VP1). 86Box has
  no VP1 board, so they use FIC's next board, the PA-2012. For ReBeep, the timer, port `61h`, the
  ISA Sound Blaster and the CPU speed matter far more than the chipset.
- **Sound.** The card is non-PnP, at `A220 I5 D1 H5`, with OPL3 at `388h`. The PC speaker is always
  emulated.
- **Video.** Tseng ET4000AX (ISA VGA).
- **The slow profile's timing is indicative only.** An emulator's timing is not a real 386SX.

Each profile is two files in `env/86box/profiles/<vm>/`:

- `86box.cfg.tmpl`: the 86Box config, rendered into the VM folder on every `rebeep vm run`. Change
  this file, not the 86Box settings dialog, because GUI changes are overwritten.
- `profile.json`: disk geometry, where C: comes from, the install media, and the ROM files the
  machine needs.

## The disks

| Drive | Size | Made by | Lifetime |
|---|---|---|---|
| **C:** | 128 MB (260 cylinders, 16 heads, 63 sectors) | DOS Setup, or the FreeDOS script | Kept. Snapshot it as the baseline |
| **D:** | 64 MB (130 cylinders, 16 heads, 63 sectors); 128 MB on `slow-386sx` | `rebeep disk deploy`, every time | **Rewritten on every deploy.** Don't keep files there |

`slow-386sx`'s BIOS has one user-defined disk type, shared by both drives, so its D: uses C:'s
geometry.

The D: layout:

```
D:\README.TXT
D:\ENV\BOOT.BAT              run by AUTOEXEC on every boot
D:\ENV\QPICHK.COM            reports whether QPIEMU is up
D:\ENV\MSDOS622\INSTALL.BAT  one-time C: setup for MS-DOS 6.22
D:\ENV\FREEDOS\INSTALL.BAT   one-time C: setup after a FreeDOS installer
D:\JEMM\                     Jemm 5.87, JLOAD, QPIEMU
D:\GAMES\<NAME>\             your games
D:\REBEEP\                   REBEEP.COM, RBTEST.COM and AUTOLOAD.FLG, the latest build, and
                             REBEEPD.COM, the dev-only trace build
```

D: is written by the CLI's own FAT16 writer, straight from the repo, the tool archives and your
game zips. Game files are never extracted onto your host.

DOS needs 8.3 names, so the deploy handles awkward files like this:

- **Long name** (more than 8.3 characters): **skipped**, with a warning that names the game.
- **Two names that differ only by case:** the first is kept, with a warning.
- **A game that doesn't fit on D:**: left out, with a warning.

Check the output of `rebeep disk deploy` (or `rebeep disk list`) when a game misbehaves.

To move a file between your host and D: without copying it by hand, quit the VM first, then:

| Goal | Command |
|---|---|
| See what D: holds now, including what DOS wrote | `rebeep disk show <vm> [path]` |
| Copy a file or folder off D: | `rebeep disk fetch <vm> <path>`, into `build/disk/<vm>/` unless you give `--out <dir>` |
| Put a host file on D: | `rebeep disk add <vm> <file> [--to <dir>]` |

The next deploy drops anything you added and anything DOS wrote, so fetch it before then. Game
folders can't be fetched; your games stay in the media folder.

## How a boot fits together

1. **CONFIG menu.** The default is **ReBeep dev**, which loads
   `C:\JEMM\JEMMEX.EXE NOEMS X=TEST NOVME NOINVLPG` and `DOS=HIGH,UMB`. **Clean** loads no memory
   manager, for A/B listening.
2. **AUTOEXEC** (MS-DOS) or **FDAUTO** (FreeDOS):
   - sets `PATH` (with `C:\JEMM` first) and `BLASTER=A220 I5 D1 H5 T6`;
   - sets `RBDEV=1` on the dev entry;
   - calls `D:\ENV\BOOT.BAT`.
3. **BOOT.BAT** adds `D:\REBEEP` to `PATH` on every boot, then, on the dev entry:
   - runs `JLOAD QPIEMU.DLL`, then `QPICHK`;
   - `LH D:\REBEEP\REBEEP` if `D:\REBEEP\AUTOLOAD.FLG` exists. `rebeep build run --deploy` writes
     that flag for every build target marked `"autoload": true` in `src/targets.json` (`REBEEP.COM` is).

Because `BOOT.BAT` lives on D:, changing the boot steps needs only a deploy, never an edit on C:.

**MS-DOS and FreeDOS differ:**

| | MS-DOS 6.22 | FreeDOS 1.4 |
|---|---|---|
| Config files | `CONFIG.SYS`, `AUTOEXEC.BAT` | `FDCONFIG.SYS`, `FDAUTO.BAT` |
| `%CONFIG%` on the dev entry | `REBEEP` (the block name) | `1` (the menu number) |
| Shell line | ordinary | `SHELL=… /P=C:\FDAUTO.BAT` is required |

## Where ReBeep loads

On the **ReBeep dev** entry, `BOOT.BAT` loads ReBeep high (`LH D:\REBEEP\REBEEP.COM`) after QPIEMU,
so every boot starts with the newest build resident. `REBEEP /U` unloads it. The **Clean** entry
loads nothing. `RBTEST.COM` is deployed beside it.

## The `vm` test suite

`rebeep test run --suite vm` runs each `tests/vm/P_*.BAT` probe unattended on `mirror-freedos`. It
writes a probe D: whose `ENV\BOOT.BAT` is the probe, boots, reads `RESULT.TXT` back and redeploys the
normal D:. Probe format and rules: [tests/vm/AGENTS.md](../../tests/vm/AGENTS.md).

## Snapshot and reset

| Command | Does |
|---|---|
| `rebeep vm snapshot <vm>` | Saves C: and the CMOS (NVR) as the baseline |
| `rebeep vm reset <vm>` | Restores the baseline and rewrites D: |
| `rebeep env reset` | Resets every VM that has a baseline |
| `rebeep env clean` | Deletes the tools, cache and VMs, and keeps your media and baselines (`--all` deletes both). Files it didn't create are never touched |

All of these refuse while that VM is running. Add `--preview` to see what would change.

With no baseline:

- `mirror-freedos` and `slow-386sx` are rebuilt.
- `mirror-msdos` refuses unless you pass `--rebuild`, so a hand-done install is never wiped by
  accident.

## Pinned tools

`env/86box/manifest.json` pins every download by version, URL and SHA-256:

- 86Box v6.0 and its v6.0 ROM set;
- Jemm 5.87;
- FreeDOS 1.4;
- NASM 3.02;
- DOSBox-X 2026.10.01.

On Linux and macOS, NASM (and on Linux, DOSBox-X) comes from your package manager instead. To
re-pin a tool, follow the procedure in [env/AGENTS.md](../../env/AGENTS.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "CMOS checksum error" at every boot | Press F1. Take a snapshot after the first good boot, so it's saved |
| BIOS doesn't see a disk | Del → IDE HDD auto-detection (or set the type to Auto), then save |
| `DISK BOOT FAILURE` on `slow-386sx` | Del → set Drive C: to the user type with 260 / 16 / 63, precomp 0, landzone 260. See [lab setup](setup.md#3-full-path-ms-dos-622-and-your-own-game) |
| No sound at all, even `ECHO` + Ctrl+G | Check 86Box in the host's volume mixer, then **Action → Hard Reset** |
| A game hangs on a black screen in `mirror-freedos` | Some old games don't run on FreeDOS. Grand Prix Circuit hangs there in both menu entries; use `mirror-msdos` |
| `QPICHK: no QPI` | Boot the **ReBeep dev** entry. Clean has no Jemm |
| `… is running. Quit 86Box first.` | Close the VM window, then retry |
| Changes made in the 86Box settings dialog vanished | Expected. Edit the profile's `86box.cfg.tmpl` |
