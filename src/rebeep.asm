; ReBeep - plays PC-speaker tones on a Sound Blaster's OPL2/OPL3. A TSR: the resident part
; comes first, then the startup part, which is freed when ReBeep goes resident. Everything
; the resident part touches lives below resident_end.
; Build with "rebeep build run": it defines REBEEP_VERSION and REBEEP_VER_MAJOR/MINOR/PATCH.
; SPDX-License-Identifier: MIT

%ifndef REBEEP_VERSION
%fatal REBEEP_VERSION is not defined: build with "rebeep build run"
%endif

        org     100h
image_start:
        jmp     startup_entry
%include "resident/data.asm"            ; RB_STATE first, then variables and the private stack
%include "capture/trap.asm"             ; cpu 386
%include "engine/interp.asm"            ; cpu 8086
%include "engine/opl.asm"               ; cpu 8086
%include "hotkey/kbd.asm"
%include "resident/amis.asm"
resident_end:
%include "startup/main.asm"             ; freed when going resident
