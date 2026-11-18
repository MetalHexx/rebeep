; OPL render target: detects an OPL2/OPL3 at 388h and plays one voice on
; channel 8, either a faithful square wave or one of four built-in patches.
; Near calls; DS = this module's segment. Every routine preserves all
; registers except its outputs, and flags.
; Only channel 8's registers, the global 01h and (OPL3) 105h are ever written.
;
; Define OPL_TEST_SINK as a label before including this file and opl_write
; jumps there instead of touching the ports; detection still uses the ports.
; SPDX-License-Identifier: MIT

        cpu     8086
%include "speaker.inc"
%include "opl.inc"

; opl_detect: the standard AdLib timer test.
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
        push    ax
        call    opl_reset_timers
        pop     ax
        cmp     al, 0C0h
        jne     .none
        in      al, dx
        and     al, 06h
        jnz     .opl2
        mov     byte [opl_idx_reads], 2
        mov     byte [opl_data_reads], 2
        mov     al, 3
        jmp     .out
.opl2:
        mov     byte [opl_idx_reads], 6
        mov     byte [opl_data_reads], 35
        mov     al, 2
        jmp     .out
.none:
        xor     al, al
.out:
        pop     dx
        pop     cx
        pop     bx
        ret

opl_reset_timers:
        push    ax
        push    bx
        mov     bx, REG_TIMCTL
        mov     al, 60h
        call    opl_hw_write
        mov     al, 80h
        call    opl_hw_write
        pop     bx
        pop     ax
        ret

; opl_init: take over channel 8, key off, current voice and volume.
; In:  AL = 2 or 3 (the chip opl_detect found)
opl_init:
        push    ax
        push    bx
        mov     bx, 6 | (35 << 8)       ; OPL2 delays
        mov     ah, 2
        cmp     al, 3
        jne     .have
        mov     bx, 2 | (2 << 8)        ; OPL3 delays
        mov     ah, 3
.have:
        mov     [opl_idx_reads], bl
        mov     [opl_data_reads], bh
        mov     [opl_type], ah
        mov     bx, REG_TEST
        mov     al, 20h
        call    opl_write
        cmp     byte [opl_type], 3
        jne     .opl2
        mov     bx, REG_NEW
        mov     al, 01h
        call    opl_write
.opl2:
        mov     byte [opl_keyed], 0
        call    opl_put_keyblk
        call    opl_program
        pop     bx
        pop     ax
        ret

; opl_set_voice: reprogram channel 8's operators; the key state is untouched.
; In:  AL = 0 faithful, 1..4 patch (anything else is faithful)
opl_set_voice:
        cmp     al, 4
        jbe     .ok
        xor     al, al
.ok:
        mov     [opl_voice], al
        jmp     opl_program

; opl_set_volume: In: AL = 0..15 (0 silent; larger values count as 15)
opl_set_volume:
        cmp     al, 15
        jbe     .ok
        mov     al, 15
.ok:
        mov     [opl_vol], al
        jmp     opl_put_volume

; opl_note_on: In: BX = divisor (DIV_MIN..DIV_MAX)
opl_note_on:
        mov     byte [opl_keyed], 1

; opl_pitch: retune without touching the key bit, so a sounding note glides
; instead of retriggering. In: BX = divisor
opl_pitch:
        push    ax
        push    bx
        push    cx
        push    dx
        cmp     bx, DIV_MIN
        jae     .lo
        mov     bx, DIV_MIN
.lo:
        cmp     bx, DIV_MAX
        jbe     .hi
        mov     bx, DIV_MAX
.hi:
        ; Block b suits divisor d when (3 << (23 - b)) / d <= 1023, that is
        ; d > 24576 >> b. Take the smallest such block for the best resolution.
        xor     cl, cl
        mov     dx, 24576
.block:
        cmp     bx, dx
        ja      .got
        cmp     cl, 7
        je      .got
        shr     dx, 1
        inc     cl
        jmp     .block
