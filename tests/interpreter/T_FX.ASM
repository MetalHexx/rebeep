; T_FX - a game profile's effects (engine/fx.asm): the effect voice taking a tone in an
; effect's range from the main voice and giving it back, 2-op on channel 6 and, on an OPL3,
; 4-op on bank 1's pair 2+5, through the recording sink in place of the OPL's ports.
; SPDX-License-Identifier: MIT

        cpu     8086
        org     100h

%include "speaker.inc"

%define OPL_TEST_SINK sink
SINK_MAX        equ 512

        jmp     start

%include "engine/opl.asm"
%include "engine/rules.asm"
%include "engine/fx.asm"
%include "testlib.inc"
%include "oplsink.inc"

; ---------------------------------------------------------------- the table

%if PT_LAYOUT != 0 || PT_ACTIVE != 1 || PT_CUR != 2 || PT_COUNT != 3 || PT_STATE != 4
%error TABLE writes layout, active, current, count, state, effects, effect slot, then the name
%endif
%if PT_FXCOUNT != 5 || PT_FXSLOT != 6 || PT_NAME != 7
%error TABLE writes layout, active, current, count, state, effects, effect slot, then the name
%endif
%if EF_LO != 0 || EF_HI != 2 || EF_SLOT != 4 || EF_WHILE != 5
%error EFFECT writes lo, hi, slot, while
%endif
%macro TABLE 3                          ; label, rules, effects
%push table
%1:
%$start:
        db      PROF_LAYOUT, 1, PT_NONE, %2, 0, %3, PT_NONE
        db      "TEST", 0, 0, 0, 0, 0
%endmacro
%macro RULE 3                           ; slot, flags, steps
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
%macro EFFECTS 0
        times PT_EFFECTS - ($ - %$start) db 0
%endmacro
%macro EFFECT 4                         ; lo, hi, slot, while
        dw      %1, %2
        db      %3, %4
%endmacro
%macro BLOCKS 0
        times PT_BLOCKS - ($ - %$start) db 0
%endmacro
%macro ENDTABLE 0
        times PT_LEN - ($ - %$start) db 0
%pop
%endmacro

; A patch block: name, octave, flags, two-operator record, four-operator record.
%macro BLOCK 3+
%%name: db      %1, 0
        times 18 - ($ - %%name) db 0
        db      4, %2
        db      %3
%endmacro
%define REC4_NONE times 22 db 0
%define OPS4 22h, 21h, 23h, 20h, 18h, 48h, 14h, 0CCh, 0F0h, 0F1h, 0F2h, 0F3h, 05h, 06h, 07h, 08h, 00h, 01h, 02h, 03h

W_GRID          equ     (0 + 1) * 2
D_ENGINE        equ     1000h           ; an engine count, in no effect
D_RED           equ     11D6h           ; effect 0: the lights, while GRID
D_GREEN         equ     0471h           ; effect 1: the same patch, no WHILE
D_SQUEAL        equ     0950h           ; effect 2: a four-operator patch
LIGHTS_CAR_TL   equ     04h

TABLE   t_fx, 1, 3
        RULE    0, 0, 2
        STEP    SK_CTRL, 0B6h, 0B6h
        STEP    SK_NOTE, 0C22Eh - 40, 0C22Eh + 40
        ENDRULE
        EFFECTS
        EFFECT  D_RED - 40, D_RED + 40, 1, W_GRID
        EFFECT  D_GREEN - 30, D_GREEN + 30, 1, 0
        EFFECT  D_SQUEAL - 50, D_SQUEAL + 50, 2, 0
        BLOCKS
