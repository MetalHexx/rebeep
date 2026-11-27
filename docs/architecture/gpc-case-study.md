# Grand Prix Circuit: a case study

Accolade's Grand Prix Circuit is the game ReBeep's first release was proven on. This page covers how it
drives the PC speaker, what ReBeep makes of that, and what still sounds different. It comes from
reading the game's EGA executable (`GPEGA.EXE`) and its `music.bin` as data, without running
them, from listening on the `mirror-msdos` VM, and from REBEEPD logs of the menus and a race
there. The other executables may differ. The settings to play it with are in
[compatibility](../guide/compatibility.md#grand-prix-circuit).

## The race: engine and effects

The race driver runs on the game's 100 Hz timer tick and loops a fixed 60 ms pattern:

1. 40 ms of the engine pitch, taken from the RPM, about 24 to 391 Hz.
2. 20 ms of count `FFFFh` (18.2 Hz), used as a rest. Tire squeal (501 Hz), driving off the road
   (119 Hz) or a gear-change chirp (1018 to 1115 Hz, gliding) take this slot when they sound.

The start lights break the pattern: each is one tone held about 0.4 s, 261 Hz for red and for
yellow, 1049 Hz for green. A light starts as a new note or as a change of the engine's, whichever
slot it lands in.

Each slot loads a new count into PIT channel 2, then sets port `61h` bits 0 and 1 together. The
driver never writes the control port `43h`, and the gate stays on while driving. Only the race's
start does, as each song's does ([below](#telling-the-screens-apart)).

**What ReBeep does.** The engine pitch and the effects are tones, so they play on the OPL. The
`FFFFh` slot is a rest: the OPL keys off and the speaker stays still, so the engine starts a new
note every 60 ms. An effect fills the rest instead, so ReBeep hears a pitch change on the engine's
note, not a new note. [ReBeep's profile](../guide/playing.md#game-profiles) plays the effects in
patches of their own, on the effect voice. The lights count from the race's start until the green
light ends, because red and yellow share a pitch with the engine's revs: the rule that ends that
window takes the green light as a new note or a change (`STEP=PITCH`). Then the chirp and the
squeal count. Driving off the road stays in the engine's patch.

**The difference.** On a real PC a new count takes over only at the end of the current half-cycle.
At 18.2 Hz that is about 27 ms, so the real rest runs a little longer than ReBeep's 20 ms, and the
next engine slot a little shorter. ReBeep has no clock to time that.

## The music: the intro, the menus, the trophy and the pits

`music.bin` holds two songs. Each song's entry lists the patterns of a melody voice and of a
percussion voice; neither song uses the percussion voice.

| Song | Played by | First note |
|---|---|---|
| The menu song | Game type, track and car, restarted as you move between them | Count 5409, 220.6 Hz |
| The intro song | The intro, once across its three screens; the trophy screen; the pit screen (by the code, not heard yet) | Count 6434, 185.4 Hz |

The qualifying results and the race's scoreboard are silent. The music driver plays two voices on
the one speaker.

- **Melody.** A tone on channel 2, started and stopped with the gate (`61h` bit 0) alone, while
  the speaker bit (bit 1) stays on. Each tick rewrites the count with a small vibrato of about
  100 counts either way. There is at least one gate-off tick between notes.
- **Percussion.** A 1-bit voice on `61h` bit 1. On each tick it sets or clears the speaker bit from
  a bit pattern in three parts (attack, a looping middle, release). On a real PC each cleared tick
  would cut the speaker for 10 ms, a click or a chop in the melody. Neither song uses it.

Between notes the speaker is parked high: bit 1 on, the gate off, and channel 2's output high. When
a song stops, both bits go off and the speaker drops to 0. When the next one starts, bit 1 goes on
and the speaker rises again.

**What ReBeep does.** The melody plays on the OPL. While a note sounds, ReBeep holds the gate clear
rather than bit 1, so the parked speaker doesn't move at each note on and off. The song start and
stop are direct control of the speaker bit, which ReBeep can't turn into a tone, so they reach the
real speaker unchanged, unless `/R:0` mutes it.

**What you hear.** On `mirror-msdos`, at the default `/R:1`, the intro has a few clicks, and each
screen change, forward or back, makes one. They are songs stopping and starting on the real
speaker, which click the same way on a real PC: a REBEEPD log of a short session, from the intro to
a race, shows no other speaker steps. With `/R:0` they are gone, in every patch, and the melody
plays on the OPL alone.

## Telling the screens apart

Every song and the race start the same way: in the tick that stops the last sound, the game writes
`B6h` to `43h`, channel 2's control word, then plays the first note. The logs show `B6h` at a start
and nowhere else, and neither song plays the other's first note, so the pair names the screen.
The first note arrives about 20 counts above its count: the game opens the gate before it sets
the speaker bit, and a vibrato tick lands between. The race starts on the engine's idle, about
24 Hz. The engine comes within 24 counts of each song's first note, so the control word must come
first. The profile ReBeep comes with, `GPC`, matches that pair
([game profiles](how-it-works.md#game-profiles)).

## Port reads and the keyboard

- Every read of `61h` is part of an immediate read-modify-write. The game never reads the channel 2
  count (`42h`) or the timer output (`61h` bit 5), so ReBeep holding the gate doesn't disturb it.
- Its keyboard handler acknowledges each key through `61h` bit 7. ReBeep passes that bit through
  untouched.
- It never passes keys on to the previous keyboard handler, which is why the hotkeys don't fire.
