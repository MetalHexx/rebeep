; Speaker interpreter: tracks PIT channel 2 and port 61h from the bytes a game
; writes, and reports tone-on, pitch-change and tone-off events plus a
; SILENT/TONE/RAW/REST mode. Near calls; DS = this module's segment.
; A square wave below 20 Hz (divisor above DIV_MAX, or 0) is M_REST while
; interp_low is 0, and M_TONE otherwise; the caller sets interp_low and may
; call interp_refresh to apply a change at once.
; Every routine preserves all registers except its outputs, and flags.
; SPDX-License-Identifier: MIT

        cpu     8086
%include "speaker.inc"

; interp_reset: all state off. Gate 0, speaker 0, channel 2 in mode 3 with
; LSB-then-MSB access, divisor unknown. Only the tests call it (ReBeep starts from
; interp_sync), so it is assembled only when INTERP_RESET is defined.
%ifdef INTERP_RESET
interp_reset:
        mov     byte [st_gate], 0
        mov     byte [st_spk], 0
        mov     byte [st_acc], 3
        mov     byte [st_cmode], 3
        mov     byte [st_pcmode], 3
        mov     byte [st_flip], 0
        mov     byte [st_known], 0
        mov     byte [interp_mode], M_SILENT
        mov     word [st_div], 0
        mov     word [interp_div], 0
        ret
%endif

; interp_sync: adopt the real port 61h value after a pass-through.
; In:  AL = port 61h value
; Out: AH = mode (M_SILENT or M_RAW; the divisor is unknown)
; No event is reported: if the previous mode was M_TONE, the caller must key the
; OPL voice off (opl_note_off) itself.
interp_sync:
        push    ax
        push    bx
        mov     bl, al
        and     bl, SC_GATE2
        mov     [st_gate], bl
        and     al, SC_SPKR
        mov     [st_spk], al
        mov     byte [st_acc], 3
        mov     byte [st_cmode], 3
        mov     byte [st_pcmode], 3
        mov     byte [st_flip], 0
        mov     byte [st_known], 0
        mov     word [st_div], 0
        mov     word [interp_div], 0
        call    interp_verdict
        mov     [interp_mode], al
        pop     bx
        pop     ax
        mov     ah, [interp_mode]
        ret

; interp_write: feed one byte a game wrote to a speaker-related port.
; In:  AL = byte, DX = port (42h, 43h or 61h; any other port gives EV_NONE)
; Out: AL = event, AH = mode after the write, BX = divisor (valid when AH = M_TONE)
interp_write:
        push    cx
        mov     cl, al
        cmp     dx, PIT_CTRL
        je      .ctrl
        cmp     dx, PIT_CH2
        je      .ch2
        cmp     dx, SYS_CTRL
        je      .sys
.none:
        mov     al, EV_NONE
.out:
        mov     ah, [interp_mode]
        mov     bx, [interp_div]
        pop     cx
        ret

; Control word: only channel 2 with a real access mode counts. The new
; counting mode waits in st_pcmode until the count completes.
.ctrl:
        mov     al, cl
        and     al, 0C0h
        cmp     al, 80h
        jne     .none
        mov     al, cl
        and     al, 30h
        jz      .none
        mov     ch, cl
        mov     cl, 4
        shr     al, cl
        mov     [st_acc], al
        mov     al, ch
        and     al, 0Eh
        shr     al, 1
        cmp     al, 6
        jb      .mode
        sub     al, 4                   ; 6 -> 2, 7 -> 3
.mode:
        mov     [st_pcmode], al
        mov     byte [st_flip], 0
        jmp     .none

.ch2:
        mov     al, [st_acc]
        cmp     al, 1
        je      .lsb
        cmp     al, 2
        je      .msb
        cmp     byte [st_flip], 0
        jne     .second
        mov     [st_lsb], cl
        mov     byte [st_flip], 1
        jmp     .none
.second:
        mov     byte [st_flip], 0
        mov     ch, cl
        mov     cl, [st_lsb]
        jmp     .count
.lsb:
        xor     ch, ch
        jmp     .count
.msb:
        mov     ch, cl
        xor     cl, cl
.count:
        mov     [st_div], cx
        mov     al, [st_pcmode]
        mov     [st_cmode], al
        mov     byte [st_known], 1
        jmp     .recompute

.sys:
        mov     al, cl
        and     al, SC_GATE2
        mov     [st_gate], al
        mov     al, cl
        and     al, SC_SPKR
        mov     [st_spk], al

; Recompute the verdict and turn the transition into an event.
.recompute:
        call    interp_verdict
        mov     ah, [interp_mode]       ; previous mode
        mov     [interp_mode], al
        mov     cl, EV_NONE
        cmp     al, M_TONE
        je      .toneNow
        cmp     ah, M_TONE
        jne     .event
        mov     cl, EV_TONE_OFF
        jmp     .event
.toneNow:
        mov     bx, [st_div]
        cmp     ah, M_TONE
        je      .toneKept
        mov     cl, EV_TONE_ON
        jmp     .newDiv
.toneKept:
        cmp     bx, [interp_div]
        je      .event
        mov     cl, EV_PITCH
.newDiv:
        mov     [interp_div], bx
.event:
        mov     al, cl
        jmp     .out

; interp_refresh: re-derive the mode from the state already seen, after interp_low changed.
; Out: as interp_write (EV_NONE when the mode and divisor stand).
interp_refresh:
        push    cx
        jmp     interp_write.recompute

; interp_verdict: AL = the mode the current state implies.
interp_verdict:
        cmp     byte [st_spk], 0
        je      .silent
        cmp     byte [st_gate], 0
        je      .raw
        cmp     byte [st_known], 0
        je      .raw
        cmp     byte [st_cmode], 3
        jne     .raw
        cmp     word [st_div], 0        ; 0 means 65536
        je      .low
        cmp     word [st_div], DIV_MIN
        jb      .raw
        cmp     word [st_div], DIV_MAX
        ja      .low
.tone:
        mov     al, M_TONE
        ret
.low:
        cmp     byte [interp_low], 0
        jne     .tone
        mov     al, M_REST
        ret
.raw:
        mov     al, M_RAW
        ret
.silent:
        mov     al, M_SILENT
        ret

; Read-only state for status: current mode and (in M_TONE) divisor.
interp_mode     db      M_SILENT
interp_div      dw      0
; Set by the caller: 0 = a count below 20 Hz is a rest, nonzero = a tone. A change applies
; from the next write, or at once through interp_refresh.
interp_low      db      0

st_gate         db      0
st_spk          db      0
st_acc          db      3               ; 1 = LSB, 2 = MSB, 3 = LSB then MSB
st_cmode        db      3               ; counting mode in force
st_pcmode       db      3               ; counting mode waiting for the next count
st_flip         db      0               ; 1 = LSB already written
st_lsb          db      0
st_known        db      0               ; a count has completed
st_div          dw      0               ; last completed count (0 = 65536)
