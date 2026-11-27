; T_RULES - a game profile's rules (engine/rules.asm): matching events against the steps, the
; first completed rule winning, the catch-all, and the patch switch through a recording sink
; in place of the OPL's ports.
; SPDX-License-Identifier: MIT

        cpu     8086
        org     100h

%include "speaker.inc"

%define OPL_TEST_SINK sink

        jmp     start

%include "engine/opl.asm"
%include "engine/rules.asm"
%include "testlib.inc"

; ---------------------------------------------------------------- tables

; RULE slot, flags, steps ... ENDRULE: one rule, its steps between them (STEP kind, lo, hi).
%if RL_STEPS != 0 || RL_SLOT != 1 || RL_FLAGS != 2 || RL_AT != 3 || RL_STEP != 4
%error RULE writes steps, slot, flags, at, then the steps
%endif
%if ST_KIND != 0 || ST_LO != 1 || ST_HI != 3
%error STEP writes kind, lo, hi
%endif
%macro RULE 3
%push rule
%$start:
        db      %3, %1, %2, 0
%endmacro
%macro STEP 3
        db      %1
        dw      %2, %3
%endmacro
%macro ENDRULE 0
        times RULE_LEN - ($ - %$start) db 0
%pop
%endmacro

; TABLE label, rules: a table's header, its rules to follow, then ENDTABLE and its blocks.
%if PT_LAYOUT != 0 || PT_ACTIVE != 1 || PT_CUR != 2 || PT_COUNT != 3 || PT_STATE != 4
%error TABLE writes layout, active, current, count, state, effects, effect slot, then the name
%endif
%if PT_FXCOUNT != 5 || PT_FXSLOT != 6 || PT_NAME != 7 || PT_RULES != PT_NAME + 9
%error TABLE writes layout, active, current, count, state, effects, effect slot, then the name
%endif
%macro TABLE 2
%push table
%1:
%$start:
        db      PROF_LAYOUT, 1, PT_NONE, %2, 0, 0, PT_NONE
        db      "TEST", 0, 0, 0, 0, 0
%endmacro
%macro BLOCKS 0
        times PT_BLOCKS - ($ - %$start) db 0
%endmacro
%macro ENDTABLE 0
        times PT_LEN - ($ - %$start) db 0
%pop
%endmacro

; A patch block: name, octave, flags, two-operator record, no four-operator one.
%macro BLOCK 3+
%%name: db      %1, 0
        times 18 - ($ - %%name) db 0
        db      4, %2
        db      %3
        times 22 db 0
%endmacro

; Grand Prix Circuit's: the intro, the menus, and a catch-all for any other song start.
TABLE   t_gpc, 3
        RULE    0, 0, 2
        STEP    SK_CTRL, 0B6h, 0B6h
        STEP    SK_NOTE, 1922h - 40, 1922h + 40
        ENDRULE
        RULE    1, 0, 2
        STEP    SK_CTRL, 0B6h, 0B6h
        STEP    SK_NOTE, 1521h - 40, 1521h + 40
        ENDRULE
        RULE    2, RL_F_ANY, 2
        STEP    SK_CTRL, 0B6h, 0B6h
        STEP    SK_NOTE | SK_ANY, 0, 0FFFFh
        ENDRULE
        BLOCKS
        BLOCK   "T\ORGAN", RBS_PF_LOADED, 22h, 21h, 18h, 08h, 0F0h, 0F0h, 0Ch, 0Ch, 00h, 00h, 01h
        BLOCK   "T\FLUTE", RBS_PF_LOADED, 21h, 21h, 28h, 00h, 0B0h, 0C0h, 0Ah, 0Ah, 00h, 00h, 00h
        BLOCK   "T\BELL", RBS_PF_LOADED, 23h, 21h, 20h, 00h, 0F0h, 0F4h, 2Ah, 2Ah, 00h, 00h, 00h
        BLOCK   "T\NONE", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
ENDTABLE

