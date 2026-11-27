# The trace build: REBEEPD

`REBEEPD.COM` is ReBeep with a logger, for finding out what a game makes ReBeep do while the
user listens. It is dev-only: built and deployed with every build, never packaged
(`PACKAGED_TARGETS` in `tools/lib/release.mjs`). The game itself is never touched.

It records, into a resident buffer of 1024 records (`REBEEP_TRACE` in `src/targets.json`):

- every **speaker step**: a write to the real `61h` that changes bit 1, or the gate while bit 1 is
  on;
- every **OPL note** the game's writes start or stop;
- every rule of a **game profile** (`/G:`) that completes ([profiles.md](profiles.md)).

Each record carries a timestamp and the game's last 8 byte writes. A full buffer keeps the earliest
records and counts the rest. `REBEEPD /D` appends the buffer to `D:\REBEEP\RBTRACE.TXT` and empties it.

## A session with the user

1. `rebeep build run --deploy` with every VM closed, then `rebeep vm run mirror-msdos`.
2. The user, in the VM:
   - `REBEEP /U`, then `LH D:\REBEEP\REBEEPD` with the options under test (`/P:FLUTE`, `/R:0`, ...);
   - play just the part that misbehaves, since the buffer fills;
   - quit to DOS, run `REBEEPD /D`, then close the VM.
   Each `/D` adds a dump, so several short runs can go into one file.
3. You: `rebeep disk fetch mirror-msdos REBEEP\RBTRACE.TXT`, then read
   `build/disk/mirror-msdos/REBEEP/RBTRACE.TXT`.

`REBEEP` and `REBEEPD` answer to different names, so each refuses to change or unload the other
(exit 6). Unload with the one that is loaded.

## Reading RBTRACE.TXT

A dump starts with `# ReBeep <v> trace: <kept> records kept of <offered> offered (capacity n)`.
More offered than kept means records were dropped: the buffer filled, or they came while a dump
ran. Each record is one line; every number is hex:

| Field | Meaning |
|---|---|
| seq | The game's byte OUTs to 42h/43h/61h so far (`RBS_TRAPPED`) |
| tick | BIOS tick count, low word. A game that reprograms the timer may stop it |
| pit0 | PIT channel 0's count, latched: it counts down within each tick |
| kind | `step61` forwarding the game's 61h write, `steppit` a 42h/43h write moved the mask, `steprb` ReBeep itself (an apply, the hotkey, `/OFF`), `noteon`, `noteoff`, `rule` a profile's rule completed, `fallbk` its catch-all did |
| before>after | The real `61h` around a step (`00>00` for a note); for `rule` and `fallbk`, the rule's number > its patch slot |
| game61, mode, masked | The game's own `61h`, the interpreter mode (0 silent, 1 tone, 2 raw, 3 rest), the bit held clear |
| divisor, flags | `RBS_DIVISOR` (valid in tone mode), `RBS_FLAGS` |
| `pp=vv` x 8 | The game's last byte writes, oldest first: port low byte = value |

The layout is in `src/include/trace.inc`.

## Rules

- **Fetch before any deploy.** A deploy rewrites D: and drops `RBTRACE.TXT`.
- **Dev-only.** Never add `REBEEPD.COM` to the package, the docs for players, or `README.TXT`.
- **It costs more than the normal build:** a QPI read on every real `61h` write and a QPI latch
  per record (fast toggling runs about half as fast), about 30 more bytes of the game's stack in
  the hotkey, and 32 KB more resident, which may not fit in upper memory.
- **Timing is indicative:** an emulator's timer is not a real PC's. A step that comes between a
  game's own channel-0 latch and its reads (only possible from the hotkey) tears that read.
- `rebeep test run --suite vm --probe P_TRACE` checks the build end to end.
