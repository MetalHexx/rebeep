; OPL render target: plays a voice, either a faithful square wave or a patch (the
; two-operator record and octave of a patch block, amis.inc; on an OPL3 its four-operator
; record too, when it has one). The main voice's new note takes the other of channels 7
; and 8 (or, four-operator, of the pairs A and B on bank 1), so the last note releases
; undisturbed instead of being retriggered; a pitch change stays on the note's own channel.
; A second voice, the effect voice, has one channel: 6, or bank 1's pair 2+5. Everything
; that differs between the two is in opl_ctx, the current voice's, and every routine
; serves whichever is current; opl_ctx_swap exchanges it with opl_ctx_alt. Only
; engine/fx.asm swaps, and the main voice is current between its calls.
; Near calls; DS = this module's segment. Every routine preserves all
; registers except its outputs, and flags.
; Only channels 6, 7 and 8's registers (or pairs A, B and 2+5's), the global 01h, (OPL3)
; 104h and 105h and, while detecting (startup/opldet.asm), the timer registers 02h and
; 04h are ever written. Volume 0 keys no note: TL 63 is only -47 dB, not silence.
; The voice's mode (opl_four), record and carriers are latched when opl_set_voice
; runs: no other routine reads RB_STATE, and a record is read where it is only for
; its levels. The pair is keyed off, by the mode it was set in, before 104h changes.
; Stack: at most 16 bytes, return address included (opl_detect, opl_init,
; opl_set_voice and opl_shutdown reach it). The call chains are kept flat for that
; (the operator loops walk opl_regs2 or opl_regs4 with one index); a change that
; nests one more call or push breaks it.
;
; Define OPL_TEST_SINK as a label before including this file and opl_write
; jumps there instead of touching the ports; detection still uses the ports.
; SPDX-License-Identifier: MIT

        cpu     8086
%include "speaker.inc"
%include "opl.inc"
%include "amis.inc"

%if OPL_CH_B != OPL_CH_A + 1 || OPL4_CH_B != OPL4_CH_A + 1
%error the loops write the other channel's registers one above the first's
%endif
%if OPL_FX_CH != OPL_CH_A - 1 || (OPL4_FX_CH & 100h) != (OPL4_CH_A & 100h)
%error the effect voice's registers are the main voice's plus a difference, on the same bank
%endif

; Status reads after each write, by chip: after the index write, after the data write.
OPL2_IDX_READS  equ     6
OPL2_DATA_READS equ     35
OPL3_IDX_READS  equ     2
OPL3_DATA_READS equ     2

; opl_init: take over the current voice's channels, key off, its voice and the volume. The
; mode starts two-operator: opl_shutdown left 104h at 0, and opl_set_voice enables the pairs.
; fx_init runs it for each voice.
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
        mov     byte [opl_wavemask], 03h ; OPL2 has waveforms 0 to 3 only
        cmp     byte [opl_type], 3
        jne     .masked
        mov     byte [opl_wavemask], 07h
.masked:
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
        mov     byte [opl_four], 0
        call    opl_channels
        mov     byte [opl_keyed], 0
        call    opl_put_keyblk
        call    opl_swap_ch
        call    opl_put_keyblk
        call    opl_swap_ch             ; the first note goes to B
        jmp     opl_program

; opl_channels: the current voice's channels in the mode in opl_four, the first note about to
; take the second of them; the effect voice has one, so both are it. Sets opl_delta.
opl_channels:
        push    ax
        push    bx
        mov     ax, OPL_CH_A
        mov     bl, [opl_d2]
        cmp     byte [opl_four], 0
        je      .have
        mov     ax, OPL4_CH_A
        mov     bl, [opl_d4]
.have:
        mov     [opl_delta], bl
        add     al, bl                  ; AH keeps the bank
        mov     [opl_ch], ax
        add     al, [opl_dup]
        mov     [opl_chx], ax
        pop     bx
        pop     ax
        ret

; opl_swap_ch: the other channel becomes the current one.
opl_swap_ch:
        push    ax
        mov     ax, [opl_ch]
        xchg    ax, [opl_chx]
        mov     [opl_ch], ax
        pop     ax
        ret

