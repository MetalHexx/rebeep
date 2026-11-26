# Changelog

Player-facing changes to ReBeep, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

## [0.2.0] - 2026-11-26

### Added

- **ReBeep Studio**, a patch editor that comes in the package: shape your own FM sounds, play them on the keyboard,
  roll random new ones, and collect them in banks you can share
  ([studio](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/studio.md)).
- **Your own sounds in your games:** `/P:` now takes a patch by name, whether you made it or it came with ReBeep
  ([playing](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/playing.md#pick-a-voice)).
- **Four-operator voices:** on an OPL3, a patch can use four operators for a fuller sound
  ([playing](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/playing.md#pick-a-voice)).

### Changed

- **Ctrl+Alt+N** now switches between the faithful voice and the loaded patch
  ([playing](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/playing.md#hotkeys)).

### Removed

- **`/P:1` to `/P:4`:** use `/P:ORGAN`, `/P:FLUTE`, `/P:BRASS` or `/P:BELL`. Update old boot and batch files too, or
  ReBeep reports a bad option and doesn't load
  ([playing](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/playing.md#pick-a-voice)).

### Known issues

- **OPL2 cards** such as an AdLib: the faithful voice hasn't been checked by ear. If it sounds wrong, pick a patch,
  such as `REBEEP /P:ORGAN` ([playing](https://github.com/MetalHexx/rebeep/blob/main/docs/guide/playing.md#pick-a-voice)).

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
