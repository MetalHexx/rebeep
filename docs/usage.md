# Using ReBeep

The player reference: starting ReBeep, its options and hotkeys, and what to do when it refuses. The
package's `README.TXT` mirrors the tables below; if they ever differ, fix both. Machine and game
results are in [compatibility](compatibility.md), the design in [how it works](how-it-works.md).

## Start it

Run `INSTALL` from the folder that holds `REBEEP.COM`. It copies the files to `C:\REBEEP` (or the
folder you name) and prints the config lines to add. It edits nothing. Then pick one way to run:

| Way | What you do |
|---|---|
| Per game | `RBPLAY GAME.EXE [args]` loads ReBeep, runs the game, unloads ReBeep if it loaded it |
| Every boot | Add the lines `INSTALL` prints to `CONFIG.SYS` and `AUTOEXEC.BAT` |
| Sample config | Copy from `SAMPLES\MSDOS` or `SAMPLES\FREEDOS`: a boot menu entry loads ReBeep |

Jemm and QPIEMU must be up first, so `CONFIG.SYS` needs `DEVICE=C:\JEMM\JEMMEX.EXE NOEMS X=TEST NOVME
NOINVLPG` and `DOS=HIGH,UMB`, and `AUTOEXEC.BAT` runs `C:\JEMM\JLOAD.EXE C:\JEMM\QPIEMU.DLL` before
ReBeep. `RBPLAY` loads QPIEMU itself when it is missing, from `C:\JEMM` or the folder in `RBJEMM`
(`SET RBJEMM=D:\JEMM`), but never the memory manager. Load ReBeep with `LH REBEEP` to keep it out of
conventional memory.

Back up your own `CONFIG.SYS` and `AUTOEXEC.BAT` before copying a sample over them.

## Options

`REBEEP [/F | /P:n] [/V:n] [/K:xy] [/ON | /OFF] [/S] [/U] [/?]`

| Option | Does |
|---|---|
| `/F` | Faithful square-wave voice (default) |
| `/P:n` | Built-in patch `n`, 1 to 4: 1 Organ, 2 Flute, 3 Brass, 4 Bell |
| `/V:n` | Volume, 0 to 15 (default 12) |
| `/K:xy` | Ctrl+Alt+`x` toggles, Ctrl+Alt+`y` cycles the voice (default `BN`) |
| `/ON` | Trap the speaker again |
| `/OFF` | Stop trapping and release the OPL to the game |
| `/S` | Status |
| `/U` | Unload |
| `/?` | Help |

`/S`, `/U`, `/ON` and `/OFF` act only on a loaded copy. On a loaded copy, any other option changes
only what it names, so `REBEEP /V:8` leaves the voice alone. On a plain load, unnamed options take
their defaults.

## Hotkeys and voices

| Hotkey (defaults) | Does |
|---|---|
| Ctrl+Alt+B | Turn translation on or off |
| Ctrl+Alt+N | Cycle the voice: faithful, then patches 1 to 4 |

The faithful voice is the nearest to the real speaker: a square wave on an OPL3, a close FM
approximation on an OPL2. The four patches are Organ, Flute, Brass and Bell. Volume applies to
every voice.

## `/OFF` and `/ON`

`/OFF` hands the speaker and the OPL back: nothing is trapped, and the OPL is the game's. `/ON`
traps again and picks up the game's current speaker state.

Use `/OFF` before a game that plays its own FM music, or that toggles the speaker so often it slows
down. Use `/ON` to come back. The hotkey is not enough for a game with its own FM music: it stops
translating but keeps the traps, and on an OPL3 keeps the chip in OPL3 mode.

Some games take over the keyboard interrupt, so the hotkeys do nothing in them. Set the state
before you start the game.

## Exit codes

Also returned in `ERRORLEVEL`.

| Code | Meaning | Code | Meaning |
|---|---|---|---|
| 0 | ok | 5 | speaker ports already trapped |
| 1 | bad option | 6 | a different version is loaded |
| 2 | CPU below 386 | 7 | not loaded |
| 3 | no QPIEMU (Jemm) | 8 | unload refused |
| 4 | no OPL at 388h | 9 | other failure |

## Check your hardware with RBTEST

`RBTEST.COM` plays speaker test cases and checks ReBeep's behaviour. It exits with 0 when every
check passed, and 1 otherwise.

| Command | Does |
|---|---|
| `RBTEST` | Menu: keys 0 to 9 play a case, Esc quits |
| `RBTEST /C:n` | Play case `n` (0 to 9) once |
| `RBTEST /A` | Unattended behaviour checks (PASS and FAIL lines) |
| `RBTEST /A /R` | Also require ReBeep and check its state |
| `RBTEST /M:SAVE` | Save the largest free block to `RBMEM.DAT` |
| `RBTEST /M:SAME x` | Compare it with the saved value, as test `x` |
| `RBTEST /B` | Time `OUT 61h` against `OUT 80h` |
| `RBTEST /?` | Help |

To hear that ReBeep works, load it and run `RBTEST /C:1`: the tones should come from the FM chip.

## Troubleshooting

| Message | What to do |
|---|---|
| "Bad option. Run REBEEP /? for the options." | A switch is misspelled or out of range |
| "ReBeep needs a 386 or better." | The CPU is below a 386; ReBeep cannot run on it |
| "QPIEMU is not loaded. Run JLOAD QPIEMU.DLL first" | Run `JLOAD C:\JEMM\QPIEMU.DLL` |
| "No OPL2/OPL3 found at port 388h." | No FM chip answers there. ReBeep needs a Sound Blaster, or a card with an OPL at that port |
| "No free AMIS multiplex number." | Other resident programs hold every slot. Unload one and retry |
| "Another program already traps the speaker ports" | Turn off that program's PC-speaker feature (SBEMU has one). Only one program can trap the ports |
| "... is loaded. Use that version's REBEEP" | A different version is resident. Run `REBEEP` from that version's folder |
| "ReBeep is not loaded." | `/S`, `/U`, `/ON` and `/OFF` need a loaded copy. Load it, then retry |
| "Can't unload: another program hooked in after ReBeep." | Unload the program that loaded after ReBeep, then `REBEEP /U` |
| "DOS would not free ReBeep's memory." | Reboot to clear the resident copy |

Other problems:

| Symptom | Fix |
|---|---|
| A game with its own FM music clashes | `REBEEP /OFF` before it, or `REBEEP /U` |
| A hotkey does nothing in a game | Set `/ON` or `/OFF` before starting the game |
| A game runs slowly | It toggles the speaker very often. `REBEEP /OFF` before starting it. See [performance](how-it-works.md#performance) |
| `RBPLAY` says ReBeep did not load | Run `REBEEP /?` and read the exit code above |
