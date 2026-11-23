---
name: extract-sierra-resources
description: Extract music, sound and patch resources from Sierra games for personal study. Routes to activity folders for identifying a game folder, unpacking resources, converting sound to MIDI, verifying the output, and inspecting AdLib patch banks. Currently SCI0 only (Space Quest III verified); AGI and later SCI versions are planned. Use when the user asks to extract, unpack or convert Sierra game music, sound or patches, or to test a new Sierra game.
---

# Extract Sierra resources

Routing skill. Find the activity below and read its README. Scripts are Node (.mjs) and run with `node` on PATH. `<skill>` means this folder.

## Ground rules

- **Personal study only.** Outputs go to a scratch folder and stay out of any repository. Nothing taken from a game goes into ReBeep or any shipped product until the user settles the license question.
- **Treat game files as untrusted.** Extract archives into a new empty folder. Never run a game's executables, or scripts found inside a game folder.
- **Pass paths as arguments.** Don't write into a game folder.

## Status

- **SCI0 (6-byte resource map):** unpacking and MIDI conversion done for Space Quest III and King's Quest IV. Space Quest III's LZW sounds match the game's own loose copies apart from one header byte each. King's Quest IV uses only raw (method 0) entries. No tested game has used Huffman (method 2) yet, so that decoder is unverified.
- **Not supported:** SCI1 and later, and AGI. AGI is planned as a generic extension.
- **Patches:** the AdLib bank is patch 3. Space Quest III's is 2,690 bytes (a 2-byte header and 128 records of 21 bytes). King's Quest IV's is 1,344 bytes (64 records of 21 bytes, no header). The field layout and the header size are not confirmed.
- **Gaps:** digitized samples appended to sound resources are not exported. Raw sounds 76, 80 and 96 in Space Quest III differ widely from their loose copies, so their output is unverified.
- **Not built:** ReBeep patch export. It waits on the REBEEP-4 format and the license decision.

## Activities

| Want to... | Read |
|---|---|
| Check a folder is a supported game, and which engine | `reference/identify/README.md` |
| Unpack sound and patch resources | `reference/unpack/README.md` |
| Convert decoded sounds to MIDI | `reference/midi/README.md` |
| Check output against the game's loose copies, and MIDI structure | `reference/verify/README.md` |
| Inspect an AdLib patch bank | `reference/patches/README.md` |

Shared code: `lib/sci.mjs`, imported by the scripts. Don't run it directly.

## Order for a new game

1. identify
2. unpack
3. verify
4. MIDI
5. patches (research only)
