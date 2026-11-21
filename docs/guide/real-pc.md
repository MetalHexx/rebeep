# Set up on a real PC

This page adds a **ReBeep entry to your boot menu**. Your usual setup stays as it was, a pick
away. It takes six steps: back up, get Jemm, install ReBeep, add the entry, check it, and how to
undo it.

You'll edit two files that DOS runs at every boot. `CONFIG.SYS` loads drivers, such as the memory
manager. `AUTOEXEC.BAT` runs commands, such as loading ReBeep. Open them with `EDIT`:

```
EDIT C:\CONFIG.SYS
EDIT C:\AUTOEXEC.BAT
```

On FreeDOS the two files are `FDCONFIG.SYS` and `FDAUTO.BAT`. See [FreeDOS](#freedos) at the end.

## 1. Back up your boot files

```
COPY C:\CONFIG.SYS C:\CONFIG.BAK
COPY C:\AUTOEXEC.BAT C:\AUTOEXEC.BAK
```

If an edit ever stops the PC from booting:

- **MS-DOS 6:** press **F5** when `Starting MS-DOS...` appears to skip both files, or **F8** to
  confirm each line one by one.
- **Any DOS:** boot from a DOS floppy.

Then copy the `.BAK` files back over the originals.

## 2. Get Jemm

Jemm is a free memory manager. Its QPIEMU module is what lets ReBeep catch the speaker.

1. Download the latest release, 5.87 or later, from
   <https://github.com/Baron-von-Riedesel/Jemm/releases>.
2. Unzip it on any computer, and move these three files to the DOS PC:

   | File | What it is |
   |---|---|
   | `JEMMEX.EXE` | The memory manager. It replaces both `HIMEM.SYS` and `EMM386.EXE` |
   | `JLOAD.EXE` | Loads Jemm modules |
   | `QPIEMU.DLL` | The module that lets ReBeep catch the speaker |

3. Put them in `C:\JEMM`. From the drive that holds them, here `A:`:

   ```
   MD C:\JEMM
   COPY A:\JEMMEX.EXE C:\JEMM
   COPY A:\JLOAD.EXE C:\JEMM
   COPY A:\QPIEMU.DLL C:\JEMM
   ```

## 3. Install ReBeep

Get the floppy image `rebeep-x.y.z-floppy.img` or the zip from the
[latest release](https://github.com/MetalHexx/rebeep/releases/latest), and put its files on a disk
the PC can read. Then, from that drive:

```
A:
INSTALL
```

You should see `ReBeep is in C:\REBEEP\`, then the lines to add to your boot files. `INSTALL`
copies the files and changes nothing else. To use another folder, name it: `INSTALL D:\REBEEP`.

**If `INSTALL` fails,** as it can on Windows 98's DOS with `Invalid drive or directory`, copy the
files by hand:

```
MD C:\REBEEP
COPY A:\*.* C:\REBEEP
```

## 4. Add a ReBeep boot menu entry

A boot menu lets you pick a setup each time the PC starts. It is written in `CONFIG.SYS`, and
needs MS-DOS 6 or later. Each entry has its own block, and `AUTOEXEC.BAT` learns which entry you
picked from `%CONFIG%`. Follow the case that matches your `CONFIG.SYS`.

**The menu is optional, but handy.** With one, you pick your usual entry for games that don't use
the speaker, and ReBeep and Jemm stay out of their way. Without one, they load on every boot
(case C).

### A. You have no boot menu yet

Make your `CONFIG.SYS` look like this. Move your own `HIMEM.SYS` and `EMM386.EXE` lines into
`[NORMAL]`, and everything else you load into `[COMMON]`:

```
[MENU]
MENUITEM=REBEEP, ReBeep (Jemm + QPIEMU)
MENUITEM=NORMAL, My usual setup
MENUDEFAULT=REBEEP,5

[REBEEP]
DEVICE=C:\JEMM\JEMMEX.EXE NOEMS X=TEST NOVME NOINVLPG
DOS=HIGH,UMB

[NORMAL]
DEVICE=C:\DOS\HIMEM.SYS
DEVICE=C:\DOS\EMM386.EXE
DOS=HIGH,UMB

[COMMON]
FILES=40
BUFFERS=20
```

`MENUDEFAULT=REBEEP,5` picks ReBeep after 5 seconds. Then add two lines at the end of
`AUTOEXEC.BAT`:

```
IF "%CONFIG%"=="REBEEP" C:\JEMM\JLOAD.EXE C:\JEMM\QPIEMU.DLL
IF "%CONFIG%"=="REBEEP" LH C:\REBEEP\REBEEP.COM
```

Also add `;C:\REBEEP` to the end of your `PATH` line, so `REBEEP` and `RBPLAY` work from any
folder. The package's `SAMPLES\MSDOS` folder holds a complete pair of files like these.

### B. You already have a boot menu

Windows 98 PCs set up for DOS games often have one, with entries that load `EMM386.EXE`. Add
three things. In `CONFIG.SYS`, a menu item and its block:

```
[MENU]
...your entries...
MENUITEM=RB, ReBeep (Jemm + QPIEMU)

[RB]
DEVICE=C:\JEMM\JEMMEX.EXE NOEMS X=TEST NOVME NOINVLPG
DOS=HIGH,UMB
```

Leave out `DOS=HIGH,UMB` if your `[COMMON]` block already has it. Copy in any other driver lines
you want in this entry, such as a CD-ROM driver.

In `AUTOEXEC.BAT`, if it jumps to the entry with `GOTO %CONFIG%`, add a label that matches the menu
item:

```
:RB
C:\JEMM\JLOAD.EXE C:\JEMM\QPIEMU.DLL
LH C:\REBEEP\REBEEP.COM
GOTO END
```

The `GOTO` at the end matters: a batch file runs on through the next label, so point it at the
label your other entries finish on (here `:END`). Add your mouse driver here too, if the other
entries load one. If your `AUTOEXEC.BAT` uses `IF "%CONFIG%"==` lines instead, add the two lines
from case A, with `RB` in place of `REBEEP`.

### C. No boot menu

For MS-DOS 5, or if you'd rather load ReBeep on every boot. In `CONFIG.SYS`, remove your
`HIMEM.SYS` and `EMM386.EXE` lines and put these in their place:

```
DEVICE=C:\JEMM\JEMMEX.EXE NOEMS X=TEST NOVME NOINVLPG
DOS=HIGH,UMB
```

Then add these to the end of `AUTOEXEC.BAT`, and `;C:\REBEEP` to the end of your `PATH` line:

```
C:\JEMM\JLOAD.EXE C:\JEMM\QPIEMU.DLL
LH C:\REBEEP\REBEEP.COM
```

These are the lines `INSTALL` prints. To undo, copy your backups back (step 6).

### What each line does

| Line | Does |
|---|---|
| `DEVICE=C:\JEMM\JEMMEX.EXE` | Loads Jemm. It does the job of `HIMEM.SYS` and `EMM386.EXE`, so this entry loads neither |
| `NOEMS` | No EMS (expanded memory) page frame, which leaves more upper memory free. Remove it for a game that needs EMS |
| `X=TEST` | Jemm only uses upper memory that reads as empty, so it never covers a card's ROM or RAM |
| `NOVME` | Leaves off a Pentium feature, V86 mode extensions. It is Jemm's default; the line makes it plain |
| `NOINVLPG` | Jemm skips the 486's `INVLPG` instruction. Its manual suggests this for emulators and virtual machines |
| `DOS=HIGH,UMB` | Loads DOS into high memory, and lets programs load into upper memory |
| `JLOAD.EXE ... QPIEMU.DLL` | Loads QPIEMU. It must come before ReBeep |
| `LH C:\REBEEP\REBEEP.COM` | Loads ReBeep high, into upper memory, so games keep their 640 KB |

Want ReBeep's settings at every boot? Put them on its line, for example
`LH C:\REBEEP\REBEEP.COM /P:1 /R:0`. The options are in [playing](playing.md).

## 5. Check it

Reboot and pick **ReBeep (Jemm + QPIEMU)**. As it boots, you should see ReBeep's message:

```
ReBeep x.y.z loaded in upper memory, nnnn bytes resident.
OPL3, faithful voice, volume 12.
Ctrl+Alt+B toggles, Ctrl+Alt+N cycles the voice.
Notes below 20 Hz are silent (/L:0).
Sounds ReBeep can't translate play on the speaker (/R:1).
```

It says `OPL2` on a card with an OPL2. If it says `conventional memory`, `LH` found no upper
memory: check the `DOS=HIGH,UMB` line. Then play a test tune:

```
C:\REBEEP\RBTEST /C:1
```

The tones should come from your sound card's speakers, not the PC speaker. A message instead of
the load summary? See [troubleshooting](troubleshooting.md).

## 6. Undo

- **For one session:** pick your usual entry at the boot menu.
- **For good:** copy the backups back, and delete the two folders:

  ```
  COPY C:\CONFIG.BAK C:\CONFIG.SYS
  COPY C:\AUTOEXEC.BAK C:\AUTOEXEC.BAT
  DELTREE C:\REBEEP
  DELTREE C:\JEMM
  ```

## FreeDOS

FreeDOS writes its menu differently, in `FDCONFIG.SYS`. Start from the two files in the package's
`SAMPLES\FREEDOS` folder, which add the same ReBeep entry. Two things to know:

- FreeDOS comes with an older Jemm. Keep the full `C:\JEMM\` paths shown above.
- Put `C:\JEMM` first on your `PATH`, so the newer copy is the one found.
