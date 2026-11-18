# Getting started

From a fresh clone to a booted DOS VM with ReBeep's environment loaded.

## 1. Prerequisites

| Need | Check |
|---|---|
| Node.js 22 or newer | `node --version` |
| About 4 GB free | for 86Box, its ROMs, the VM disks and their baselines (`env check` warns below 4 GB) |
| Linux/macOS only: NASM ≥ 2.16 | `nasm -v` (`sudo apt install nasm`, `brew install nasm`) |
| Linux only, for the DOS test suite: DOSBox-X | `dosbox-x --version` (distro package or Flatpak) |

Then check the host:

```sh
node tools/rebeep.mjs env check
```

> Tip: `npm link` once, and use `rebeep …` instead of `node tools/rebeep.mjs …`.

## 2. Free path: FreeDOS

```sh
rebeep env setup               # fetch tools, build the FreeDOS C:, write D:
rebeep vm run mirror-freedos
```

- **First boot:** the BIOS says "CMOS checksum error - Defaults loaded". Press **F1**. The VM keeps
  its CMOS from then on.
- The boot menu picks **ReBeep dev** after 5 seconds. It loads Jemm, then QPIEMU, and prints
  `QPICHK: QPI ready (QPIEMU), version 07.03`.
- `D:\REBEEP\REBEEP` runs the latest build.

When it looks right, save it as the VM's baseline:

```sh
rebeep vm snapshot mirror-freedos      # quit 86Box first
```

## 3. Full path: MS-DOS 6.22 and your own game

You supply three MS-DOS 6.22 floppy images (1.44 MB each) and a game zip. They are copied into
`~/.rebeep/media`, never run on your host and never committed.

```sh
rebeep media add msdos622 path/to/msdos-floppies
rebeep media add game path/to/game.zip --name GPC
rebeep vm create mirror-msdos
rebeep vm run mirror-msdos --install
```

In the VM:

1. Press **F1** at the CMOS message. Setup starts from disk 1.
2. Pick **Configure unallocated disk space**. Setup restarts the VM and formats C:.
3. When it asks for disk 2 or 3: **Media → Floppy 1 → Existing image…**, then pick the path the CLI
   printed (`…\vms\mirror-msdos\floppy\DISK2.IMA`).
4. At the end, **Media → Floppy 1 → Eject**, press Enter, let it boot to `C:\>`, then close 86Box.

Then attach D: and install the ReBeep boot files:

```sh
rebeep vm run mirror-msdos
```

```
C:\> D:\ENV\MSDOS622\INSTALL
```

Restart (**Action → Ctrl+Alt+Del**), let the menu pick **ReBeep dev**, and run your game from
`D:\GAMES\GPC\`. When it all works, quit 86Box and `rebeep vm snapshot mirror-msdos`.

The slow profile clones that baseline:

```sh
rebeep vm create slow-386sx
rebeep vm run slow-386sx
```

## 4. Everyday loop

```sh
rebeep build run --deploy      # edit src/, assemble, rewrite every VM's D:
rebeep vm run mirror-freedos   # then run D:\REBEEP\REBEEP in the VM
rebeep test run --suite tools  # the CLI's own tests
```

Something broken? `rebeep vm reset <vm> --preview`, then `--yes`.

## Verified on

| Host | Status |
|---|---|
| Windows 11 x64 | ✔ verified: tool fetch, FreeDOS VM boot with Jemm + QPIEMU, deploy, snapshot and reset, MS-DOS 6.22 install |
| Linux x64 | unverified; CI runs the tools tests and build |
| macOS (Apple Silicon / Intel) | unverified; CI runs the tools tests and build |

Tried it on Linux or macOS? A PR adding your result to this table is very welcome.
