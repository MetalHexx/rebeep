; T_OPL - detects the real OPL at 388h, then checks the register writes the OPL
; target makes through a recording sink (once as an OPL2, once as an OPL3).
; T_OPL /L is the listening mode: it plays the faithful voice, then the four factory
; patches' records and, on an OPL3, a four-operator patch, through the real ports.
; SPDX-License-Identifier: MIT

        cpu     8086
        org     100h

%include "speaker.inc"

%define OPL_TEST_SINK sink

SINK_MAX        equ 512         ; entries of 4 bytes: register word, value byte, pad
                                ; a case that reads the log clears it first
A4              equ 2711        ; 1,193,182 / 440 Hz
ORGAN_MOD_TL    equ 18h         ; the Organ record's 40h bytes (blk_organ)
ORGAN_CAR_TL    equ 08h

        jmp     start

%include "engine/opl.asm"
%include "startup/opldet.asm"
%include "testlib.inc"

; A patch block as RB_STATE holds one from RBS_PATCH on: the name (18 bytes), the octave, the
; flags, the two-operator record and the four-operator record (here all zero).
%macro BLOCK 3+
%%name: db      %1, 0
        times 18 - ($ - %%name) db 0
        db      %2, RBS_PF_LOADED
        db      %3
        times 22 db 0
%endmacro

; The four factory patches' records, as the patch files give them.
blk_organ       BLOCK   "ORGAN", 4, 22h, 21h, 18h, 08h, 0F0h, 0F0h, 0Ch, 0Ch, 00h, 00h, 01h
blk_flute       BLOCK   "FLUTE", 4, 21h, 21h, 28h, 00h, 0B0h, 0C0h, 0Ah, 0Ah, 00h, 00h, 00h
blk_brass       BLOCK   "BRASS", 4, 21h, 21h, 10h, 00h, 0E0h, 0F0h, 0Bh, 0Bh, 00h, 00h, 0Ah
blk_bell        BLOCK   "BELL", 4, 23h, 21h, 20h, 00h, 0F0h, 0F4h, 2Ah, 2Ah, 00h, 00h, 00h
; Waveforms 7 and 5: an OPL2 keeps only the low two bits of E0h.
blk_wave        BLOCK   "WAVE", 4, 21h, 21h, 20h, 00h, 0F0h, 0F0h, 0Ch, 0Ch, 07h, 05h, 00h
; The octave under test is written into this one.
blk_oct         BLOCK   "OCTAVE", 4, 21h, 21h, 28h, 00h, 0B0h, 0C0h, 0Ah, 0Ah, 00h, 00h, 00h
; A copy of a block, for the cases that overwrite the one a voice was set from.
blk_scr         times PBLK_LEN db 0

