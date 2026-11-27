; T_INTERP - drives the speaker interpreter with scripted port writes and
; checks the events, mode and divisor it reports.
; SPDX-License-Identifier: MIT

        cpu     8086
        org     100h

%include "speaker.inc"

CW_CH2_LSBMSB   equ 0B6h        ; channel 2, LSB then MSB, mode 3
CW_CH2_LSB      equ 096h        ; channel 2, LSB only, mode 3
CW_CH2_MSB      equ 0A6h        ; channel 2, MSB only, mode 3
CW_CH2_MODE2    equ 0B4h        ; channel 2, LSB then MSB, mode 2
CW_CH2_LATCH    equ 086h
CW_CH0          equ 036h
CW_CH1          equ 076h
CW_READBACK     equ 0C2h

D1000           equ 04A9h       ; 1000 Hz
GPC_ENGINE      equ 0BB8h       ; 3000, about 398 Hz: an engine pitch

        jmp     start

%define INTERP_RESET                    ; the tests start each case from interp_reset
%include "engine/interp.asm"
%include "testlib.inc"

; Write one byte to a port; the result stays in AL/AH/BX for EXPECT.
%macro W 2
        mov     dx, %1
        mov     al, %2
        call    interp_write
%endmacro

; Program a complete LSB-then-MSB count, ignoring the intermediate results.
%macro COUNT 1
        W       PIT_CTRL, CW_CH2_LSBMSB
        W       PIT_CH2, (%1) & 0FFh
        W       PIT_CH2, (%1) >> 8
%endmacro

; Same, with the count taken from the word at the given address.
%macro COUNT_AT 1
        W       PIT_CTRL, CW_CH2_LSBMSB
        mov     dx, PIT_CH2
        mov     al, [%1]
        call    interp_write
        mov     dx, PIT_CH2
        mov     al, [%1 + 1]
        call    interp_write
%endmacro

%macro EXPECT 2
        mov     cx, ((%2) << 8) | (%1)
        call    t_check
%endmacro

%macro EXPECTD 3
        mov     cx, ((%2) << 8) | (%1)
        mov     si, %3
        call    t_checkd
%endmacro