blk_engine:
        BLOCK   "T\ENGINE", RBS_PF_LOADED, 22h, 21h, 18h, 08h, 0F0h, 0F0h, 0Ch, 0Ch, 00h, 00h, 01h
        REC4_NONE
        BLOCK   "T\LIGHTS", RBS_PF_LOADED, 21h, 21h, 28h, LIGHTS_CAR_TL, 0B0h, 0C0h, 0Ah, 0Ah, 00h, 00h, 00h
        REC4_NONE
        BLOCK   "T\SQUEAL", RBS_PF_LOADED | RBS_PF_4OP, 23h, 21h, 20h, 00h, 0F0h, 0F4h, 2Ah, 2Ah, 00h, 00h, 06h
        db      OPS4, 0Ah, 00h
blk_main4:
        BLOCK   "T\MAIN4", RBS_PF_LOADED | RBS_PF_4OP, 23h, 21h, 20h, 00h, 0F0h, 0F4h, 2Ah, 2Ah, 00h, 00h, 00h
        db      OPS4, 0Bh, 01h
ENDTABLE

; ---------------------------------------------------------------- helpers

; setup: AL = the chip (2 or 3), AH = the main voice: 0 the engine, 1 the 4-op patch. The
; table loaded with GRID fired, the main voice a patch, the volume 15, the log on and empty.
setup:
        push    ax
        mov     si, t_fx
        mov     di, rules_tbl
        mov     cx, PT_LEN
.copy:
        mov     al, [si]
        mov     [di], al
        inc     si
        inc     di
        loop    .copy
        mov     byte [rules_tbl + PT_STATE], W_GRID
        mov     byte [RB_STATE + RBS_VOICE], 1
        mov     byte [sink_on], 1
        pop     ax
        push    ax
        mov     byte [opl_104], 0       ; as opl_shutdown leaves it
        call    fx_init
        mov     byte [rules_tbl + PT_FXSLOT], PT_NONE ; as rb_set_voice leaves it
        pop     ax
        mov     si, blk_engine
        or      ah, ah
        jz      .voice
        mov     si, blk_main4
.voice:
        mov     al, 1
        call    opl_set_voice
        mov     al, 15
        call    opl_set_volume
        SINK_CLEAR
        ret

; ev: AL = event, BX = divisor, through fx_play.
%macro EV 2
        mov     al, %1
        mov     bx, %2
        call    fx_play
%endmacro

; key_offs: BX = a B0h register. Out: AX = the writes to it with the key bit clear.
key_offs:
        push    si
        xor     ax, ax
        xor     si, si
.scan:
        cmp     si, [sink_n]
        jae     .done
        cmp     [sink_buf + si], bx
        jne     .next
        test    byte [sink_buf + si + 2], KEY_ON
        jnz     .next
        inc     ax
.next:
        add     si, 4
        jmp     .scan
.done:
        pop     si
        ret

; KEYOFFS reg, n: that many key-off writes to reg since the log was cleared.
%macro KEYOFFS 2
        mov     bx, %1
        call    key_offs
        mov     cx, %2
        call    t_check
%endmacro

; FXKEYED n: the effect voice's key flag.
%macro FXKEYED 1
        mov     al, [opl_fx_keyed]
        xor     ah, ah
        mov     cx, %1
        call    t_check
%endmacro

; MAINCTX: the main voice is the current one (one twin channel, no difference).
%macro MAINCTX 0
        mov     al, [opl_dup]
        mov     ah, [opl_d2]
        mov     cx, 0001h
        call    t_check
%endmacro

STK_AREA        equ     128
%macro STK_FILL 0
        cld
        mov     di, sp
        sub     di, STK_AREA
        mov     cx, STK_AREA / 2
        mov     ax, 0A5A5h
        rep stosw
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
FX_STACK_MAX    equ     22              ; opl.asm's 16, and fx.asm's 6 on top

; FXPRES ax, bx, si, routine: call it with those and sentinels in the rest; every register,
; AX whole, must come back.
%macro FXPRES 4
        mov     ax, %1
        mov     bx, %2
        mov     cx, 1111h
        mov     dx, 3333h
        mov     si, %3
        mov     di, 5555h
        mov     bp, 6666h
        call    %4
        cmp     ax, %1
        jne     %%bad
        cmp     bx, %2
        jne     %%bad
        cmp     cx, 1111h
        jne     %%bad
        cmp     dx, 3333h
        jne     %%bad
        cmp     si, %3
        jne     %%bad
        cmp     di, 5555h
        jne     %%bad
        cmp     bp, 6666h
        jne     %%bad
        xor     ax, ax
        jmp     %%check
