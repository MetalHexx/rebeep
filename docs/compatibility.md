# Compatibility

What ReBeep has been tried on, and what is known not to work. Machine options and fixes are in
[usage](usage.md); the VMs are in [the 86Box environment](86box-environment.md).

## Games

| Game | DOS | Machine | Result |
|---|---|---|---|
| Grand Prix Circuit | MS-DOS 6.22 | 86Box `mirror-msdos` | Engine, effects and music play on the OPL in all four patches. At the default `/R:1` the music's percussion and each screen change click on the real speaker, as on a real PC; `REBEEP /R:0` mutes them. The hotkeys don't work inside the game |
| Grand Prix Circuit | FreeDOS 1.4 | 86Box `mirror-freedos` | Hangs on a black screen in both menu entries, with and without Jemm, so ReBeep is not the cause. Use MS-DOS |

How Grand Prix Circuit drives the speaker, and what still sounds different, is on
[its own page](gpc.md).

Tried another game? Open an issue or a PR adding a row.

## Hardware and emulators

| Machine | Sound | Result |
|---|---|---|
| 86Box `mirror-freedos` (Pentium MMX 233) | Sound Blaster Vibra 16S, OPL3 | Verified by the probes (`rebeep test run --suite vm`): load, trap, translate, fallback, `/OFF`, unload |
| Real hardware | any | Not yet recorded |

The speed of ReBeep's trap on these machines is in [performance](how-it-works.md#performance).

## Known conflicts

| What | Why | What to do |
|---|---|---|
| SBEMU's PC-speaker feature | It traps the same ports, and only one program can (exit code 5) | Turn that feature off |
| Games with their own FM music | The game and ReBeep both drive the OPL (ReBeep uses channels 7 and 8) | `REBEEP /OFF` before the game, or `REBEEP /U` |
| Games that take over the keyboard, such as Grand Prix Circuit | The game's keyboard handler never passes keys on, so the hotkeys never reach ReBeep | Set the voice, or `REBEEP /OFF`, at the DOS prompt before starting the game |
| Protected-mode games | ReBeep is built for real-mode games | Not supported |
| EMM386 and QEMM | ReBeep needs Jemm's QPIEMU module | Not supported. Use Jemm |
