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
of any other you have, such as one you made in [ReBeep Studio](studio.md). `REBEEP /P:name` looks
in `USER` first, then `FACTORY`; a patch from another bank takes the bank too, `/P:HEXX\ORGAN`. If ReBeep
can't use a patch it says why and plays the faithful voice ([why](troubleshooting.md#a-patch-was-not-used)).

On a card with only an OPL2, such as an AdLib, `/F` is an FM copy of the square wave. It hasn't
been checked by ear yet: if it sounds wrong, pick a patch. A patch with a four-operator voice
plays that on an OPL3 and its two-operator voice on an OPL2.

On a loaded copy, an option changes only what it names, so the other settings stay as they are.

## Game profiles

A game profile gives each part of a game its own patch, such as one for the title music and
another for the menus. ReBeep tells the parts apart by what the game sends the speaker.

```
REBEEP /G:MYGAME
```

`/G:MYGAME` loads `PROFILES\MYGAME\MYGAME.RBG` from ReBeep's folder, and the patches beside it. No
profile comes with ReBeep yet: you write your own, as below. The profile's default patch plays
until a rule picks another, and a rule's patch plays in its own voice, even after Ctrl+Alt+N.
`REBEEP /S` names the profile, and `/P:` or `/F` ends it. It lasts until you unload ReBeep or restart the PC. If ReBeep can't use a profile
it says why, and what was playing goes on ([why](troubleshooting.md#a-profile-was-not-used)).

A profile is a text file, in the same style as a patch:

```
[PROFILE]
FORMAT=1
NAME=My Game
DEFAULT=MENU

[RULE]
ID=RACE
STEP=CTRL B6h
STEP=NOTE C22Eh 40
PATCH=ENGINE

[EFFECT]
NAME=Tire squeal
WHILE=RACE
TONE=0950h 50
PATCH=SQUEAL
```

| Line | Means |
|---|---|
| `FORMAT=1` | Required |
| `NAME=My Game` | A name to show in a menu later, 1 to 24 characters, in any section. Optional |
| `DEFAULT=MENU` | The patch that plays first, `MENU.RBP` in the profile's folder. Without it, the patch you had plays on |
| `[RULE]` | One rule, up to 16. They are tried in order, and the first to match picks its patch. That patch plays until another rule picks a different one |
| `ID=RACE` | A rule's name, for `WHILE=`: 1 to 8 letters, digits, `_` or `-`, not only digits. Optional |
| `WHILE=RACE` | The rule or effect counts only while `RACE` is the last rule to have matched. Optional |
| `STEP=` | Up to 4 a rule, in order. Each matches the next sound event of its kind. `NOTE n t`: a note starts within `t` of the timer count `n`. `PITCH n t`: a sounding note changes to that count. `TONE n t`: either. `OFF`: a note stops. `CTRL n`: the game writes `n` to the timer's control port, `43h`. Leave out the number to take any |
| `PATCH=ENGINE` | The rule's or effect's patch, `ENGINE.RBP` in the profile's folder. Up to 8 patches a profile |
| `[EFFECT]` | A sound effect with a patch of its own, up to 8. While a note is within `t` of the count `n` in `TONE=n t` (`n - t` at least 193), it plays in the effect's patch on an FM channel of its own; then the rule's patch takes the note back. Not in the faithful voice |

Numbers are decimal, or hex with a trailing `h`. Lines starting with `;` are comments. A profile
file is at most 2,048 bytes. A `PROFILES=` line in [the settings file](studio.md#the-settings-file) moves the profiles folder.

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