%%bad:
        mov     ax, 1
%%check:
        xor     cx, cx
        call    t_check
%endmacro

; The registers fx.asm's calls may write while the main voice is silent: the effect voice's,
; and the main voice's key registers (it gives way, and fx_quiet keys it off). Channel 6's
; operators are slots 10h (modulator) and 13h (carrier); pair 2+5's are bank 1's 02h, 05h,
; 0Ah and 0Dh.
%macro OPS6 1
        dw      %1 + 10h, %1 + 13h
%endmacro
%macro OPS25 1
        dw      100h + %1 + 02h, 100h + %1 + 05h, 100h + %1 + 0Ah, 100h + %1 + 0Dh
%endmacro
ok_fx2          dw      0A6h, 0B6h, 0C6h, 0B7h, 0B8h
                OPS6    20h
                OPS6    40h
                OPS6    60h
                OPS6    80h
                OPS6    0E0h
OK_FX2_N        equ     ($ - ok_fx2) / 2
ok_fx3          dw      0A6h, 0B6h, 0C6h, 1B0h, 1B1h, 104h, 1A2h, 1B2h, 1C2h, 1C5h
                OPS6    20h
                OPS6    40h
                OPS6    60h
                OPS6    80h
                OPS6    0E0h
                OPS25   20h
                OPS25   40h
                OPS25   60h
                OPS25   80h
                OPS25   0E0h
OK_FX3_N        equ     ($ - ok_fx3) / 2

; ---------------------------------------------------------------- the cases

