; A game profile as ReBeep holds it: the table rules.asm matches against, which AMIS 16h returns
; at DX:BX and the startup part fills from a profile file (.RBG). The limits are fixed: the
; table is resident at its full size from the first load, so a profile loaded later always fits.
; SPDX-License-Identifier: MIT

%ifndef PROFILE_INC
%define PROFILE_INC

%include "amis.inc"

PROF_LAYOUT     equ 1           ; bump on any change below: the change path checks it
PROF_RULES      equ 16          ; the limits a profile file must keep
PROF_STEPS      equ 4
PROF_PATCHES    equ 8
PROF_NAME_LEN   equ 9           ; ASCIZ, 8 characters at most

; A step: the next event of one kind, with an optional value range.
ST_KIND         equ 0           ; db SK_*, or SK_ANY with it: any value
ST_LO           equ 1           ; dw the lowest value that matches
ST_HI           equ 3           ; dw the highest
STEP_LEN        equ 5

SK_NOTE         equ 1           ; a note starts; value: its divisor (EV_TONE_ON)
SK_PITCH        equ 2           ; a sounding note changes pitch; value: the new divisor (EV_PITCH)
SK_OFF          equ 3           ; a note stops; no value (EV_TONE_OFF)
SK_CTRL         equ 4           ; a byte written to 43h, the timer's control word; value: the byte
SK_ANY          equ 80h

; A rule: up to PROF_STEPS steps in order, then the patch slot it picks.
RL_STEPS        equ 0           ; db 1..PROF_STEPS
RL_SLOT         equ 1           ; db 0..PROF_PATCHES - 1
RL_FLAGS        equ 2           ; db RL_F_*
RL_AT           equ 3           ; db the steps matched so far: the step the next event is tested on
RL_STEP         equ 4           ; PROF_STEPS steps
RULE_LEN        equ RL_STEP + PROF_STEPS * STEP_LEN
RL_F_ANY        equ 01h         ; the last step takes any value: a catch-all, logged as a fallback

; The table.
PT_LAYOUT       equ 0           ; db PROF_LAYOUT
PT_ACTIVE       equ 1           ; db 1 while a profile is on: /G: sets it, /P: and /F clear it
PT_CUR          equ 2           ; db the slot playing, or PT_NONE
PT_COUNT        equ 3           ; db rules in use
PT_NAME         equ 4           ; db PROF_NAME_LEN: the profile's name, ASCIZ
PT_RULES        equ PT_NAME + PROF_NAME_LEN
PT_BLOCKS       equ PT_RULES + PROF_RULES * RULE_LEN    ; PROF_PATCHES patch blocks (amis.inc)
PT_LEN          equ PT_BLOCKS + PROF_PATCHES * PBLK_LEN
PT_NONE         equ 0FFh

%endif