.got:
        mov     [opl_block], cl
        mov     ch, 7
        sub     ch, cl
        mov     cl, ch
        mov     dx, 3                   ; 3 << (23 - b) as DX:0 = 3 << (7 - b) << 16
        shl     dx, cl
        xor     ax, ax
        div     bx                      ; DX < BX, so no overflow
        cmp     ax, 1023
        jbe     .fnum
        mov     ax, 1023
.fnum:
        mov     [opl_fnum], ax
        mov     bx, REG_FNUMLO + OPL_CH
        call    opl_write               ; AL = low 8 bits
        call    opl_put_keyblk
        pop     dx
        pop     cx
        pop     bx
        pop     ax
        ret

; opl_note_off: key off, block and F-number kept.
opl_note_off:
        mov     byte [opl_keyed], 0
        jmp     opl_put_keyblk

; opl_shutdown: key off, carrier silenced, OPL3 mode left. /ON calls opl_init.
opl_shutdown:
        push    ax
        push    bx
        mov     byte [opl_keyed], 0
        call    opl_put_keyblk
        mov     bx, REG_KSLTL + OP_CAR
        mov     al, 3Fh
        call    opl_write
        cmp     byte [opl_type], 3
        jne     .done
        mov     bx, REG_NEW
        xor     al, al
        call    opl_write
.done:
        pop     bx
        pop     ax
        ret

; opl_write: In: BX = register 000h-1FFh (bit 8 = bank 1), AL = value.
; Each write is followed by the status reads the chip needs to settle.
%ifdef OPL_TEST_SINK
opl_write:
        jmp     OPL_TEST_SINK
%else
opl_write:
%endif
opl_hw_write:
        push    ax
        push    cx
        push    dx
        mov     ah, al
        mov     dx, OPL_ADDR1
        test    bh, 1
        jz      .bank
        mov     dx, OPL_ADDR2
.bank:
        mov     al, bl
        out     dx, al
        mov     cl, [opl_idx_reads]
        call    opl_settle
        inc     dx
        mov     al, ah
        out     dx, al
        mov     cl, [opl_data_reads]
        call    opl_settle
        pop     dx
        pop     cx
        pop     ax
        ret

; opl_settle: CL status reads (at least 1). Preserves DX and AX.
opl_settle:
        push    ax
        push    dx
        mov     dx, OPL_ADDR1
.read:
        in      al, dx
        dec     cl
        jnz     .read
        pop     dx
        pop     ax
        ret

; opl_put_keyblk: write B8h from the key flag, block and F-number high bits.
opl_put_keyblk:
        push    ax
        push    bx
        mov     al, [opl_block]
        shl     al, 1
        shl     al, 1
        or      al, [opl_fnum + 1]
        cmp     byte [opl_keyed], 0
        je      .write
        or      al, KEY_ON
.write:
        mov     bx, REG_KEYBLK + OPL_CH
        call    opl_write
        pop     bx
        pop     ax
        ret

; opl_program: write the current voice's operators and C0h, then the volume.
; The carrier's 40h is left to opl_put_volume so it is written once, scaled.
opl_program:
        push    ax
        push    bx
        push    cx
        push    si
        push    di
        mov     al, [opl_voice]
        or      al, al
        jnz     .patch
        mov     si, voice_faithful2
        cmp     byte [opl_type], 3
        jne     .have
        mov     si, voice_faithful3
        jmp     .have
.patch:
        dec     al
        mov     cl, 11
        mul     cl
        add     ax, patch_table
        mov     si, ax
.have:
        mov     [opl_rec], si
        mov     di, opl_bases
        mov     cx, 5
.regs:
        mov     bl, [di]
        xor     bh, bh
        add     bl, OP_MOD
        mov     al, [si]
        inc     si
        call    opl_write
        add     bl, OP_CAR - OP_MOD
        mov     al, [si]
        inc     si
        cmp     byte [di], REG_KSLTL
        je      .skip
        call    opl_write
.skip:
        inc     di
        loop    .regs
        mov     al, [si]
        cmp     byte [opl_type], 3
        jne     .fb
        or      al, OPL3_OUT
