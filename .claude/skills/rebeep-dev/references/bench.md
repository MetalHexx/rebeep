# A bench: a hand test set up for the user

Whenever the user runs a test by hand in a VM (listening, a REBEEPD trace, a profile, the
studio), set it up first so all they do is press Enter to start the program. Never hand them
commands to type. `BOOT.BAT` calls `D:\ENV\BENCH.BAT` at the end of every boot, on either menu
entry, when it is there; the next deploy removes it.

## Setting one up

1. Deploy with every VM closed: `rebeep build run --deploy`, or `rebeep disk deploy <vm>`.
2. Write `BENCH.BAT` outside the repo, in a folder of its own (`disk add` keeps the host name,
   which must be 8.3), as CRLF text, from the template below.
3. `rebeep disk add <vm> <folder>/BENCH.BAT --to ENV`.
4. `rebeep vm run <vm> --json` starts 86Box detached and returns its `pid`. Wait on that pid in
   the background (PowerShell `Wait-Process -Id <pid>`, or a `kill -0` loop), so you know when
   the user closes the VM.
5. Tell the user, in a few lines: what the bench loads, what to play, what to listen for.
6. When the VM closes, fetch the results before any deploy ([d-files.md](d-files.md)).

## The template

```bat
@ECHO OFF
REM Bench: the GPC race, the engine patch. BOOT.BAT runs it every boot.
IF NOT "%RBDEV%"=="1" GOTO CLEAN
D:\REBEEP\REBEEP /U
LH D:\REBEEP\REBEEPD /G:GPC /R:0
D:
CD \GAMES\GPC\GPAUTO
:PLAY
ECHO.
ECHO Play the intro, the menus and a race, then quit to DOS.
ECHO Press Enter to start GPEGA.
PAUSE >NUL
GPEGA
D:\REBEEP\REBEEPD /D
CHOICE /C:YN Play again
IF NOT ERRORLEVEL 2 GOTO PLAY
ECHO Done: the log is in D:\REBEEP\RBTRACE.TXT. Close the VM.
GOTO END
:CLEAN
ECHO This bench needs the ReBeep dev entry. Reboot and pick it.
:END
```

## Rules

- **One load line carries every option under test** (`/R:0`, `/P:`, `/G:`): a run whose load
  line left one off tests the wrong thing.
- **Start the game's own executable, not its launcher:** it gets the user in faster (GPC:
  `GPEGA`, not `GP`).
- After the program, collect what the test needs (`REBEEPD /D`, a `COPY`), then offer to play
  again (`CHOICE`, in MS-DOS and FreeDOS), so a second run is logged too.
- Lines of 78 columns or fewer. A very long `REM` line hangs FreeDOS's shell
  ([tests/vm/AGENTS.md](../../../../tests/vm/AGENTS.md)).
- **It runs on every boot until the next deploy,** so a reboot runs it again. Each `REBEEPD /D`
  appends a dump.
- **Clean has no Jemm:** a bench that loads ReBeep checks `RBDEV`, as the template does.
- `disk add` refuses while the VM runs. The `vm` suite's probe D: never has a bench.
