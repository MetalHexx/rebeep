; OPL render target: detects an OPL2/OPL3 at 388h and plays one voice, either a
; faithful square wave or one of four built-in patches. Each new note takes the
; other of channels 7 and 8, so the last note releases undisturbed instead of
; being retriggered; a pitch change stays on the note's own channel.
; Near calls; DS = this module's segment. Every routine preserves all
; registers except its outputs, and flags.
; Only channels 7 and 8's registers, the global 01h and (OPL3) 105h are ever
; written.
; Stack: at most 16 bytes, return address included (opl_detect, opl_init and
; opl_set_voice reach it). The call chains are kept flat for that; a change that
; nests one more call or push breaks it.
;
; Define OPL_TEST_SINK as a label before including this file and opl_write
; jumps there instead of touching the ports; detection still uses the ports.
; SPDX-License-Identifier: MIT

        cpu     8086
%include "speaker.inc"
%include "opl.inc"

%if OPL_CH_B != OPL_CH_A + 1
%error opl_program and opl_put_volume expect OPL_CH_B = OPL_CH_A + 1
%endif
OPL_CAR_A       equ     OPL_CH_A + OP_MOD_OFS + OP_CAR_OFS  ; channel A's carrier; B's is next

; Status reads after each write, by chip: after the index write, after the data write.
OPL2_IDX_READS  equ     6
OPL2_DATA_READS equ     35
OPL3_IDX_READS  equ     2
OPL3_DATA_READS equ     2

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

; opl_init: take over channels 7 and 8, key off, current voice and volume.
; In:  AL = 2 or 3 (the chip opl_detect found)
opl_init:
        mov     byte [opl_type], 2
        mov     byte [opl_idx_reads], OPL2_IDX_READS
        mov     byte [opl_data_reads], OPL2_DATA_READS
        cmp     al, 3
        jne     .have
        mov     byte [opl_type], 3
        mov     byte [opl_idx_reads], OPL3_IDX_READS
        mov     byte [opl_data_reads], OPL3_DATA_READS
.have:
        push    ax
        push    bx
        mov     bx, REG_TEST
        mov     al, 20h
        call    opl_write
        cmp     byte [opl_type], 3
        jne     .opl2
        mov     bx, REG_NEW
        mov     al, 01h
        call    opl_write
.opl2:
        pop     bx
        pop     ax
        mov     byte [opl_keyed], 0
        mov     byte [opl_ch], OPL_CH_B
        call    opl_put_keyblk
        mov     byte [opl_ch], OPL_CH_A ; the first note goes to B
        call    opl_put_keyblk
        jmp     opl_program

; opl_set_voice: reprogram both channels' operators; the key state is untouched.
; In:  AL = 0 faithful, 1..4 patch (anything else is faithful)
opl_set_voice:
        mov     [opl_voice], al
        cmp     al, 4
        jbe     .go
        mov     byte [opl_voice], 0
.go:
        jmp     opl_program

; opl_set_volume: In: AL = 0..15 (0 silent; larger values count as 15)
opl_set_volume:
        mov     [opl_vol], al
        cmp     al, 15
        jbe     .go
        mov     byte [opl_vol], 15
.go:
        jmp     opl_put_volume

; opl_note_on: key off the channel that played last (it may still be keyed), then
; key the other one on. In: BX = divisor (DIV_MIN..DIV_MAX)
opl_note_on:
        mov     byte [opl_keyed], 0
        call    opl_put_keyblk
        xor     byte [opl_ch], OPL_CH_A ^ OPL_CH_B
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
        pop     dx                      ; free before the write, to keep the stack shallow
        pop     cx
        mov     bx, REG_FNUMLO
        add     bl, [opl_ch]
        call    opl_write               ; AL = low 8 bits
        pop     bx
        pop     ax
        jmp     opl_put_keyblk

; opl_note_off: key off the sounding channel, block and F-number kept.
opl_note_off:
        mov     byte [opl_keyed], 0
        jmp     opl_put_keyblk

; opl_shutdown: both carriers silenced, both channels keyed off, OPL3 mode left.
; /ON calls opl_init.
opl_shutdown:
        push    ax
        push    bx
        mov     bx, REG_KSLTL + OPL_CAR_A
        mov     al, 3Fh
        call    opl_write
        inc     bx
        call    opl_write
        pop     bx
        pop     ax
        mov     byte [opl_keyed], 0
        call    opl_put_keyblk
        xor     byte [opl_ch], OPL_CH_A ^ OPL_CH_B
        call    opl_put_keyblk
        xor     byte [opl_ch], OPL_CH_A ^ OPL_CH_B
        cmp     byte [opl_type], 3
        jne     .done
        push    ax
        push    bx
        mov     bx, REG_NEW
        xor     al, al
        call    opl_write
        pop     bx
        pop     ax
