# How ReBeep works

For the curious: how a speaker beep becomes an FM note, and what that costs. Options and fixes are
in the [player guide](../guide/getting-started.md); the code-level rules are in
[src/AGENTS.md](../../src/AGENTS.md).

```
game ──OUT 42h/43h/61h──▶ Jemm + QPIEMU ──▶ ReBeep ──▶ OPL2/OPL3 at 388h
                                               └──────▶ PC speaker (fallback)
```

## Catching the speaker: QPI

A game makes a beep by loading a divisor into PIT channel 2 (`42h`, with a control word on `43h`)
and switching the speaker on through port `61h`. Real-mode code can't be told when it does that, but
Jemm's QPIEMU module can trap port accesses in V86 mode and hands each one to a callback through its
QPI interface. ReBeep installs that callback and traps `42h`, `43h` and `61h`, so it needs a 386 and
Jemm. It reads and writes those ports itself only through QPI, because a direct access would trap
again. QPIEMU calls the callback on the game's stack, and a game's interrupt handler may have landed
on a small DOS or BIOS one, so the callback switches to its own stack before saving anything. A
trapped write takes only QPIEMU's 8 bytes of the game's stack.

Every byte a game writes reaches the real port, so the timer runs as the game set it. The one
change is to `61h`: while the FM chip plays a tone, or the game rests, ReBeep holds one of its bits
clear to keep the real speaker quiet (next section). A timing loop that reads the timer output on
`61h` bit 5 sees real hardware, except while that bit is the gate.

## Port `61h`: masking and the game's view

While the OPL plays a tone, or the game rests below 20 Hz (see the interpreter), ReBeep holds one
bit of the real `61h` clear so the PC speaker stays quiet. It picks the bit that leaves the speaker
where it rests, because a speaker that moves clicks:

- Most games switch the timer gate (bit 0) and speaker data (bit 1) on and off together. Between
  notes the speaker rests at 0, so ReBeep holds bit 1 clear.
- Some, such as Grand Prix Circuit, leave bit 1 on and start and stop each note with the gate alone.
  With the gate off, channel 2 holds its output high, so the speaker rests high. ReBeep holds the
  gate clear instead, and the speaker stays high and still.

The game must not notice, so a read of `61h` returns the real value with bits 0 and 1 replaced by
the game's own. A `42h` or `43h` write that moves a tone between the OPL and the speaker re-issues
`61h` at once, so the handoff has no gap.

Holding the gate clear stops the real channel 2, which has two side effects while such a note, or a
rest, plays:

- Bit 5 of `61h` would stand still, so ReBeep flips it on every read, and a game that waits for an
  edge doesn't hang. A game that times its notes by counting those edges plays them short.
- A game that reads the count back from `42h` sees it frozen, so one that waits for the count to
  change would hang.

Neither happens in games that switch both bits together, and Grand Prix Circuit reads neither.

## The interpreter

The interpreter follows channel 2 and `61h` from the bytes written, and is always in one of four
states:

| State | When | Plays on |
|---|---|---|
| SILENT | Speaker data bit is off | Nothing |
| TONE | Speaker on, gate on, a completed count in square-wave mode, divisor 193 to 59659 (about 20 to 6182 Hz) | The OPL |
| REST | As TONE, but a divisor above 59659, or 0 (which means 65536): 18.2 to 20 Hz | Nothing; the speaker stays held. With `/L:1` it is a TONE |
| RAW | Speaker on, but not a clean tone: gate off (direct toggling), another counting mode, an unknown count, a divisor below 193 | The real speaker |

It reports three events: tone on, pitch change and tone off. A new count or mode applies only when
the count completes, as on the real chip.

Games use the counts below 20 Hz as rests. On the real chip a new count takes over only at the end
of a half-cycle, which at 18 Hz is 27 ms away, so a short slot of `FFFFh` leaves the speaker still.
Grand Prix Circuit's engine rests like that for 20 ms in every 60. `/L:1` plays them as a low FM
note instead. A change of `/L` on a loaded copy applies to a count the game is holding at once.

## The OPL voice

