# Changelog

Player-facing changes to ReBeep, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Added

- ReBeep is now a real TSR. `REBEEP` goes resident (use `LH` to keep it out of conventional memory) and
  passes the speaker through for now. Ctrl+Alt+B toggles translation and Ctrl+Alt+N cycles the voice.
  `REBEEP /S` shows the status, `/OFF`, `/ON` and `/U` release, retake and unload it, and `REBEEP /?`
  lists every option and exit code.
- In the dev VMs, ReBeep now loads at boot on the "ReBeep dev" menu entry.
- RBTEST, a speaker exerciser: it plays test sounds, checks that ReBeep handles the speaker correctly,
  and measures free memory and the cost of ReBeep's speaker handling. Run `RBTEST /?` for the options.