.done:
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
        push    dx
        push    ax
        mov     dx, OPL_ADDR1
        test    bh, 1
        jz      .bank
        mov     dx, OPL_ADDR2
.bank:
        mov     al, bl
        out     dx, al
        mov     dx, OPL_ADDR1           ; the status port, whichever bank
        mov     ah, [opl_idx_reads]
.idx:
        in      al, dx
        dec     ah
        jnz     .idx
        pop     ax
        push    ax
        inc     dx                      ; the data port of the bank
        test    bh, 1
        jz      .data
        inc     dx
        inc     dx
.data:
        out     dx, al
        mov     dx, OPL_ADDR1
        mov     ah, [opl_data_reads]
.dat:
        in      al, dx
        dec     ah
        jnz     .dat
        pop     ax
        pop     dx
        ret

; opl_put_keyblk: write the current channel's B0h from the key flag, block and
; F-number high bits.
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
        mov     bx, REG_KEYBLK
        add     bl, [opl_ch]
        call    opl_write
        pop     bx
        pop     ax
        ret

; opl_program: write the current voice's operators and C0h on both channels, then
; the volume. The carriers' 40h is left to opl_put_volume so it is written once,
; scaled.
opl_program:
        push    ax
        push    bx
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
        mov     bl, 11
        mul     bl
        add     ax, patch_table
        mov     si, ax
.have:
        mov     [opl_rec], si
        mov     ah, OPL_CH_A            ; AH = the channel; opl_write keeps it
.chan:
        mov     si, [opl_rec]
        mov     di, opl_bases
.regs:
        mov     bl, [di]
        xor     bh, bh
        add     bl, ah
        add     bl, OP_MOD_OFS
        mov     al, [si]
        inc     si
        call    opl_write
        add     bl, OP_CAR_OFS
        mov     al, [si]
        inc     si
        cmp     byte [di], REG_KSLTL
        je      .skip
        call    opl_write
.skip:
        inc     di
        cmp     di, opl_bases + 5
        jne     .regs
        mov     al, [si]
        cmp     byte [opl_type], 3
        jne     .fb
        or      al, OPL3_OUT
.fb:
        mov     bx, REG_FBCNT
        add     bl, ah
        call    opl_write
        inc     ah
        cmp     ah, OPL_CH_B
        jbe     .chan
        pop     di
        pop     si
        pop     bx
        pop     ax
        jmp     opl_put_volume

; opl_put_volume: both carriers' TL = the voice's base TL + (15 - volume) * 4,
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
        pop     si                      ; free before the write, to keep the stack shallow
        pop     cx
        mov     bx, REG_KSLTL + OPL_CAR_A
        call    opl_write
        inc     bx                      ; channel B's carrier
        call    opl_write
        pop     bx
        pop     ax
        ret

; Voice records, 11 bytes in register order: modulator and carrier of 20h,
; 40h, 60h, 80h and E0h, then C0h (the OPL3 output bits are added at write time).

; Faithful voice on OPL3: the carrier alone, as a square wave (waveform 6),
; additive so the modulator (TL 63) adds nothing. Sustain on holds the level.
; Attack 13 (under a millisecond) and release 13 (about 10 ms) round the
; note's edges: a key-on restarts the wave at full level, and an instant step
; there or at key-off is a click.
voice_faithful3:
        db      21h, 21h                ; sustain, multiplier 1
        db      3Fh, 00h                ; modulator muted, carrier TL 0
        db      0D0h, 0D0h              ; attack 13, decay 0
        db      0Dh, 0Dh                ; sustain level 0, release 13
        db      00h, 06h                ; carrier waveform 6 = square
        db      01h                     ; additive connection, feedback 0

; Faithful voice on OPL2, which has no square waveform. The modulator runs at
; twice the carrier's frequency (MULT 2 against 1): FM with a 2:1 ratio puts
; the sidebands on odd harmonics of the carrier only, which is a square wave's
; spectrum. Modulator TL 1Ah, FM connection, feedback 0, sine waveforms, and
; the OPL3 voice's envelope: attack 13, decay 0, sustain level 0, release 13,
; sustain on.
voice_faithful2:
        db      22h, 21h
        db      1Ah, 00h
        db      0D0h, 0D0h
        db      0Dh, 0Dh
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
opl_ch          db      OPL_CH_A        ; the channel the last note took
opl_block       db      0
opl_fnum        dw      0
opl_rec         dw      voice_faithful2 ; record the current voice uses
opl_idx_reads   db      OPL2_IDX_READS
opl_data_reads  db      OPL2_DATA_READS
