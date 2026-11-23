# Changelog

Player-facing changes to ReBeep, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Added

- **ReBeep Studio**, a full-screen patch editor: shape your own FM voices, play them on the keyboard,
  and save them. It comes in the package, and `INSTALL` copies it
  ([studio](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/studio.md)).
- **Patches by name:** `/P:` takes the name of a patch from `USER`, `FACTORY` or a pack folder, and
  `PATCH=` in `RBSTUDIO.CFG` picks one at every load
  ([playing](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/playing.md#pick-a-voice)).
- **Four-operator voices** on an OPL3, for patches that have one
  ([how it works](https://github.com/MetalHexx/rebeep/blob/main/docs/architecture/how-it-works.md#patches)).

### Changed

- **Ctrl+Alt+N** now switches between the faithful voice and the loaded patch
  ([playing](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/playing.md#hotkeys)).

### Removed

- **`/P:1` to `/P:4`.** Use `/P:ORGAN`, `/P:FLUTE`, `/P:BRASS` and `/P:BELL`
  ([playing](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/playing.md#pick-a-voice)).

## [0.1.0] - 2026-11-21

### Added

- **ReBeep**, a TSR that plays DOS games' PC-speaker beeps on a Sound Blaster's OPL2 or OPL3 FM
  chip. It needs a 386 or better and Jemm 5.87 or later with its QPIEMU module
  ([getting started](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/getting-started.md)).
- **Five voices:** a faithful square wave (`/F`) or one of four FM patches (`/P:1` to `/P:4`:
  Organ, Flute, Brass, Bell), with the volume set by `/V`
  ([playing](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/playing.md#pick-a-voice)).
- **Nothing lost:** sounds the FM chip can't play still go to the real speaker, and `/R:0` mutes
  them. Pitches below 20 Hz stay silent, and `/L:1` plays them as a low note
  ([playing](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/playing.md#mute-the-leftover-speaker-sounds)).
- **Hotkeys:** Ctrl+Alt+B switches between the sound card and the speaker, and Ctrl+Alt+N cycles
  the voice. `/K` changes the keys
  ([playing](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/playing.md#hotkeys)).
- **Control at the prompt:** `/S` shows the status, `/OFF` and `/ON` pause and resume, and `/U`
  unloads. `LH REBEEP` loads it into upper memory, where it takes about 3.4 KB
  ([reference](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/reference.md)).
- **The package**, as a zip and a floppy image: `INSTALL` to install or update, `RBPLAY` to run one
  game with ReBeep, sample MS-DOS and FreeDOS boot menus, `RBTEST` to check your setup, and the
  `README.TXT` manual
  ([set up on a real PC](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/real-pc.md),
  [in 86Box](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/86box.md)).

### Known issues

- The hotkeys don't work in games that take over the keyboard, such as Grand Prix Circuit. Set the
  voice at the DOS prompt before you start them
  ([known conflicts](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/compatibility.md#known-conflicts)).
- Games with their own FM music need `REBEEP /OFF` first
  ([known conflicts](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/compatibility.md#known-conflicts)).
- Grand Prix Circuit hangs on FreeDOS 1.4, with or without ReBeep
  ([Grand Prix Circuit](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/compatibility.md#grand-prix-circuit)).
- On a card with only an OPL2, such as an AdLib, the faithful voice hasn't been checked by ear. If
  it sounds wrong, pick a patch, such as `REBEEP /P:1`
  ([playing](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/playing.md#pick-a-voice)).
