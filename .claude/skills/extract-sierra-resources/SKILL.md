---
name: extract-sierra-resources
description: Extract music, sound and patch resources from Sierra games for personal study. Routes to activity folders for identifying a game folder, unpacking resources, converting sound to MIDI, verifying the output, and inspecting AdLib patch banks or converting them to ReBeep .RBP files. Currently SCI0 only (Space Quest III verified); AGI and later SCI versions are planned. Use when the user asks to extract, unpack or convert Sierra game music, sound or patches, or to test a new Sierra game.
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
- **Patches (AdLib bank, patch 3):** the layout follows the SCI Wiki spec: 28-byte instruments with two operators. Space Quest III has 96 (two blocks), King's Quest IV has 48. `to-rbp.mjs` writes ReBeep `.RBP` text. The meanings of the level, KSL and algorithm fields are assumptions, listed in the patches README.
- **Gaps:** digitized samples appended to sound resources are not exported. Raw sounds 76, 80 and 96 in Space Quest III differ widely from their loose copies, so their output is unverified.
- **Not done:** no ReBeep build or parser has read the `.RBP` output, and no converted patch has been listened to.

## Activities

| Want to... | Read |
|---|---|
| Check a folder is a supported game, and which engine | `reference/identify/README.md` |
| Unpack sound and patch resources | `reference/unpack/README.md` |
| Convert decoded sounds to MIDI | `reference/midi/README.md` |
| Check output against the game's loose copies, and MIDI structure | `reference/verify/README.md` |
| Inspect an AdLib patch bank, or convert it to ReBeep `.RBP` files | `reference/patches/README.md` |

Shared code: `lib/sci.mjs`, imported by the scripts. Don't run it directly.

## Order for a new game

1. identify
2. unpack
3. verify
4. MIDI
5. patches (research only)