.fb:
        mov     bx, REG_FBCNT + OPL_CH
        call    opl_write
        call    opl_put_volume
        pop     di
        pop     si
        pop     cx
        pop     bx
        pop     ax
        ret

; opl_put_volume: carrier TL = the voice's base TL + (15 - volume) * 4,
; clamped to 63; volume 0 is always 63.
opl_put_volume:
        push    ax
        push    bx
        push    cx
        push    si
        mov     si, [opl_rec]
        mov     al, [si + 3]            ; carrier 40h
        mov     ah, al
        and     ah, 0C0h                ; keep the key scale level bits
        and     al, 3Fh
        mov     cl, [opl_vol]
        or      cl, cl
        jz      .mute
        mov     ch, 15
        sub     ch, cl
        shl     ch, 1
        shl     ch, 1
        add     al, ch
        cmp     al, 63
        jbe     .write
.mute:
        mov     al, 63
.write:
        or      al, ah
        mov     bx, REG_KSLTL + OP_CAR
        call    opl_write
        pop     si
        pop     cx
        pop     bx
        pop     ax
        ret

; Voice records, 11 bytes in register order: modulator and carrier of 20h,
; 40h, 60h, 80h and E0h, then C0h (the OPL3 output bits are added at write time).

; Faithful voice on OPL3: the carrier alone, as a square wave (waveform 6),
; additive so the modulator (TL 63) adds nothing. Attack and release 15 and
; sustain on keep fast beeps crisp.
voice_faithful3:
        db      21h, 21h                ; sustain, multiplier 1
        db      3Fh, 00h                ; modulator muted, carrier TL 0
        db      0F0h, 0F0h              ; attack 15, decay 0
        db      0Fh, 0Fh                ; sustain level 0, release 15
        db      00h, 06h                ; carrier waveform 6 = square
        db      01h                     ; additive connection, feedback 0

; Faithful voice on OPL2, which has no square waveform. The modulator runs at
; twice the carrier's frequency (MULT 2 against 1): FM with a 2:1 ratio puts
; the sidebands on odd harmonics of the carrier only, which is a square wave's
; spectrum. Starting values: modulator TL 1Ah, FM connection, feedback 0,
; sine waveforms, attack 15, decay 0, sustain level 0, release 15, sustain on.
; Not tuned by ear.
voice_faithful2:
        db      22h, 21h
        db      1Ah, 00h
        db      0F0h, 0F0h
        db      0Fh, 0Fh
        db      00h, 00h
        db      00h                     ; FM connection, feedback 0

; Patches 1..4; every release rate (low nibble of 80h) is at least 10.
patch_table:
        db      22h, 21h, 18h, 08h, 0F0h, 0F0h, 0Ch, 0Ch, 00h, 00h, 01h  ; 1 Organ
        db      21h, 21h, 28h, 00h, 0B0h, 0C0h, 0Ah, 0Ah, 00h, 00h, 00h  ; 2 Flute
        db      21h, 21h, 10h, 00h, 0E0h, 0F0h, 0Bh, 0Bh, 00h, 00h, 0Ah  ; 3 Brass
        db      23h, 21h, 20h, 00h, 0F0h, 0F4h, 2Ah, 2Ah, 00h, 00h, 00h  ; 4 Bell

; For the help and summary text.
opl_patch_names db      "1 Organ, 2 Flute, 3 Brass, 4 Bell", '$'

opl_bases       db      REG_AVEKSR, REG_KSLTL, REG_ARDR, REG_SLRR, REG_WAVE

opl_type        db      0               ; 0 = not initialised, 2 or 3
opl_voice       db      0               ; 0 faithful, 1..4 patch
opl_vol         db      15
opl_keyed       db      0
opl_block       db      0
opl_fnum        dw      0
opl_rec         dw      voice_faithful2 ; record the current voice uses
opl_idx_reads   db      6               ; status reads after the index write
opl_data_reads  db      35              ; and after the data write
