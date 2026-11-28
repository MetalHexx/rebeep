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
%include "engine/rules.asm"             ; cpu 8086: a game profile's rules and table
%include "engine/fx.asm"                ; cpu 8086: a profile's effects, on the effect voice
%include "hotkey/kbd.asm"
%include "resident/amis.asm"
%include "capture/trace.asm"            ; the trace build only
resident_end:
%include "startup/main.asm"             ; freed when going resident
%include "startup/opldet.asm"           ; opl_detect, run once by the load path
%include "startup/patch.asm"            ; the patch file parser
%include "startup/files.asm"            ; the program's folder, the settings file, the patch lookup
%include "startup/profile.asm"          ; /G: the profile file parser and loader
%include "startup/dump.asm"             ; the trace build only: REBEEPD /D

; The resident part costs every player memory, so its size is a decision: the build stops
; when it grows past the cap. Raise RESIDENT_MAX only on purpose, with how-it-works.md.
; One paragraph more than before (5120), for the profile table's full FOLDER\NAME (PT_NAME).
RESIDENT_MAX    equ 5136
%ifndef REBEEP_TRACE
%if RESIDENT_PARAS * 16 > RESIDENT_MAX
%error the resident part is over RESIDENT_MAX bytes: raise the cap only on purpose
%endif
%endif

; A .COM file loads at 100h in one 64 KB segment, with DOS's stack at its top: leave it 512 bytes.
%if $ - $$ > 10000h - 100h - 512
%error the image is over 64,768 bytes, with no room left for the stack (a trace build: fewer records)
%endif