; The four-operator patches, one per connection (FM-FM, AM-FM, FM-AM, AM-AM): a two-operator
; record (the Bell's), then op1..op4 of 20h, 40h, 60h, 80h and E0h, then the two C0h bytes.
; Every operator has a value of its own, so a slot that lands in the wrong register shows.
; The 40h values carry key scale levels, which volume keeps (op2: 1, op4: 3).
%macro BLOCK4 3+
%%name: db      %1, 0
        times 18 - ($ - %%name) db 0
        db      %2, RBS_PF_LOADED | RBS_PF_4OP
        db      %3
%endmacro
%define REC2_OF4 23h, 21h, 20h, 00h, 0F0h, 0F4h, 2Ah, 2Ah, 00h, 00h, 00h
%define OPS4    22h, 21h, 23h, 20h, 18h, 48h, 14h, 0CCh, 0F0h, 0F1h, 0F2h, 0F3h
%define OPS4B   05h, 06h, 07h, 08h, 00h, 01h, 02h, 03h
blk_fmfm        BLOCK4  "FMFM", 4, REC2_OF4, OPS4, OPS4B, 0Ah, 00h
blk_amfm        BLOCK4  "AMFM", 4, REC2_OF4, OPS4, OPS4B, 0Bh, 00h
blk_fmam        BLOCK4  "FMAM", 4, REC2_OF4, OPS4, OPS4B, 0Ah, 01h
blk_amam        BLOCK4  "AMAM", 4, REC2_OF4, OPS4, OPS4B, 0Bh, 01h
blocks4         dw      blk_fmfm, blk_amfm, blk_fmam, blk_amam
; Entry 0 is unused: voice 0 is the faithful voice. Entry 5 is a four-operator patch, for /L.
blocks          dw      blk_organ, blk_organ, blk_flute, blk_brass, blk_bell, blk_fmam

; route_n: AL = 0 to 3, the four-operator patch of that connection. Out: SI = the block.
route_n:
        push    bx
        xor     ah, ah
        mov     bx, ax
        shl     bx, 1
        mov     si, [blocks4 + bx]
        mov     al, 1
        pop     bx
        jmp     opl_set_voice

; voice_n: AL = 0 the faithful voice, 1 to 4 the factory patch of that number. Out: SI = the
; block, as opl_set_voice keeps it.
voice_n:
        push    bx
        xor     ah, ah
        mov     bx, ax
        shl     bx, 1
        mov     si, [blocks + bx]
        or      al, al
        jz      .go
        mov     al, 1
.go:
        pop     bx
        jmp     opl_set_voice

; PATCH_AT block: AL = 1 and SI = the block, opl_set_voice's inputs for a patch.
%macro PATCH_AT 1
        mov     al, 1
        mov     si, %1
%endmacro

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

; The registers a two-operator ReBeep may write: 01h, 105h, the channel registers of
; channels 7 and 8, and their operators: 20h/40h/60h/80h/E0h + 11h/12h (modulators) or
; 14h/15h (carriers).
ok_regs2        dw      01h, 105h, 0A7h, 0B7h, 0C7h, 0A8h, 0B8h, 0C8h
                dw      31h, 34h, 51h, 54h, 71h, 74h, 91h, 94h, 0F1h, 0F4h
                dw      32h, 35h, 52h, 55h, 72h, 75h, 92h, 95h, 0F2h, 0F5h
OK2_N           equ     ($ - ok_regs2) / 2
; A four-operator one adds 104h, pairs A and B's channel registers (the first channel's for
; the frequency and key, both channels' C0h) and their operators on bank 1: slots 00h,
; 03h, 08h, 0Bh and one more for pair B.
%macro OKOPS 1
        dw      100h + %1 + 00h, 100h + %1 + 01h, 100h + %1 + 03h, 100h + %1 + 04h
        dw      100h + %1 + 08h, 100h + %1 + 09h, 100h + %1 + 0Bh, 100h + %1 + 0Ch
%endmacro
                dw      104h, 1A0h, 1A1h, 1B0h, 1B1h, 1C0h, 1C1h, 1C3h, 1C4h
                OKOPS   20h
                OKOPS   40h
                OKOPS   60h
                OKOPS   80h
                OKOPS   0E0h
OK4_N           equ     ($ - ok_regs2) / 2

; twin_diff: Out: AX = 0 when every channel-7 voice register's last recorded
; value equals its channel-8 twin's, and the twin was written; otherwise the
; channel-8 register of the first pair that differs.
twin_diff:
        push    bx
        push    dx
        push    si
        mov     si, twins
.pair:
        cmp     si, twins_end
        jae     .same
        mov     bx, [si + 2]
        call    sink_last
        cmp     ax, 0FFFFh
        je      .differ
        mov     dx, ax
        mov     bx, [si]
        call    sink_last
        cmp     ax, dx
        jne     .differ
        add     si, 4
        jmp     .pair
.differ:
        mov     ax, [si + 2]
        jmp     .out
.same:
        xor     ax, ax
.out:
        pop     si
        pop     dx
        pop     bx
        ret

; (channel 7, channel 8) pairs: the operators and C0h. Pitch (A0h/B0h) is per note.
twins           dw      31h, 32h, 34h, 35h, 51h, 52h, 54h, 55h, 71h, 72h
                dw      74h, 75h, 91h, 92h, 94h, 95h, 0F1h, 0F2h, 0F4h, 0F5h
                dw      0C7h, 0C8h
twins_end:

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

; oct_expect: BX = divisor, DL = a patch's octave. Out: CL = block, AX = F-number: expect_pitch's,
; the block moved by octave - 4 and held to 0..7, the F-number doubled (to 1023 at most) or
; halved for what the block could not take.
oct_expect:
        push    dx
        call    expect_pitch
        sub     dl, 4
        mov     ch, cl
        add     ch, dl                  ; CH = block + shift, -4 to 10
        cmp     ch, 0
        jl      .below
        cmp     ch, 7
        jg      .above
        mov     cl, ch
        jmp     .done
.above:
        sub     ch, 7
        mov     cl, ch
        shl     ax, cl
        cmp     ax, 1023
        jbe     .top
        mov     ax, 1023
.top:
        mov     cl, 7
        jmp     .done
.below:
        neg     ch
        mov     cl, ch
        shr     ax, cl
        xor     cl, cl
.done:
        pop     dx
        ret

; rec_check: SI = an 11-byte voice record, DL = the mask E0h's values are held to, DH = the
; bits C0h gains. Out: AX = 0 when the last values written to both channels' operators and
; C0h are the record's, else the first register that differs.
rec_check:
        push    bx
        push    cx
        push    di
        xor     di, di
.byte:
        mov     bx, si
        add     bx, di
        mov     al, [bx]
        cmp     di, 8
        jb      .plain
        and     al, dl
.plain:
        mov     cl, al
        xor     ch, ch
        mov     bl, [rc_regs + di]
        xor     bh, bh
        call    sink_last
        cmp     ax, cx
        jne     .bad
        inc     bx
        call    sink_last
        cmp     ax, cx
        jne     .bad
        inc     di
        cmp     di, 10
        jb      .byte
        mov     al, [si + 10]
        or      al, dh
        mov     cl, al
        xor     ch, ch
        mov     bx, 0C7h
        call    sink_last
        cmp     ax, cx
        jne     .bad
        inc     bx
        call    sink_last
        cmp     ax, cx
        jne     .bad
        xor     ax, ax
        jmp     .out
.bad:
        mov     ax, bx
.out:
        pop     di
        pop     cx
        pop     bx
        ret

; Channel 7's register for each byte of a voice record; channel 8's is one more.
rc_regs         db      31h, 34h, 51h, 54h, 71h, 74h, 91h, 94h, 0F1h, 0F4h

; rec4_check: SI = a 22-byte four-operator record, DL = the mask E0h's values are held to,
; DH = the bits the C0h bytes gain. Out: AX = 0 when the last values written to pair A's
; and pair B's operators (bank 1) and C0h bytes are the record's, else the first register
; that differs.
rec4_check:
        push    bx
        push    cx
        push    di
        xor     di, di
.byte:
        mov     bx, si
        add     bx, di
        mov     al, [bx]
        cmp     di, 16
        jb      .plain
        and     al, dl
.plain:
        mov     cl, al
        xor     ch, ch
        mov     bl, [rc4_regs + di]
        mov     bh, 1
        call    sink_last
        cmp     ax, cx
        jne     .bad
        inc     bx
        call    sink_last
        cmp     ax, cx
        jne     .bad
        inc     di
        cmp     di, 20
        jb      .byte
        mov     al, [si + 20]
        or      al, dh
        mov     cl, al
        xor     ch, ch
        mov     bx, 1C0h
        call    sink_last
        cmp     ax, cx
        jne     .bad
        inc     bx
        call    sink_last
        cmp     ax, cx
        jne     .bad
        mov     al, [si + 21]
        or      al, dh
        mov     cl, al
        xor     ch, ch
        mov     bx, 1C3h
        call    sink_last
        cmp     ax, cx
        jne     .bad
        inc     bx
        call    sink_last
        cmp     ax, cx
        jne     .bad
        xor     ax, ax
        jmp     .out
.bad:
        mov     ax, bx
.out:
        pop     di
        pop     cx
        pop     bx
        ret

; Pair A's register for each byte of a four-operator record, without the bank bit; pair B's
; is one more.
rc4_regs        db      20h, 23h, 28h, 2Bh, 40h, 43h, 48h, 4Bh, 60h, 63h, 68h, 6Bh
                db      80h, 83h, 88h, 8Bh, 0E0h, 0E3h, 0E8h, 0EBh

; tl4_check: SI = 4 TL bytes, one per operator. Out: AX = 0 when the last 40h written to
; each operator of pair A and of pair B (bank 1) is its byte, else the first register that differs.
tl4_check:
        push    bx
        push    cx
        push    di
        xor     di, di
.op:
        mov     bx, si
        add     bx, di
        mov     cl, [bx]
        xor     ch, ch
        mov     bl, [rc4_regs + 4 + di]
        mov     bh, 1
        call    sink_last
        cmp     ax, cx
        jne     .bad
        inc     bx
        call    sink_last
        cmp     ax, cx
        jne     .bad
        inc     di
        cmp     di, 4
        jb      .op
        xor     ax, ax
        jmp     .out
.bad:
        mov     ax, bx
.out:
        pop     di
        pop     cx
        pop     bx
        ret

; The TLs op1..op4 end up with at volume 7 (4 * 8 = 32 more, held to 63, key scale bits kept):
; only the carriers of the connection (FM-FM, AM-FM, FM-AM, AM-AM) are scaled. Then volume 0:
; the carriers at 63.
tl4_v7          db      18h, 48h, 14h, 0ECh,  38h, 48h, 14h, 0ECh,  18h, 68h, 14h, 0ECh,  38h, 48h, 34h, 0ECh
tl4_v0          db      18h, 48h, 14h, 0FFh,  3Fh, 48h, 14h, 0FFh,  18h, 7Fh, 14h, 0FFh,  3Fh, 48h, 3Fh, 0FFh

; tl4_row: AL = 0 to 3 (the connection), BX = tl4_v7 or tl4_v0. Out: SI = that connection's row.
tl4_row:
        push    ax
        xor     ah, ah
        shl     ax, 1
        shl     ax, 1
        add     ax, bx
        mov     si, ax
        pop     ax
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

STACK_MAX       equ 16          ; bytes, return address included
STK_AREA        equ 64
PROBES          equ 21

; STK_FILL: sentinel-fill the STK_AREA bytes below SP. Clobbers AX, CX, DI.
%macro STK_FILL 0
        cld
        mov     di, sp
        sub     di, STK_AREA
        mov     cx, STK_AREA / 2
        mov     ax, 0A5A5h
        rep stosw
%endmacro

; STK_DEPTH: AX = bytes below the fill's SP that were touched since it.
%macro STK_DEPTH 0
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

; PROBE setup, routine: the stack the routine touches, on the real ports.
%macro PROBE 2
        STK_FILL
        %1
        call    %2
        STK_DEPTH
        call    stk_note
%endmacro

; stk_note: AX = a depth; keeps it in deeps and tracks the largest in deep.
stk_note:
        mov     bx, [deep_n]
        mov     [deeps + bx], ax
        add     word [deep_n], 2
        cmp     ax, [deep]
        jbe     .done
        mov     [deep], ax
.done:
        ret

; PRES ax, bx, routine, check_al: load sentinels, call, and require every
; register (AL only when check_al) to come back unchanged.
%macro PRES 4-5 3333h
        mov     ax, %1
        mov     bx, %2
        mov     cx, 1111h
        mov     dx, 2222h
        mov     si, %5
        mov     di, 4444h
        mov     bp, 5555h
        call    %3
        cmp     ah, (%1) >> 8
        jne     %%bad
%if %4
        cmp     al, (%1) & 0FFh
        jne     %%bad
%endif
        cmp     bx, %2
        jne     %%bad
        cmp     cx, 1111h
        jne     %%bad
        cmp     dx, 2222h
        jne     %%bad
        cmp     si, %5
        jne     %%bad
        cmp     di, 4444h
        jne     %%bad
        cmp     bp, 5555h
        jne     %%bad
        xor     ax, ax
        jmp     %%chk
%%bad:
        mov     ax, 1
%%chk:
        xor     cx, cx
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
        LASTWM  0B7h, 20h, 0
        ENDCASE

%strcat cname "output_bits_", %2
        CASE    cname
        SINK_CLEAR
        mov     al, %1
        call    opl_init
        mov     byte [tv], 0
%%ovoice:
        mov     al, [tv]
        call    voice_n
%if %1 == 3
        mov     cx, 30h
%else
        xor     cx, cx
%endif
        mov     bx, 0C8h
        call    sink_last
        cmp     ax, 0FFFFh
        je      %%onone
        and     ax, 30h
%%onone:
        call    t_check
        mov     bx, 0C7h
        call    sink_last
        cmp     ax, 0FFFFh
        je      %%onone7
        and     ax, 30h
%%onone7:
        call    t_check
        inc     byte [tv]
        cmp     byte [tv], 5
        jb      %%ovoice
        ENDCASE

%strcat cname "faithful_voice_", %2
        CASE    cname
        SINK_CLEAR
        mov     al, %1
        call    opl_init
        xor     al, al
        call    opl_set_voice
        LASTW   60h + 12h, 0D0h         ; attack 13, decay 0
        LASTW   60h + 15h, 0D0h
        LASTW   80h + 12h, 0Dh          ; sustain level 0, release 13
        LASTW   80h + 15h, 0Dh
%if %1 == 3
        LASTW   20h + 15h, 21h
        LASTW   40h + 12h, 3Fh
        LASTW   0E0h + 15h, 06h
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
        SINK_CLEAR
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
        SINK_CLEAR
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

%strcat cname "only_channels_7_8_", %2
        CASE    cname
        SINK_CLEAR
        mov     al, %1
        call    opl_init
        mov     byte [tv], 0
%%svoice:
        mov     al, [tv]
        call    voice_n
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
        mov     bx, A4                  ; a second note, on the other channel
        call    opl_note_on
        call    opl_note_off
        call    opl_shutdown
        mov     al, 15
        call    opl_set_volume
        mov     ax, [sink_n]
        cmp     ax, SINK_MAX * 4
        mov     ax, 1
        jae     %%checked               ; the log overflowed: cannot vouch for it
        mov     bp, ok_regs2
        mov     cx, OK2_N
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
        LASTWM  0B7h, 20h, 0
        LASTW   40h + 15h, 3Fh
        LASTW   40h + 14h, 3Fh
%if %1 == 3
        LASTW   105h, 00h
%else
        LASTW   105h, 0FFFFh
%endif
        ENDCASE

; Each new note takes the other channel; the one before is left keyed off, and a
; pitch change or key-off touches the sounding note's channel alone.
%strcat cname "alternates_channels_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        SINK_CLEAR
        mov     bx, 1193
        call    opl_note_on
        LASTWM  0B8h, 20h, 20h          ; the first note after init is on 8
        call    opl_note_off
        LASTWM  0B8h, 20h, 0
        mov     bx, A4
        call    opl_note_on
        LASTWM  0B7h, 20h, 20h
        LASTWM  0B8h, 20h, 0
        SINK_CLEAR
        mov     bx, 1500
        call    opl_pitch
        LASTWM  0B7h, 20h, 20h
        LASTW   0A8h, 0FFFFh
        LASTW   0B8h, 0FFFFh
        SINK_CLEAR
        call    opl_note_off
        LASTWM  0B7h, 20h, 0
        LASTW   0B8h, 0FFFFh
        mov     bx, 1193
        call    opl_note_on
        LASTWM  0B8h, 20h, 20h          ; and back to 8
        LASTWM  0B7h, 20h, 0
        call    opl_note_off
        ENDCASE

; A note on with no note off before it keys the sounding channel off first.
%strcat cname "retrigger_keys_old_off_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     bx, 1193
        call    opl_note_on
        SINK_CLEAR
        mov     bx, A4
        call    opl_note_on
        LASTWM  0B8h, 20h, 0
        LASTWM  0B7h, 20h, 20h
        call    opl_note_off
        ENDCASE

; Volume scales an additive voice's modulators with its carriers (Organ: C0h bit 0 set),
; and leaves an FM voice's modulators alone (Flute).
%strcat cname "additive_volume_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     al, 1
        call    voice_n
        SINK_CLEAR
        mov     al, 7
        call    opl_set_volume
        LASTW   40h + 11h, ORGAN_MOD_TL + (15 - 7) * 4
        LASTW   40h + 12h, ORGAN_MOD_TL + (15 - 7) * 4
        LASTW   40h + 15h, ORGAN_CAR_TL + (15 - 7) * 4
        mov     al, 15
        call    opl_set_volume
        LASTW   40h + 12h, ORGAN_MOD_TL
        mov     al, 2
        call    voice_n
        SINK_CLEAR
        mov     al, 7
        call    opl_set_volume
        LASTW   40h + 12h, 0FFFFh
        mov     al, 15
        call    opl_set_volume
        xor     al, al
        call    opl_set_voice
        ENDCASE

; Volume 0 keys nothing, through a note on or a pitch change; a volume back up keys again.
%strcat cname "mute_keys_nothing_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        xor     al, al
        call    opl_set_volume
        SINK_CLEAR
        mov     bx, 1193
        call    opl_note_on
        LASTWM  0B8h, 20h, 0
        mov     bx, A4
        call    opl_pitch
        LASTWM  0B8h, 20h, 0
        call    opl_note_off
        mov     al, 15
        call    opl_set_volume
        mov     bx, 1193
        call    opl_note_on
        LASTWM  0B7h, 20h, 20h
        call    opl_note_off
        ENDCASE

; A patch's record reaches both channels' operators and C0h as it is, whatever the chip
; allows: an OPL2 keeps waveforms 0 to 3.
%strcat cname "patch_records_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     al, 15
        call    opl_set_volume
        mov     byte [tv], 1
%%prec:
        SINK_CLEAR
        mov     al, [tv]
        call    voice_n
        add     si, PB_REC2
        mov     dl, 0FFh
        xor     dh, dh
%if %1 == 3
        mov     dh, 30h                 ; OPL3's output enables join C0h
%endif
        call    rec_check
        xor     cx, cx
        call    t_check
        inc     byte [tv]
        cmp     byte [tv], 5
        jb      %%prec
        SINK_CLEAR
        mov     si, blk_wave
        mov     al, 1
        call    opl_set_voice
        mov     si, blk_wave + PB_REC2
%if %1 == 3
        mov     dx, 3000h + 0FFh
%else
        mov     dx, 03h
%endif
        call    rec_check
        xor     cx, cx
        call    t_check
        xor     al, al
        call    opl_set_voice
        ENDCASE

; A patch's octave moves the block by octave - 4, and at block 7 or 0 scales the F-number.
%strcat cname "octave_shift_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     al, 15
        call    opl_set_volume
        mov     word [tw], od_divs
%%div:
        mov     byte [tv], 0
%%oct:
        mov     al, [tv]
        mov     [blk_oct + PB_OCTAVE], al
        mov     al, 1
        mov     si, blk_oct
        call    opl_set_voice
        SINK_CLEAR
        mov     bx, [tw]
        mov     bx, [bx]
        call    opl_note_on
        mov     bx, [tw]
        mov     bx, [bx]
        mov     dl, [tv]
        call    oct_expect              ; CL = block, AX = F-number
        mov     di, ax
        shl     cl, 1
        shl     cl, 1
        mov     al, ah
        or      al, cl
        or      al, 20h
        mov     [tv2], al               ; the B0h value expected
        mov     bx, 0A0h
        add     bl, [opl_ch]
        call    sink_last
        mov     cx, di
        xor     ch, ch
        call    t_check
        mov     bx, 0B0h
        add     bl, [opl_ch]
        call    sink_last
        mov     cl, [tv2]
        xor     ch, ch
        call    t_check
        call    opl_note_off
        inc     byte [tv]
        cmp     byte [tv], 8
        jb      %%oct
        add     word [tw], 2
        cmp     word [tw], od_end
        jb      %%div
        ENDCASE

; The faithful voice plays at the game's pitch again after a patch with another octave.
%strcat cname "faithful_octave_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     byte [blk_oct + PB_OCTAVE], 7
        mov     al, 1
        mov     si, blk_oct
        call    opl_set_voice
        xor     al, al
        call    opl_set_voice
        SINK_CLEAR
        mov     bx, A4
        call    opl_note_on
        mov     bx, A4
        mov     dl, 4
        call    oct_expect
        mov     di, ax
        mov     bx, 0A0h
        add     bl, [opl_ch]
        call    sink_last
        mov     cx, di
        xor     ch, ch
        call    t_check
        call    opl_note_off
        mov     byte [blk_oct + PB_OCTAVE], 4
        ENDCASE

; Both channels carry the same voice and volume, and shutdown silences both.
%strcat cname "both_channels_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     byte [tv], 0
%%bvoice:
        SINK_CLEAR
        mov     al, [tv]
        call    voice_n
        call    twin_diff
        xor     cx, cx
        call    t_check
        inc     byte [tv]
        cmp     byte [tv], 5
        jb      %%bvoice
        SINK_CLEAR
        mov     al, 7
        call    opl_set_volume
        mov     bx, 40h + 15h
        call    sink_last
        mov     cx, ax
        mov     bx, 40h + 14h
        call    sink_last
        cmp     cx, 0FFFFh
        jne     %%vset
        xor     cx, cx                  ; 55h never written: fail
%%vset:
        call    t_check
        mov     bx, 1193
        call    opl_note_on
        SINK_CLEAR
        call    opl_shutdown
        LASTWM  0B7h, 20h, 0
        LASTWM  0B8h, 20h, 0
        LASTW   40h + 14h, 3Fh
        LASTW   40h + 15h, 3Fh
        mov     al, 15
        call    opl_set_volume
        ENDCASE

; A four-operator patch programs both pairs' operators and C0h on an OPL3, whatever its
; connection, with 104h joining the pairs; an OPL2 plays the patch's two-operator record.
%strcat cname "fourop_slots_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     al, 15
        call    opl_set_volume
        mov     byte [tv], 0
%%route:
        xor     al, al
        call    opl_set_voice           ; from two-operator, so that every connection is a switch
        SINK_CLEAR
        mov     al, [tv]
        call    route_n
%if %1 == 3
        LASTW   104h, 18h
        add     si, PB_REC4
        mov     dx, 30FFh               ; OPL3's output enables join the C0h bytes
        call    rec4_check
%else
        LASTW   104h, 0FFFFh
        LASTW   1C0h, 0FFFFh
        add     si, PB_REC2
        mov     dx, 00FFh
        call    rec_check
%endif
        xor     cx, cx
        call    t_check
        inc     byte [tv]
        cmp     byte [tv], 4
        jb      %%route
        xor     al, al
        call    opl_set_voice
%if %1 == 3
        LASTW   104h, 00h
%endif
        ENDCASE

%if %1 == 3
; Notes alternate between pairs A and B, keyed through their first channel; a glide stays on
; the pair and keeps its key bit.
%strcat cname "fourop_alternates_pairs_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     al, 15
        call    opl_set_volume
        xor     al, al
        call    route_n
        SINK_CLEAR
        mov     bx, 1193
        call    opl_note_on
        LASTWM  1B1h, 20h, 20h          ; the first note is on pair B
        LASTWM  1B0h, 20h, 0
        call    opl_note_off
        LASTWM  1B1h, 20h, 0
        mov     bx, A4
        call    opl_note_on
        LASTWM  1B0h, 20h, 20h
        LASTWM  1B1h, 20h, 0
        SINK_CLEAR
        mov     bx, 1500
        call    opl_pitch
        LASTWM  1B0h, 20h, 20h
        WROTE   1A0h
        LASTW   1A1h, 0FFFFh
        LASTW   1B1h, 0FFFFh
        LASTW   1A3h, 0FFFFh            ; the second channels are never tuned or keyed
        LASTW   1B3h, 0FFFFh
        LASTW   1B4h, 0FFFFh
        SINK_CLEAR
        call    opl_note_off
        LASTWM  1B0h, 20h, 0
        LASTW   1B1h, 0FFFFh
        mov     bx, 1193
        call    opl_note_on
        LASTWM  1B1h, 20h, 20h          ; and back to B
        LASTWM  1B0h, 20h, 0
        call    opl_note_off
        xor     al, al
        call    opl_set_voice
        ENDCASE

; Volume scales the carriers of the connection and no other operator, on both pairs; volume 0
; puts them at 63 and keys nothing.
%strcat cname "fourop_volume_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     byte [tv], 0
%%tvol:
        xor     al, al
        call    opl_set_voice
        mov     al, 7
        call    opl_set_volume
        SINK_CLEAR
        mov     al, [tv]
        call    route_n
        mov     al, [tv]
        mov     bx, tl4_v7
        call    tl4_row
        call    tl4_check
        xor     cx, cx
        call    t_check
        xor     al, al
        call    opl_set_volume
        mov     al, [tv]
        mov     bx, tl4_v0
        call    tl4_row
        call    tl4_check
        xor     cx, cx
        call    t_check
        inc     byte [tv]
        cmp     byte [tv], 4
        jb      %%tvol
        mov     bx, 1193
        call    opl_note_on
        LASTWM  1B1h, 20h, 0
        call    opl_note_off
        mov     al, 15
        call    opl_set_volume
        xor     al, al
        call    opl_set_voice
        ENDCASE

; Changing between two- and four-operator play keys off the sounding channel or pair before
; 104h changes under it; a change between four-operator patches leaves the note alone.
%strcat cname "fourop_switch_keys_off_first_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     al, 15
        call    opl_set_volume
        xor     al, al
        call    opl_set_voice
        mov     bx, 1193
        call    opl_note_on             ; a two-operator note, on channel 8
        SINK_CLEAR
        xor     al, al
        call    route_n
        LASTWM  0B8h, 20h, 0
        LASTW   104h, 18h
        BEFORE  0B8h, 104h
        mov     bx, 1193
        call    opl_note_on             ; pair B
        LASTWM  1B1h, 20h, 20h
        SINK_CLEAR
        mov     al, 1
        call    route_n
        LASTW   104h, 0FFFFh
        LASTW   1B0h, 0FFFFh
        LASTW   1B1h, 0FFFFh
        SINK_CLEAR
        xor     al, al
        call    opl_set_voice           ; back to the faithful voice
        LASTWM  1B1h, 20h, 0
        LASTW   104h, 00h
        BEFORE  1B1h, 104h
        mov     bx, A4
        call    opl_note_on
        LASTWM  0B8h, 20h, 20h          ; the next note is two-operator again
        LASTWM  0B7h, 20h, 0
        call    opl_note_off
        ENDCASE

; The mode is the one set with the voice: a block overwritten by the next voice's (a change
; copies it in before it applies) does not change how the sounding pair is left.
%strcat cname "fourop_mode_is_latched_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     al, 15
        call    opl_set_volume
        xor     al, al
        call    opl_set_voice
        cld
        mov     si, blk_fmfm
        mov     di, blk_scr
        mov     cx, PBLK_LEN
        rep movsb
        mov     al, 1
        mov     si, blk_scr
        call    opl_set_voice
        mov     bx, 1193
        call    opl_note_on             ; pair B sounds
        mov     si, blk_organ
        mov     di, blk_scr
        mov     cx, PBLK_LEN
        rep movsb                       ; a two-operator patch, flags bit 1 clear
        SINK_CLEAR
        mov     al, 1
        mov     si, blk_scr
        call    opl_set_voice
        LASTWM  1B1h, 20h, 0
        LASTW   104h, 00h
        BEFORE  1B1h, 104h
        mov     si, blk_scr + PB_REC2
        mov     dx, 30FFh
        call    rec_check               ; and it plays the new block's record
        xor     cx, cx
        call    t_check
        mov     al, 1
        mov     si, blk_fmfm
        call    opl_set_voice
        mov     bx, 1193
        call    opl_note_on
        mov     byte [blk_fmfm + PB_FLAGS], RBS_PF_LOADED       ; only the flags cleared, as a refused /P: does
        SINK_CLEAR
        mov     al, 1
        mov     si, blk_fmfm
        call    opl_set_voice
        mov     byte [blk_fmfm + PB_FLAGS], RBS_PF_LOADED | RBS_PF_4OP
        LASTWM  1B1h, 20h, 0
        LASTW   104h, 00h
        BEFORE  1B1h, 104h
        xor     al, al
        call    opl_set_voice
        ENDCASE

