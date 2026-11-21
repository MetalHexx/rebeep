# Roadmap

Where ReBeep is headed. Nothing here is a promise or a date: ideas are talked over on
[Discord](https://discord.gg/4wkPZnCfz) before anyone builds them.

## Now: the first release

On a 386 or better running Jemm, a real-mode game's PC-speaker sound plays on a Sound Blaster's
OPL2 or OPL3 FM chip. It is proven on Grand Prix Circuit, on a real PC and in 86Box.

## Next

- **A project website** on GitHub Pages: what ReBeep is, what it runs on, and how to get it.

## Ideas being considered

| Idea | What it would bring |
|---|---|
| One-click 86Box setup | A ready VM with DOS, Jemm and ReBeep, and a folder to drop your games into |
| An AI setup helper | An assistant plugin that walks newcomers through Jemm and the boot files |
| Jemm in the package | One download instead of two, if Jemm's license allows it |
| Hotkeys in every game | Catching the keys at the keyboard's port, so games that own the keyboard can't block them |
| More voices | A larger set of FM patches, each able to play an octave up or down |
| Per-game profiles | Settings picked per game, such as the voice, the volume and how low notes play |
| Digital sound for the rest | Clicks and noise played through the Sound Blaster's digital audio instead of the speaker |
| XT and 286 machines | A simpler way to catch the beeps on the machines most speaker games were written for |
| MIDI and other sound chips | Speaker music on a MIDI synth, or on a Tandy-style tone chip |
| Other memory managers | EMM386 or QEMM, for setups that can't switch to Jemm |
| Arranged soundtracks | Recognizing a game's tune and playing a full arrangement in its place |

## How you can help

- **Test games.** This is the biggest help right now. Try ReBeep with your speaker-only games and
  tell us what you hear in a
  [game report](https://github.com/MetalHexx/rebeep/issues/new?template=game-report.yml), or add a
  row to [compatibility](guide/compatibility.md) in a pull request.
- **Help build the roadmap.** Bring an idea to [Discord](https://discord.gg/4wkPZnCfz) first. Once
  it's agreed there, open a
  [feature idea](https://github.com/MetalHexx/rebeep/issues/new?template=feature-idea.yml) and see
  [contributing](lab/contributing.md).
