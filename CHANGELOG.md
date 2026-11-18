# Changelog

Player-facing changes to ReBeep, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Added

- ReBeep is now a real TSR. `REBEEP` goes resident (use `LH` to keep it out of conventional memory).
  Ctrl+Alt+B toggles translation and Ctrl+Alt+N cycles the voice. `REBEEP /S` shows the status, `/OFF`,
  `/ON` and `/U` release, retake and unload it, and `REBEEP /?` lists every option and exit code.
- Speaker tones now play on the Sound Blaster's FM chip instead of the PC speaker. Anything ReBeep can't
  translate, such as noise or a pitch the FM chip can't reach, still plays on the real speaker, and the
  switch between the two is immediate. `/OFF` and the hotkey hand a sounding tone back to the speaker
  without a gap, and `/ON` picks the game's speaker state up again.
- In the dev VMs, ReBeep now loads at boot on the "ReBeep dev" menu entry.
- Setup files: `INSTALL.BAT` copies ReBeep to a folder and prints the lines to add, `RBPLAY.BAT` runs
  one game with ReBeep loaded, and `SAMPLES\` holds ready-made MS-DOS and FreeDOS boot configs with a
  ReBeep menu entry.
- RBTEST, a speaker exerciser: it plays test sounds, checks that ReBeep handles the speaker correctly,
  and measures free memory and the cost of ReBeep's speaker handling. Run `RBTEST /?` for the options.
