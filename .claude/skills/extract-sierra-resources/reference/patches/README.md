# Patches

Research only. Nothing here produces ReBeep patches yet.

## Command

```
node "<skill>/reference/patches/inspect-patch.mjs" "<scratch>\<game>-out\patch-003.bin"
```

Optional arguments: record size (default 21) and header bytes (default 2).

## What is known

- Patch 1 is MT-32, patch 2 is IBM Music Feature or FB-01, patch 3 is AdLib (the FM bank), and patch 4 is General MIDI. The numbers match the sound driver table in the SCI0 notes.
- Space Quest III's patch 3 is 2,690 bytes: a 2-byte header, then 128 records of 21 bytes. That fits 128 instruments.
- The first two bytes are `00 03`, which may be the patch number.
- King's Quest IV: patch 3 is 1,344 bytes, which is 64 records of 21 bytes with no header. It is stored raw (method 0). It is identical to the game's loose `patch\PATCH.003` copy once that file's 2-byte type word is removed, so the raw decode of patches is verified for that file.

## What is not known

- The field layout of each 21-byte record is not decoded. The column ranges suggest operator-level values, and possibly four operators. That is a hypothesis.
- Next step: read how ScummVM's SCI AdLib driver uses the record bytes. That needs the user's approval of the sources to fetch.

## Not built

ReBeep `.RBP` export. It waits on the REBEEP-4 format and the license decision.
