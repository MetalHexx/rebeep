# 6. Shape the sounds

Get the rules right first: a sound is easier to judge once it plays in the right place.

## Three ways to a patch

| Way | When |
|---|---|
| A factory patch: `ORGAN`, `FLUTE`, `BRASS`, `BELL` | The user likes one as it is, and for placeholders |
| You write the `.RBP` from the user's words | Most of the time: they describe it, you shape it, they listen |
| The user shapes it in [ReBeep Studio](../../../../docs/guide/studio.md) | They want their hands on it, playing keys while they turn the knobs |

The studio saves to `D:\REBEEP\PATCHES\USER\`. Collect a patch from there as rebeep-dev's
[patches.md](../../rebeep-dev/references/patches.md) says, into the profile's folder, under the
name the profile gives it.

## Writing one

- The format: [patches](../../../../docs/architecture/how-it-works.md#patches), and the comment at
  the top of every `.RBP`, which names its twelve numbers. Start from the factory patch closest to
  the sound, or a lab profile's patch, and change a few numbers.
- In FM, `OP1` is the modulator: it shapes the tone. `OP2` is the carrier: it is what you hear.
- A `[4OP]` voice plays on an OPL3 only, and the required `[2OP]` one everywhere else. Make the
  2-op voice good on its own.
- Write in the patch's comments what it is meant to sound like, and why: the next change starts
  from there. Lines of 78 columns or fewer.
- ReBeep refuses a bad patch when it loads, with the reason: the load check shows it
  ([check.md](check.md#check-that-it-loads)).

## From words to numbers

A starting point, not a recipe: listen, and keep what works.

| The user says | Try |
|---|---|
| Brighter, harsher | The modulator louder: its `OL` up |
| Softer, rounder | The modulator quieter, `FEEDBACK` down |
| Gritty, distorted | `FEEDBACK` up, to 6 or 7 |
| Metallic, a bell | The modulator's `MULT` high, 5 or more |
| Plucked, short | The carrier's `DR` up and `SUS` 0 |
| Held, like an organ | The carrier's `SUS` 1 |
| A softer start | The carrier's `AR` down |
| Lower, higher | `OCTAVE` down or up: 4 is the game's pitch |
| Wobbling | `VIB` 1, or `TREM` 1 for loudness |
| Thicker, a chord | A `[4OP]` voice, its second pair a fifth or an octave up |

## Pitfalls

- A slow release (a low `RR`) on a sound the game repeats quickly rings on and piles up. A sound
  made of short bursts wants a release just long enough to bridge the gaps.
- A high modulator `MULT` with a ringing release sounds like an alarm clock, whatever was meant.
- Judge in the game, never alone: the game's rhythm and the other sounds change how a patch sounds.
- One change at a time between sessions, so the user can say which way is better. The last one
  they liked stays in git.
