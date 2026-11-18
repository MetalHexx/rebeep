; T_OPL - detects the real OPL at 388h, then checks the register writes the OPL
; target makes through a recording sink (once as an OPL2, once as an OPL3).
; T_OPL /L is the listening mode: it plays each voice through the real ports.
; SPDX-License-Identifier: MIT

        cpu     8086
        org     100h

%include "speaker.inc"

%define OPL_TEST_SINK sink

SINK_MAX        equ 256         ; entries of 4 bytes: register word, value byte, pad
A4              equ 2711        ; 1,193,182 / 440 Hz

        jmp     start

%include "engine/opl.asm"
%include "testlib.inc"

; sink: stands in for the ports. Records (BX, AL) while sink_on is set and
; otherwise forwards to the hardware (listening mode).
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

; sink_b8_off: Out: AX = number of recorded writes to B8h with the key bit clear.
sink_b8_off:
        push    si
        xor     ax, ax
        xor     si, si
.scan:
        cmp     si, [sink_n]
        jae     .done
        cmp     word [sink_buf + si], 0B8h
        jne     .next
        test    byte [sink_buf + si + 2], 20h
        jnz     .next
        inc     ax
.next:
        add     si, 4
        jmp     .scan
.done:
        pop     si
        ret

; sink_stray: Out: AX = 0 when every recorded write is to channel 8's operator
; registers, C8h/A8h/B8h, 01h or 105h; otherwise the first other register.
sink_stray:
        push    bx
        push    cx
        push    si
        push    di
        xor     si, si
.entry:
        cmp     si, [sink_n]
        jae     .clean
        mov     bx, [sink_buf + si]
        add     si, 4
        cmp     bx, 01h
        je      .entry
        cmp     bx, 105h
        je      .entry
        cmp     bx, 0A8h
        je      .entry
        cmp     bx, 0B8h
        je      .entry
        cmp     bx, 0C8h
        je      .entry
        or      bh, bh
        jnz     .stray
        mov     di, ok_ops
        mov     cx, OK_OPS_N
.op:
        cmp     bl, [di]
        je      .entry
        inc     di
        loop    .op
.stray:
        mov     ax, bx
        jmp     .out
.clean:
        xor     ax, ax
.out:
        pop     di
        pop     si
        pop     cx
        pop     bx
        ret

; Operator registers of channel 8: 20h/40h/60h/80h/E0h + 12h (modulator) or 15h (carrier).
ok_ops          db      32h, 35h, 52h, 55h, 72h, 75h, 92h, 95h, 0F2h, 0F5h
OK_OPS_N        equ     $ - ok_ops

; expect_pitch: BX = divisor. Out: CL = block, AX = F-number, from the formula
; fnum = (3 << (23 - block)) / divisor with the smallest block whose result fits 10 bits.
expect_pitch:
        push    dx
        xor     ch, ch
.try:
        mov     cl, 7
        sub     cl, ch
        mov     dx, 3
        shl     dx, cl                  ; DX:0 = 3 << (23 - block)
        cmp     dx, bx
        jae     .next                   ; quotient beyond 16 bits, certainly > 1023
        xor     ax, ax
        div     bx
        cmp     ax, 1023
        jbe     .done
.next:
        inc     ch
        jmp     .try
.done:
        mov     cl, ch
        pop     dx
        ret

; wait_ticks: AX = BIOS timer ticks (18.2 per second) to wait.
wait_ticks:
        push    bx
        push    cx
        push    dx
        mov     bx, ax
        xor     ah, ah
        int     1Ah
        mov     ax, dx
.poll:
        push    ax
        xor     ah, ah
        int     1Ah
        pop     ax
        mov     cx, dx
        sub     cx, ax
        cmp     cx, bx
        jb      .poll
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

; The checks that depend on the chip. %1 = 2 or 3, %2 = a name suffix.
%macro REGCASES 2
%strcat cname "init_writes_", %2
        CASE    cname
        mov     al, 15
        call    opl_set_volume
        xor     al, al
        call    opl_set_voice
        SINK_CLEAR
        mov     al, %1
        call    opl_init
        LASTW   01h, 20h
