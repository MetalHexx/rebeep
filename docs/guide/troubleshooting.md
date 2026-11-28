# Troubleshooting

Find what you see, then try the fix. If nothing here helps, file a
[bug report](https://github.com/MetalHexx/rebeep/issues/new?template=bug-report.yml).

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
| `Patch ... not used` and the faithful voice plays | ReBeep couldn't use the patch you named. See [a patch was not used](#a-patch-was-not-used) |
| Ctrl+Alt+N does nothing at the prompt | No patch is loaded, so there is only the faithful voice. Load one with `REBEEP /P:FLUTE` |
| A hotkey does nothing in a game | The game owns the keyboard. Set things at the DOS prompt before starting it ([playing](playing.md#hotkeys)) |
| A game's own AdLib or FM music sounds wrong | `REBEEP /OFF` before the game, `REBEEP /ON` after |
| A game runs slowly | It beeps very often. `REBEEP /OFF` before starting it |
| A game says it needs EMS (expanded memory) | Remove `NOEMS` from the `JEMMEX.EXE` line |
| A game crashes or hangs | Boot your usual entry and try again. If it still fails, ReBeep isn't the cause. If it fails only with ReBeep, open an issue |
| `RBPLAY` says ReBeep did not load | Run `REBEEP` to see its message, then look it up below |
| In the studio, a note doesn't sound when you hold three or more keys | Some keyboards can't send every set of keys at once. Hold the same keys at the DOS prompt: if the last letter doesn't appear there either, it's the keyboard's limit, and the studio can't change it |

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

## A patch was not used

A patch ReBeep can't use is never an error. It says why, and the faithful voice plays:

```
Patch MYLEAD not used. Playing the faithful voice.
  not found in FACTORY.
```

The last line is the reason. A line above it, ending in `:`, names the file or folder it is about,
when that isn't the name you gave.

| The reason | What to do |
|---|---|
| `not found in FACTORY` | A bare name is only ReBeep's own: there is no `MYLEAD.RBP` in `FACTORY`. For a patch of yours, give its folder, such as `/P:USER\MYLEAD` or `/P:HEXX\ORGAN`. Check the spelling too |
| `not found` | There is no such file in the folder you named, such as `USER\MYLEAD.RBP` for `/P:USER\MYLEAD` |
| `folder does not exist` | The `PATCHES=` folder in `RBSTUDIO.CFG` isn't there. Fix the line or make the folder |
| `not a valid patch name` | A name is up to 8 letters, digits, `-` and `_`, and not only digits |
| `cannot be read` | DOS couldn't read the file. Check the disk |
| Something about the file, such as `FORMAT is not 1` | The file has a mistake. Open it in a text editor and fix that line. The studio leaves such a file out of its list, and its log says which line |

A `PATCHES=` line that isn't a plain DOS path gets its own message, and the default folder is used:

```
PATCHES=..\MINE
ignored: not a plain DOS path. Using the default folder.
```

The line is explained in [the settings file](studio.md#the-settings-file).

## A profile was not used

A [game profile](profiles.md) ReBeep can't use is never an error either. It says why, and what
was playing goes on:

```
Profile USER\MYGAME not used: not found in PROFILES.
```

That means there is no `MYGAME.RBG` in `PROFILES\USER\MYGAME`: check the folder and the name. A
bare name, `/G:MYGAME`, is only ReBeep's own, and says `not found in FACTORY`; give your folder,
`/G:USER\MYGAME`. A profile of yours never stands in for a bare name, nor ReBeep's for yours.
Otherwise a line names the file and the next gives the reason, such as
`a rule has no PATCH`, `more than 16 rules` or `the file is over 4096 bytes`: fix that. A patch the
profile names that can't be used gets the patch message above, and the faithful voice plays for its
rule. It is looked for only beside the `.RBG`, so a [changed copy](profiles.md#change-one-that-comes-with-rebeep)
needs every patch. A bad `PROFILES=` line gets a message like the one for `PATCHES=`.

## The studio log

[ReBeep Studio](studio.md) writes `RBSTUDIO.LOG` into the folder that holds `RBSTUDIO.EXE`, usually
`C:\REBEEP`, and replaces it on every run. F1 in the editor prints its path. It lists what the
studio found at start, and a line for each problem: a patch file left out of the list and why, a
bad `PATCHES=` line, a missing `SPLASH.ANS`. Start `RBSTUDIO /TRACE` to log each FM chip write too.
When you report a studio problem, attach the log.
