# Roadmap

Where ReBeep is headed. Nothing here is a promise or a date: ideas are talked over on
[Discord](https://discord.gg/4wkPZnCfz) before anyone builds them.

## Now

**ReBeep Studio.** A full-screen patch editor: shape your own FM voices, play them on the keyboard,
save them and hear them in a game. Patches are chosen by name with `/P:`, and OPL3 cards play
four-operator voices ([studio](guide/studio.md)).

**The first release.** On a 386 or better running Jemm, a real-mode game's PC-speaker sound plays on
a Sound Blaster's OPL2 or OPL3 FM chip. It is proven on Grand Prix Circuit, on a real PC and in
86Box.

**Game profiles.** `/G:` gives each part of a game its own patch, told apart by what the game
sends the speaker. ReBeep comes with its first, for Grand Prix Circuit, where the intro, the menus,
the race and its effects get their own ([game profiles](guide/profiles.md)).

**A project website**, on GitHub Pages at <https://metalhexx.github.io/rebeep/>: what ReBeep is,
what it runs on, and how to get it. It shows the latest release on its own.

## Next

**The profile editor.** ReBeep Studio's Game Profiles screen, to make and change a game profile
without writing its file by hand. It is on the studio's main menu, marked coming soon.

## Ideas being considered

| Idea | What it would bring |
|---|---|
| One-click 86Box setup | A ready VM with DOS, Jemm and ReBeep, and a folder to drop your games into |
| A full DOS installer | A menu to install, update or remove ReBeep in the folder you choose, and the boot menu set up for you, with backups |
| An AI setup helper | An assistant plugin that walks newcomers through Jemm and the boot files |
| Jemm in the package | One download instead of two, if Jemm's license allows it |
| Hotkeys in every game | Catching the keys at the keyboard's port, so games that own the keyboard can't block them |
| More voices | A larger set of factory patches, beyond the four that ship now |
| More from game profiles | Profiles for more games, the game recognized on its own, and settings such as the volume and how low notes play |
| Digital sound for the rest | Clicks and noise played through the Sound Blaster's digital audio instead of the speaker |
| XT and 286 machines | A simpler way to catch the beeps on the machines most speaker games were written for |
| MIDI and other sound chips | Speaker music on a MIDI synth, or on a Tandy-style tone chip |
| Other memory managers | EMM386 or QEMM, for setups that can't switch to Jemm |
| Arranged soundtracks | Recognizing a game's tune and playing a full arrangement in its place |
| A settings page | Change ReBeep's options from a menu in the studio, instead of typing them. It is on the studio's main menu, marked coming soon |
| Custom sound effects | Replace or add effects, not only tunes |

## How you can help

- **Test games.** This is the biggest help right now. Try ReBeep with your speaker-only games and
  tell us what you hear in a
  [game report](https://github.com/MetalHexx/rebeep/issues/new?template=game-report.yml), or add a
  row to [compatibility](guide/compatibility.md) in a pull request.
- **Help build the roadmap.** Bring an idea to [Discord](https://discord.gg/4wkPZnCfz) first. Once
  it's agreed there, open a
  [feature idea](https://github.com/MetalHexx/rebeep/issues/new?template=feature-idea.yml) and see
  [contributing](lab/contributing.md).