%if %1 == 3
        LASTW   105h, 01h
%else
        LASTW   105h, 0FFFFh
%endif
        LASTWM  0B8h, 20h, 0
        ENDCASE

%strcat cname "output_bits_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     byte [tv], 0
%%ovoice:
        mov     al, [tv]
        call    opl_set_voice
        mov     bx, 0C8h
        call    sink_last
        cmp     ax, 0FFFFh
        je      %%onone
        and     ax, 30h
%%onone:
%if %1 == 3
        mov     cx, 30h
%else
        xor     cx, cx
%endif
        call    t_check
        inc     byte [tv]
        cmp     byte [tv], 5
        jb      %%ovoice
        ENDCASE

%strcat cname "faithful_voice_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        xor     al, al
        call    opl_set_voice
%if %1 == 3
        LASTW   20h + 15h, 21h
        LASTW   40h + 12h, 3Fh
        LASTW   0E0h + 15h, 06h
        LASTW   60h + 15h, 0F0h
        LASTW   80h + 15h, 0Fh
        LASTWM  0C8h, 01h, 01h
%else
        LASTW   20h + 12h, 22h
        LASTW   20h + 15h, 21h
        LASTW   40h + 12h, 1Ah
        LASTW   0E0h + 12h, 00h
        LASTW   0E0h + 15h, 00h
        LASTWM  0C8h, 0Fh, 00h
%endif
        ENDCASE

%strcat cname "volume_scale_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     byte [tv], 1
%%vol:
        mov     al, [tv]
        call    opl_set_volume
        mov     bx, 40h + 15h
        call    sink_last
        cmp     ax, 0FFFFh
        je      %%vnone
        and     ax, 3Fh
%%vnone:
        mov     cl, 15
        sub     cl, [tv]
        shl     cl, 1
        shl     cl, 1
        xor     ch, ch
        call    t_check
        inc     byte [tv]
        cmp     byte [tv], 16
        jb      %%vol
        xor     al, al
        call    opl_set_volume
        LASTWM  40h + 15h, 3Fh, 3Fh
        mov     al, 15
        call    opl_set_volume
        ENDCASE

%strcat cname "note_on_sets_key_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        SINK_CLEAR
        mov     bx, 1193
        call    opl_note_on
        LASTWM  0B8h, 20h, 20h
        mov     bx, 0A8h
        call    sink_last
        cmp     ax, 0FFFFh
        mov     ax, 0
        jne     %%wrote
        inc     ax
%%wrote:
        xor     cx, cx
        call    t_check
        ENDCASE

%strcat cname "pitch_keeps_key_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     bx, 1193
        call    opl_note_on
        SINK_CLEAR
        mov     bx, A4
        call    opl_pitch
        LASTWM  0B8h, 20h, 20h
        call    sink_b8_off
        xor     cx, cx
        call    t_check
        ENDCASE

%strcat cname "note_off_clears_key_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     bx, 1193
        call    opl_note_on
        mov     bx, 0B8h
        call    sink_last
        and     al, 0DFh
        mov     [tv], al
        SINK_CLEAR
        call    opl_note_off
        LASTWM  0B8h, 20h, 0
        mov     bx, 0B8h
        call    sink_last
        mov     cl, [tv]
        xor     ch, ch
        call    t_check
        ENDCASE

%strcat cname "only_channel_8_", %2
        CASE    cname
        SINK_CLEAR
        mov     al, %1
        call    opl_init
        mov     byte [tv], 0
%%svoice:
        mov     al, [tv]
        call    opl_set_voice
        inc     byte [tv]
        cmp     byte [tv], 5
        jb      %%svoice
        mov     al, 7
        call    opl_set_volume
        mov     bx, 1193
        call    opl_note_on
        mov     bx, DIV_MIN
        call    opl_pitch
        mov     bx, DIV_MAX
        call    opl_pitch
        call    opl_note_off
        call    opl_shutdown
        mov     al, 15
        call    opl_set_volume
        mov     ax, [sink_n]
        cmp     ax, SINK_MAX * 4
        mov     ax, 1
        jae     %%checked               ; the log overflowed: cannot vouch for it
        call    sink_stray
