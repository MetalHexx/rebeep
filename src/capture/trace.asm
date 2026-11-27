; The trace build's resident part (REBEEPD.COM, REBEEP_TRACE defined; assembled to nothing
; otherwise). It records every speaker step ReBeep makes on the real 61h, every OPL note the
; game's writes start and stop, each large pitch jump on one, every rule of a profile that
; completes and every tone one of its effects takes, each with a timestamp and the game's
; last byte OUTs, into a buffer that AMIS 15h hands to "REBEEPD /D". Layout: include/trace.inc.
; Resident code (386, like the capture code that calls it). Port 43h goes through QPI;
; port 40h is not trapped, so it is read directly. Nothing here calls DOS.
; SPDX-License-Identifier: MIT

%ifdef REBEEP_TRACE
        cpu     386
%if TRACE_REC != 32
%error trace_record's shl assumes TRACE_REC = 32
%endif
%if TRACE_RECS < 1
%error REBEEP_TRACE must be at least 1 record; rebeep.asm checks that the image fits
%endif

; trace_note: remember one byte the game writes. In: DL = port, AL = byte. Preserves all.
trace_note:
        push    bx
        movzx   bx, byte [trace_pos]
        mov     [trace_ctx + bx], dl
        mov     [trace_ctx + bx + 1], al
        add     bl, 2
        and     bl, 15
        mov     [trace_pos], bl
        pop     bx
        ret

; trace_event: record an OPL note on or off, or a pitch jump (TK_PITCH in trace.inc).
; In: AL = interpreter event, BX = divisor. Preserves all.
trace_event:
        push    ax
        push    cx
        mov     cl, TK_NOTE_ON
        cmp     al, EV_TONE_ON
        je      .start
        cmp     al, EV_PITCH
        je      .pitch
        mov     cl, TK_NOTE_OFF
        cmp     al, EV_TONE_OFF
        jne     .done
.rec:
        xor     ax, ax
        call    trace_record
.done:
        pop     cx
        pop     ax
        ret
.start:
        mov     [trace_div], bx
        jmp     .rec
.pitch:
        mov     ax, [trace_div]         ; AX = the last count recorded
        mov     cx, bx
        sub     cx, ax                  ; CX = new - last
        jae     .up
        neg     cx                      ; the last is the larger
        jmp     .size
.up:
        mov     ax, bx                  ; the new is the larger
.size:
        shr     ax, 3
        cmp     cx, ax
        jbe     .done                   ; an eighth or less: vibrato, a glide
        mov     [trace_div], bx
        mov     cl, TK_PITCH
        jmp     .rec

; trace_rule: record a profile's rule completing. In: AL = rule, AH = slot, CH = its RL_FLAGS.
; Preserves all.
trace_rule:
        push    cx
        mov     cl, TK_RULE
        test    ch, RL_F_ANY
        jz      .rec
        mov     cl, TK_FALLBK
.rec:
        call    trace_record
        pop     cx
        ret

; trace_fx: record a tone moving onto the effect voice. In: SI = the effect, AH = its slot.
; Preserves all.
trace_fx:
        push    ax
        push    cx
        mov     ch, ah
        mov     ax, si
        sub     ax, rules_tbl + PT_EFFECTS
        mov     cl, EFFECT_LEN
        div     cl                      ; AL = the effect's number
        mov     ah, ch
        mov     cl, TK_EFFECT
        call    trace_record
        pop     cx
        pop     ax
        ret

; trace_out61: qpi_out to the real 61h, recording a speaker step first when the write
; changes bit 1, or the gate while bit 1 is on.
; In: DX = SYS_CTRL, BL = byte, [trace_site] = the step's kind. Clobbers AX, as qpi_out.
trace_out61:
        push    cx
        push    bx
        call    qpi_in                  ; BL = the real 61h now
        mov     al, bl
        pop     bx
        push    bx
        mov     ah, bl                  ; AL = before, AH = after
        mov     cl, al
        or      cl, ah
        test    cl, SC_SPKR
        jz      .write                  ; bit 1 off before and after: the speaker stays at 0
        mov     cl, al
        xor     cl, ah
        test    cl, SC_GATE2 | SC_SPKR
        jz      .write
        mov     cl, [trace_site]
        call    trace_record
.write:
        pop     bx
        pop     cx
        jmp     qpi_out

; trace_record: append one record, unless the buffer is full.
; In: AL = real 61h before, AH = after, CL = kind. Preserves all.
trace_record:
        inc     word [trace_hdr + TH_SEEN]
        pusha
        push    es
        mov     bx, [trace_hdr + TH_COUNT]
        cmp     bx, TRACE_RECS
        jae     .full
        inc     word [trace_hdr + TH_COUNT]
        shl     bx, 5                   ; TRACE_REC = 32
        lea     di, [trace_buf + bx]
        mov     [di + TR_BEFORE], al
        mov     [di + TR_AFTER], ah
        mov     [di + TR_KIND], cl
        mov     ax, [RB_STATE + RBS_TRAPPED]
        mov     [di + TR_SEQ], ax
        xor     ax, ax
        mov     es, ax
        mov     ax, [es:046Ch]
        mov     [di + TR_TICK], ax
        push    dx
        mov     dx, PIT_CTRL
        xor     bl, bl                  ; latch channel 0
        call    qpi_out
        pop     dx
        in      al, 40h
        mov     ah, al
        in      al, 40h
        xchg    al, ah
        mov     [di + TR_PIT0], ax
        mov     al, [game_61]
        mov     [di + TR_GAME], al
        mov     al, [RB_STATE + RBS_MODE]
        mov     [di + TR_MODE], al
        mov     al, [masked]
        mov     [di + TR_MASKED], al
        mov     ax, [RB_STATE + RBS_DIVISOR]
        mov     [di + TR_DIVISOR], ax
        mov     al, [RB_STATE + RBS_FLAGS]
        mov     [di + TR_FLAGS], al
        mov     byte [di + TR_SPARE], 0
        add     di, TR_CTX              ; no string instructions: DF is the game's
        movzx   si, byte [trace_pos]    ; the oldest entry
        mov     cx, 8
.ctx:
        mov     ax, [trace_ctx + si]
        mov     [di], ax
        add     di, 2
        add     si, 2
        and     si, 15
        loop    .ctx
.full:
        pop     es
        popa
        ret

trace_site      db      TK_REBEEP
trace_div       dw      0               ; the count of the last note on or pitch record
trace_pos       db      0               ; the next slot in trace_ctx, and so the oldest
trace_ctx       times 16 db 0
trace_hdr:
        dw      0                       ; TH_COUNT
        dw      0                       ; TH_SEEN
        dw      TRACE_RECS              ; TH_CAP
        dw      TRACE_REC               ; TH_RECSZ
trace_buf       times TRACE_RECS * TRACE_REC db 0
%endif
