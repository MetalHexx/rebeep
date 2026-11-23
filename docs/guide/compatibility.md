# Compatibility

What ReBeep has been tried on, the settings each game wants, and what doesn't mix with it.

## Games

| Game | DOS | Machine | Result |
|---|---|---|---|
| Grand Prix Circuit | MS-DOS 6.22 | 86Box, Pentium MMX 233, Sound Blaster Vibra 16S | Engine, effects and music play on the sound card in every voice. At the default `/R:1` the music's drum clicks and each screen change click on the PC speaker, as they do without ReBeep; `REBEEP /R:0` mutes them |
| Grand Prix Circuit | MS-DOS 7.1 (Windows 98) | Real PC, FIC PA-2010 (Socket 7), Sound Blaster Vibra 16 | With `REBEEP /P:ORGAN /R:0`, loaded high under JemmEx: a practice race and a full race to the win screen, with no crash and no click |
| Grand Prix Circuit | FreeDOS 1.4 | 86Box, Pentium MMX 233 | The game hangs on a black screen, with or without ReBeep and Jemm. Use MS-DOS |

Tried another game? That is the biggest help right now. File a
[game report](https://github.com/MetalHexx/rebeep/issues/new?template=game-report.yml), or open a
pull request adding a row.

### Grand Prix Circuit

```
REBEEP /P:ORGAN /R:0
```

- **Set everything before you start it.** The game takes over the keyboard, so the hotkeys do
  nothing inside it.
- **`/R:0`** removes the clicks at the intro and at each screen change. The music loses its drum
  clicks with them.
- **Run it on MS-DOS.** It hangs on FreeDOS.

Want to know why? See the [Grand Prix Circuit case study](../architecture/gpc-case-study.md).

## Machines

| Machine | Sound | Result |
|---|---|---|
| 86Box, Pentium MMX 233, FreeDOS 1.4 | Sound Blaster Vibra 16S, OPL3 | Passes ReBeep's automated tests: load, catching the speaker, translation, the speaker fallback, `/OFF`, unload |
| Real PC: FIC PA-2010 (Socket 7), MS-DOS 7.1, JemmEx and QPIEMU | Sound Blaster Vibra 16 | Grand Prix Circuit races clean (Games above) |

How fast ReBeep is on these machines: [performance](../architecture/how-it-works.md#performance).

## Known conflicts

| What | Why | What to do |
|---|---|---|
| SBEMU, with its PC-speaker emulation on | Both programs catch the same speaker ports, and only one can. ReBeep says `Another program already traps the speaker ports` | Start SBEMU with `/PCS0` to turn its speaker emulation off |
| Games with their own AdLib or FM music | The game and ReBeep would both play on the FM chip | `REBEEP /OFF` before the game, `REBEEP /ON` after. Or unload with `REBEEP /U` |
| Games that take over the keyboard, such as Grand Prix Circuit | The game never passes keys on, so the hotkeys never reach ReBeep | Set the voice at the DOS prompt before starting the game, for example `REBEEP /P:FLUTE` |
| Games that run in protected mode, through a DOS extender such as DOS/4GW | ReBeep only catches programs running in real mode | Not supported |
| `EMM386.EXE` or QEMM as the memory manager | They have no QPIEMU, which ReBeep needs | Boot a ReBeep entry that loads Jemm instead ([real PC, step 4](real-pc.md#4-add-a-rebeep-boot-menu-entry)) |
| A DOS window inside Windows | Windows runs its own memory manager | Boot to plain DOS |
