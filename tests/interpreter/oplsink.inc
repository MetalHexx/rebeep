; The OPL target's recording sink, for the test programs that include engine/opl.asm. Define
; OPL_TEST_SINK as sink and SINK_MAX (entries of 4 bytes: register word, value byte, pad)
; before including opl.asm, then include this file after the jmp to the cases.
; While sink_on is set it records (BX, AL); otherwise it forwards to the hardware (T_OPL's
; listening mode). A case that reads the log clears it first (SINK_CLEAR). sink_stray checks
; the log against a table of the registers allowed.
; SPDX-License-Identifier: MIT

        cpu     8086

sink:
        cmp     byte [sink_on], 0
        jne     .rec
        jmp     opl_hw_write
.rec:
        push    di
        mov     di, [sink_n]
        cmp     di, SINK_MAX * 4
        jae     .done
        mov     [sink_buf + di], bx
        mov     [sink_buf + di + 2], al
        add     word [sink_n], 4
.done:
        pop     di
        ret

; sink_last: BX = register. Out: AX = last value written to it, 0FFFFh if never.
sink_last:
        push    si
        mov     si, [sink_n]
.scan:
        or      si, si
        jz      .none
        sub     si, 4
        cmp     [sink_buf + si], bx
        jne     .scan
        xor     ah, ah
        mov     al, [sink_buf + si + 2]
        pop     si
        ret
.none:
        mov     ax, 0FFFFh
        pop     si
        ret

; sink_pos: BX = register. Out: AX = how many writes came before the first one to it,
; 0FFFFh if there was none.
sink_pos:
        push    si
        xor     si, si
        xor     ax, ax
.scan:
        cmp     si, [sink_n]
        jae     .none
        cmp     [sink_buf + si], bx
        je      .found
        add     si, 4
        inc     ax
        jmp     .scan
.none:
        mov     ax, 0FFFFh
.found:
        pop     si
        ret

; sink_stray: In: BP = a table of the registers ReBeep may write (words), CX = how many.
; Out: AX = 0 when every recorded write is to one of them, otherwise the first other register.
sink_stray:
        push    bx
        push    cx
        push    dx
        push    si
        push    di
        mov     dx, cx
        xor     si, si
.entry:
        cmp     si, [sink_n]
        jae     .clean
        mov     bx, [sink_buf + si]
        add     si, 4
        mov     di, bp
        mov     cx, dx
.reg:
        cmp     bx, [di]
        je      .entry
        add     di, 2
        loop    .reg
        mov     ax, bx
        jmp     .out
.clean:
        xor     ax, ax
.out:
        pop     di
        pop     si
        pop     dx
        pop     cx
        pop     bx
        ret

%macro SINK_CLEAR 0
        mov     word [sink_n], 0
%endmacro

; The last value written to a register must equal the expectation.
%macro LASTW 2
        mov     bx, %1
        call    sink_last
        mov     cx, %2
        call    t_check
%endmacro

; (the last value written to a register & mask) must equal the expectation;
; a register never written fails.
%macro LASTWM 3
        mov     bx, %1
        call    sink_last
        cmp     ax, 0FFFFh
        je      %%none
        and     ax, %2
%%none:
        mov     cx, %3
        call    t_check
%endmacro

; The register was written since the log was last cleared.
%macro WROTE 1
        mov     bx, %1
        call    sink_last
        cmp     ax, 0FFFFh
        mov     ax, 1
        je      %%never
        dec     ax
%%never:
        xor     cx, cx
        call    t_check
%endmacro

; The first write to the register %1 came before the first one to %2, which was made.
%macro BEFORE 2
        mov     bx, %1
        call    sink_pos
        mov     dx, ax
        mov     bx, %2
        call    sink_pos
        cmp     dx, ax
        mov     ax, 1
        jae     %%late
        dec     ax
%%late:
        xor     cx, cx
        call    t_check
%endmacro

sink_on         db      0
sink_n          dw      0
sink_buf        times SINK_MAX * 4 db 0