; Shutdown silences the carriers of both pairs, keys both off, then clears 104h and 105h.
%strcat cname "fourop_shutdown_", %2
        CASE    cname
        mov     al, %1
        call    opl_init
        mov     al, 15
        call    opl_set_volume
        mov     al, 3
        call    route_n                 ; AM-AM: operators 1, 3 and 4 are the carriers
        mov     bx, 1193
        call    opl_note_on
        SINK_CLEAR
        call    opl_shutdown
        LASTWM  140h, 3Fh, 3Fh
        LASTWM  141h, 3Fh, 3Fh
        LASTWM  148h, 3Fh, 3Fh
        LASTWM  149h, 3Fh, 3Fh
        LASTWM  14Bh, 3Fh, 3Fh
        LASTWM  14Ch, 3Fh, 3Fh
        LASTW   143h, 0FFFFh
        LASTW   144h, 0FFFFh
        LASTWM  1B0h, 20h, 0
        LASTWM  1B1h, 20h, 0
        LASTW   104h, 00h
        LASTW   105h, 00h
        BEFORE  1B1h, 104h
        BEFORE  104h, 105h
        mov     al, %1
        call    opl_init
        ENDCASE

; Only pairs A and B's registers, the globals and channels 7 and 8's (keyed off on the way
; in) are written: no other channel, and no other pair.
%strcat cname "fourop_only_pairs_a_b_", %2
        CASE    cname
        SINK_CLEAR
        mov     al, %1
        call    opl_init
        mov     byte [tv], 0
