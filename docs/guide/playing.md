# Playing

Everyday use, once ReBeep is [set up](getting-started.md#pick-your-path). Every command here works
at the DOS prompt, before or between games. The full list is in the [reference](reference.md).

## Start a game

| How | What you do |
|---|---|
| ReBeep loads at boot | Pick the ReBeep boot entry, then start the game as usual |
| For one game only | `RBPLAY GAME.EXE`, from the game's folder |

`RBPLAY` loads ReBeep, runs the game, and unloads ReBeep when the game exits. It passes on any
options after the game's name: `RBPLAY GAME.EXE /X`. It needs `C:\REBEEP` on your `PATH` and Jemm
loaded from `CONFIG.SYS`, and loads QPIEMU by itself from `C:\JEMM`. If Jemm lives elsewhere, tell
it first:

```
SET RBJEMM=D:\JEMM
```

## Pick a voice

```
REBEEP /P:FLUTE
```

| Option | Voice |
|---|---|
| `/F` | Faithful: a square wave, the nearest to the real speaker (default) |
| `/P:ORGAN` | Organ |
| `/P:FLUTE` | Flute |
| `/P:BRASS` | Brass |
| `/P:BELL` | Bell |

A patch is an FM voice kept in a small file. Those four come with ReBeep, and `/P:` takes the name
of any other you have, such as one you made in [ReBeep Studio](studio.md). A bare name, `/P:BELL`, is
always ReBeep's own, from `FACTORY`; a patch of yours takes its folder too, `/P:USER\BELL` or `/P:HEXX\ORGAN`.
If ReBeep can't use a patch it says why and plays the faithful voice ([why](troubleshooting.md#a-patch-was-not-used)).

On a card with only an OPL2, such as an AdLib, `/F` is an FM copy of the square wave. It hasn't
been checked by ear yet: if it sounds wrong, pick a patch. A patch with a four-operator voice
plays that on an OPL3 and its two-operator voice on an OPL2.

On a loaded copy, an option changes only what it names, so the other settings stay as they are.

## Game profiles

A game profile gives each part of a game its own patch, such as one for the title music, another
for the menus and others for sound effects. ReBeep tells the parts apart by what the game sends
the speaker, and changes the patch as you play. A profile is a folder holding a text file and its
patches. ReBeep comes with one, `GPC`, for [Grand Prix Circuit](compatibility.md#grand-prix-circuit);
to change it or make your own, see [writing a game profile](profiles.md).

Load a profile by its name, before you start the game. A bare name is ReBeep's own; one of yours
takes its folder, `/G:USER\MYGAME`:

```
REBEEP /G:GPC
```

You should see `Profile GPC picks the patch from what the game plays.` and, below it, that `/P:` or `/F` ends it.

| To | Do this |
|---|---|
| Load it for one game only | `RBPLAY GAME.EXE /G:GPC` |
| See which profile is on | `REBEEP /S` |
| Change to another | `REBEEP /G:USER\MYGAME` |
| End it | `REBEEP /P:ORGAN`, or `REBEEP /F` |

A profile lasts until you end it, unload ReBeep or restart the PC. Give `/G:` without `/P:` or
`/F`. While a profile is on, each change of patch replaces a voice you picked with Ctrl+Alt+N. If
ReBeep can't use a profile it says why, and what was playing goes on
([why](troubleshooting.md#a-profile-was-not-used)).

## Set the volume

```
REBEEP /V:8
```

From 0, silent, to 15. The default is 12.

## Mute the leftover speaker sounds

Clicks, noise and very high pitches can't become a note, so they still play on the PC speaker.
To hear only the sound card:

```
REBEEP /R:0
```

The game then loses whatever it played that way, such as a drum beat made of clicks. `/R:1` brings
them back.

## Very low notes

Some games use a pitch below 20 Hz as a pause between notes. ReBeep keeps those silent, as the real
speaker nearly does. To hear them as a low note instead:

```
REBEEP /L:1
```

## Hotkeys

| Keys | Does |
|---|---|
| Ctrl+Alt+B | Switch between the sound card and the real speaker |
| Ctrl+Alt+N | Switch between the faithful voice and the patch you loaded |

**They don't work in every game yet.** Games that take over the keyboard, such as Grand Prix
Circuit, never pass the keys on. Set the voice and volume at the DOS prompt before you start
those games. The keys can be changed: `REBEEP /K:QW` makes them Ctrl+Alt+Q and Ctrl+Alt+W.

## Turn it off, or unload it

| Command | Does |
|---|---|
| `REBEEP /S` | Shows whether ReBeep is loaded, and its settings |
| `REBEEP /OFF` | Stops catching the speaker. The game has the speaker and the sound card's FM chip to itself |
| `REBEEP /ON` | Starts again |
| `REBEEP /U` | Removes ReBeep from memory |

Use `REBEEP /OFF` before a game that plays its own AdLib or FM music, and `REBEEP /ON` after it.
Ctrl+Alt+B is not enough for those games: it only switches where the beeps go.
