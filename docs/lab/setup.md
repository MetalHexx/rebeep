# Lab setup

From a fresh clone to a booted DOS VM with ReBeep's environment loaded.

## 1. Prerequisites

| Need | Check |
|---|---|
| Node.js 22 or newer | `node --version` |
| About 4 GB free | for 86Box, its ROMs, the VM disks and their baselines (`env check` warns below 4 GB) |
| Linux/macOS only: NASM ≥ 2.16 | `nasm -v` (`sudo apt install nasm`, `brew install nasm`) |
| Linux only, for the DOS test suite: DOSBox-X | `dosbox-x --version` (distro package or Flatpak) |
| A `tar` that reads xz, to unpack Open Watcom | Windows: its own `System32\tar.exe`. Linux: GNU tar with `xz-utils`. macOS: its own `tar` |

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
- The boot menu picks **ReBeep dev** after 5 seconds. It loads Jemm, then QPIEMU, prints
  `QPICHK: QPI ready (QPIEMU), version 07.03`, and loads the latest ReBeep build (autoload).
- `REBEEP /S` shows its status. `D:\REBEEP\RBTEST` plays test sounds and checks ReBeep; see
  [the RBTEST reference](../guide/reference.md#rbtest).

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

Restart (**Action → Ctrl+Alt+Del**), let the menu pick **ReBeep dev**, and run your game from its
folder under `D:\GAMES\<NAME>\`. The deploy strips one wrapper folder from the zip and keeps the
rest, so look inside: Grand Prix Circuit lands in `D:\GAMES\GPC\GPAUTO\`. When it all works, quit
86Box and `rebeep vm snapshot mirror-msdos`.

The slow profile clones that baseline:

```sh
rebeep vm create slow-386sx
rebeep vm run slow-386sx
```

Its 1990 Award BIOS forgets the disks when it loads defaults, so the first boot needs setup:

1. Press **F1** at the CMOS message. It then stops at `DISK BOOT FAILURE`.
2. **Action → Ctrl+Alt+Del**, and press **Del** while it counts memory.
3. Set **Drive C:** to the user-defined type (the last one, 49) with **260** cylinders, **16** heads,
   **63** sectors, precomp **0**, landzone **260**. Drive D: shares that type, which is why D: on
   this VM is the same size as C:.
4. Set **Drive A:** to **1.44M, 3½ in.**, then **F10** to save.
5. Once it boots, quit 86Box and `rebeep vm snapshot slow-386sx`.

The EGA profile, for the studio's 14-line font, and the Hercules profile, for its mono view, clone
the same baseline and need only the F1:

```sh
rebeep vm create ega-msdos
rebeep vm run ega-msdos
rebeep vm create hercules-msdos
rebeep vm run hercules-msdos
```

On each, press **F1** at the CMOS message, and once it reaches the DOS prompt, quit 86Box and
`rebeep vm snapshot <vm>`.

## 4. Everyday loop

[ReBeep Studio](../architecture/studio.md) is C, so the build needs Open Watcom once. `tool fetch` downloads the pinned snapshot
and unpacks it with the `tar` from the prerequisites:

```sh
rebeep tool fetch open-watcom
```

```sh
rebeep build run --deploy      # edit src/, assemble, rewrite every VM's D:
rebeep vm run mirror-freedos   # the dev entry autoloads the new REBEEP.COM
rebeep test run --suite tools  # the CLI's own tests
```

In the VM, `REBEEP /U` unloads the autoloaded copy so you can load another with options, and
`D:\REBEEP\RBTEST /A /R` checks it. The DOS-side tests run unattended:

```sh
rebeep test run --suite interpreter           # in DOSBox-X, no VM
rebeep test run --suite vm [--probe P_TSR]    # boots mirror-freedos; opens 86Box
```

Something broken? `rebeep vm reset <vm> --preview`, then `--yes`.

## Verified on

| Host | Status |
|---|---|
| Windows 11 x64 | ✔ verified: tool fetch, FreeDOS VM boot with Jemm + QPIEMU, deploy, snapshot and reset, MS-DOS 6.22 install, Grand Prix Circuit with speaker sound on `mirror-msdos` and `slow-386sx` |
| Linux x64 | unverified; CI runs the tools tests and build |
| macOS (Apple Silicon / Intel) | unverified; CI runs the tools tests and build |

Tried it on Linux or macOS? A PR adding your result to this table is very welcome.

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
| [`game-profile`](../../.claude/skills/game-profile/SKILL.md) | Makes or changes a game profile with you: logs the game, finds the events that tell its parts apart, checks that each rule fires, shapes the patches by ear |

For this page, its [environment](../../.claude/skills/rebeep-dev/references/environment.md) and
[VMs](../../.claude/skills/rebeep-dev/references/vms.md) references cover setup, media and first
boots.
