; ReBeep - plays PC-speaker tones on a Sound Blaster's OPL2/OPL3. A TSR: the resident part
; comes first, then the startup part, which is freed when ReBeep goes resident. Everything
; the resident part touches lives below resident_end.
; Build with "rebeep build run": it defines REBEEP_VERSION and REBEEP_VER_MAJOR/MINOR/PATCH.
; SPDX-License-Identifier: MIT

%ifndef REBEEP_VERSION
%fatal REBEEP_VERSION is not defined: build with "rebeep build run"
%endif

; REBEEP_TRACE (the record count) builds REBEEPD.COM, the dev-only logger (capture/trace.asm).
; Its name differs, so it and REBEEP.COM never take each other for the same version.
%ifdef REBEEP_TRACE
%define REBEEP_NAME "ReBeep ", REBEEP_VERSION, " trace"
%else
%define REBEEP_NAME "ReBeep ", REBEEP_VERSION
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
%include "capture/trace.asm"            ; the trace build only
resident_end:
%include "startup/main.asm"             ; freed when going resident
%include "startup/patch.asm"            ; the patch file parser
%include "startup/files.asm"            ; the program's folder, the settings file, the patch lookup
%include "startup/dump.asm"             ; the trace build only: REBEEPD /D
