; OPL detection, startup only: the load path runs it once, before ReBeep goes resident, so
; it lives after resident_end and is freed. It writes the chip through opl_hw_write (the
; ports, even in a test build with OPL_TEST_SINK) and sets the write delays that
; engine/opl.asm keeps. Include it after opl.asm. Preserves every register but AL.
; SPDX-License-Identifier: MIT

        cpu     8086

; opl_detect: the standard AdLib timer test, on the timer registers 02h and 04h.
; Out: AL = 0 none, 2 = OPL2, 3 = OPL3. Also picks the write delays by chip.
opl_detect:
        push    bx
        push    cx
        push    dx
        call    opl_reset_timers
        mov     dx, OPL_ADDR1
        in      al, dx
        and     al, 0E0h
        jnz     .none
        mov     bx, REG_TIMER1
        mov     al, 0FFh
        call    opl_hw_write
        mov     bx, REG_TIMCTL
        mov     al, 21h
        call    opl_hw_write
        mov     cx, 200                 ; at least 80 us of status reads
.wait:
        in      al, dx
        loop    .wait
        in      al, dx
        and     al, 0E0h
        mov     ch, al
        call    opl_reset_timers
        mov     al, ch
        cmp     al, 0C0h
        jne     .none
        in      al, dx
        and     al, 06h
        jnz     .opl2
        mov     byte [opl_idx_reads], OPL3_IDX_READS
        mov     byte [opl_data_reads], OPL3_DATA_READS
        mov     al, 3
        jmp     .out
.opl2:
        mov     byte [opl_idx_reads], OPL2_IDX_READS
        mov     byte [opl_data_reads], OPL2_DATA_READS
        mov     al, 2
        jmp     .out
.none:
        xor     al, al
.out:
        pop     dx
        pop     cx
        pop     bx
        ret

; Clobbers AL and BX; the callers have saved or do not need them.
opl_reset_timers:
        mov     bx, REG_TIMCTL
        mov     al, 60h
        call    opl_hw_write
        mov     al, 80h
        jmp     opl_hw_write