%%pvoice:
        mov     al, [tv]
        call    route_n
        mov     al, 7
        call    opl_set_volume
        mov     bx, 1193
        call    opl_note_on
        mov     bx, DIV_MIN
        call    opl_pitch
        mov     bx, DIV_MAX
        call    opl_pitch
        call    opl_note_off
        mov     bx, A4
        call    opl_note_on
        call    opl_note_off
        inc     byte [tv]
        cmp     byte [tv], 4
        jb      %%pvoice
        call    opl_shutdown
        mov     al, 15
        call    opl_set_volume
        mov     ax, [sink_n]
        cmp     ax, SINK_MAX * 4
        mov     ax, 1
        jae     %%pchecked              ; the log overflowed: cannot vouch for it
        mov     bp, ok_regs2
        mov     cx, OK4_N
        call    sink_stray
%%pchecked:
        xor     cx, cx
        call    t_check
        mov     al, %1
        call    opl_init
        ENDCASE
%endif
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
        mov     [tv], al                ; expected B0h of the note's channel
        mov     bx, 0A0h
        add     bl, [opl_ch]
        call    sink_last
        mov     cx, di
        xor     ch, ch
        call    t_check
        mov     bx, 0B0h
        add     bl, [opl_ch]
        call    sink_last
        mov     cl, [tv]
        xor     ch, ch
        call    t_check
        add     si, 2
        cmp     si, pf_end
        jb      .pitch
        ENDCASE

        ; Divisor 0 means 65536; it plays as 65535, the nearest the OPL's block 0 holds.
        CASE    "pitch_zero_is_lowest"
        mov     bx, 0FFFFh
        call    expect_pitch            ; CL = block, AX = F-number
        mov     di, ax
        shl     cl, 1
        shl     cl, 1
        mov     al, ah
        or      al, cl
        or      al, 20h
        mov     [tv], al
        SINK_CLEAR
        xor     bx, bx
        call    opl_note_on
        mov     bx, 0A0h
        add     bl, [opl_ch]
        call    sink_last
        mov     cx, di
        xor     ch, ch
        call    t_check
        mov     bx, 0B0h
        add     bl, [opl_ch]
        call    sink_last
        mov     cl, [tv]
        xor     ch, ch
        call    t_check
        call    opl_note_off
        ENDCASE

        REGCASES 2, "opl2"
        REGCASES 3, "opl3"

        CASE    "registers_preserved"
        SINK_CLEAR
        PRES    0AB00h, 1234h, opl_detect, 0
        PRES    0AB03h, 1234h, opl_init, 1
        PRES    0AB03h, 1234h, opl_set_voice, 1
        PRES    0ABF7h, 1234h, opl_set_voice, 1
        PRES    0AB01h, 1234h, opl_set_voice, 1, blk_flute
        PRES    0AB07h, 1234h, opl_set_volume, 1
        PRES    0ABF0h, 1234h, opl_set_volume, 1
        PRES    0AB66h, 1193, opl_note_on, 1
        PRES    0AB66h, A4, opl_pitch, 1
        PRES    0AB66h, 1234h, opl_note_off, 1
        PRES    0AB66h, 1234h, opl_shutdown, 1
        ; Four-operator play (the chip is an OPL3 by now): into it with and without a note keyed,
        ; between patches, out of it, and shut down in it.
        PRES    0AB01h, 1234h, opl_set_voice, 1, blk_fmfm
        PRES    0AB66h, 1193, opl_note_on, 1
        PRES    0AB01h, 1234h, opl_set_voice, 1, blk_amfm
        PRES    0AB66h, A4, opl_pitch, 1
        PRES    0AB07h, 1234h, opl_set_volume, 1
        PRES    0AB00h, 1234h, opl_set_voice, 1
        PRES    0AB66h, 1193, opl_note_on, 1
        PRES    0AB01h, 1234h, opl_set_voice, 1, blk_amam
        PRES    0AB66h, 1234h, opl_note_off, 1
        PRES    0AB66h, 1234h, opl_shutdown, 1
        ENDCASE

        ; Through the real ports, so the deepest call chain is the one measured.
        CASE    "stack_depth"
        mov     byte [sink_on], 0
        mov     word [deep], 0
        mov     word [deep_n], 0
        cli
        PROBE   {nop}, opl_detect
        PROBE   {mov al, 3}, opl_init
        PROBE   {mov al, 2}, opl_init
        PROBE   {PATCH_AT blk_organ}, opl_set_voice
        PROBE   {xor al, al}, opl_set_voice
        PROBE   {mov al, 7}, opl_set_volume
        PROBE   {mov bx, 1193}, opl_note_on
        PROBE   {mov bx, A4}, opl_pitch
        PROBE   {PATCH_AT blk_oct}, opl_set_voice
        PROBE   {mov bx, 193}, opl_pitch
        PROBE   {nop}, opl_note_off
        PROBE   {nop}, opl_shutdown
        ; Four-operator play: into it, a note, a glide, a volume, between patches, out of it
        ; (the deepest: it keys the pair off, then writes 104h), in again, and shut down in it.
        PROBE   {mov al, 3}, opl_init
        PROBE   {PATCH_AT blk_fmam}, opl_set_voice
        PROBE   {mov bx, 1193}, opl_note_on
        PROBE   {mov bx, A4}, opl_pitch
        PROBE   {mov al, 7}, opl_set_volume
        PROBE   {PATCH_AT blk_amam}, opl_set_voice
        PROBE   {xor al, al}, opl_set_voice
        PROBE   {PATCH_AT blk_fmam}, opl_set_voice
        PROBE   {nop}, opl_shutdown
        sti
        mov     byte [sink_on], 1
        mov     dx, s_stack
        call    t_print
        mov     si, deeps
