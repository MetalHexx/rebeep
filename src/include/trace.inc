; The trace build (REBEEPD.COM, REBEEP_TRACE defined): the buffer layout AMIS 15h returns,
; and the macros the capture code places. Without REBEEP_TRACE the macros are empty, or
; the plain QPI write, so the normal build is unchanged.
; SPDX-License-Identifier: MIT

%ifndef TRACE_INC
%define TRACE_INC

; The header at DX:BX, then TH_CAP records of TRACE_REC bytes. Records are only appended,
; and a full buffer keeps the earliest: a record below TH_COUNT never changes.
TH_COUNT        equ 0           ; dw records stored
TH_SEEN         equ 2           ; dw records offered, stored or not (wraps)
TH_CAP          equ 4           ; dw capacity
TH_RECSZ        equ 6           ; dw TRACE_REC
TH_SIZE         equ 8

TRACE_REC       equ 32
TR_SEQ          equ 0           ; dw RBS_TRAPPED: the game's byte OUTs so far
TR_TICK         equ 2           ; dw BIOS tick count, low word (0040:006C)
TR_PIT0         equ 4           ; dw PIT channel 0 count, latched
TR_BEFORE       equ 6           ; db real 61h before the write (kinds 1-3; else 0)
TR_AFTER        equ 7           ; db real 61h written (kinds 1-3; else 0)
TR_GAME         equ 8           ; db the game's own 61h
TR_MODE         equ 9           ; db interpreter mode (M_*)
TR_MASKED       equ 10          ; db `masked`
TR_KIND         equ 11          ; db TK_*
TR_DIVISOR      equ 12          ; dw RBS_DIVISOR
TR_CTX          equ 14          ; 8 x (db port low byte, db value): the game's last byte OUTs, oldest first
TR_FLAGS        equ 30          ; db RBS_FLAGS
TR_SPARE        equ 31          ; db 0

; Record kinds. 1-3 are speaker steps: a write to the real 61h that changes bit 1, or the
; gate while bit 1 is on. 4-5 are the OPL notes the game's writes start and stop.
TK_GAME61       equ 1           ; forwarding the game's 61h write
TK_GAMEPIT      equ 2           ; the game's 42h/43h write moved the mask
TK_REBEEP       equ 3           ; ReBeep itself: an apply, the hotkey, /OFF, /U
TK_NOTE_ON      equ 4
TK_NOTE_OFF     equ 5

%ifdef REBEEP_TRACE
TRACE_RECS      equ REBEEP_TRACE

%macro TRACE_SITE 1                     ; the kind a speaker step written next would get
        mov     byte [trace_site], %1
%endmacro
%macro TRACE_NOTE 0                     ; DL = port, AL = the byte the game writes
        call    trace_note
%endmacro
%macro TRACE_EVENT 0                    ; AL = interpreter event
        call    trace_event
%endmacro
%macro OUT_REAL_61 0                    ; DX = 61h, BL = byte; as qpi_out
        call    trace_out61
%endmacro

%else
%macro TRACE_SITE 1
%endmacro
%macro TRACE_NOTE 0
%endmacro
%macro TRACE_EVENT 0
%endmacro
%macro OUT_REAL_61 0
        call    qpi_out
%endmacro
%endif

%endif
