; A game profile as ReBeep holds it: the table rules.asm matches against, which AMIS 16h returns
; at DX:BX and the startup part fills from a profile file (.RBG). The limits are fixed: the
; table is resident at its full size from the first load, so a profile loaded later always fits.
; SPDX-License-Identifier: MIT

%ifndef PROFILE_INC
%define PROFILE_INC

%include "amis.inc"

PROF_LAYOUT     equ 3           ; bump on any change below: the change path checks it
PROF_RULES      equ 16          ; the limits a profile file must keep
PROF_STEPS      equ 4
PROF_PATCHES    equ 8
PROF_EFFECTS    equ 8
PROF_NAME_LEN   equ 9           ; a patch's or a rule's name, ASCIZ, 8 characters at most
PROF_SPEC_LEN   equ 18          ; a profile's FOLDER\NAME, ASCIZ, 17 characters at most

; A step: the next event of one kind, with an optional value range.
ST_KIND         equ 0           ; db SK_*, or SK_ANY with it: any value
ST_LO           equ 1           ; dw the lowest value that matches
ST_HI           equ 3           ; dw the highest
STEP_LEN        equ 5

; Kinds are bits: an event has one, a step one or (PITCH) two, and they match when they share one.
SK_NOTE         equ 1           ; a note starts; value: its divisor (EV_TONE_ON)
SK_CHANGE       equ 2           ; a sounding note changes pitch; value: the new divisor (EV_PITCH)
SK_PITCH        equ 3           ; either: a note starts, or a sounding note changes pitch
SK_OFF          equ 4           ; a note stops; no value (EV_TONE_OFF)
SK_CTRL         equ 8           ; a byte written to 43h, the timer's control word; value: the byte
SK_ANY          equ 80h

; A rule: up to PROF_STEPS steps in order, then the patch slot it picks.
RL_STEPS        equ 0           ; db 1..PROF_STEPS
RL_SLOT         equ 1           ; db 0..PROF_PATCHES - 1
RL_FLAGS        equ 2           ; db RL_F_ANY | its WHILE (RL_F_WHILE)
RL_AT           equ 3           ; db the steps matched so far: the step the next event is tested on
RL_STEP         equ 4           ; PROF_STEPS steps
RULE_LEN        equ RL_STEP + PROF_STEPS * STEP_LEN
RL_F_ANY        equ 01h         ; the last step takes any value: a catch-all, logged as a fallback
; A WHILE: the rule (or effect) counts only while the rule it names is the last to have fired.
; Held as (that rule's number + 1) * 2, so 0 is none and it sits in RL_FLAGS above RL_F_ANY;
; PT_STATE holds the last rule to fire the same way, so the two compare as they are.
RL_F_WHILE      equ 3Eh
%if (PROF_RULES * 2) > RL_F_WHILE
%error a WHILE needs more than RL_FLAGS' bits 1-5
%endif

; An effect: a tone in its range, while its WHILE holds, plays its patch on the effect channel.
EF_LO           equ 0           ; dw the lowest divisor that matches, DIV_MIN at least
EF_HI           equ 2           ; dw the highest
EF_SLOT         equ 4           ; db its patch's slot, one whose patch loaded
EF_WHILE        equ 5           ; db its WHILE, as RL_F_WHILE holds it, or 0
EFFECT_LEN      equ 6

; The table.
PT_LAYOUT       equ 0           ; db PROF_LAYOUT
PT_ACTIVE       equ 1           ; db 1 while a profile is on: /G: sets it, /P: and /F clear it
PT_CUR          equ 2           ; db the slot playing, or PT_NONE
PT_COUNT        equ 3           ; db rules in use
PT_STATE        equ 4           ; db the last rule to fire, as RL_F_WHILE holds it; 0: none yet
PT_FXCOUNT      equ 5           ; db effects in use; /P: and /F clear it with PT_ACTIVE
PT_FXSLOT       equ 6           ; db the slot the effect channel is programmed with, or PT_NONE
PT_NAME         equ 7           ; db PROF_SPEC_LEN: the profile as /G: names it (GPC, or USER\GPC2), ASCIZ
PT_RULES        equ PT_NAME + PROF_SPEC_LEN
PT_EFFECTS      equ PT_RULES + PROF_RULES * RULE_LEN    ; PROF_EFFECTS effects
PT_BLOCKS       equ PT_EFFECTS + PROF_EFFECTS * EFFECT_LEN ; PROF_PATCHES patch blocks (amis.inc)
PT_LEN          equ PT_BLOCKS + PROF_PATCHES * PBLK_LEN
PT_NONE         equ 0FFh

%endif