; opl_set_voice: reprogram the operators; the key state is untouched, except that a
; change between two- and four-operator play keys off the voice being left first.
; In:  AL = 0 faithful, 1 patch (anything else is faithful); for a patch SI = the patch
;      block, whose record is played from where it is (so a change to the block shows at
;      the next volume change or voice set) and whose octave is copied. On an OPL3 a
;      block with the four-operator flag plays its four-operator record, on two pairs of
;      channels; everything else plays two-operator, the faithful voice included.
; The mode is decided here and kept, so a block that has been overwritten since (the
; new voice's, while the old one still sounds) does not change how the old one is left.
; A note that is sounding keeps its pitch until the next note on or pitch, unless the mode
; changes: it is keyed off then, and the next note on starts it in the new voice.
opl_set_voice:
        push    ax
        mov     byte [opl_voice], 0
        mov     byte [opl_octave], 4
        xor     ah, ah                  ; AH = the new mode: 1 = four-operator
        cmp     al, 1
        jne     .mode
        mov     byte [opl_voice], 1
        mov     [opl_blk], si
        mov     al, [si + PB_OCTAVE]
        cmp     al, 7
        jbe     .octave
        mov     al, 7
.octave:
        mov     [opl_octave], al
        cmp     byte [opl_type], 3
        jne     .mode
        test    byte [si + PB_FLAGS], RBS_PF_4OP
        jz      .mode
        inc     ah
.mode:
        cmp     ah, [opl_four]
        je      .same
        mov     byte [opl_keyed], 0
        call    opl_put_keyblk          ; the voice being left, both its channels, before 104h
        call    opl_swap_ch
        call    opl_put_keyblk
        mov     [opl_four], ah
        call    opl_channels
        push    bx
        mov     al, [opl_4bits]         ; this voice's pairs join or part; the other voice's stay
        or      ah, ah
        jnz     .join
        not     al
        and     al, [opl_104]
        jmp     .put
.join:
        or      al, [opl_104]
.put:
        mov     [opl_104], al
        mov     bx, REG_4OP
        call    opl_write
        pop     bx
.same:
        pop     ax
        jmp     opl_program

; opl_set_volume: In: AL = 0..15 (0 silent; larger values count as 15). A note
; sounding when it changes keeps its key until the next note on, pitch or key-off.
opl_set_volume:
        mov     [opl_vol], al
        cmp     al, 15
        jbe     .go
        mov     byte [opl_vol], 15
.go:
        jmp     opl_put_volume

; opl_note_on: key off the channel (or pair) that played last (it may still be keyed),
; then key the other one on. In: BX = divisor (0 = 65536; below DIV_MIN plays DIV_MIN)
opl_note_on:
        mov     byte [opl_keyed], 0
        call    opl_put_keyblk
        call    opl_swap_ch
        mov     byte [opl_keyed], 1

; opl_pitch: retune without touching the key bit, so a sounding note glides
; instead of retriggering. In: BX = divisor. A patch's octave shifts the block by
; octave - 4; past block 7 or 0 the F-number doubles (to 1023 at most) or halves instead.
opl_pitch:
        push    ax
        push    bx
        push    cx
        push    dx
        or      bx, bx
        jnz     .nz
        dec     bx                      ; 0 means 65536: 65535 is the nearest (18.2 Hz)
.nz:
        cmp     bx, DIV_MIN
        jae     .hi
        mov     bx, DIV_MIN
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
        jbe     .octave
        mov     ax, 1023
.octave:
        mov     cl, [opl_octave]
        sub     cl, 4                   ; CL = the signed shift, DL = the block
        mov     dl, [opl_block]
.shift:
        or      cl, cl
        jz      .shifted
        js      .down
        dec     cl
        cmp     dl, 7
        jb      .blkup
        shl     ax, 1
        cmp     ax, 1023
        jbe     .shift
        mov     ax, 1023
        jmp     .shift
.blkup:
        inc     dl
        jmp     .shift
.down:
        inc     cl
        or      dl, dl
        jz      .halve
        dec     dl
        jmp     .shift
.halve:
        shr     ax, 1
        jmp     .shift
.shifted:
        mov     [opl_block], dl
        mov     [opl_fnum], ax
        pop     dx                      ; free before the write, to keep the stack shallow
        pop     cx
        mov     bx, REG_FNUMLO
        add     bx, [opl_ch]
        call    opl_write               ; AL = low 8 bits
        pop     bx
        pop     ax
        jmp     opl_put_keyblk

; opl_note_off: key off the sounding channel, block and F-number kept.
opl_note_off:
        mov     byte [opl_keyed], 0
        jmp     opl_put_keyblk

; opl_silence: the current voice's channels (or pairs) keyed off, then their carriers at TL 63.
; The carriers come last so this tail-jumps there: opl_shutdown calls it within 16 bytes.
opl_silence:
        mov     byte [opl_keyed], 0
        call    opl_put_keyblk
        call    opl_swap_ch
        call    opl_put_keyblk
        call    opl_swap_ch
        mov     byte [opl_att], 63
        jmp     opl_put_carriers

; opl_shutdown: the current voice silenced, then (OPL3) every pair 104h joins released and
; OPL3 mode left. The other voice must be silent already: fx_shutdown silences the effect
; voice, then calls this for the main one. /ON calls opl_init.
opl_shutdown:
        call    opl_silence
        cmp     byte [opl_type], 3
        jne     .done
        push    ax
        push    bx
        xor     al, al
        cmp     [opl_104], al
        je      .new
        mov     [opl_104], al
        mov     bx, REG_4OP             ; after the pairs are keyed off, never under a keyed one
        call    opl_write
.new:
        mov     bx, REG_NEW
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
; F-number high bits. A pair is keyed through its first channel.
opl_put_keyblk:
        push    ax
        push    bx
        mov     al, [opl_block]
        shl     al, 1
        shl     al, 1
        or      al, [opl_fnum + 1]
        cmp     byte [opl_keyed], 0
        je      .write
        cmp     byte [opl_vol], 0       ; volume 0 keys nothing: TL 63 alone still sounds
        je      .write
        or      al, KEY_ON
.write:
        mov     bx, REG_KEYBLK
        add     bx, [opl_ch]
        call    opl_write
        pop     bx
        pop     ax
        ret

; NEXT_REG label: the operator loops' step. Needs SI = the entry's index, counted from 0.
; Out: AL = the record's byte, BL = the register it goes to, the current voice's (the table's,
; for pair or channel A, + opl_delta; BH is left to the loop), SI + 1.
; Jumps to label at the end of the register table, which holds 0.
%macro NEXT_REG 1
        mov     bx, [opl_rec]
        mov     al, [bx + si]
        mov     bx, [opl_tab]
        mov     bl, [bx + si]
        inc     si
        or      bl, bl
        jz      %1
        add     bl, [opl_delta]
%endmacro

; opl_program: write the current mode's voice to the operators and C0h of both channels
; (or both pairs), then the volume. The record and the register table are walked in step:
; a register gets the record's byte, and then the same byte again opl_dup registers up: one,
; for the main voice's other channel; none, for the effect voice's one, which so gets it
; twice. The carriers' 40h is left to opl_put_volume so it is written once,
; scaled; an additive two-operator voice's modulator is a carrier here, so its 40h is too.
; Latches the record, the table and the carriers (opl_cmask: bit n = operator n + 1 is
; heard) for opl_put_carriers.
opl_program:
        push    ax
        push    bx
        push    si
        cmp     byte [opl_four], 0
        jne     .four
        mov     bx, voice_faithful2
        cmp     byte [opl_voice], 0
        jne     .patch
        cmp     byte [opl_type], 3
        jne     .rec2
        mov     bx, voice_faithful3
        jmp     .rec2
.patch:
        mov     bx, [opl_blk]
        add     bx, PB_REC2
.rec2:
        mov     [opl_rec], bx
        mov     word [opl_tab], opl_regs2
        mov     al, [bx + 10]
        and     al, 01h                 ; additive: the modulator is heard too
        or      al, 02h
        jmp     .have
.four:
        mov     bx, [opl_blk]
        add     bx, PB_REC4
        mov     [opl_rec], bx
        mov     word [opl_tab], opl_regs4
        mov     al, [bx + 21]           ; CNT2
        and     al, 01h
        shl     al, 1
        mov     ah, [bx + 20]           ; CNT1
        and     ah, 01h
        or      al, ah
        mov     bx, opl_carriers
        xlat
.have:
        mov     [opl_cmask], al
        mov     ah, al
        xor     si, si
.reg:
        NEXT_REG .done
        mov     bh, [opl_four]
        cmp     bl, REG_KSLTL
        jb      .write
        cmp     bl, REG_ARDR
        jb      .tl
        cmp     bl, REG_FBCNT
        jb      .write
        cmp     bl, REG_WAVE
        jae     .wave
        cmp     byte [opl_type], 3      ; C0h: OPL3 wants its output bits
        jne     .write
        or      al, OPL3_OUT
        jmp     .write
.wave:
        and     al, [opl_wavemask]      ; OPL2 has waveforms 0 to 3 only
        jmp     .write
.tl:
        shr     ah, 1
        jc      .reg                    ; a carrier's
.write:
        call    opl_write
        add     bl, [opl_dup]
        call    opl_write
        jmp     .reg
.done:
        pop     si
        pop     bx
        pop     ax
        jmp     opl_put_volume

; opl_put_volume: the TL of every carrier = the voice's base TL + (15 - volume) * 4,
; clamped to 63; volume 0 is always 63. A two-operator voice's carrier is its second
; operator, and in an additive voice (C0h bit 0) its modulator too, so the balance of
; its partials holds at every volume. A four-operator voice's are the operators its
; connection sends to the output (opl_carriers).
opl_put_volume:
        push    ax
        mov     al, 63
        cmp     byte [opl_vol], 0
        je      .att
        mov     al, 15
        sub     al, [opl_vol]
        shl     al, 1
        shl     al, 1
.att:
        mov     [opl_att], al
        pop     ax

; opl_put_carriers: write every carrier's TL: the record's base + opl_att, clamped to
; 63, on both channels (or pairs), as opl_program does; the key scale level bits stay.
opl_put_carriers:
        push    ax
        push    bx
        push    si
        mov     ah, [opl_cmask]
        xor     si, si
.reg:
        NEXT_REG .done
        cmp     bl, REG_KSLTL
        jb      .reg
        cmp     bl, REG_ARDR
        jae     .reg
        shr     ah, 1
        jnc     .reg                    ; not a carrier
        mov     bh, al
        and     bh, 0C0h                ; keep the key scale level bits
        and     al, 3Fh
        add     al, [opl_att]
        cmp     al, 63
        jbe     .write
        mov     al, 63
.write:
        or      al, bh
        mov     bh, [opl_four]
        call    opl_write
        add     bl, [opl_dup]
        call    opl_write
        jmp     .reg
.done:
        pop     si
        pop     bx
        pop     ax
        ret

; Voice records, 11 bytes in register order: modulator and carrier of 20h,
; 40h, 60h, 80h and E0h, then C0h (the OPL3 output bits are added at write time).

; Faithful voice on OPL3: the carrier alone, as a square wave (waveform 6),
; additive, with the modulator at TL 63 (-47 dB, next to nothing). Sustain on
; holds the level.
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

; The registers a record's bytes go to, in the record's order: for a channel (the pair's
; first channel, for four operators) A; B's are one above. Four operators are on bank 1.
; Each table ends with 0.
%macro OPS2 1
        db      %1 + OPL_CH_A + OP_MOD_OFS, %1 + OPL_CH_A + OP_MOD_OFS + OP_CAR_OFS
%endmacro
%macro OPS4 1
        db      %1 + OPL4_OP1, %1 + OPL4_OP2, %1 + OPL4_OP3, %1 + OPL4_OP4
%endmacro
opl_regs2:
        OPS2    REG_AVEKSR
        OPS2    REG_KSLTL
        OPS2    REG_ARDR
        OPS2    REG_SLRR
        OPS2    REG_WAVE
        db      REG_FBCNT + OPL_CH_A, 0
opl_regs4:
        OPS4    REG_AVEKSR
        OPS4    REG_KSLTL
        OPS4    REG_ARDR
        OPS4    REG_SLRR
        OPS4    REG_WAVE
        db      REG_FBCNT, REG_FBCNT + OPL4_CH2, 0

; The carriers of a four-operator connection (CNT1 + 2 * CNT2: FM-FM, AM-FM, FM-AM,
; AM-AM), bit n for operator n + 1: op4; op1, op4; op2, op4; op1, op3, op4.
opl_carriers    db      1000b, 1001b, 1010b, 1101b

; opl_ctx_swap: the other voice becomes the current one, and the current one waits in
; opl_ctx_alt. Only engine/fx.asm calls it. Preserves every register.
opl_ctx_swap:
        push    ax
        push    cx
        push    si
        mov     si, opl_ctx
        mov     cx, OPL_CTX_LEN / 2
.next:
        mov     ax, [si]
        xchg    ax, [si + OPL_CTX_LEN]
        mov     [si], ax
        inc     si
        inc     si
        loop    .next
        pop     si
        pop     cx
        pop     ax
        ret

; The chip, shared by both voices.
opl_type        db      0               ; 0 = not initialised, 2 or 3
opl_wavemask    db      03h             ; E0h's usable bits: 03h on an OPL2, 07h on an OPL3
opl_vol         db      15
opl_att         db      0               ; what opl_put_carriers adds to a TL: (15 - opl_vol) * 4, 63 at volume 0
opl_104         db      0               ; REG_4OP as written: each voice's opl_4bits while it is four-operator
opl_idx_reads   db      OPL2_IDX_READS
opl_data_reads  db      OPL2_DATA_READS

; The current voice: the main voice, except inside an fx.asm call.
opl_ctx:
opl_voice       db      0               ; 0 faithful, 1 patch
opl_four        db      0               ; 1 = four operators (OPL3): the mode set by opl_set_voice,
                                        ; also the bank the voice's operator registers are on
opl_octave      db      4               ; the patch's octave, 4 for the faithful voice
opl_keyed       db      0
opl_block       db      0
opl_cmask       db      02h             ; the carriers, as in opl_carriers
opl_delta       db      0               ; added to channel or pair A's registers, in this mode
opl_d2          db      0               ; opl_delta for two operators
opl_d4          db      0               ; and four
opl_dup         db      1               ; 1: the twin channel (or pair) one up as well; 0: one only
opl_4bits       db      OPL4_ENABLE     ; this voice's pairs in REG_4OP
                db      0
opl_blk         dw      0               ; the patch block (its records are played where they are)
opl_ch          dw      OPL_CH_A        ; the channel the last note took, bank bit included
opl_chx         dw      OPL_CH_B        ; the other one: the next note's
opl_fnum        dw      0
opl_rec         dw      voice_faithful2 ; record the voice uses
opl_tab         dw      opl_regs2       ; its register table
OPL_CTX_LEN     equ     $ - opl_ctx
; The other voice: the effect voice, as opl_init leaves it.
opl_ctx_alt:
        db      0, 0, 4, 0, 0, 02h
        db      (OPL_FX_CH - OPL_CH_A) & 0FFh, (OPL_FX_CH - OPL_CH_A) & 0FFh
        db      OPL4_FX_CH - OPL4_CH_A, 0, OPL4_FX_ENABLE, 0
        dw      0, OPL_FX_CH, OPL_FX_CH, 0, voice_faithful2, opl_regs2
%if $ - opl_ctx_alt != OPL_CTX_LEN || (OPL_CTX_LEN & 1)
%error opl_ctx_alt must match opl_ctx, an even length for the swap's words
%endif
opl_fx_keyed    equ     opl_ctx_alt + (opl_keyed - opl_ctx) ; the effect voice's key flag
