# Set up in 86Box

[86Box](https://86box.net) emulates old PCs, down to the sound card and the PC speaker. ReBeep
runs in an 86Box VM just as it does on a real PC, so the setup is the same once the VM is ready.

## 1. Get the VM ready

You need a VM with DOS installed: [FreeDOS](https://www.freedos.org) is free, and MS-DOS needs
your own disks. Check these in the VM's **Settings**:

| Settings page | Choose |
|---|---|
| Machine | A 386 or newer machine and CPU |
| Sound | **Sound card #1:** a Sound Blaster. ReBeep is tested with the Sound Blaster Vibra 16S. Any card with an OPL2 or OPL3 works |
| Floppy & CD-ROM drives | A 3.5" 1.44 MB floppy drive, for ReBeep's disk |

**Before you change anything,** copy the VM's hard disk image somewhere safe. Copying it back
undoes everything below.

## 2. Insert ReBeep's floppy

1. Download `rebeep-x.y.z-floppy.img` from the
   [latest release](https://github.com/MetalHexx/rebeep/releases/latest).
2. In 86Box, open the **Media** menu, pick the floppy drive, then **Existing image**, and choose
   the file. You can also click the floppy icon on the status bar.

DOS sees it as drive `A:`.

## 3. Get Jemm into the VM

The VM can't see your computer's files, so Jemm's three files (`JEMMEX.EXE`, `JLOAD.EXE`,
`QPIEMU.DLL`) need a way in. Download Jemm as in
[step 2 of the real PC page](real-pc.md#2-get-jemm), then either:

- **As a CD:** put the three files in a folder on your computer. In 86Box, open **Media**, pick the
  CD-ROM drive, then **Folder**, and choose that folder. DOS can read it only if the VM loads a
  CD-ROM driver.
- **On a floppy image:** copy the files onto a floppy image with a disk image tool, then insert it
  as in step 2.

## 4. Follow the real PC steps

From here, the VM is a PC. Follow [Set up on a real PC](real-pc.md) from step 1. Where it copies
from `A:`, use the drive your files are on.
