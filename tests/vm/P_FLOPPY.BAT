REM VM: mirror-freedos
REM VM-TIMEOUT: 150
REM VM-FLOPPY: build/release/rebeep-{version}-floppy.img
REM Floppy probe: the release floppy mounts as A: while C: still boots, and ReBeep runs from it.
@ECHO OFF
D:
CD \
DIR A:\ >NUL
IF NOT EXIST A:\REBEEP.COM GOTO MISSING
A:\REBEEP.COM /? >NUL
IF ERRORLEVEL 1 GOTO HELPBAD
ECHO PASS floppy-help>> D:\RESULT.TXT
IF NOT EXIST A:\RBTEST.COM GOTO MISSING
A:\RBTEST.COM /A>> D:\RESULT.TXT
GOTO FINISH
:HELPBAD
ECHO FAIL floppy-help: exit code not 0>> D:\RESULT.TXT
GOTO FINISH
:MISSING
ECHO FAIL floppy: REBEEP.COM or RBTEST.COM missing from A:>> D:\RESULT.TXT
:FINISH
ECHO DONE>> D:\RESULT.TXT
C:\FREEDOS\BIN\FDAPM.COM POWEROFF