.stkp:
        mov     ax, [si]
        call    t_printdec
        mov     dl, ' '
        call    t_putc
        add     si, 2
        cmp     si, deeps + PROBES * 2
        jb      .stkp
        mov     dx, s_crlf
        call    t_print
        mov     ax, [deep]
        mov     cx, STACK_MAX
        cmp     ax, cx
        ja      .stkcheck
        mov     ax, cx
.stkcheck:
        call    t_check
        ENDCASE

        jmp     t_done

; Listening mode: the faithful voice, then the four factory patches' records and, on an OPL3,
; a four-operator patch (FM-AM), a second each at 440 Hz.
listen:
        call    opl_detect
        or      al, al
        jnz     .found
        mov     dx, s_none
        call    t_print
        mov     ax, 4C01h
        int     21h
.found:
        mov     byte [lvoices], 5
        cmp     al, 3
        jne     .count
        inc     byte [lvoices]
.count:
        push    ax
        mov     dx, s_listen
        call    t_print
        pop     ax
        call    opl_init
        mov     al, 15
        call    opl_set_volume
        mov     byte [tv], 0
.voice:
        mov     dx, s_voice
        call    t_print
        mov     al, [tv]
        call    voice_n                 ; SI = the voice's block
        cmp     byte [tv], 0
        jne     .named
        mov     dx, s_faithful
        call    t_print
        jmp     .play
