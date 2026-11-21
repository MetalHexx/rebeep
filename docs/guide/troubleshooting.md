# Troubleshooting

Find what you see, then try the fix. If nothing here helps, open an
[issue](https://github.com/MetalHexx/rebeep/issues) with the game, your DOS and what happened.

## By symptom

| You see or hear | Try |
|---|---|
| No ReBeep message at boot | Check you picked the ReBeep entry, and that `AUTOEXEC.BAT` has its two lines ([step 4](real-pc.md#4-add-a-rebeep-boot-menu-entry)). Run `C:\REBEEP\REBEEP` by hand to see what it says |
| A message instead of the load summary | Look it up under [messages](#messages) |
| It says `loaded in conventional memory` | Upper memory wasn't ready. The entry needs `DOS=HIGH,UMB`, and `LH` before `REBEEP` |
| A Jemm error at boot | The ReBeep entry must not also load `HIMEM.SYS` or `EMM386.EXE`: `JEMMEX.EXE` replaces both |
| Nothing from the sound card | Run `REBEEP /S`: translation should be on. Try `REBEEP /V:12`, and turn up the card's FM volume in its mixer program. Then `RBTEST /C:1` |
| The tunes still come from the PC speaker | Ctrl+Alt+B may have switched them there: press it again. If `REBEEP /S` says `traps off`, run `REBEEP /ON` |
| Clicks from the PC speaker | That's a sound ReBeep can't turn into a note. `REBEEP /R:0` mutes it |
| A hotkey does nothing in a game | The game owns the keyboard. Set things at the DOS prompt before starting it ([playing](playing.md#hotkeys)) |
| A game's own AdLib or FM music sounds wrong | `REBEEP /OFF` before the game, `REBEEP /ON` after |
| A game runs slowly | It beeps very often. `REBEEP /OFF` before starting it |
| A game says it needs EMS (expanded memory) | Remove `NOEMS` from the `JEMMEX.EXE` line |
| A game crashes or hangs | Boot your usual entry and try again. If it still fails, ReBeep isn't the cause. If it fails only with ReBeep, open an issue |
| `RBPLAY` says ReBeep did not load | Run `REBEEP` to see its message, then look it up below |

## Messages

| ReBeep says | What to do |
|---|---|
| `Bad option. Run REBEEP /? for the options.` | A switch is misspelled or out of range. Check it against `REBEEP /?` |
| `ReBeep needs a 386 or better.` | The CPU is a 286 or older, which ReBeep can't run on |
| `QPIEMU is not loaded. Run JLOAD QPIEMU.DLL first (see README.TXT).` | Run `C:\JEMM\JLOAD.EXE C:\JEMM\QPIEMU.DLL`. If that fails, Jemm isn't loaded: boot the ReBeep entry |
| `No OPL2/OPL3 found at port 388h.` | No FM chip answers. ReBeep needs a Sound Blaster, or a card with an OPL at that port. Some cards need their setup program run first |
| `No free AMIS multiplex number.` | Other TSRs hold every slot. Unload one and try again |
| `Another program already traps the speaker ports (for example SBEMU's PC-speaker feature).` | Only one program can catch the speaker. For SBEMU, start it with `/PCS0`. See [compatibility](compatibility.md#known-conflicts) |
| `... is loaded. Use that version's REBEEP to change or unload it.` | Another ReBeep version is in memory. Run `REBEEP` from that version's folder |
| `ReBeep is not loaded.` | `/S`, `/U`, `/ON` and `/OFF` need ReBeep loaded. Load it, then try again |
| `Can't unload: another program hooked in after ReBeep. Unload it first.` | Unload the TSR you loaded after ReBeep, then `REBEEP /U` |
| `DOS would not free ReBeep's memory.` | Reboot |

The exit codes behind these messages are in the [reference](reference.md#exit-codes).
