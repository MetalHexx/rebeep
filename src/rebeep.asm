; ReBeep - plays PC-speaker tones on a Sound Blaster's OPL2/OPL3.
; Placeholder entry point: prints its version and exits.
; SPDX-License-Identifier: MIT

        cpu     8086
        org     100h

%ifndef REBEEP_VERSION
%define REBEEP_VERSION "0.1.0"
%endif

start:
        mov     dx, banner
        mov     ah, 09h             ; DOS: print $-terminated string
        int     21h
        mov     ax, 4C00h           ; DOS: exit with code 0
        int     21h

banner  db      "ReBeep ", REBEEP_VERSION, " - scaffold", 13, 10, "$"
