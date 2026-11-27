; Game profiles: the rules that pick a patch from what a game sends the speaker. A rule is up to
; four steps, each "the next event of this kind", with an optional value range; when the last
; step matches, the rule's patch plays and holds until another rule picks a different one.
; Rules are tested in order and the first to complete wins. They go by the order of events
; alone, never by time: games reprogram the timer, so ReBeep has no clock to trust.
; The table (include/profile.inc) is this module's state; the startup part fills it.
; Near calls; DS = this module's segment, which also holds RB_STATE. Every routine preserves
; all registers except its outputs, and flags. No string instructions: DF is the game's.
; SPDX-License-Identifier: MIT

        cpu     8086
%include "speaker.inc"
%include "amis.inc"
%include "profile.inc"

%if SK_NOTE != EV_TONE_ON || SK_PITCH != EV_PITCH || EV_TONE_OFF != 3 || SK_TONE != (SK_NOTE | SK_PITCH)
%error an event's kind is the interpreter's event for a note start or a pitch, SK_OFF for an off
%endif
%if STEP_LEN != 5
%error step_at multiplies by 5
%endif

; rules_match: one event against the rules, while a profile is on.
; In:  AL = the interpreter's event, BX = divisor, DX = port, CL = the byte the game wrote
;      (a byte to 43h is a control word; any other port's event is a note's)
; Out: CF clear: no rule completed, and only the rules' steps moved. CF set: AL = the rule that
;      completed, AH = its slot, CH = its RL_FLAGS, and every rule is back at its first step.
rules_match:
        cmp     byte [rules_tbl + PT_ACTIVE], 0
        je      .ret                    ; CF clear from the compare
        push    bx
        push    dx
        push    si
        cmp     dx, PIT_CTRL
        jne     .note
        mov     dl, SK_CTRL
        mov     bl, cl
        xor     bh, bh
        jmp     .rules
.note:
        mov     dl, al
        or      al, al
        jz      .none                   ; EV_NONE: a count byte half written, or a step held
        cmp     al, EV_TONE_OFF
        ja      .none
        jb      .rules
        mov     dl, SK_OFF
.rules:                                 ; DL = the event's kind, one bit, BX = its value
        mov     si, rules_tbl + PT_RULES
        xor     dh, dh                  ; DH = the rule's number
.rule:
        cmp     dh, [rules_tbl + PT_COUNT]
        jae     .none
        call    rule_step
        jc      .fire
        add     si, RULE_LEN
        inc     dh
        jmp     .rule
.fire:
        mov     al, dh
        mov     ah, [si + RL_SLOT]
        mov     ch, [si + RL_FLAGS]
        inc     dh                      ; the state, as a WHILE holds it: (rule + 1) * 2
        shl     dh, 1
        mov     [rules_tbl + PT_STATE], dh ; here, not in rules_switch: the slot may not change
        call    rules_reset
        stc
        jmp     .out
.none:
        clc
.out:
        pop     si
        pop     dx
        pop     bx
.ret:
        ret

; rule_step: In: SI = a rule, DL = the event's kind, BX = its value. A rule whose WHILE does not
; hold, or an event of another kind than its next step, leaves it; one of that kind moves it on
; when the value fits, and otherwise sends it back to its first step, which the same event may
; start again. A WHILE changes only when a rule fires, which sends every rule back to its first
; step, so a rule left out by its WHILE is never half matched.
; Out: CF set when the rule has completed.
rule_step:
        push    ax
        push    di
        mov     al, [si + RL_FLAGS]
        and     al, RL_F_WHILE
        jz      .on
        cmp     al, [rules_tbl + PT_STATE]
        jne     .keep
.on:
        mov     al, [si + RL_AT]
        call    step_at
        call    step_test
        or      ah, ah
        jz      .keep                   ; another kind
        dec     ah
        jz      .next
        or      al, al
        jz      .keep                   ; already at the first step
        xor     al, al
        mov     [si + RL_AT], al
        lea     di, [si + RL_STEP]
        call    step_test
        dec     ah
        jnz     .keep
.next:
        inc     al
        cmp     al, [si + RL_STEPS]
        jae     .done
        mov     [si + RL_AT], al
.keep:
        clc
        jmp     .out
.done:
        stc
.out:
        pop     di
        pop     ax
        ret

; step_at: In: SI = a rule, AL = a step's number. Out: DI = the step.
step_at:
        push    ax
        xor     ah, ah
        mov     di, ax
        shl     di, 1
        shl     di, 1
        add     di, ax
        add     di, si
        add     di, RL_STEP
        pop     ax
        ret

; step_test: In: DI = a step, DL = the event's kind, BX = its value.
; Out: AH = 0 another kind, 1 it matches, 2 it does not.
step_test:
        mov     ah, [di + ST_KIND]
        and     ah, 0FFh ^ SK_ANY
        test    ah, dl                  ; the step's kinds hold the event's
        jz      .other
        test    byte [di + ST_KIND], SK_ANY
        jnz     .match
        cmp     bx, [di + ST_LO]
        jb      .miss
        cmp     bx, [di + ST_HI]
        ja      .miss
.match:
        mov     ah, 1
        ret
.miss:
        mov     ah, 2
        ret
.other:
        xor     ah, ah
        ret

; rules_reset: every rule back at its first step.
rules_reset:
        push    cx
        push    si
        mov     si, rules_tbl + PT_RULES + RL_AT
        mov     cx, PROF_RULES
.next:
        mov     byte [si], 0
        add     si, RULE_LEN
        loop    .next
        pop     si
        pop     cx
        ret

; rules_switch: play the patch of slot AH, unless that slot is the one playing. Its block goes
; into RB_STATE, so the status, the hotkey and AMIS apply all see it, with the patch voice, or the
; faithful voice when the slot's patch could not be loaded. With the traps on the OPL takes the
; voice at once; with them off only RB_STATE changes. Runs with interrupts off.
; Out: CF set when the patch changed: a tone that is sounding still has the old voice's pitch
; and key, which the caller restarts.
rules_switch:
        cmp     ah, [rules_tbl + PT_CUR]
        je      .ret                    ; CF clear from the compare
        push    ax
        push    cx
        push    si
        push    di
        mov     [rules_tbl + PT_CUR], ah
        mov     al, PBLK_LEN
        mul     ah
        mov     si, ax
        add     si, rules_tbl + PT_BLOCKS
        mov     di, RB_STATE + RBS_PATCH
        mov     cx, PBLK_LEN
.copy:
        mov     al, [si]
        mov     [di], al
        inc     si
        inc     di
        loop    .copy
        xor     al, al
        test    byte [RB_STATE + RBS_PFLAGS], RBS_PF_LOADED
        jz      .voice
        inc     al
.voice:
        mov     [RB_STATE + RBS_VOICE], al
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS
        jz      .done
        mov     si, RB_STATE + RBS_PATCH
        call    opl_set_voice
.done:
        pop     di
        pop     si
        pop     cx
        pop     ax
        stc
.ret:
        ret

; The table, as a fresh load leaves it: no profile.
rules_tbl:
        db      PROF_LAYOUT             ; PT_LAYOUT
        db      0                       ; PT_ACTIVE
        db      PT_NONE                 ; PT_CUR
        db      0                       ; PT_COUNT
        db      0                       ; PT_STATE
        db      0                       ; PT_FXCOUNT
        db      PT_NONE                 ; PT_FXSLOT
        times PT_LEN - PT_NAME db 0
%if $ - rules_tbl != PT_LEN
%error rules_tbl does not match profile.inc
%endif
