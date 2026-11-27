<div align="center">

<img src="docs/images/rebeep-logo.png" alt="A green frog at a retro PC, saying ReBeep!" width="300">

**Hear your beeper-only DOS games through a real sound card.**

[![CI](https://github.com/MetalHexx/rebeep/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MetalHexx/rebeep/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/MetalHexx/rebeep)](https://github.com/MetalHexx/rebeep/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join%20the%20chat-5865F2?logo=discord&logoColor=white)](https://discord.gg/4wkPZnCfz)

**[Visit the ReBeep website →](https://metalhexx.github.io/rebeep/)**

</div>

---

Plenty of 1980s DOS games can only beep: one square wave, through a tiny speaker inside the case.
Your Sound Blaster sits there silent. ReBeep is a small DOS program that catches those beeps and
plays them on the card's FM chip instead.

## Highlights

- **The game's beeps on your sound card.** Melodies and sound effects play on the OPL2 or OPL3 FM
  chip of a Sound Blaster or a clone, and the PC speaker stays quiet.
- **Nothing goes missing.** Sounds the FM chip can't play, such as noise or very high pitches, still
  go to the real speaker. `/R:0` mutes them instead.
- **Five voices, and your own.** A faithful square wave close to the original, or one of four FM
  patches chosen by name: `/P:ORGAN`, `/P:FLUTE`, `/P:BRASS` or `/P:BELL`. OPL3 cards play
  four-operator voices.
- **ReBeep Studio.** Shape, play and save your own patches in a DOS editor: [see it below](#rebeep-studio).
- **Change it while you play.** Ctrl+Alt+B swaps between the sound card and the speaker, and
  Ctrl+Alt+N switches between the faithful voice and your patch. The keys can be changed. They
  don't work yet in games that take over the keyboard; set those up at the DOS prompt first.
- **Small and tidy.** One `.COM` file that loads high and unloads cleanly. The game is
  never patched.

## ReBeep Studio

A full-screen FM editor in the same package: play the keyboard while you shape a voice, press F12 for
a random one or F11 to mutate it, then hear it in your games. **[Take the tour →](docs/guide/studio.md)**

<table align="center"><tr>
<td><a href="docs/images/studio/splash.png"><img src="docs/images/studio/splash.png" width="300" alt="ReBeep Studio's splash: the ReBeep! logo over a smiling green frog"></a></td>
<td><a href="docs/images/studio/synth.gif"><img src="docs/images/studio/synth.gif" width="300" alt="The patch editor rolling new random four-operator voices with F12"></a></td></tr></table>

## How it works

```
game ──OUT 42h/43h/61h──▶ Jemm + QPIEMU ──▶ ReBeep ──▶ OPL2/OPL3 at 388h
                                               └──────▶ PC speaker (fallback)
```

A game beeps by setting a pitch on the PC's timer chip and switching the speaker on. Jemm's QPIEMU
module lets ReBeep catch those port writes as they happen. ReBeep works out the note the game asked
for, plays it on the FM chip, and holds the real speaker still. The details, and what it costs in
speed, are in [how it works](docs/architecture/how-it-works.md).

## What you need

| Need | |
|---|---|
| CPU | A 386 or better |
| DOS | MS-DOS 5 or later, or FreeDOS |
| Memory manager | Jemm 5.87 or later, with its QPIEMU module |
| Sound | An OPL2 or OPL3 FM chip at `388h` (Sound Blaster cards and most clones) |

## Install it

1. Download the zip or the floppy image from the
   [latest release](https://github.com/MetalHexx/rebeep/releases/latest).
2. Run `INSTALL` from the folder that holds `REBEEP.COM`, and choose install or update.
3. Add a ReBeep entry to your boot menu that loads Jemm, then ReBeep.

The full walkthrough, from getting Jemm to the boot menu lines, starts at
[getting started](docs/guide/getting-started.md), for a [real PC](docs/guide/real-pc.md) or
[86Box](docs/guide/86box.md).

## Tested on

Grand Prix Circuit, raced on a real Socket 7 PC with a Sound Blaster Vibra 16, and in 86Box on an
emulated Pentium MMX and a 386SX/16, backed by automated checks that run in DOS VMs.
[Compatibility](docs/guide/compatibility.md) lists every result and the known conflicts.

## Documentation

**Using ReBeep**

| Doc | What it covers |
|---|---|
| [Getting started](docs/guide/getting-started.md) | What it is, what you need, which setup to follow |
| [Set up on a real PC](docs/guide/real-pc.md) | Jemm, installing, a boot menu entry, checking it, undoing it |
| [Set up in 86Box](docs/guide/86box.md) | The VM's settings, getting the files in, then the same steps |
| [Playing](docs/guide/playing.md) | Voices, game profiles, volume, muting, hotkeys, turning it off |
| [Writing a game profile](docs/guide/profiles.md) | A game's parts and effects in patches of their own: the file, and how it matches |
| [ReBeep Studio](docs/guide/studio.md) | A tour, then making and saving your own patches, banks, the settings file |
| [Troubleshooting](docs/guide/troubleshooting.md) | By symptom, then every message |
| [Compatibility](docs/guide/compatibility.md) | Tested games and machines, settings per game, known conflicts |
| [Reference](docs/guide/reference.md) | Every option, hotkey, exit code, and the RBSTUDIO and RBTEST commands |

**How it works**

| Doc | What it covers |
|---|---|
| [How it works](docs/architecture/how-it-works.md) | The design, and the measured cost |
| [ReBeep Studio, built](docs/architecture/studio.md) | The studio's modules and the design behind them |
| [Grand Prix Circuit](docs/architecture/gpc-case-study.md) | A case study: how the game drives the speaker, and what ReBeep makes of it |

**The lab and contributing**

| Doc | What it covers |
|---|---|
| [Lab setup](docs/lab/setup.md) | From a fresh clone to a booted DOS VM, on the Free and Full paths |
| [The 86Box lab](docs/lab/86box-lab.md) | The VMs, their disks, the boot flow, snapshot and reset |
| [Contributing](docs/lab/contributing.md) | Set up, workflow and checks, commits, payload rules |
| [Releasing](docs/lab/releasing.md) | The release procedure and the checks by a person |

## Build it yourself

ReBeep comes with a ready-made 86Box lab: one command-line tool fetches 86Box, FreeDOS and Jemm at
pinned versions, builds the DOS VMs, and puts each new build on them. Start at
[lab setup](docs/lab/setup.md).

## Roadmap

What's here now, and the ideas being considered: [roadmap](docs/roadmap.md).

## Contributing

[![Report a game](https://img.shields.io/badge/Report_a_game-2ea44f?style=for-the-badge)](https://github.com/MetalHexx/rebeep/issues/new?template=game-report.yml)
[![Report a bug](https://img.shields.io/badge/Report_a_bug-d73a4a?style=for-the-badge)](https://github.com/MetalHexx/rebeep/issues/new?template=bug-report.yml)
[![Suggest a feature](https://img.shields.io/badge/Suggest_a_feature-0969da?style=for-the-badge)](https://github.com/MetalHexx/rebeep/issues/new?template=feature-idea.yml)

- **Test games.** The biggest help right now: try ReBeep with yours and file a
  [game report](https://github.com/MetalHexx/rebeep/issues/new?template=game-report.yml).
- **Found a bug?** File a [bug report](https://github.com/MetalHexx/rebeep/issues/new?template=bug-report.yml). The
  [troubleshooting page](docs/guide/troubleshooting.md) may already have the fix.
- **Planning a feature?** Talk it over first in a [feature idea](https://github.com/MetalHexx/rebeep/issues/new?template=feature-idea.yml),
  so it fits the [roadmap](docs/roadmap.md).

Start with [contributing](docs/lab/contributing.md); AI agents start at [AGENTS.md](AGENTS.md).

## Community

Come chat on [Discord](https://discord.gg/4wkPZnCfz) about ReBeep, the games you've tried it with,
or other ideas for giving old DOS games better sound.

## License

[MIT](LICENSE)
