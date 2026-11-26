# Reference

Every option, hotkey and exit code, and the studio's switches. `REBEEP /?` prints the same list, and
the package's `README.TXT` carries these tables too. For how to use them, see [playing](playing.md)
and [ReBeep Studio](studio.md).

## Options

```
REBEEP [/F | /P:name] [/V:n] [/L:n] [/R:n] [/K:xy] [/ON | /OFF] [/S] [/U] [/?]
```

| Option | Does |
|---|---|
| `/F` | Faithful square-wave voice (default) |
| `/P:name` | A patch: `BANK\NAME`, or `NAME` from `USER` then `FACTORY` |
| `/V:n` | Volume, 0 to 15 (default 12) |
| `/L:n` | Notes below 20 Hz: 0 silent (default), 1 played as a low FM note |
| `/R:n` | Sounds ReBeep can't translate: 1 on the real speaker (default), 0 muted |
| `/K:xy` | Ctrl+Alt+`x` toggles, Ctrl+Alt+`y` switches the voice (default `BN`) |
| `/ON` | Catch the speaker again |
| `/OFF` | Stop catching the speaker, and leave the FM chip to the game |
| `/S` | Status |
| `/U` | Unload |
| `/?` | Help |

- `/S`, `/U`, `/ON` and `/OFF` act only on a loaded copy.
- On a loaded copy, any other option changes only what it names: `REBEEP /V:8` leaves the voice
  alone.
- On a fresh load, options you leave out take their defaults, except the patch: with neither `/F`
  nor `/P:`, a `PATCH=` line in [`RBSTUDIO.CFG`](studio.md#the-settings-file) picks it.
- A patch ReBeep can't use is a message, and the faithful voice plays
  ([troubleshooting](troubleshooting.md#a-patch-was-not-used)).

## Hotkeys

| Hotkey (defaults) | Does |
|---|---|
| Ctrl+Alt+B | Switch between the sound card and the real speaker |
| Ctrl+Alt+N | Switch between the faithful voice and the patch |

They work at the DOS prompt and in games that leave the keyboard alone, but not yet in games that
take it over, such as Grand Prix Circuit.

## Exit codes

ReBeep returns one in `ERRORLEVEL`, so a batch file can test it.

| Code | Meaning | Code | Meaning |
|---|---|---|---|
| 0 | ok | 5 | speaker ports already caught by another program |
| 1 | bad option | 6 | a different version is loaded |
| 2 | CPU below 386 | 7 | not loaded |
| 3 | no QPIEMU (Jemm) | 8 | unload refused |
| 4 | no FM chip at 388h | 9 | other failure |

What to do about each: [troubleshooting](troubleshooting.md#messages).

## RBSTUDIO

`RBSTUDIO.EXE` is [ReBeep Studio](studio.md), the patch editor.

```
RBSTUDIO [/VIEW:MONO] [/TRACE] [/?]
```

| Option | Does |
|---|---|
| `/VIEW:MONO` | Force the mono view; a monochrome display is noticed without it |
| `/TRACE` | Log every FM chip write and key press to `RBSTUDIO.LOG` |
| `/?` | Help |

Its keys are in [studio](studio.md#the-keys), and are on screen under F1.

## RBTEST

`RBTEST.COM` plays speaker test sounds and checks how ReBeep handles them. It exits with 0 when
every check passed, and 1 otherwise.

| Command | Does |
|---|---|
| `RBTEST` | Menu: keys 0 to 9 play a test sound, Esc quits |
| `RBTEST /C:n` | Play test sound `n` (0 to 9) once |
| `RBTEST /A` | Unattended checks, with PASS and FAIL lines |
| `RBTEST /A /R` | The same, and also require ReBeep to be loaded and check its state |
| `RBTEST /M:SAVE` | Save the largest free memory block to `RBMEM.DAT` |
| `RBTEST /M:SAME x` | Compare it with the saved value, reported as test `x` |
| `RBTEST /B` | Time `OUT 61h` against `OUT 80h` |
| `RBTEST /?` | Help |

To hear that ReBeep works, load it and run `RBTEST /C:1`: the tones should come from the sound
card, not the PC speaker.