start:
        CASE    "an_effect_takes_the_tone_from_the_main_voice"
        mov     ax, 2
        call    setup
        EV      EV_TONE_ON, D_ENGINE
        LASTWM  0B8h, KEY_ON, KEY_ON    ; the first note takes channel 8
        SINK_CLEAR
        EV      EV_PITCH, D_RED
        LASTWM  0B8h, KEY_ON, 0         ; the main voice gives way
        LASTWM  0B6h, KEY_ON, KEY_ON    ; channel 6 sounds
        WROTE   0C6h                    ; programmed with the lights' patch
        LASTWM  53h, 3Fh, LIGHTS_CAR_TL ; channel 6's carrier, at volume 15
        LASTW   0C7h, 0FFFFh            ; the main voice's channels keep their patch
        LASTW   0C8h, 0FFFFh
        BEFORE  0B8h, 0B6h
        FXKEYED 1
        mov     al, [rules_tbl + PT_FXSLOT]
        xor     ah, ah
        mov     cx, 1
        call    t_check
        MAINCTX
        ENDCASE

        CASE    "the_same_slot_glides"
        SINK_CLEAR
        EV      EV_PITCH, D_GREEN       ; effect 1, the lights' slot too
        KEYOFFS 0B6h, 0
        WROTE   0A6h
        LASTWM  0B6h, KEY_ON, KEY_ON
        LASTW   0C6h, 0FFFFh            ; not programmed again
        MAINCTX
        ENDCASE

        CASE    "a_tone_in_no_effect_goes_back_to_the_main_voice"
        SINK_CLEAR
        EV      EV_PITCH, D_ENGINE
        LASTWM  0B6h, KEY_ON, 0
        LASTWM  0B7h, KEY_ON, KEY_ON    ; the next note takes the other channel
        BEFORE  0B6h, 0B7h
        FXKEYED 0
        MAINCTX
        ENDCASE

        CASE    "a_tone_off_keys_the_effect_off"
        EV      EV_PITCH, D_RED
        SINK_CLEAR
        EV      EV_TONE_OFF, 0
        LASTWM  0B6h, KEY_ON, 0
        LASTWM  0B7h, KEY_ON, 0         ; fx_quiet: the main voice's last channel, already off
        FXKEYED 0
        ENDCASE

        CASE    "a_note_start_in_an_effect_plays_the_effect"
        SINK_CLEAR
        EV      EV_TONE_ON, D_RED       ; the start lights come after a rest
        LASTWM  0B6h, KEY_ON, KEY_ON
        LASTW   0C6h, 0FFFFh            ; its patch is still loaded
        FXKEYED 1
        MAINCTX
        ENDCASE

        CASE    "another_slot_keys_off_then_programs"
        SINK_CLEAR
        EV      EV_PITCH, D_SQUEAL      ; a four-operator patch: its 2-op record on an OPL2
        KEYOFFS 0B6h, 2                 ; before the program, then opl_note_on's own
        BEFORE  0B6h, 0C6h
        LASTWM  0B6h, KEY_ON, KEY_ON
        LASTW   0C6h, 06h
        LASTW   104h, 0FFFFh
        LASTW   1B2h, 0FFFFh
        mov     al, [rules_tbl + PT_FXSLOT]
        xor     ah, ah
        mov     cx, 2
        call    t_check
        MAINCTX
        ENDCASE

        CASE    "fx_shutdown_silences_both_voices"
        SINK_CLEAR
        call    fx_shutdown
        LASTWM  0B6h, KEY_ON, 0
        LASTWM  0B7h, KEY_ON, 0
        LASTWM  0B8h, KEY_ON, 0
        LASTWM  53h, 3Fh, 3Fh           ; the effect voice's carrier
        LASTWM  55h, 3Fh, 3Fh           ; the main voice's, channel 8
        MAINCTX
        ENDCASE

        CASE    "while_gates_an_effect"
        mov     ax, 2
        call    setup
        mov     byte [rules_tbl + PT_STATE], 0
        EV      EV_TONE_ON, D_RED       ; the lights' range, but GRID has not fired
        LASTW   0B6h, 0FFFFh
        FXKEYED 0
        EV      EV_TONE_OFF, 0
        mov     byte [rules_tbl + PT_STATE], W_GRID
        SINK_CLEAR
        EV      EV_TONE_ON, D_RED
        LASTWM  0B6h, KEY_ON, KEY_ON
        EV      EV_TONE_OFF, 0
        ENDCASE

        CASE    "the_faithful_voice_plays_no_effect"
        mov     ax, 2
        call    setup
        mov     byte [RB_STATE + RBS_VOICE], 0
        EV      EV_TONE_ON, D_GREEN
        LASTW   0B6h, 0FFFFh
        LASTWM  0B8h, KEY_ON, KEY_ON
        FXKEYED 0
        ENDCASE

        CASE    "no_effect_without_the_count"
        mov     ax, 2
        call    setup
        mov     byte [rules_tbl + PT_FXCOUNT], 0 ; as /P: and /F leave it
        EV      EV_TONE_ON, D_GREEN
        LASTW   0B6h, 0FFFFh
        FXKEYED 0
        ENDCASE

        CASE    "a_new_volume_reaches_the_effect"
        mov     ax, 2
        call    setup
        EV      EV_TONE_ON, D_GREEN
        EV      EV_TONE_OFF, 0
        mov     al, 7
        call    opl_set_volume
        mov     byte [rules_tbl + PT_FXSLOT], PT_NONE ; rb_set_voice, as an apply runs it
        SINK_CLEAR
        EV      EV_TONE_ON, D_GREEN
        LASTWM  53h, 3Fh, LIGHTS_CAR_TL + (15 - 7) * 4
        MAINCTX
        ENDCASE

        CASE    "a_fourop_effect_on_an_opl3_takes_pair_2_5"
        mov     ax, 0103h               ; an OPL3, the main voice four-operator
        call    setup
        EV      EV_TONE_ON, D_ENGINE
        LASTWM  1B1h, KEY_ON, KEY_ON    ; pair B
        SINK_CLEAR
        EV      EV_PITCH, D_SQUEAL
        LASTWM  1B1h, KEY_ON, 0
        LASTW   104h, 38h               ; pairs A, B and 2+5
        LASTWM  1B2h, KEY_ON, KEY_ON
        WROTE   1A2h
        LASTW   1C2h, 0Ah | OPL3_OUT
        LASTW   1C5h, 00h | OPL3_OUT
        WROTE   122h                    ; op1 of pair 2+5: 20h + 02h on bank 1
        WROTE   12Dh                    ; op4: 20h + 0Dh
        LASTWM  0B6h, KEY_ON, 0         ; channel 6 only keyed off, as the two-op mode is left
        LASTW   0C6h, 0FFFFh
        BEFORE  1B1h, 104h
        BEFORE  104h, 1B2h
        MAINCTX
        ENDCASE

        CASE    "back_from_a_fourop_effect_keeps_104h"
        SINK_CLEAR
        EV      EV_PITCH, D_ENGINE
        LASTWM  1B2h, KEY_ON, 0
        LASTWM  1B0h, KEY_ON, KEY_ON
        LASTW   104h, 0FFFFh
        MAINCTX
        ENDCASE

        CASE    "a_twoop_effect_after_a_fourop_one_parts_its_pair"
        EV      EV_PITCH, D_SQUEAL
        SINK_CLEAR
        EV      EV_PITCH, D_GREEN       ; the lights: two-operator, on channel 6
        LASTWM  1B2h, KEY_ON, 0
        LASTW   104h, 18h               ; only the main voice's pairs
        BEFORE  1B2h, 104h
        LASTWM  0B6h, KEY_ON, KEY_ON
        LASTW   0C6h, 00h | OPL3_OUT
        MAINCTX
        ENDCASE

        CASE    "fx_shutdown_on_an_opl3_clears_104h_last"
        EV      EV_PITCH, D_SQUEAL
        SINK_CLEAR
        call    fx_shutdown
        LASTWM  1B2h, KEY_ON, 0
        LASTWM  1B0h, KEY_ON, 0
        LASTWM  1B1h, KEY_ON, 0
        LASTW   104h, 00h
        LASTW   105h, 00h
        BEFORE  1B2h, 104h
        BEFORE  1B1h, 104h
        BEFORE  104h, 105h
        mov     al, [opl_104]
        xor     ah, ah
        xor     cx, cx
        call    t_check
        MAINCTX
        ENDCASE

        CASE    "fx_init_leaves_the_effect_voice_twoop"
        mov     ax, 0003h
        call    setup
        EV      EV_PITCH, D_GREEN
        LASTWM  0B6h, KEY_ON, KEY_ON
        LASTW   104h, 0FFFFh
        MAINCTX
        ENDCASE

        CASE    "fx_off_with_nothing_sounding_writes_nothing"
        mov     ax, 2
        call    setup
        call    fx_off
        mov     ax, [sink_n]
        xor     cx, cx
        call    t_check
        ENDCASE

        CASE    "fx_play_keeps_registers_with_df_set"
        mov     ax, 0103h
        call    setup
        EV      EV_TONE_ON, D_ENGINE
        std                             ; the game's DF, as the trap may find it
        mov     ax, (77h << 8) | EV_PITCH
        mov     bx, D_SQUEAL
        mov     cx, 1111h
        mov     dx, 2222h
        mov     si, 3333h
        mov     di, 4444h
        mov     bp, 5555h
        call    fx_play                 ; the deepest path: a mode change on the effect voice
        cld
        cmp     ax, (77h << 8) | EV_PITCH
        jne     .kbad
        cmp     bx, D_SQUEAL
        jne     .kbad
        cmp     cx, 1111h
        jne     .kbad
        cmp     dx, 2222h
        jne     .kbad
        cmp     si, 3333h
        jne     .kbad
        cmp     di, 4444h
        jne     .kbad
        cmp     bp, 5555h
        jne     .kbad
        xor     ax, ax
        jmp     .kcheck
