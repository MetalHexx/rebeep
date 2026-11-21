@ECHO OFF
REM RBPLAY [game [args]] runs a game with ReBeep loaded.
REM It loads ReBeep if it is not up, and Jemm's QPIEMU if
REM none is up. After the game it unloads ReBeep only when
REM it loaded it. QPIEMU stays loaded.
REM RBJEMM names the Jemm folder. Set it when Jemm is not in C:\JEMM.
IF "%RBJEMM%"=="" SET RBJEMM=C:\JEMM
SET RBLOADED=
REBEEP /S >NUL
IF ERRORLEVEL 7 IF NOT ERRORLEVEL 8 GOTO LOAD
IF ERRORLEVEL 1 GOTO FAILED
GOTO READY
:LOAD
LH REBEEP
IF ERRORLEVEL 3 IF NOT ERRORLEVEL 4 GOTO NOQPI
IF ERRORLEVEL 1 GOTO FAILED
GOTO LOADED
:NOQPI
%RBJEMM%\JLOAD.EXE %RBJEMM%\QPIEMU.DLL
LH REBEEP
IF ERRORLEVEL 1 GOTO FAILED
:LOADED
SET RBLOADED=1
:READY
IF "%1"=="" GOTO END
CALL %1 %2 %3 %4 %5 %6 %7 %8 %9
IF "%RBLOADED%"=="1" REBEEP /U
GOTO END
:FAILED
ECHO ReBeep did not load, so the game was not started.
ECHO Run REBEEP /? for the exit codes.
:END
