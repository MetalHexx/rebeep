@ECHO OFF
REM Installs or updates ReBeep in a folder, over any copy already there. It
REM never edits CONFIG.SYS, AUTOEXEC.BAT, FDCONFIG.SYS or FDAUTO.BAT, and it
REM never touches your PATCHES and PROFILES folders, or an RBSTUDIO.CFG
REM already there. It replaces what ReBeep ships in the FACTORY folder.
REM Usage: INSTALL [/I or /U] [folder]. The default folder is C:\REBEEP.
REM With no /I or /U it shows a menu, which needs CHOICE: MS-DOS 6 or later,
REM Windows 95 or 98, or FreeDOS.
IF "%1"=="/?" GOTO HELP
IF NOT EXIST REBEEP.COM GOTO NOTHERE
SET RBMODE=
IF "%1"=="/I" SET RBMODE=I
IF "%1"=="/i" SET RBMODE=I
IF "%1"=="/U" SET RBMODE=U
IF "%1"=="/u" SET RBMODE=U
SET RBDIR=C:\REBEEP
IF "%RBMODE%"=="" IF NOT "%1"=="" SET RBDIR=%1
IF NOT "%RBMODE%"=="" IF NOT "%2"=="" SET RBDIR=%2
IF "%RBDIR%"=="" GOTO NOENV
ECHO.
ECHO ReBeep @VERSION@ setup
IF "%RBMODE%"=="I" GOTO INSTALL
IF "%RBMODE%"=="U" GOTO UPDATE
IF EXIST %RBDIR%\REBEEP.COM ECHO ReBeep is already in %RBDIR%.
ECHO.
ECHO   I  Install into %RBDIR%
ECHO   U  Update the copy in %RBDIR%
ECHO   Q  Quit
ECHO.
ECHO Another folder? Type INSTALL D:\GAMES\REBEEP
CHOICE /C:IUQ "Choose "
IF ERRORLEVEL 3 GOTO DONE
IF ERRORLEVEL 2 GOTO UPDATE
IF ERRORLEVEL 1 GOTO INSTALL
ECHO No menu on this DOS. Type INSTALL /I to install or INSTALL /U to update.
GOTO DONE

:INSTALL
SET RBMODE=I
IF NOT EXIST %RBDIR%\NUL MD %RBDIR%
IF NOT EXIST %RBDIR%\NUL GOTO NODIR
GOTO DOCOPY
:UPDATE
SET RBMODE=U
IF NOT EXIST %RBDIR%\REBEEP.COM GOTO NOCOPY
:DOCOPY
ECHO.
ECHO Copying ReBeep to %RBDIR%
COPY REBEEP.COM %RBDIR%
COPY RBTEST.COM %RBDIR%
COPY RBSTUDIO.EXE %RBDIR%
COPY SPLASH.ANS %RBDIR%
COPY MENU.ANS %RBDIR%
IF NOT EXIST %RBDIR%\FACTORY\NUL MD %RBDIR%\FACTORY
REM Version 0.2 and earlier kept the factory patches in FACTORY itself.
IF EXIST %RBDIR%\FACTORY\*.RBP DEL %RBDIR%\FACTORY\*.RBP
REM From here a command names the folder once, so that a long install
REM folder still fits DOS's command line.
IF EXIST %RBDIR%\FACTORY\PATCHES\NUL GOTO PATDIR
MD %RBDIR%\FACTORY\PATCHES
:PATDIR
FOR %%F IN (%RBDIR%\FACTORY\PATCHES\*.RBP) DO DEL %%F
COPY FACTORY\PATCHES\*.RBP %RBDIR%\FACTORY\PATCHES
IF EXIST %RBDIR%\FACTORY\PROFILES\NUL GOTO PRODIR
MD %RBDIR%\FACTORY\PROFILES
:PRODIR
IF EXIST %RBDIR%\FACTORY\PROFILES\GPC\NUL GOTO GPCDIR
MD %RBDIR%\FACTORY\PROFILES\GPC
:GPCDIR
FOR %%F IN (%RBDIR%\FACTORY\PROFILES\GPC\*.RB?) DO DEL %%F
COPY FACTORY\PROFILES\GPC\*.RB? %RBDIR%\FACTORY\PROFILES\GPC
COPY RBPLAY.BAT %RBDIR%
COPY README.TXT %RBDIR%
COPY CHANGES.TXT %RBDIR%
IF NOT EXIST %RBDIR%\REBEEP.COM GOTO FAILED
IF NOT EXIST %RBDIR%\FACTORY\PATCHES\BELL.RBP GOTO FAILED
IF NOT EXIST %RBDIR%\FACTORY\PROFILES\GPC\GPC.RBG GOTO FAILED
ECHO.
IF "%RBMODE%"=="U" GOTO UPDATED
ECHO ReBeep @VERSION@ is in %RBDIR%
ECHO.
ECHO Add these lines to CONFIG.SYS:
ECHO   DEVICE=C:\JEMM\JEMMEX.EXE NOEMS X=TEST NOVME NOINVLPG
ECHO   DOS=HIGH,UMB
ECHO.
ECHO Add these lines to AUTOEXEC.BAT:
ECHO   PATH [your current PATH];%RBDIR%
ECHO   C:\JEMM\JLOAD.EXE C:\JEMM\QPIEMU.DLL
ECHO   LH REBEEP
ECHO.
ECHO README.TXT section 3 shows how to add them as a boot menu entry, and
ECHO ready-made configs are in the SAMPLES folder next to INSTALL.BAT.
ECHO.
ECHO If ReBeep is already loaded, reboot to load the new copy.
GOTO DONE
:UPDATED
ECHO ReBeep in %RBDIR% is now version @VERSION@. Your boot files need
ECHO no change. If ReBeep is loaded, reboot to load the new copy.
GOTO DONE

:HELP
ECHO Installs or updates ReBeep. Run it from the folder that holds it.
ECHO.
ECHO INSTALL [/I or /U] [folder]
ECHO   /I      Install, over any copy already there
ECHO   /U      Update the copy already there
ECHO   folder  Where ReBeep goes. The default is C:\REBEEP
ECHO With no /I or /U, INSTALL shows a menu.
GOTO DONE
:NOTHERE
ECHO Run INSTALL from the folder that holds REBEEP.COM.
GOTO DONE
:NOENV
ECHO Out of environment space. Copy the files by hand, as README.TXT shows.
GOTO DONE
:NODIR
ECHO Could not create %RBDIR%. Nothing was copied.
GOTO DONE
:NOCOPY
ECHO ReBeep isn't in %RBDIR%, so there is nothing to update. Type INSTALL /I
ECHO to install it there.
GOTO DONE
:FAILED
ECHO Not every file reached %RBDIR%. Copy the files by hand, as
ECHO README.TXT shows. DOS commands have a length limit, so a shorter folder
ECHO path may help.
:DONE
SET RBMODE=
SET RBDIR=