ReBeep plays one voice on OPL channels 7 and 8, a profile's effects on channel 6 ([Game profiles](#game-profiles)),
and touches nothing else (four-operator patches use channel pairs, see [Patches](#patches)). Each
new note takes the other channel, so the note before it fades out on its own: starting it again on
the sounding channel would restart its wave mid-cycle, which clicks.

A divisor `d` is a frequency of 1193182 / `d` Hz. The OPL wants a block `b` and an F-number `n`,
with `f = n * 49716 / 2^(20-b)`, so

```
n = 3 * 2^(23-b) / d        (the smallest block b that keeps n ≤ 1023)
```

Changing pitch while a note sounds rewrites only the pitch, never the key bit, so a glide stays a
glide. Volume (0 to 15) sets the attenuation of every operator that is heard: the carriers, and
in an additive voice such as Organ the modulators too, so the voice keeps its balance at every
volume. Volume 0 keys no note at all. Divisor 0 plays as 65535, block 0. The faithful voice is a
square wave on an OPL3. An OPL2 has no square wave, so it gets a two-operator FM approximation.
The faithful voice fades in over about a millisecond and out over about ten, so a beep never starts
or stops on a step. On an OPL3 the chip stays in OPL3 mode, with both channels routed to both
outputs, while ReBeep is trapping.

## Patches

A patch is a plain FM setting in an `.RBP` text file: a `[PATCH]` section (`FORMAT=1`, an `OCTAVE`
from 0 to 7 where 4 is the game's pitch), a required `[2OP]` section and an optional `[4OP]` one.
Each voice has a `CONNECTION`, a `FEEDBACK` and one line of 12 numbers per operator. A file is at
most 2048 bytes. [ReBeep Studio](../guide/studio.md) writes the same format that ReBeep's startup
reads, and both refuse a file that breaks its rules, with the reason.

**The startup loader.** ReBeep reads a patch once, at load, so nothing resident touches a file.
The name comes from `/P:`, or from `PATCH=` in `RBSTUDIO.CFG` when there is neither `/F` nor `/P:`.
A bare `NAME` is looked up as `USER\NAME`, then `FACTORY\NAME`, and the first file that exists
decides. `BANK\NAME` is that file alone: a bank is a folder of patches. `FACTORY` sits beside the program; `USER` and the
other banks sit in the patches folder, `PATCHES=` in the settings file or else `PATCHES` beside the program.
The loader parses the file into a record, then the startup part is freed. A patch it can't use is
a message and the faithful voice, never an exit code.

**`RB_STATE`, layout 2.** The state block the command line reads over AMIS holds the patch as 53
bytes however many patches exist: its `FOLDER\NAME`, octave, a flags byte (a patch is loaded, it
has a four-operator variant), the 11-byte two-operator record and the 22-byte four-operator record,
both already in register order. The voice byte says which voice plays: 0 the faithful one, 1 the
patch. A loaded copy with a different layout number, in the first byte, is refused, because its
bytes would be misread.

**Four-operator voices.** On an OPL3, a patch with a `[4OP]` section plays on two channel pairs of
the second register bank, 0+3 and 1+4 (OPL3 channels 9+12 and 10+13), which register `104h` joins
into four-operator voices. Each note takes the other pair, as the two-operator voice takes the
other channel, and keys it through the pair's first channel. The connection is one of FM-FM, AM-FM,
FM-AM and AM-AM: the first operator pair and the second each choose FM or AM. On an OPL2, or for a
patch without `[4OP]`, the two-operator record plays instead. Changing voice keys the old channels
off before `104h` changes, so a note never sounds half joined.

## The fallback

Anything the interpreter calls RAW is never translated: the game's bytes reach the real speaker
unchanged, including the speaker bit. That covers noise from direct toggling, pitches above the FM
chip's 6182 Hz and odd timer modes. The switch between OPL and speaker is immediate. `/OFF` and
Ctrl+Alt+B take the same path for a sounding tone.

`/R:0` mutes the fallback. ReBeep then holds bit 1 of the real `61h` clear in every state, so the
speaker never moves, while the gate and the timer still run as the game set them. Muting while a
note holds the gate moves the hold to bit 1, which is one step on the speaker. Ctrl+Alt+B still
gives the game the real speaker, unmuted.

## Game profiles

A [profile](../guide/playing.md#game-profiles) picks a patch from what the game plays. `/G:` reads
its file and every patch it names at load, into a table in the resident part.

**Rules go by events, never time.** Each game byte gives at most one event: a note start, a pitch
change or a note stop, with the divisor, or a byte written to `43h`, the timer's control word. A
step matches the next event of its kind, a `PITCH` step a note start or a pitch change. A value that
doesn't fit sends the rule back to its first step, which the same event may start again; other
kinds pass by. The first rule to complete wins, and all start over. Games reprogram the timer.

**The switch.** The winning patch is copied into `RB_STATE`, so `/S`, Ctrl+Alt+N and a change all
see it, and the voice changes before the event plays: a note that starts on it starts in the new
voice, and one that sounds on restarts in it. It plays the patch voice, as `/P:` does, so it ends a
faithful voice picked with Ctrl+Alt+N. The same patch twice writes nothing. The rules run with
translation on or off.

**A state, not a clock.** `WHILE=` makes a rule or an effect count only while a named rule is the
last to have fired: the part of the game the player is in, set by events alone. Grand Prix
Circuit's start lights share a pitch with its engine, and only the race's first seconds tell them apart.

**Effects.** An effect plays a sound that shares the speaker with music or an engine in a patch of
its own, on a second voice: channel 6, or bank 1's free pair 2+5 for a four-operator patch on an
OPL3. While a tone is in an effect's range the main voice keys off and the effect voice plays it,
until a tone outside every effect goes back to the main voice. A switch is a key off and a key on;
a channel is reprogrammed only for another effect patch, never while it sounds. One copy of the OPL
code serves both voices: the effect code swaps the other voice's state in for a call. No effect
plays in the faithful voice.

**Fixed size.** The table holds 16 rules of 4 steps, 8 effects and 8 patches, 872 bytes, from the
first load, so a later `/G:` always fits. ReBeep is 5,120 bytes resident, profile or not: effects
cost 390 bytes, 155 of them paid by moving startup-only and test-only code out of the resident
part. The build stops if it grows past that, so growth is a decision. With no profile on, a
trapped write costs a call, a compare and a return more, too little to show in `P_BENCH`.

## Residency, AMIS and the hotkey

`REBEEP.COM` is a resident part followed by a startup part. When the program goes resident, the
startup part is freed. Nothing resident calls DOS.

The resident copy answers on `INT 2Dh` as an AMIS program (manufacturer `MetalHex`, product
`REBEEP`, on a free multiplex number). The command line talks to it through that interface: `/S`
reads its state, `/ON` and `/OFF` switch the traps, a change applies the new voice, volume and
keys, and `/U` asks it to uninstall. A copy of another version answers too, which is how exit code 6
is found. Uninstall is refused if another program hooked an interrupt after ReBeep (exit code 8),
because removing ReBeep would break that chain.

The hotkey hooks `INT 09h`. It tracks Ctrl and Alt from the raw scan codes, so it still works when a
game replaces the BIOS keyboard handler, but not when a game takes over the interrupt entirely, as
Grand Prix Circuit does. Ctrl+Alt+N flips the voice byte between the faithful voice and the loaded
patch, and does nothing when no patch is loaded.

## Performance

Each trapped write goes through QPIEMU and ReBeep's callback. `RBTEST /B` measures it by timing
loops of `OUT 61h` and `OUT 80h` (a harmless port that is not trapped), doubling the number of
writes until a run lasts at least a second. The cost of the trap is the difference.

Measured by `rebeep test run --suite vm --probe P_BENCH` on `mirror-freedos`, an emulated Pentium
MMX 233 in 86Box:

| State | `OUT 61h` | One tone change (two `OUT 42h` writes) |
|---|---|---|
| ReBeep loaded and trapping | 6.4 µs | 21.7 µs |
| After `/OFF` | 0.9 µs | 1.9 µs |
| After unload | 0.9 µs | 1.9 µs |

So the overhead is about 6 µs per `61h` write while ReBeep is trapping, and none after `/OFF`:
releasing the traps returns the machine to its unloaded speed. A game that toggles the speaker
thousands of times a second feels it; one that sets a tone and moves on does not. The emulated rows
are indicative, not a real machine's.

| Profile | `OUT 61h` loaded | `OUT 61h` after `/OFF` |
|---|---|---|
| `mirror-freedos` (86Box, Pentium MMX 233) | 6.4 µs | 0.9 µs |
| `slow-386sx` (86Box, 386SX/16) | Not measured yet | Not measured yet |

### The studio

`RBSTUDIO /BENCH` times the synth screen on a sample patch with the chip silenced, each figure over at
least 5 seconds, and writes the milliseconds per call to `BENCH.TXT`. Measured on `slow-386sx` (86Box,
a 386SX/16) after the dev boot, ReBeep resident. "Before" is the same bench on the studio as it drew
until then: a call per cell, and every key event a full redraw.

| Figure, per call | Before | After |
|---|---|---|
| Full redraw, 4-OP screen | 176 ms | 119 ms |
| Full redraw, 2-OP screen | 163 ms | 109 ms |
| A piano key pressed and released | 352 ms | 18 ms |
| A value changed (voice reprogrammed, undo step) | 361 ms | 112 ms |
| Help page 1 opened over the screen | 406 ms | 352 ms |

A piano key now redraws the bottom bar alone, and a modifier or a held key's repeat draws nothing. A
value change still redraws the whole parameter grid and the band. The help's own drawing, about
230 ms of its figure, was not changed. The envelope's sixteenth blocks cost nothing measurable: the same
bench before and after them differs by noise.

**The library.** The studio reads every patch once per run. Measured on `slow-386sx` on 1,151 patches (the
1,000 of a test bank plus the lab set), the file reads dominating at about 60 ms a file:

| Figure | Before | After |
|---|---|---|
| One read of the library | 70 s | 70 s: a count of 1.4 s on the checks screen, then 69 s once on the splash |
| Waiting before the first edit | about 140 s: the checks screen, then entering the Patch Editor | 70 s, all on the splash behind a percentage; 0 s entering the Patch Editor |
| Library block (computed from the 21-byte entry, not measured) | about 43 KB, one entry for each of the 2,048 the library could hold | about 25 KB, sized to the files |
| `MEM` largest executable program, taken at boot | 620K | 620K: a boot figure, before the studio ran |

The saving is the second pass and the wait on the checks screen, not the reads. Free memory with the library
loaded was not measured: `MEM` was read at boot only. **The patch list**, measured on `slow-386sx` over 2,048
patches in 34 banks, All view, selection at the end, costs by the number of banks, not of patches: a draw
55 ms, a click on the bottom row 16 ms, PgDn 32 ms. There is no "before": the list had no banks to switch.
