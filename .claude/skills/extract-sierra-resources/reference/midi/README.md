# MIDI

Converts decoded sound resources to Standard MIDI Files, format 0.

## Commands

```
node "<skill>/reference/midi/to-midi.mjs" --dir "<scratch>\<game>-out" "<scratch>\<game>-midi"
node "<skill>/reference/midi/to-midi.mjs" "<sound.bin>" "<out.mid>"
```

## What the conversion does

- Timing: 60 ticks per quarter note with a tempo of 1,000,000 µs, so one MIDI tick is one SCI tick (1/60 s).
- Notes, controllers, pitch bend and program changes pass through.
- Channel 15 (the SCI control channel) and SysEx are dropped. So are the SCI-only controllers 0x4B, 0x4C, 0x4E and 0x60.
- Program numbers are the game's own, not General MIDI. A GM synth will play them with its own instruments. The sound comes through only once the AdLib bank is decoded.
- Digitized samples appended to a sound are skipped.

## Reading the output

Each line gives the flag, event count, length in seconds, what ended the sequence, the note channels, and the programs used. A `PROBLEMS:` note means the parser stopped early. Structure is checked by the verify activity. Nothing here has been listened to yet, so check the timing in a MIDI player.
