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
REBEEP /P:2
```

| Option | Voice |
|---|---|
| `/F` | Faithful: a square wave, the nearest to the real speaker (default) |
| `/P:1` | Organ |
| `/P:2` | Flute |
| `/P:3` | Brass |
| `/P:4` | Bell |

On a loaded copy, an option changes only what it names, so the other settings stay as they are.

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
| Ctrl+Alt+N | Next voice: faithful, then patches 1 to 4 |

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
