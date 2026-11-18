# Compatibility

What ReBeep has been tried on, and what is known not to work. Machine options and fixes are in
[usage](usage.md); the VMs are in [the 86Box environment](86box-environment.md).

## Games

| Game | DOS | Machine | Result |
|---|---|---|---|
| Grand Prix Circuit | MS-DOS 6.22 | 86Box `mirror-msdos` | Pending its listening check at release |
| Grand Prix Circuit | FreeDOS 1.4 | 86Box `mirror-freedos` | Hangs on a black screen in both menu entries, with and without Jemm, so ReBeep is not the cause. Use MS-DOS |

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
| Games with their own FM music | The game and ReBeep both drive the OPL | `REBEEP /OFF` before the game, or `REBEEP /U` |
| Protected-mode games | ReBeep is built for real-mode games | Not supported |
| EMM386 and QEMM | ReBeep needs Jemm's QPIEMU module | Not supported. Use Jemm |
