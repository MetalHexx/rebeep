# Changelog

Player-facing changes to ReBeep, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

## [0.1.0] - 2026-11-18

### Added

- First release. ReBeep is a TSR for DOS games that only know the PC speaker. It plays their speaker
  tones on the Sound Blaster's FM chip (OPL2 or OPL3) instead. Anything it can't translate, such as
  noise or a pitch the FM chip can't reach, still plays on the real speaker, and the switch between the
  two is immediate. Pitches below 20 Hz, which games use as rests, stay silent; `REBEEP /L:1` plays them
  as a low FM note.
- Load it with `REBEEP`, or `LH REBEEP` to keep it out of conventional memory. Ctrl+Alt+B toggles
  between the FM chip and the speaker, and Ctrl+Alt+N cycles the voice. `REBEEP /S` shows the status,
  `/OFF`, `/ON` and `/U` release, retake and unload it, and `REBEEP /?` lists every option and exit
  code. `/OFF` and the hotkey hand a sounding tone back to the speaker without a gap.
- The package, as a zip and as a floppy image: `INSTALL.BAT` copies ReBeep to a folder and prints the
  lines to add, `RBPLAY.BAT` runs one game with ReBeep loaded, and `SAMPLES\` holds ready-made MS-DOS
  and FreeDOS boot configs with a ReBeep menu entry. `README.TXT` walks through setup.
- RBTEST, a speaker exerciser: it plays test sounds, checks that ReBeep handles the speaker correctly,
  and measures free memory and the cost of ReBeep's speaker handling. Run `RBTEST /?` for the options.
- Docs for players: a usage guide (options, hotkeys, exit codes, troubleshooting), how ReBeep works with
  its measured cost, and a compatibility page with tested games and known conflicts.

### Known issues

- Grand Prix Circuit hangs on FreeDOS 1.4 whether or not ReBeep is loaded.
- The hotkeys don't fire in games that take over the keyboard, such as Grand Prix Circuit. Set the voice,
  or `REBEEP /OFF`, at the DOS prompt before starting them.
- Games with their own FM music need `REBEEP /OFF` first, or ReBeep and the game fight over the FM chip.
