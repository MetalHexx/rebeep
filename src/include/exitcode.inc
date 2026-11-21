; REBEEP.COM's exit codes, also returned in BL by a failed AMIS 12h and 14h.
; SPDX-License-Identifier: MIT

%ifndef EXITCODE_INC
%define EXITCODE_INC

EXIT_OK         equ 0
EXIT_BAD_OPTION equ 1
EXIT_NO_386     equ 2
EXIT_NO_QPI     equ 3
EXIT_NO_OPL     equ 4
EXIT_TRAPPED    equ 5           ; the speaker ports are already trapped
EXIT_MISMATCH   equ 6           ; a resident copy of another version
EXIT_NOT_LOADED equ 7
EXIT_REFUSED    equ 8           ; unload refused: another program hooked in after ReBeep
EXIT_FAILED     equ 9           ; no free multiplex number, a DOS error

%endif