.kbad:
        mov     ax, 1
.kcheck:
        xor     cx, cx
        call    t_check
        LASTW   104h, 38h
        MAINCTX
        ENDCASE

        CASE    "the_main_voice_changing_mode_keeps_the_effect_pair_joined"
        mov     ax, 0103h
        call    setup
        EV      EV_TONE_ON, D_ENGINE
        EV      EV_PITCH, D_SQUEAL      ; 104h = 38h: the main voice's pairs and 2+5
        SINK_CLEAR
        mov     al, 1
        mov     si, blk_engine          ; the main voice to two operators, as an apply sets it
        call    fx_set_voice
        LASTW   104h, 20h
        BEFORE  1B1h, 104h
        LASTW   1B2h, 0FFFFh            ; the effect sounds on, untouched
        LASTW   1C2h, 0FFFFh
        mov     al, [rules_tbl + PT_FXSLOT]
        xor     ah, ah
        mov     cx, PT_NONE             ; fx_set_voice: the effect voice is programmed again
        call    t_check
        SINK_CLEAR
        mov     al, 1
        mov     si, blk_main4
        call    fx_set_voice
        LASTW   104h, 38h
        MAINCTX
        ENDCASE

        CASE    "the_effect_voice_writes_only_its_registers_opl2"
        mov     ax, 2
        call    setup
        SINK_CLEAR
        EV      EV_TONE_ON, D_RED
        EV      EV_PITCH, D_GREEN
        EV      EV_PITCH, D_SQUEAL
        EV      EV_TONE_OFF, 0
        mov     bp, ok_fx2
        mov     cx, OK_FX2_N
        call    sink_stray
        xor     cx, cx
        call    t_check
        ENDCASE

        CASE    "the_effect_voice_writes_only_its_registers_opl3"
        mov     ax, 0103h
        call    setup
        EV      EV_TONE_ON, D_ENGINE
        SINK_CLEAR
        EV      EV_PITCH, D_SQUEAL
        EV      EV_PITCH, D_GREEN
        EV      EV_PITCH, D_SQUEAL
        EV      EV_TONE_OFF, 0
        mov     bp, ok_fx3
        mov     cx, OK_FX3_N
        call    sink_stray
        xor     cx, cx
        call    t_check
        ENDCASE

        CASE    "every_fx_routine_keeps_the_registers"
        mov     ax, 0103h
        call    setup
        EV      EV_TONE_ON, D_ENGINE
        FXPRES  (77h << 8) | EV_PITCH, D_SQUEAL, 4444h, fx_play
        FXPRES  7700h, 2222h, 4444h, fx_off
        FXPRES  7700h, 2222h, 4444h, fx_quiet
        FXPRES  7701h, 2222h, blk_engine, fx_set_voice
        FXPRES  7700h, 2222h, 4444h, fx_shutdown
        FXPRES  7703h, 2222h, 4444h, fx_init
        MAINCTX
        ENDCASE

        CASE    "stack_depth"
        mov     ax, 0103h
        call    setup
        EV      EV_TONE_ON, D_ENGINE
        mov     byte [sink_on], 0       ; the real ports: opl_hw_write's pushes count
        STK_FILL
        mov     al, EV_PITCH
        mov     bx, D_SQUEAL
        call    fx_play
        STK_DEPTH
        mov     [deep], ax
        STK_FILL
        call    fx_shutdown
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
        cmp     ax, FX_STACK_MAX
        mov     ax, 0
        jbe     .fits
        inc     ax
.fits:
        xor     cx, cx
        call    t_check
        ENDCASE

        jmp     t_done

s_stack         db      "INFO stack bytes, deepest fx call: $"

; What rules.asm and fx.asm read of the resident state.
RB_STATE        times RBS_REC4 + 22 db 0
deep            dw      0