start:
        CASE    "lsb_then_msb"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        EXPECT  EV_NONE, M_RAW
        W       PIT_CTRL, CW_CH2_LSBMSB
        EXPECT  EV_NONE, M_RAW
        W       PIT_CH2, D1000 & 0FFh
        EXPECT  EV_NONE, M_RAW
        W       PIT_CH2, D1000 >> 8
        EXPECTD EV_TONE_ON, M_TONE, D1000
        ENDCASE

        CASE    "half_count_keeps_pitch"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        COUNT   D1000
        W       PIT_CTRL, CW_CH2_LSBMSB
        W       PIT_CH2, 00h
        EXPECTD EV_NONE, M_TONE, D1000
        W       PIT_CH2, 02h
        EXPECTD EV_PITCH, M_TONE, 0200h
        ENDCASE

        CASE    "divisor_zero_is_65536"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        COUNT   D1000
        EXPECT  EV_TONE_ON, M_TONE
        W       PIT_CTRL, CW_CH2_LSBMSB
        W       PIT_CH2, 00h
        W       PIT_CH2, 00h
        EXPECT  EV_TONE_OFF, M_REST
        mov     byte [interp_low], 1
        COUNT   D1000
        EXPECTD EV_TONE_ON, M_TONE, D1000
        COUNT   0
        EXPECTD EV_PITCH, M_TONE, 0
        mov     byte [interp_low], 0
        ENDCASE

        CASE    "lsb_only_access"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        W       PIT_CTRL, CW_CH2_LSB
        W       PIT_CH2, 200
        EXPECTD EV_TONE_ON, M_TONE, 200
        W       PIT_CH2, 210
        EXPECTD EV_PITCH, M_TONE, 210
        ENDCASE

        CASE    "msb_only_access"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        W       PIT_CTRL, CW_CH2_MSB
        W       PIT_CH2, 04h
        EXPECTD EV_TONE_ON, M_TONE, 0400h
        W       PIT_CH2, 08h
        EXPECTD EV_PITCH, M_TONE, 0800h
        ENDCASE

        CASE    "non_square_mode_is_raw"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        COUNT   D1000
        W       PIT_CTRL, CW_CH2_MODE2
        EXPECT  EV_NONE, M_TONE
        W       PIT_CH2, D1000 & 0FFh
        EXPECT  EV_NONE, M_TONE
        W       PIT_CH2, D1000 >> 8
        EXPECT  EV_TONE_OFF, M_RAW
        COUNT   D1000
        EXPECTD EV_TONE_ON, M_TONE, D1000
        ENDCASE

        CASE    "channel_0_1_ignored"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        COUNT   D1000
        W       PIT_CTRL, CW_CH2_LSBMSB
        W       PIT_CH2, 00h
        W       PIT_CTRL, CW_CH0
        EXPECT  EV_NONE, M_TONE
        W       PIT_CTRL, CW_CH1
        EXPECT  EV_NONE, M_TONE
        W       PIT_CH2, 02h
        EXPECTD EV_PITCH, M_TONE, 0200h
        ENDCASE

        CASE    "latch_and_readback_ignored"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        COUNT   D1000
        W       PIT_CTRL, CW_CH2_LSBMSB
        W       PIT_CH2, 00h
        W       PIT_CTRL, CW_CH2_LATCH
        EXPECT  EV_NONE, M_TONE
        W       PIT_CTRL, CW_READBACK
        EXPECT  EV_NONE, M_TONE
        W       PIT_CH2, 02h
        EXPECTD EV_PITCH, M_TONE, 0200h
        ENDCASE

        CASE    "glide_is_pitch_not_retrigger"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        COUNT   D1000
        COUNT   900
        EXPECTD EV_PITCH, M_TONE, 900
        COUNT   800
        EXPECTD EV_PITCH, M_TONE, 800
        COUNT   800
        EXPECTD EV_NONE, M_TONE, 800
        ENDCASE

        CASE    "control_word_mid_tone"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        COUNT   D1000
        W       PIT_CTRL, CW_CH2_LSBMSB
        EXPECTD EV_NONE, M_TONE, D1000
        ENDCASE

        CASE    "gate_off_toggling_is_raw"
        call    interp_reset
        W       SYS_CTRL, SC_SPKR
        EXPECT  EV_NONE, M_RAW
        W       SYS_CTRL, 0
        EXPECT  EV_NONE, M_SILENT
        W       SYS_CTRL, SC_SPKR
        EXPECT  EV_NONE, M_RAW
        COUNT   D1000
        EXPECT  EV_NONE, M_RAW
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        EXPECTD EV_TONE_ON, M_TONE, D1000
        W       SYS_CTRL, SC_SPKR
        EXPECT  EV_TONE_OFF, M_RAW
        ENDCASE

        CASE    "div_min_boundary"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        COUNT   DIV_MIN - 1
        EXPECT  EV_NONE, M_RAW
        COUNT   DIV_MIN
        EXPECTD EV_TONE_ON, M_TONE, DIV_MIN
        COUNT   DIV_MIN - 1
        EXPECT  EV_TONE_OFF, M_RAW
        ENDCASE

        CASE    "div_max_boundary"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        COUNT   DIV_MAX + 1
        EXPECT  EV_NONE, M_REST
        COUNT   DIV_MAX
        EXPECTD EV_TONE_ON, M_TONE, DIV_MAX
        COUNT   DIV_MAX + 1
        EXPECT  EV_TONE_OFF, M_REST
        ENDCASE

        ; Below 20 Hz is a rest by default, whatever the count; it still needs the gate and
        ; speaker bits, like a tone.
        CASE    "low_counts_rest"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        COUNT   0FFFFh
        EXPECT  EV_NONE, M_REST
        COUNT   0
        EXPECT  EV_NONE, M_REST
        COUNT   DIV_MAX + 1
        EXPECT  EV_NONE, M_REST
        W       SYS_CTRL, SC_SPKR
        EXPECT  EV_NONE, M_RAW
        W       SYS_CTRL, SC_GATE2
        EXPECT  EV_NONE, M_SILENT
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        EXPECT  EV_NONE, M_REST
        COUNT   D1000
        EXPECTD EV_TONE_ON, M_TONE, D1000
        COUNT   0FFFFh
        EXPECT  EV_TONE_OFF, M_REST
        ENDCASE

        ; With interp_low set the same counts are tones, gliding like any other pitch.
        CASE    "low_counts_play"
        call    interp_reset
        mov     byte [interp_low], 1
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        COUNT   0FFFFh
        EXPECTD EV_TONE_ON, M_TONE, 0FFFFh
        COUNT   DIV_MAX + 1
        EXPECTD EV_PITCH, M_TONE, DIV_MAX + 1
        COUNT   0
        EXPECTD EV_PITCH, M_TONE, 0
        COUNT   D1000
        EXPECTD EV_PITCH, M_TONE, D1000
        COUNT   DIV_MIN - 1
        EXPECT  EV_TONE_OFF, M_RAW
        mov     byte [interp_low], 0
        ENDCASE

        CASE    "sync_speaker_on_is_raw"
        call    interp_reset
        mov     al, SC_GATE2 | SC_SPKR
        call    interp_sync
        mov     cx, (M_RAW << 8) | SC_GATE2 | SC_SPKR
        call    t_check
        mov     al, SC_GATE2 | SC_SPKR
        call    interp_sync
        mov     al, ah
        xor     ah, ah
        mov     cx, M_RAW
        call    t_check
        W       PIT_CTRL, CW_CH2_LSBMSB
        W       PIT_CH2, D1000 & 0FFh
        EXPECT  EV_NONE, M_RAW
        W       PIT_CH2, D1000 >> 8
        EXPECTD EV_TONE_ON, M_TONE, D1000
        ENDCASE

        CASE    "sync_speaker_off_is_silent"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        COUNT   D1000
        mov     al, SC_GATE2
        call    interp_sync
        mov     al, ah
        xor     ah, ah
        mov     cx, M_SILENT
        call    t_check
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        EXPECT  EV_NONE, M_RAW
        ENDCASE

        CASE    "sync_after_tone_forgets_divisor"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        COUNT   D1000
        mov     al, SC_GATE2 | SC_SPKR
        call    interp_sync
        mov     al, ah
        xor     ah, ah
        mov     cx, M_RAW
        call    t_check
        COUNT   D1000
        EXPECTD EV_TONE_ON, M_TONE, D1000
        ENDCASE

        CASE    "on_off_on_has_no_hanging_state"
        call    interp_reset
        COUNT   D1000
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        EXPECTD EV_TONE_ON, M_TONE, D1000
        W       SYS_CTRL, SC_GATE2
        EXPECT  EV_TONE_OFF, M_SILENT
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        EXPECTD EV_TONE_ON, M_TONE, D1000
        ENDCASE

        CASE    "other_ports_ignored"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        COUNT   D1000
        W       60h, 0FFh
        EXPECTD EV_NONE, M_TONE, D1000
        W       PIT_CH2 - 2, 0FFh
        EXPECTD EV_NONE, M_TONE, D1000
        ENDCASE

        CASE    "registers_preserved"
        call    interp_reset
        mov     cx, 1111h
        mov     si, 2222h
        mov     di, 3333h
        mov     bp, 4444h
        mov     dx, SYS_CTRL
        mov     al, SC_GATE2 | SC_SPKR
        call    interp_write
        mov     ax, cx
        mov     cx, 1111h
        call    t_check
        mov     ax, si
        mov     cx, 2222h
        call    t_check
        mov     ax, di
        mov     cx, 3333h
        call    t_check
        mov     ax, bp
        mov     cx, 4444h
        call    t_check
        mov     ax, dx
        mov     cx, SYS_CTRL
        call    t_check
        ENDCASE

        ; Grand Prix Circuit's engine: 20 beeps, each stepping up in pitch.
        CASE    "twenty_stepped_beeps"
        call    interp_reset
        mov     word [beep_pitch], 1200
        mov     byte [beep_n], 20
