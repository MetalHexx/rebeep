# Patches

> The AdLib instrument bank (SCI0 patch 3), its layout, and conversion to ReBeep `.RBP` files. Personal study only.

## What's here

| Path | Role |
|---|---|
| `inspect-patch.mjs` | Prints the instrument count, the separator, and each field's range across a bank |
| `to-rbp.mjs` | Writes one `.RBP` per instrument, then parses each file back and checks it |
| `../../lib/sci.mjs` | `ADLIB` (field offsets) and `readAdlibPatch` (splits the bank into instruments) |

## Run

```
node "<skill>/reference/patches/inspect-patch.mjs" "<scratch>\<game>-out\patch-003.bin"
node "<skill>/reference/patches/to-rbp.mjs" "<scratch>\<game>-out\patch-003.bin" "<scratch>\<game>-rbp" SQ3
```

The prefix is 1-4 characters with at least one letter. Files are named `SQ3-000.RBP`, `SQ3-001.RBP` and so on.
The output is CRLF text, as `.RBP` requires.

## Layout (SCI Wiki spec)

- Each instrument is 28 bytes and describes one voice with two operators. Operator 1 is the modulator and operator 2 the carrier when the algorithm is FM.
- A block holds 48 instruments. An `AB CD` separator may follow it, then a second block of 48.
- Space Quest III has 96 instruments (two blocks). King's Quest IV has 48 (one block).
- Bytes `0x0f` and `0x19` are unused.

## Mapping to `.RBP`

| SCI field | `.RBP` key | Conversion |
|---|---|---|
| AR, DR, RR, MULT, WAVE | AR, DR, RR, MULT, WAVE | as is |
| sustain level | SL | 15 − value |
| amplitude | OL | 63 − value |
| key scaling | KSL | register bits 0, 1, 2, 3 map to file 0, 2, 1, 3 |
| AM, VIB, EGT, KSR | TREM, VIB, SUS, KSR | as is |
| algorithm | CONNECTION | 1 is FM, 0 is AM |
| feedback | FEEDBACK | as is |

Every file has `OCTAVE=4`, the game's own pitch.

## Assumptions, not confirmed

- **Levels are raw OPL values.** Amplitude is read as attenuation and sustain as the register nibble. In FM records the carrier is louder than the modulator: mean amplitude 2.9 against 13.6 in Space Quest III, and 1.3 against 18.2 in King's Quest IV. The spec gives no bit mapping.
- **KSL is raw register bits.** If the game stores a dB index instead, the KSL column is wrong.
- **Algorithm 1 is FM**, with operator 1 modulating operator 2. The spec says the field's sense is switched.
- **Skipped:** all-zero instruments, algorithm values above 1, and feedback above 7. King's Quest IV slots 1, 3 and 4 have high bits set in the feedback byte, so they are not written.
- **Not checked:** whether any file sounds right. The script checks the format rules and that the mapping loses nothing. No ReBeep parser has read the output yet.

## Pitfalls

- The output is derived from game data. Write it to a scratch folder, never into the repo, and don't ship it until the license question is settled.
- The first two bytes of the Space Quest III bank are instrument data, not a header.

## Related

- [SKILL.md](../../SKILL.md): ground rules and status.
- [unpack](../unpack/README.md): produces the decoded `patch-003.bin`.