%%checked:
        xor     cx, cx
        call    t_check
        ENDCASE

%strcat cname "shutdown_keys_off_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     bx, 1193
        call    opl_note_on
        SINK_CLEAR
        call    opl_shutdown
        LASTWM  0B8h, 20h, 0
        LASTW   40h + 15h, 3Fh
%if %1 == 3
        LASTW   105h, 00h
%else
        LASTW   105h, 0FFFFh
%endif
        ENDCASE
%endmacro

start:
        mov     si, 81h
.args:
        mov     al, [si]
        cmp     al, 13
        je      .auto
        cmp     al, '/'
        jne     .more
        mov     al, [si + 1]
        or      al, 20h
        cmp     al, 'l'
        jne     .more
        jmp     listen
.more:
        inc     si
        jmp     .args
.auto:
        mov     byte [sink_on], 1

        CASE    "detects_opl"
        call    opl_detect
        mov     [chip], al
        xor     ah, ah
        mov     cx, ax
        cmp     ax, 2
        jb      .nochip
        cmp     ax, 3
        jbe     .chipok
.nochip:
        mov     cx, 2
.chipok:
        call    t_check
        ENDCASE
        mov     dx, s_none
        cmp     byte [chip], 2
        jne     .not2
        mov     dx, s_opl2
.not2:
        cmp     byte [chip], 3
        jne     .say
        mov     dx, s_opl3
.say:
        call    t_print

        CASE    "pitch_matches_formula"
        mov     si, pf_divs
.pitch:
        SINK_CLEAR
        mov     bx, [si]
        call    opl_note_on
        mov     bx, [si]
        call    expect_pitch            ; CL = block, AX = F-number
        mov     di, ax
        shl     cl, 1
        shl     cl, 1
        mov     al, ah
        or      al, cl
        or      al, 20h
        mov     [tv], al                ; expected B8h
        mov     bx, 0A8h
        call    sink_last
        mov     cx, di
        xor     ch, ch
        call    t_check
        mov     bx, 0B8h
        call    sink_last
        mov     cl, [tv]
        xor     ch, ch
        call    t_check
        add     si, 2
        cmp     si, pf_end
        jb      .pitch
        ENDCASE

        REGCASES 2, "opl2"
        REGCASES 3, "opl3"

        jmp     t_done

; Listening mode: the faithful voice, then each patch, a second each at 440 Hz.
listen:
        call    opl_detect
        or      al, al
        jnz     .found
        mov     dx, s_none
        call    t_print
        mov     ax, 4C01h
        int     21h
.found:
        push    ax
        mov     dx, s_listen
        call    t_print
        mov     dx, opl_patch_names
        call    t_print
        mov     dx, s_crlf
        call    t_print
        pop     ax
        call    opl_init
        mov     al, 15
        call    opl_set_volume
        mov     byte [tv], 0
.voice:
        mov     dx, s_voice
        call    t_print
        mov     dl, [tv]
        add     dl, '0'
        call    t_putc
        mov     dx, s_crlf
        call    t_print
        mov     al, [tv]
        call    opl_set_voice
        mov     bx, A4
        call    opl_note_on
        mov     ax, 18
        call    wait_ticks
        call    opl_note_off
        mov     ax, 6
        call    wait_ticks
        inc     byte [tv]
        cmp     byte [tv], 5
        jb      .voice
        call    opl_shutdown
        mov     ax, 4C00h
        int     21h

pf_divs         dw      193, 385, 1193, 1536, 1537, 24576, 24577, 59659
pf_end:

s_opl2          db      "INFO OPL2 detected", 13, 10, '$'
s_opl3          db      "INFO OPL3 detected", 13, 10, '$'
s_none          db      "No OPL detected", 13, 10, '$'
s_listen        db      "Voices: 0 faithful, $"
s_voice         db      "voice $"

chip            db      0
tv              db      0
sink_on         db      0
sink_n          dw      0
sink_buf        times SINK_MAX * 4 db 0
