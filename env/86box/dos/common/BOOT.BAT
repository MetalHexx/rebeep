@ECHO OFF
REM ReBeep dev boot step. AUTOEXEC calls this from D: on every boot, so
REM changing it needs only "rebeep disk deploy", never an edit on C:.
REM RBDEV=1 means the "ReBeep dev" menu entry was chosen (Jemm is loaded).
REM Put the latest ReBeep build on PATH on every boot, dev entry or not.
SET PATH=%PATH%;D:\REBEEP
IF NOT "%RBDEV%"=="1" GOTO END
C:\JEMM\JLOAD.EXE C:\JEMM\QPIEMU.DLL
REM QPICHK (built from src/diag) reports whether the QPI is up.
IF EXIST D:\ENV\QPICHK.COM D:\ENV\QPICHK.COM
REM Load ReBeep only when the deploy marked it ready to autoload.
IF EXIST D:\REBEEP\AUTOLOAD.FLG LH D:\REBEEP\REBEEP.COM
:END
REM A hand test set up for the user, on either menu entry. It is put
REM there by "rebeep disk add <vm> BENCH.BAT --to ENV", and the next
REM deploy removes it.
IF EXIST D:\ENV\BENCH.BAT CALL D:\ENV\BENCH.BAT