.beep:
        COUNT_AT beep_pitch
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        cmp     al, EV_TONE_ON
        jne     .badOn
        inc     word [beep_on]
        jmp     .off
.badOn:
        inc     word [beep_other]
.off:
        W       SYS_CTRL, SC_GATE2
        cmp     al, EV_TONE_OFF
        jne     .badOff
        inc     word [beep_off]
        jmp     .next
.badOff:
        inc     word [beep_other]
.next:
        sub     word [beep_pitch], 25
        dec     byte [beep_n]
        jnz     .beep
        mov     ax, [beep_on]
        mov     cx, 20
        call    t_check
        mov     ax, [beep_off]
        mov     cx, 20
        call    t_check
        mov     ax, [beep_other]
        xor     cx, cx
        call    t_check
        ENDCASE

        ; Grand Prix Circuit's in-race notes: the speaker bit stays on and the gate alone
        ; starts and stops each note. Capture's choice of what to mask rests on these verdicts.
        CASE    "gate_keyed_beeps"
        call    interp_reset
        W       SYS_CTRL, SC_SPKR
        EXPECT  EV_NONE, M_RAW
        mov     word [beep_pitch], 2000
        mov     byte [beep_n], 10
.gate:
        COUNT_AT beep_pitch
        EXPECT  EV_NONE, M_RAW
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        EXPECTD EV_TONE_ON, M_TONE, [beep_pitch]
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        EXPECTD EV_NONE, M_TONE, [beep_pitch]
        W       SYS_CTRL, SC_SPKR
        EXPECT  EV_TONE_OFF, M_RAW
        sub     word [beep_pitch], 100
        dec     byte [beep_n]
        jnz     .gate
        ENDCASE

        ; interp_refresh applies a change of interp_low to the count already held, without a
        ; write, and reports nothing when nothing changes.
        CASE    "refresh_applies_low"
        call    interp_reset
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        COUNT   0FFFFh
        EXPECT  EV_NONE, M_REST
        mov     byte [interp_low], 1
        call    interp_refresh
        EXPECTD EV_TONE_ON, M_TONE, 0FFFFh
        call    interp_refresh
        EXPECTD EV_NONE, M_TONE, 0FFFFh
        mov     byte [interp_low], 0
        call    interp_refresh
        EXPECT  EV_TONE_OFF, M_REST
        COUNT   D1000
        EXPECTD EV_TONE_ON, M_TONE, D1000
        mov     byte [interp_low], 1
        call    interp_refresh
        EXPECTD EV_NONE, M_TONE, D1000
        mov     byte [interp_low], 0
        call    interp_reset
        call    interp_refresh
        EXPECT  EV_NONE, M_SILENT
        ENDCASE

        ; Grand Prix Circuit's race engine: 40 ms of the engine pitch, then 20 ms of count
        ; FFFFh as a rest, each slot a new count on 42h then 61h |= 3. 43h is never written.
        CASE    "gpc_engine_loop"
        call    interp_reset                    ; channel 2 as the BIOS leaves it: LSB/MSB, mode 3
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        mov     byte [beep_n], 5
.engine:
        W       PIT_CH2, GPC_ENGINE & 0FFh
        W       PIT_CH2, GPC_ENGINE >> 8
        EXPECTD EV_TONE_ON, M_TONE, GPC_ENGINE
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        EXPECTD EV_NONE, M_TONE, GPC_ENGINE
        W       PIT_CH2, 0FFh
        W       PIT_CH2, 0FFh
        EXPECT  EV_TONE_OFF, M_REST
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        EXPECT  EV_NONE, M_REST
        dec     byte [beep_n]
        jnz     .engine
        ENDCASE

        ; The same loop with interp_low set: one note, gliding between the two pitches.
        CASE    "gpc_engine_loop_low"
        call    interp_reset
        mov     byte [interp_low], 1
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        W       PIT_CH2, GPC_ENGINE & 0FFh
        W       PIT_CH2, GPC_ENGINE >> 8
        EXPECTD EV_TONE_ON, M_TONE, GPC_ENGINE
        mov     byte [beep_n], 5
.engineLow:
        W       PIT_CH2, 0FFh
        W       PIT_CH2, 0FFh
        EXPECTD EV_PITCH, M_TONE, 0FFFFh
        W       SYS_CTRL, SC_GATE2 | SC_SPKR
        EXPECTD EV_NONE, M_TONE, 0FFFFh
        W       PIT_CH2, GPC_ENGINE & 0FFh
        W       PIT_CH2, GPC_ENGINE >> 8
        EXPECTD EV_PITCH, M_TONE, GPC_ENGINE
        dec     byte [beep_n]
        jnz     .engineLow
        mov     byte [interp_low], 0
        ENDCASE

        jmp     t_done

beep_pitch      dw      0
beep_n          db      0
beep_on         dw      0
beep_off        dw      0
beep_other      dw      0
