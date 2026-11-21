# Getting started

ReBeep is a small DOS program that plays a game's PC-speaker beeps on your sound card's FM chip.
It is a TSR ("terminate and stay resident"): you load it once, it stays in memory, and while you
play it catches each note the game sends to the speaker and plays it on the card. It is made for
games whose only sound is the speaker, as many 1980s PC games are.

## What you need

| You need | Why |
|---|---|
| A 386 or better | Jemm, and the way ReBeep catches the beeps, need a 386 |
| MS-DOS 5 or later, or FreeDOS, booted to plain DOS | ReBeep doesn't run in a DOS window inside Windows. On Windows 95 or 98, boot to the DOS prompt |
| [Jemm](https://github.com/Baron-von-Riedesel/Jemm/releases) 5.87 or later | A free memory manager. Its QPIEMU module is what lets ReBeep catch the beeps |
| A sound card with an OPL2 or OPL3 FM chip at port `388h` | The FM chip is the one that plays AdLib music. Sound Blaster cards and most clones have one |

**About the memory manager.** A memory manager is the driver near the top of `CONFIG.SYS` that
gives DOS its extended memory and its upper memory, the area between 640 KB and 1 MB where
drivers and TSRs can live. Most DOS PCs use Microsoft's `HIMEM.SYS` and `EMM386.EXE`. ReBeep needs
Jemm instead, because EMM386 can't catch the speaker. The setup adds Jemm as its own entry in a
boot menu, so your usual setup stays as it is.

## Pick your path

| You have | Go to |
|---|---|
| A real DOS PC | [Set up on a real PC](real-pc.md) |
| The 86Box emulator | [Set up in 86Box](86box.md) |

Then see [playing](playing.md).

## What you'll hear

- The game's tunes and sound effects come from the sound card, and the PC speaker stays quiet.
- The default voice is a square wave, close to the real speaker. There are four FM instruments to
  pick from as well.
- Some sounds can't become a note, such as clicks, noise and very high pitches. They still play on
  the real speaker, unless you mute them with `REBEEP /R:0`.

Want to know why it works this way? See [how it works](../architecture/how-it-works.md).
