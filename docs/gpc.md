# Grand Prix Circuit

Accolade's Grand Prix Circuit is the game ReBeep's first release was proven on. This page covers how it
drives the PC speaker, what ReBeep makes of that, and what still sounds different. It comes from
reading the game's EGA executable (`GPEGA.EXE`) as data, without running it, and from listening
on the `mirror-msdos` VM. The other executables may differ. The result is in
[compatibility](compatibility.md).

## Settings

- **Run it on MS-DOS.** It hangs on FreeDOS 1.4 whether or not ReBeep is loaded.
- **Set everything before starting it.** The game takes over the keyboard interrupt, so
  Ctrl+Alt+B and Ctrl+Alt+N do nothing inside it. Pick the voice and volume at the DOS prompt.
- **`/L:0`, the default,** keeps the engine's rests silent, as on a real PC. With `/L:1` the
  engine drops to a low FM note in those slots instead.
- **`/R:0`** mutes the real speaker, so only the OPL plays, and the music loses its percussion
  voice. It doesn't remove the clicks described under the music.

## The race: engine and effects

The race driver runs on the game's 100 Hz timer tick and loops a fixed 60 ms pattern:

1. 40 ms of the engine pitch, taken from the RPM, about 24 to 391 Hz.
2. 20 ms of count `FFFFh` (18.2 Hz), used as a rest. Tyre squeal (about 500 Hz), a 119 Hz tone
   or a gear-change chirp (about 1 to 1.1 kHz) take this slot when they sound.

Each slot loads a new count into PIT channel 2, then sets port `61h` bits 0 and 1 together. The
driver never writes the control port `43h`, and the gate stays on while driving.

**What ReBeep does.** The engine pitch, the squeal, the tone and the chirp are tones, so they play
on the OPL. The `FFFFh` slot is a rest: the OPL keys off and the speaker stays still.

**The difference.** On a real PC a new count takes over only at the end of the current half-cycle.
At 18.2 Hz that is about 27 ms, so the real rest runs a little longer than ReBeep's 20 ms, and the
next engine slot a little shorter. ReBeep has no clock to time that.

## The music: title, car select, results and pits

The music driver plays two voices on the one speaker.

- **Melody.** A tone on channel 2, started and stopped with the gate (`61h` bit 0) alone, while
  the speaker bit (bit 1) stays on. Each tick rewrites the count with a small vibrato of about
  100 counts either way. There is at least one gate-off tick between notes.
- **Percussion.** A 1-bit voice on `61h` bit 1. On each tick it sets or clears the speaker bit from
  a bit pattern in three parts (attack, a looping middle, release). On a real PC each cleared tick
  cuts the speaker for 10 ms, which makes a click, or a chop in the melody.

Between notes the speaker is parked high: bit 1 on, the gate off, and channel 2's output high. When
a song stops, both bits go off and the speaker drops to 0. When the next one starts, bit 1 goes on
and the speaker rises again. The songs are in `music.bin`, which hasn't been read yet, so which
songs use the percussion voice, and how, is not known.

**What ReBeep does.** The melody plays on the OPL. While a note sounds, ReBeep holds the gate clear
rather than bit 1, so the parked speaker doesn't move at each note on and off. The percussion voice
and the song start and stop are direct control of the speaker bit, which ReBeep can't turn into a
tone, so they reach the real speaker unchanged, unless `/R:0` mutes it.

**What you hear.** On `mirror-msdos` the intro has a few clicks, and each screen change, forward or
back, makes one. They sound the same with `/R:0` and in either patch tried (1 and 2). With `/R:0`
the real speaker can't move, so they are not the percussion voice or the song start and stop, as
reading the code had suggested. Whether they come from ReBeep's OPL notes or from 86Box itself
isn't known yet. With `REBEEP /R:0 /V:0` ReBeep makes no sound at all, so any click left is not
ReBeep's.

## Port reads and the keyboard

- Every read of `61h` is part of an immediate read-modify-write. The game never reads the channel 2
  count (`42h`) or the timer output (`61h` bit 5), so ReBeep holding the gate doesn't disturb it.
- Its keyboard handler acknowledges each key through `61h` bit 7. ReBeep passes that bit through
  untouched.
- It never passes keys on to the previous keyboard handler, which is why the hotkeys don't fire.