; One rule of each other kind, and two notes in a row.
TABLE   t_kinds, 3
        RULE    1, 0, 2
        STEP    SK_NOTE, 100, 100
        STEP    SK_NOTE, 200, 200
        ENDRULE
        RULE    2, 0, 1
        STEP    SK_PITCH, 290, 310
        ENDRULE
        RULE    3, RL_F_ANY, 1
        STEP    SK_OFF | SK_ANY, 0, 0FFFFh
        ENDRULE
        BLOCKS
ENDTABLE

; A race: GRID at its start, then RACE only while GRID is the last to have fired, at a tone
; (a note start or a pitch) and its stop; both play slot 0. WHILE = (the rule's number + 1) * 2:
; GRID is rule 0.
W_GRID          equ     (0 + 1) * 2
W_RACE          equ     (1 + 1) * 2
TABLE   t_while, 2
        RULE    0, 0, 2
        STEP    SK_CTRL, 0B6h, 0B6h
        STEP    SK_NOTE, 0C22Eh - 40, 0C22Eh + 40
        ENDRULE
        RULE    0, W_GRID, 2
        STEP    SK_TONE, 0471h - 30, 0471h + 30
        STEP    SK_OFF | SK_ANY, 0, 0FFFFh
        ENDRULE
        BLOCKS
        BLOCK   "T\ENGINE", RBS_PF_LOADED, 22h, 21h, 18h, 08h, 0F0h, 0F0h, 0Ch, 0Ch, 00h, 00h, 01h
ENDTABLE

; load_tbl: SI = a table image, copied over rules_tbl.
load_tbl:
        mov     di, rules_tbl
        mov     cx, PT_LEN
.copy:
        mov     al, [si]
        mov     [di], al
        inc     si
        inc     di
        loop    .copy
        ret

; ---------------------------------------------------------------- the sink

; sink: stands in for the ports, counting the writes while sink_on is set.
sink:
        cmp     byte [sink_on], 0
        je      .ret
        inc     word [sink_n]
.ret:
        ret

; sink_clear: count from 0, recording.
sink_clear:
        mov     word [sink_n], 0
        mov     byte [sink_on], 1
        ret

; ---------------------------------------------------------------- events and checks

%macro EVT 4                            ; event, divisor, port, the byte written
        mov     al, %1
        mov     bx, %2
        mov     dx, %3
        mov     cl, %4
        call    rules_match
%endmacro
%macro CTRLW 1
        EVT     EV_NONE, 0, PIT_CTRL, %1
%endmacro
%macro NOTE 1
        EVT     EV_TONE_ON, %1, SYS_CTRL, 03h
%endmacro
%macro PITCH 1
        EVT     EV_PITCH, %1, PIT_CH2, 12h
%endmacro
%macro OFF 0
        EVT     EV_TONE_OFF, 0, SYS_CTRL, 0
%endmacro

; cf_ax: AX = the carry flag.
cf_ax:
        mov     ax, 0
        adc     ax, 0
        ret

; NOFIRE: the event before completed no rule.
%macro NOFIRE 0
        call    cf_ax
        xor     cx, cx
        call    t_check
%endmacro

; FIRES rule, slot, flags: the event before completed that rule.
%macro FIRES 3
        mov     [got_ax], ax
        mov     [got_ch], ch
        call    cf_ax
        mov     cx, 1
        call    t_check
        mov     ax, [got_ax]
        mov     cx, (%2 << 8) | %1
        call    t_check
        mov     al, [got_ch]
        xor     ah, ah
        mov     cx, %3
        call    t_check
%endmacro

; SWITCH slot, CF wanted, voice wanted, block: rules_switch, then what it left.
%macro SWITCH 4
        mov     ah, %1
        call    rules_switch
        call    cf_ax
        mov     cx, %2
        call    t_check
        mov     al, [RB_STATE + RBS_VOICE]
        xor     ah, ah
        mov     cx, %3
        call    t_check
        mov     al, [rules_tbl + PT_CUR]
        mov     cx, %1
        call    t_check
        mov     si, rules_tbl + PT_BLOCKS + %4 * PBLK_LEN
        call    blk_in_state
        xor     cx, cx
        call    t_check
%endmacro

; blk_in_state: SI = a block. Out: AX = 0 when RB_STATE's patch block holds it.
blk_in_state:
        mov     di, RB_STATE + RBS_PATCH
        mov     cx, PBLK_LEN
.next:
        mov     al, [si]
        cmp     al, [di]
        jne     .bad
        inc     si
        inc     di
        loop    .next
        xor     ax, ax
        ret
.bad:
        mov     ax, 1
        ret

; Stack use: the area below SP is filled with a pattern; what a call leaves changed is its depth.
STK_AREA        equ     128
%macro STK_FILL 0
        mov     di, sp
        sub     di, STK_AREA
        mov     cx, STK_AREA / 2
%%fill:
        mov     word [di], 0A5A5h
        add     di, 2
        loop    %%fill
%endmacro
%macro STK_DEPTH 0                      ; Out: AX = the bytes below SP the call touched
        mov     di, sp
        sub     di, STK_AREA
%%scan:
        cmp     word [di], 0A5A5h
        jne     %%done
        add     di, 2
        jmp     %%scan
%%done:
        mov     ax, sp
        sub     ax, di
%endmacro

; PRESERVED: after a call with the sentinels below, every register but the outputs kept.
; In: the outputs' mask in [keep]: 1 AX, 2 CH. Out: AX = 0 when the others came back.
%macro SENTINELS 0
        mov     bx, 2222h
        mov     cx, 1111h
        mov     dx, 3333h
        mov     si, 4444h
        mov     di, 5555h
        mov     bp, 6666h
%endmacro
regs_kept:
        cmp     bx, 2222h
        jne     .bad
        cmp     cl, 11h
        jne     .bad
        test    byte [keep], 2
        jnz     .ch
        cmp     ch, 11h
        jne     .bad
.ch:
        cmp     dx, 3333h
        jne     .bad
        cmp     si, 4444h
        jne     .bad
        cmp     di, 5555h
        jne     .bad
        cmp     bp, 6666h
        jne     .bad
        xor     ax, ax
        ret
.bad:
        mov     ax, 1
        ret

; ---------------------------------------------------------------- the cases

start:
        mov     byte [sink_on], 0
        mov     al, 2
        call    opl_init                ; an OPL2, through the sink

        CASE    "inactive_profile_matches_nothing"
        mov     si, t_gpc
        call    load_tbl
        mov     byte [rules_tbl + PT_ACTIVE], 0
        CTRLW   0B6h
        NOFIRE
        NOTE    1936h
        NOFIRE
        mov     al, [rules_tbl + RL_AT + PT_RULES]
        xor     ah, ah
        xor     cx, cx
        call    t_check
        ENDCASE

        CASE    "intro_fires_on_its_first_note"
        mov     si, t_gpc
        call    load_tbl
        CTRLW   0B6h
        NOFIRE
        NOTE    1936h                   ; 20 counts high, as the game's first note plays
        FIRES   0, 0, 0
        ENDCASE

        CASE    "menu_fires_on_its_first_note"
        mov     si, t_gpc
        call    load_tbl
        CTRLW   0B6h
        NOTE    1535h
        FIRES   1, 1, 0
        ENDCASE

        CASE    "catch_all_fires_for_another_start"
        mov     si, t_gpc
        call    load_tbl
        CTRLW   0B6h
        NOTE    0C22Eh                  ; the race's idle
        FIRES   2, 2, RL_F_ANY
        ENDCASE

        CASE    "tolerance_ends"
        mov     si, t_gpc
        call    load_tbl
        CTRLW   0B6h
        NOTE    1922h - 40
        FIRES   0, 0, 0
        CTRLW   0B6h
        NOTE    1922h + 40
        FIRES   0, 0, 0
        CTRLW   0B6h
        NOTE    1922h + 41
        FIRES   2, 2, RL_F_ANY
        CTRLW   0B6h
        NOTE    1922h - 41
        FIRES   2, 2, RL_F_ANY
        ENDCASE

        CASE    "notes_without_the_control_word_match_nothing"
        mov     si, t_gpc
        call    load_tbl
        NOTE    1936h
        NOFIRE
        NOTE    1535h
        NOFIRE
        CTRLW   36h                     ; channel 0's control word
        NOTE    1936h
        NOFIRE
        ENDCASE

        CASE    "other_kinds_are_ignored_between_steps"
        mov     si, t_gpc
        call    load_tbl
        CTRLW   0B6h
        PITCH   1000h
        NOFIRE
        OFF
        NOFIRE
        CTRLW   36h
        NOFIRE
        EVT     EV_NONE, 0, PIT_CH2, 22h  ; half a count
        NOFIRE
        EVT     EV_NONE, 0, SYS_CTRL, 01h ; the gate alone
        NOFIRE
        NOTE    1922h
        FIRES   0, 0, 0
        ENDCASE

        CASE    "every_rule_starts_over_after_a_fire"
        mov     si, t_gpc
        call    load_tbl
        CTRLW   0B6h
        NOTE    1922h
        FIRES   0, 0, 0
        NOTE    1521h                   ; the menu rule saw the control word too
        NOFIRE
        NOTE    0C22Eh
        NOFIRE
        ENDCASE

        CASE    "a_wrong_value_restarts_the_rule_and_retests"
        mov     si, t_kinds
        call    load_tbl
        NOTE    100
        NOFIRE
        NOTE    150                     ; back to the first step, which 150 is not
        NOFIRE
        NOTE    200
        NOFIRE
        NOTE    100
        NOTE    100                     ; back to the first step, which this one starts again
        NOFIRE
        NOTE    200
        FIRES   0, 1, 0
        ENDCASE

        CASE    "pitch_and_off_rules"
        mov     si, t_kinds
        call    load_tbl
        PITCH   289
        NOFIRE
        PITCH   311
        NOFIRE
        PITCH   290
        FIRES   1, 2, 0
        PITCH   310
        FIRES   1, 2, 0
        OFF
        FIRES   2, 3, RL_F_ANY
        ENDCASE

        CASE    "while_holds_a_rule_until_its_rule_fires"
        mov     si, t_while
        call    load_tbl
        NOTE    0471h                   ; RACE's steps, before GRID: nothing
        NOFIRE
        OFF
        NOFIRE
        CTRLW   0B6h
        NOTE    0C22Eh
        FIRES   0, 0, 0
        mov     al, [rules_tbl + PT_STATE]
        xor     ah, ah
        mov     cx, W_GRID
        call    t_check
        NOTE    0471h
        NOFIRE
        OFF
        FIRES   1, 0, W_GRID
        mov     al, [rules_tbl + PT_STATE] ; set although the slot stays: rules_switch does not
        xor     ah, ah
        mov     cx, W_RACE
        call    t_check
        NOTE    0471h                   ; RACE is the state now, not GRID
        NOFIRE
        OFF
        NOFIRE
        ENDCASE

        CASE    "a_tone_step_takes_a_pitch_too_but_no_stop"
        mov     si, t_while
        call    load_tbl
        CTRLW   0B6h
        NOTE    0C22Eh
        FIRES   0, 0, 0
        OFF                             ; another kind than TONE: RACE stays at its first step
        NOFIRE
        PITCH   0471h                   ; the green light, as the engine's note changes to it
        NOFIRE
        PITCH   2828h                   ; another kind than OFF: kept
        NOFIRE
        OFF
        FIRES   1, 0, W_GRID
        ENDCASE

        CASE    "a_rule_left_out_by_its_while_does_not_move"
        mov     si, t_while
        call    load_tbl
        NOTE    0471h
        mov     al, [rules_tbl + PT_RULES + RULE_LEN + RL_AT]
        xor     ah, ah
        xor     cx, cx
        call    t_check
        ENDCASE

        CASE    "match_keeps_registers"
        mov     si, t_gpc
        call    load_tbl
        mov     byte [keep], 0
        SENTINELS
        mov     ax, (M_TONE << 8) | EV_TONE_ON
        mov     bx, 1922h
        mov     dx, SYS_CTRL
        call    rules_match             ; no control word first: no fire
        cmp     ax, (M_TONE << 8) | EV_TONE_ON
        jne     .mkbad
        cmp     bx, 1922h
        jne     .mkbad
        cmp     dx, SYS_CTRL
        jne     .mkbad
        mov     bx, 2222h
        mov     dx, 3333h
        call    regs_kept
        jmp     .mkcheck
.mkbad:
        mov     ax, 1
.mkcheck:
        xor     cx, cx
        call    t_check
        mov     byte [keep], 2
        CTRLW   0B6h
        SENTINELS
        mov     al, EV_TONE_ON
        mov     bx, 1922h
        mov     dx, SYS_CTRL
        call    rules_match             ; a fire: AX and CH are outputs
        cmp     bx, 1922h
        jne     .mkbad2
        cmp     dx, SYS_CTRL
        jne     .mkbad2
        mov     bx, 2222h
        mov     dx, 3333h
        call    regs_kept
        jmp     .mkcheck2
.mkbad2:
        mov     ax, 1
.mkcheck2:
        xor     cx, cx
        call    t_check
        ENDCASE

        CASE    "switch_plays_the_slot"
        mov     si, t_gpc
        call    load_tbl
        mov     byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS | RBS_F_TRANSLATE
        call    sink_clear
        SWITCH  0, 1, 1, 0
        mov     ax, [sink_n]
        or      ax, ax
        jz      .silent
        mov     ax, 1
.silent:
        mov     cx, 1                   ; the OPL took the voice
        call    t_check
        ENDCASE

        CASE    "switch_to_the_same_slot_writes_nothing"
        call    sink_clear
        mov     ah, 0
        call    rules_switch
        call    cf_ax
        xor     cx, cx
        call    t_check
        mov     ax, [sink_n]
        xor     cx, cx
        call    t_check
        ENDCASE

        CASE    "switch_to_a_failed_patch_plays_the_faithful_voice"
        call    sink_clear
        SWITCH  3, 1, 0, 3
        ENDCASE

        CASE    "switch_with_the_traps_off_changes_only_the_state"
        mov     byte [RB_STATE + RBS_FLAGS], RBS_F_TRANSLATE
        call    sink_clear
        SWITCH  1, 1, 1, 1
        mov     ax, [sink_n]
        xor     cx, cx
        call    t_check
        ENDCASE

        CASE    "switch_copies_with_the_direction_flag_set"
        mov     si, t_gpc
        call    load_tbl
        std                             ; the game's DF, as the trap may find it
        mov     ah, 2
        call    rules_switch
        cld
        mov     si, rules_tbl + PT_BLOCKS + 2 * PBLK_LEN
        call    blk_in_state
        xor     cx, cx
        call    t_check
        ENDCASE

        CASE    "switch_keeps_registers"
        mov     si, t_gpc
        call    load_tbl
        mov     byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS | RBS_F_TRANSLATE
        mov     byte [keep], 0
        SENTINELS
        mov     ax, 0177h
        call    rules_switch
        cmp     ax, 0177h
        jne     .skbad
        call    regs_kept
        jmp     .skcheck
.skbad:
        mov     ax, 1
.skcheck:
        xor     cx, cx
        call    t_check
        ENDCASE

        CASE    "stack_depth"
        mov     si, t_gpc
        call    load_tbl
        mov     byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS | RBS_F_TRANSLATE
        CTRLW   0B6h
        STK_FILL
        mov     al, EV_TONE_ON
        mov     bx, 1922h
        mov     dx, SYS_CTRL
        call    rules_match
        STK_DEPTH
        mov     [deep], ax
        STK_FILL
        mov     ah, 1
        call    rules_switch            ; the deepest path: on into opl_set_voice
        STK_DEPTH
        cmp     ax, [deep]
        jbe     .shallower
        mov     [deep], ax
.shallower:
        mov     dx, s_stack
        call    t_print
        mov     ax, [deep]
        call    t_printdec
        mov     dx, s_crlf
        call    t_print
        mov     ax, [deep]
        cmp     ax, 40
        jbe     .fits
        mov     ax, 1
        jmp     .depth
.fits:
        xor     ax, ax
.depth:
        xor     cx, cx
        call    t_check
        ENDCASE

        jmp     t_done

s_stack         db      "INFO stack bytes, deepest call: $"

; What rules.asm reads of the resident state.
RB_STATE        times RBS_REC4 + 22 db 0

sink_on         db      0
sink_n          dw      0
got_ax          dw      0
got_ch          db      0
keep            db      0
deep            dw      0