.named:
        push    si
.name:
        lodsb
        or      al, al
        jz      .named_end
        mov     dl, al
        call    t_putc
        jmp     .name
.named_end:
        pop     si
        mov     dx, s_crlf
        call    t_print
.play:
        mov     bx, A4
        call    opl_note_on
        mov     ax, 18
        call    wait_ticks
        call    opl_note_off
        mov     ax, 6
        call    wait_ticks
        inc     byte [tv]
        mov     al, [lvoices]
        cmp     [tv], al
        jb      .voice
        call    opl_shutdown
        mov     ax, 4C00h
        int     21h

pf_divs         dw      193, 385, 1193, 1536, 1537, 24576, 24577, 59659, 59660, 65535
pf_end:

; Divisors for the octave shifts: block 7 (the top), the middle, blocks 1 and 0.
od_divs         dw      193, 2711, 24577, 59660, 65535
od_end:

s_opl2          db      "INFO OPL2 detected", 13, 10, '$'
s_opl3          db      "INFO OPL3 detected", 13, 10, '$'
s_none          db      "No OPL detected", 13, 10, '$'
s_listen        db      "Voices: the faithful voice, then the factory patches, then (OPL3) a 4-OP patch", 13, 10, '$'
s_voice         db      "voice: $"
s_faithful      db      "faithful", 13, 10, '$'
s_stack         db      "INFO stack bytes per probe: $"

chip            db      0
lvoices         db      0               ; /L: how many voices to play
tv              db      0
tv2             db      0
tw              dw      0
deep            dw      0
deep_n          dw      0
deeps           times PROBES dw 0
sink_on         db      0
sink_n          dw      0
sink_buf        times SINK_MAX * 4 db 0
