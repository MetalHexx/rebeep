; T_PATCH - the startup part's patch parser, name rules, settings reader and patch lookup
; (startup/patch.asm and startup/files.asm). The parser and the settings reader run on text
; buffers; the lookup reads the factory files the suite stages as FACTORY\ beside the program.
; The parser's cases are the studio's (src/studio/patch.c): both must accept and reject the
; same files.
; SPDX-License-Identifier: MIT

        cpu     8086
        org     100h

        jmp     start

%include "startup/patch.asm"
%include "startup/files.asm"
%include "testlib.inc"

; ---------------------------------------------------------------- helpers

; TEXT label, bytes: the bytes as data, and label_len as their length.
%macro TEXT 2+
%1:     db      %2
%1_len  equ     $ - %1
%endmacro

; EXPECT label, octave, flags, {2-OP record}, {4-OP record}: what a good parse leaves past the name.
%macro EXPECT 5
%1:     db      %2, %3
        db      %4
        db      %5
%endmacro
%macro EXPECT2 4
%1:     db      %2, %3
        db      %4
        times 22 db 0
%endmacro

BLK_FILL        equ     0EEh

; fill_blk: the block under test is all BLK_FILL, so an untouched block can be told.
fill_blk:
        push    cx
        push    di
        push    ds
        pop     es
        mov     di, tblk
        mov     cx, PBLK_LEN
        mov     al, BLK_FILL
        rep     stosb
        pop     di
        pop     cx
        ret

; run_parse: SI = text, CX = its length. Parses into tblk (filled first). Out: CF as patch_parse.
run_parse:
        push    si
        push    cx
        call    fill_blk
        pop     cx
        pop     si
        mov     di, tblk
        jmp     patch_parse

; cf_ax: AX = the carry flag.
cf_ax:
        mov     ax, 0
        adc     ax, 0
        ret

; blk_untouched: Out: AX = 0 when every byte of tblk is still BLK_FILL.
blk_untouched:
        mov     si, tblk
        mov     cx, PBLK_LEN
.next:
        cmp     byte [si], BLK_FILL
        jne     .bad
        inc     si
        loop    .next
        xor     ax, ax
        ret
.bad:
        mov     ax, 1
        ret

; blk_equals: SI = the 35 bytes a good parse must leave from the octave on. Out: AX = 0 when
; tblk holds them and the name field is untouched, else 1.
blk_equals:
        mov     di, tblk
        mov     cx, PB_OCTAVE
.name:
        cmp     byte [di], BLK_FILL
        jne     .bad
        inc     di
        loop    .name
        xor     bx, bx
.body:
        mov     al, [si + bx]
        cmp     al, [di + bx]
        jne     .bad
        inc     bx
        cmp     bx, PBLK_LEN - PB_OCTAVE
        jb      .body
        xor     ax, ax
        ret
.bad:
        mov     ax, 1
        ret

; reason_ok: Out: AX = 0 when SI points at a reason: a '$'-terminated string of 1 to 80 characters.
reason_ok:
        mov     cx, 81
        cmp     si, patch_parse
        jb      .bad
.next:
        cmp     byte [si], '$'
        je      .end
        inc     si
        loop    .next
        jmp     .bad
.end:
        cmp     cx, 81
        jae     .bad
        xor     ax, ax
        ret
.bad:
        mov     ax, 1
        ret

; streq: SI, DI = ASCIZ strings. Out: AX = 0 when equal.
streq:
        push    si
        push    di
.next:
        mov     al, [si]
        cmp     al, [di]
        jne     .no
        or      al, al
        jz      .yes
        inc     si
        inc     di
        jmp     .next
.yes:
        xor     ax, ax
        jmp     .out
.no:
        mov     ax, 1
.out:
        pop     di
        pop     si
        ret

; strcpy: SI = ASCIZ copied as it is to DI.
strcpy:
        lodsb
        mov     [di], al
        inc     di
        or      al, al
        jnz     strcpy
        ret

; bytes_equal: SI, DI = byte strings, BX = their length. Out: AX = 0 when equal.
bytes_equal:
        push    cx
        mov     cx, bx
        mov     ax, 0
        push    ds
        pop     es
        repe    cmpsb
        je      .out
        mov     ax, 1
.out:
        pop     cx
        ret

; next_asciz: SI moves past the ASCIZ string it points into.
next_asciz:
        inc     si
        cmp     byte [si - 1], 0
        jne     next_asciz
        ret

; VALID name, text, expectation: the text parses, into exactly the expected bytes.
%macro VALID 3
        CASE    %1
        mov     si, %2
        mov     cx, %2_len
        call    run_parse
        call    cf_ax
        xor     cx, cx
        call    t_check
        mov     si, %3
        call    blk_equals
        xor     cx, cx
        call    t_check
        ENDCASE
%endmacro

; BADCHECK: after a parse that has to fail: CF set, a reason, the block untouched.
%macro BADCHECK 0
        call    cf_ax
        mov     cx, 1
        call    t_check
        call    reason_ok
        xor     cx, cx
        call    t_check
        call    blk_untouched
        xor     cx, cx
        call    t_check
%endmacro

; ---------------------------------------------------------------- parser texts

%define HEAD    "[PATCH]", 10, "FORMAT=1", 10
%define OPS2    "OP1=15 0 13 10 31 0 3 0 0 0 1 0", 10, "OP2=15 4 13 10 63 0 1 0 0 0 1 0", 10
%define VOICE2  "[2OP]", 10, "CONNECTION=FM", 10, "FEEDBACK=0", 10, OPS2
%define OPS4    "OP1=1 0 0 0 0 0 1 0 0 0 0 0", 10, "OP2=2 0 0 0 0 0 1 0 0 0 0 0", 10, \
                "OP3=3 0 0 0 0 0 1 0 0 0 0 0", 10, "OP4=4 0 0 0 0 0 1 0 0 0 0 0", 10
%define BELL2   23h, 21h, 20h, 00h, 0F0h, 0F4h, 2Ah, 2Ah, 00h, 00h, 00h
%define REC4    01h, 01h, 01h, 01h, 3Fh, 3Fh, 3Fh, 3Fh, 10h, 20h, 30h, 40h, 0F0h, 0F0h, 0F0h, 0F0h, 0, 0, 0, 0

TEXT t_basic, "[PATCH]", 10, "FORMAT=1", 10, "OCTAVE=5", 10, "[2OP]", 10, "CONNECTION=AM", 10, \
        "FEEDBACK=3", 10, "OP1=1 2 3 4 5 1 6 2 1 0 1 0", 10, "OP2=15 14 13 12 63 3 15 7 0 1 0 1", 10
EXPECT2 e_basic, 5, 1, {0A6h, 5Fh, 0BAh, 0C0h, 12h, 0FEh, 0C4h, 2Ch, 02h, 07h, 07h}

; Padding, tabs, runs of spaces, lower case, CRLF, comments, unknown keys and sections.
TEXT t_messy, "; a comment", 13, 10, 13, 10, "  [ patch ]  ", 13, 10, 9, "format", 9, "=", 9, "1 ", 13, 10, \
        "Octave = 3", 13, 10, "Name=ignored", 13, 10, "[Other]", 13, 10, "Format=9", 13, 10, "[Other]", 13, 10, \
        "[2op]", 13, 10, " connection = fm ", 13, 10, "feedback=0", 13, 10, \
        "OP1=", 9, "15  0   13 10", 9, "31 0 3 0 0 0 1 0  ", 13, 10, \
        "op2 = 15 4 13 10 63 0 1 0 0 0 1 0", 13, 10, "OP3=99 junk", 13, 10, "no equals sign", 13, 10
EXPECT2 e_messy, 3, 1, {BELL2}

; The last line has no line end, and OCTAVE is left out: the game's pitch.
TEXT t_nolf, HEAD, "[2OP]", 10, "CONNECTION=FM", 10, "FEEDBACK=0", 10, OPS2, "; the end"
EXPECT2 e_nolf, 4, 1, {BELL2}

; The ends of every range, and a 4-OP section ahead of the [PATCH] and [2OP] ones.
TEXT t_max, "[4OP]", 10, "CONNECTION=AM-AM", 10, "FEEDBACK=7", 10, OPS4, "[PATCH]", 10, "FORMAT=01", 10, \
        "OCTAVE=7", 10, "[2OP]", 10, "CONNECTION=AM", 10, "FEEDBACK=7", 10, \
        "OP1=15 15 15 15 63 3 15 7 1 1 1 1", 10, "OP2=0 0 0 0 0 0 0 0 0 0 0 0", 10
EXPECT  e_max, 7, 3, {0FFh, 00h, 0C0h, 3Fh, 0FFh, 00h, 0Fh, 0F0h, 07h, 00h, 0Fh}, {REC4, 0Fh, 01h}

TEXT t_4fmfm, HEAD, VOICE2, "[4OP]", 10, "CONNECTION=FM-FM", 10, "FEEDBACK=5", 10, OPS4
TEXT t_4amfm, HEAD, VOICE2, "[4OP]", 10, "CONNECTION=AM-FM", 10, "FEEDBACK=5", 10, OPS4
TEXT t_4fmam, HEAD, VOICE2, "[4OP]", 10, "CONNECTION=FM-AM", 10, "FEEDBACK=5", 10, OPS4
TEXT t_4amam, HEAD, VOICE2, "[4OP]", 10, "connection = am-am", 10, "feedback = 5", 10, OPS4
EXPECT  e_4fmfm, 4, 3, {BELL2}, {REC4, 0Ah, 00h}
EXPECT  e_4amfm, 4, 3, {BELL2}, {REC4, 0Bh, 00h}
EXPECT  e_4fmam, 4, 3, {BELL2}, {REC4, 0Ah, 01h}
EXPECT  e_4amam, 4, 3, {BELL2}, {REC4, 0Bh, 01h}

; Exactly 2048 bytes is the most a file may be; one more is refused.
t_big2048:
        db      HEAD, VOICE2, ";"
        times 2048 - ($ - t_big2048) db 'x'
t_big2048_len equ 2048
t_big2049:
        db      HEAD, VOICE2, ";"
        times 2049 - ($ - t_big2049) db 'x'
EXPECT2 e_big, 4, 1, {BELL2}

; Texts a parser must refuse.
TEXT b_nopatch, VOICE2
TEXT b_noformat, "[PATCH]", 10, "OCTAVE=4", 10, VOICE2
TEXT b_format2, "[PATCH]", 10, "FORMAT=2", 10, VOICE2
TEXT b_formatx, "[PATCH]", 10, "FORMAT=one", 10, VOICE2
TEXT b_formatdup, "[PATCH]", 10, "FORMAT=1", 10, "format=1", 10, VOICE2
TEXT b_no2op, HEAD
TEXT b_patchdup, HEAD, "[patch]", 10, VOICE2
TEXT b_2opdup, HEAD, VOICE2, "[2OP]", 10
TEXT b_4opdup, HEAD, VOICE2, "[4OP]", 10, "CONNECTION=FM-FM", 10, "FEEDBACK=0", 10, OPS4, "[4op]", 10
TEXT b_octave8, "[PATCH]", 10, "FORMAT=1", 10, "OCTAVE=8", 10, VOICE2
TEXT b_octavex, "[PATCH]", 10, "FORMAT=1", 10, "OCTAVE=high", 10, VOICE2
TEXT b_octavedup, "[PATCH]", 10, "FORMAT=1", 10, "OCTAVE=4", 10, "OCTAVE=4", 10, VOICE2
TEXT b_header, "[PATCH", 10, "FORMAT=1", 10, VOICE2
TEXT b_headertail, "[PATCH] ; comment", 10, "FORMAT=1", 10, VOICE2
TEXT b_connxx, HEAD, "[2OP]", 10, "CONNECTION=XX", 10, "FEEDBACK=0", 10, OPS2
TEXT b_connam4, HEAD, "[2OP]", 10, "CONNECTION=AM-FM", 10, "FEEDBACK=0", 10, OPS2
TEXT b_connfm4, HEAD, VOICE2, "[4OP]", 10, "CONNECTION=FM", 10, "FEEDBACK=0", 10, OPS4
TEXT b_conndup, HEAD, "[2OP]", 10, "CONNECTION=FM", 10, "CONNECTION=FM", 10, "FEEDBACK=0", 10, OPS2
TEXT b_fb8, HEAD, "[2OP]", 10, "CONNECTION=FM", 10, "FEEDBACK=8", 10, OPS2
TEXT b_fbdup, HEAD, "[2OP]", 10, "CONNECTION=FM", 10, "FEEDBACK=0", 10, "FEEDBACK=0", 10, OPS2
TEXT b_noconn, HEAD, "[2OP]", 10, "FEEDBACK=0", 10, OPS2
TEXT b_nofb, HEAD, "[2OP]", 10, "CONNECTION=FM", 10, OPS2
TEXT b_noop1, HEAD, "[2OP]", 10, "CONNECTION=FM", 10, "FEEDBACK=0", 10, "OP2=15 4 13 10 63 0 1 0 0 0 1 0", 10
TEXT b_noop2, HEAD, "[2OP]", 10, "CONNECTION=FM", 10, "FEEDBACK=0", 10, "OP1=15 0 13 10 31 0 3 0 0 0 1 0", 10
TEXT b_opdup, HEAD, VOICE2, "OP1=15 0 13 10 31 0 3 0 0 0 1 0", 10
TEXT b_4noop4, HEAD, VOICE2, "[4OP]", 10, "CONNECTION=FM-FM", 10, "FEEDBACK=0", 10, \
        "OP1=1 0 0 0 0 0 1 0 0 0 0 0", 10, "OP2=2 0 0 0 0 0 1 0 0 0 0 0", 10, "OP3=3 0 0 0 0 0 1 0 0 0 0 0", 10
TEXT b_4empty, HEAD, VOICE2, "[4OP]", 10
TEXT b_few, HEAD, "[2OP]", 10, "CONNECTION=FM", 10, "FEEDBACK=0", 10, "OP1=15 0 13 10 31 0 3 0 0 0 1", 10, \
        "OP2=15 4 13 10 63 0 1 0 0 0 1 0", 10
TEXT b_many, HEAD, "[2OP]", 10, "CONNECTION=FM", 10, "FEEDBACK=0", 10, "OP1=15 0 13 10 31 0 3 0 0 0 1 0 0", 10, \
        "OP2=15 4 13 10 63 0 1 0 0 0 1 0", 10
TEXT b_opnone, HEAD, "[2OP]", 10, "CONNECTION=FM", 10, "FEEDBACK=0", 10, "OP1=", 10, \
        "OP2=15 4 13 10 63 0 1 0 0 0 1 0", 10
TEXT b_opjunk, HEAD, "[2OP]", 10, "CONNECTION=FM", 10, "FEEDBACK=0", 10, "OP1=15 0 13 10 31 0 3 0 0 0 1 x", 10, \
        "OP2=15 4 13 10 63 0 1 0 0 0 1 0", 10
TEXT b_opneg, HEAD, "[2OP]", 10, "CONNECTION=FM", 10, "FEEDBACK=0", 10, "OP1=15 0 13 10 31 0 3 0 0 0 1 -1", 10, \
        "OP2=15 4 13 10 63 0 1 0 0 0 1 0", 10
TEXT b_opcomma, HEAD, "[2OP]", 10, "CONNECTION=FM", 10, "FEEDBACK=0", 10, "OP1=15,0,13,10,31,0,3,0,0,0,1,0", 10, \
        "OP2=15 4 13 10 63 0 1 0 0 0 1 0", 10

; One OP1 line with a single number over its range, for each of the 12 numbers.
%macro BADOP 2
TEXT %1, HEAD, "[2OP]", 10, "CONNECTION=FM", 10, "FEEDBACK=0", 10, "OP1=", %2, 10, \
        "OP2=15 4 13 10 63 0 1 0 0 0 1 0", 10
%endmacro
BADOP   b_ar, "16 0 0 0 0 0 1 0 0 0 0 0"
BADOP   b_dr, "0 16 0 0 0 0 1 0 0 0 0 0"
BADOP   b_sl, "0 0 16 0 0 0 1 0 0 0 0 0"
BADOP   b_rr, "0 0 0 16 0 0 1 0 0 0 0 0"
BADOP   b_ol, "0 0 0 0 64 0 1 0 0 0 0 0"
BADOP   b_ksl, "0 0 0 0 0 4 1 0 0 0 0 0"
BADOP   b_mult, "0 0 0 0 0 0 16 0 0 0 0 0"
BADOP   b_wave, "0 0 0 0 0 0 1 8 0 0 0 0"
BADOP   b_trem, "0 0 0 0 0 0 1 0 2 0 0 0"
BADOP   b_vib, "0 0 0 0 0 0 1 0 0 2 0 0"
BADOP   b_sus, "0 0 0 0 0 0 1 0 0 0 2 0"
BADOP   b_ksr, "0 0 0 0 0 0 1 0 0 0 0 2"
BADOP   b_huge, "0 0 0 0 0 0 1 0 0 0 0 99999999"

bad_table:
        dw      b_nopatch, b_nopatch_len, b_noformat, b_noformat_len, b_format2, b_format2_len
        dw      b_formatx, b_formatx_len, b_formatdup, b_formatdup_len, b_no2op, b_no2op_len
        dw      b_patchdup, b_patchdup_len, b_2opdup, b_2opdup_len, b_4opdup, b_4opdup_len
        dw      b_octave8, b_octave8_len, b_octavex, b_octavex_len, b_octavedup, b_octavedup_len
        dw      b_header, b_header_len, b_headertail, b_headertail_len, b_connxx, b_connxx_len
        dw      b_connam4, b_connam4_len, b_connfm4, b_connfm4_len, b_conndup, b_conndup_len
        dw      b_fb8, b_fb8_len, b_fbdup, b_fbdup_len, b_noconn, b_noconn_len, b_nofb, b_nofb_len
        dw      b_noop1, b_noop1_len, b_noop2, b_noop2_len, b_opdup, b_opdup_len
        dw      b_4noop4, b_4noop4_len, b_4empty, b_4empty_len, b_few, b_few_len, b_many, b_many_len
        dw      b_opnone, b_opnone_len, b_opjunk, b_opjunk_len, b_opneg, b_opneg_len
        dw      b_opcomma, b_opcomma_len
        dw      b_ar, b_ar_len, b_dr, b_dr_len, b_sl, b_sl_len, b_rr, b_rr_len, b_ol, b_ol_len
        dw      b_ksl, b_ksl_len, b_mult, b_mult_len, b_wave, b_wave_len, b_trem, b_trem_len
        dw      b_vib, b_vib_len, b_sus, b_sus_len, b_ksr, b_ksr_len, b_huge, b_huge_len
        dw      t_big2049, 2049
bad_end:

; ---------------------------------------------------------------- settings and names

TEXT c_trim, "  patch =  FLUTE ", 13, 10, " Patches", 9, "=", 9, "PACKS\ONE", 9, 13, 10
TEXT c_first, "PATCH=ORGAN", 10, "PATCH=BELL", 10, "patches=A", 10, "PATCHES=B", 10
TEXT c_comment, "; PATCH=BELL", 10, "  ; PATCHES=X", 10, "PATCH=FLUTE", 10
TEXT c_unknown, "FOO=1", 10, "just a line", 10, "[Section]", 10, "PATCHER=X", 10, "PATCH=BRASS", 10
TEXT c_emptyfirst, "PATCH=", 10, "PATCH=BELL", 10
TEXT c_none, "something=else", 10
TEXT c_lower, "Patch=Bell", 10
TEXT c_long, "PATCHES=0123456789012345678901234567890123456789012345678901234567890123456", 10, \
        "PATCH=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", 10

; CFG name, text, the PATCHES= value, the PATCH= value
%macro CFG 4
        CASE    %1
        mov     si, %2
        mov     cx, %2_len
        call    cfg_parse
        mov     si, cfg_patches
        mov     di, %%patches
        call    streq
        xor     cx, cx
        call    t_check
        mov     si, cfg_patch
        mov     di, %%patch
        call    streq
        xor     cx, cx
        call    t_check
        ENDCASE
        jmp     %%over
%%patches: db   %3, 0
%%patch: db     %4, 0
%%over:
%endmacro

; ASCIZ lists ended by an empty string.
paths_ok        db      "PATCHES", 0, "c:\mypatch", 0, "\packs\one", 0, "A.B", 0, "PACKS\", 0, "d:x", 0
                db      "A-B_C$~!\ABCDEFGH.XYZ", 0
                db      "ABCDEFGH\ABCDEFGH\ABCDEFGH\ABCDEFGH\ABCDEFGH\ABCDEFGH\ABCDEFGH\A", 0
                db      0
paths_bad       db      "..", 0, "..\X", 0, "A\..\B", 0, "A*B", 0, "A?", 0, "*.*", 0, "C:", 0, "C:\", 0, "\", 0
                db      "A\\B", 0, "ABCDEFGHI", 0, "A.TXTX", 0, "A.B.C", 0, "A.", 0, ".X", 0, "..A", 0, "1:\X", 0
                db      "A B", 0, "A/B", 0, "A:B:C", 0, "0123456789\X", 0
                db      "ABCDEFGH\ABCDEFGH\ABCDEFGH\ABCDEFGH\ABCDEFGH\ABCDEFGH\ABCDEFGH\AB", 0
                db      0

; Valid specs and what they become, then the invalid ones.
specs_ok        db      "FLUTE", 0, "FLUTE", 0, "USER\Bell", 0, "USER\BELL", 0, "hexx\organ", 0, "HEXX\ORGAN", 0
                db      "A-B_1", 0, "A-B_1", 0, "1A", 0, "1A", 0, "ABCDEFGH\ABCDEFGH", 0, "ABCDEFGH\ABCDEFGH", 0
                db      "X\1A", 0, "X\1A", 0, "-", 0, "-", 0, 0
specs_bad       db      "..\..\X", 0, "12", 0, "ABCDEFGHI", 0, "A\B\C", 0, "\A", 0, "A\", 0, "A B", 0, "2\X", 0
                db      "X\12", 0, "ABCDEFGH\ABCDEFGHI", 0, "A.B", 0, "A:B", 0, "?", 0, 0

; RESOLVE name, the PATCHES= value, the folder it settles to, 1 when PATCHES= is the folder, 1 when it is refused.
%macro RESOLVE 5
        CASE    %1
        mov     di, prog_dir
        mov     si, %%prog
        call    strcpy
        mov     di, cfg_patches
        mov     si, %%value
        call    strcpy
        call    patches_resolve
        call    cf_ax
        mov     cx, %5
        call    t_check
        mov     si, patches_dir
        mov     di, %%dir
        call    streq
        xor     cx, cx
        call    t_check
        mov     al, [patches_explicit]
        xor     ah, ah
        mov     cx, %4
        call    t_check
        ENDCASE
        jmp     %%over
%%prog: db      "C:\REBEEP\", 0
%%value: db     %2, 0
%%dir:  db      %3, 0
%%over:
%endmacro

; LOOKUP name, spec text, the expected bytes, the loaded name: the spec is found and parsed.
%macro LOOKUP 4
        CASE    %1
        mov     si, %2
        mov     cx, %2_len
        call    spec_valid
        call    cf_ax
        xor     cx, cx
        call    t_check
        call    find_patch
        call    cf_ax
        xor     cx, cx
        call    t_check
        mov     si, %3
        mov     di, pbuf + PB_OCTAVE
        mov     bx, PBLK_LEN - PB_OCTAVE
        call    bytes_equal
        xor     cx, cx
        call    t_check
        mov     si, pbuf
        mov     di, %%name
        call    streq
        xor     cx, cx
        call    t_check
        ENDCASE
        jmp     %%over
%%name: db      %4, 0
%%over:
%endmacro

; ---------------------------------------------------------------- the cases

start:
        VALID   "parses_values", t_basic, e_basic
        VALID   "parses_padded_lowercase_crlf", t_messy, e_messy
        VALID   "parses_without_final_newline", t_nolf, e_nolf
        VALID   "parses_range_ends", t_max, e_max
        VALID   "parses_4op_fm_fm", t_4fmfm, e_4fmfm
        VALID   "parses_4op_am_fm", t_4amfm, e_4amfm
        VALID   "parses_4op_fm_am", t_4fmam, e_4fmam
        VALID   "parses_4op_am_am", t_4amam, e_4amam
        VALID   "parses_2048_bytes", t_big2048, e_big

        CASE    "rejects_each_malformed_file"
        mov     word [tw], bad_table
.next:
        mov     bx, [tw]
        mov     si, [bx]
        mov     cx, [bx + 2]
        call    run_parse
        BADCHECK
        add     word [tw], 4
        cmp     word [tw], bad_end
        jb      .next
        ENDCASE

        CFG     "settings_trims_and_reads", c_trim, "PACKS\ONE", "FLUTE"
        CFG     "settings_first_occurrence_wins", c_first, "A", "ORGAN"
        CFG     "settings_skips_comments", c_comment, "", "FLUTE"
        CFG     "settings_ignores_unknown_lines", c_unknown, "", "BRASS"
        CFG     "settings_empty_first_value_counts", c_emptyfirst, "", ""
        CFG     "settings_without_the_keys", c_none, "", ""
        CFG     "settings_keeps_value_case", c_lower, "", "Bell"

        CASE    "settings_cuts_long_values"
        mov     si, c_long
        mov     cx, c_long_len
        call    cfg_parse
        mov     si, cfg_patches
        call    asciz_len
        mov     ax, cx
        mov     cx, CFG_PATCHES_LEN
        call    t_check
        mov     si, cfg_patch
        call    asciz_len
        mov     ax, cx
        mov     cx, CFG_PATCH_LEN
        call    t_check
        mov     si, cfg_patches
        call    path_valid
        call    cf_ax
        mov     cx, 1
        call    t_check
        ENDCASE

        CASE    "patches_path_rule_accepts"
        mov     si, paths_ok
.pok:
        cmp     byte [si], 0
        je      .pokdone
        call    path_valid
        call    cf_ax
        xor     cx, cx
        call    t_check
        call    next_asciz
        jmp     .pok
.pokdone:
        ENDCASE

        CASE    "patches_path_rule_rejects"
        mov     si, paths_bad
.pbad:
        cmp     byte [si], 0
        je      .pbaddone
        call    path_valid
        call    cf_ax
        mov     cx, 1
        call    t_check
        call    next_asciz
        jmp     .pbad
.pbaddone:
        ENDCASE

        CASE    "patches_path_rule_rejects_empty"
        mov     byte [path_buf], 0
        mov     si, path_buf
        call    path_valid
        call    cf_ax
        mov     cx, 1
        call    t_check
        ENDCASE

        RESOLVE "patches_default_folder", "", "C:\REBEEP\PATCHES", 0, 0
        RESOLVE "patches_relative_to_program", "Packs", "C:\REBEEP\PACKS", 1, 0
        RESOLVE "patches_relative_subfolder", "mine\packs\", "C:\REBEEP\MINE\PACKS", 1, 0
        RESOLVE "patches_absolute_drive", "d:\my", "D:\MY", 1, 0
        RESOLVE "patches_absolute_rooted", "\my\patches", "\MY\PATCHES", 1, 0
        RESOLVE "patches_bad_dotdot", "..", "C:\REBEEP\PATCHES", 0, 1
        RESOLVE "patches_bad_up_and_out", "..\..\X", "C:\REBEEP\PATCHES", 0, 1
        RESOLVE "patches_bad_wildcard", "A*", "C:\REBEEP\PATCHES", 0, 1
        RESOLVE "patches_bad_question", "A?B", "C:\REBEEP\PATCHES", 0, 1
        RESOLVE "patches_bad_too_long", "ABCDEFGH\ABCDEFGH\ABCDEFGH\ABCDEFGH\ABCDEFGH\ABCDEFGH\ABCDEFGH\AB", "C:\REBEEP\PATCHES", 0, 1
        RESOLVE "patches_bad_long_component", "0123456789", "C:\REBEEP\PATCHES", 0, 1

        CASE    "patch_name_rule_accepts"
        mov     si, specs_ok
.sok:
        cmp     byte [si], 0
        je      .sokdone
        call    asciz_len
        call    spec_valid
        call    cf_ax
        xor     cx, cx
        call    t_check
        call    next_asciz              ; SI = the expected spec
        mov     di, spec_buf
        call    streq
        xor     cx, cx
        call    t_check
        call    next_asciz              ; on to the next pair
        jmp     .sok
.sokdone:
        ENDCASE

        CASE    "patch_name_rule_rejects"
        mov     si, specs_bad
.sbad:
        cmp     byte [si], 0
        je      .sbaddone
        call    asciz_len
        call    spec_valid
        call    cf_ax
        mov     cx, 1
        call    t_check
        call    next_asciz
        jmp     .sbad
.sbaddone:
        ENDCASE

        CASE    "patch_name_rule_rejects_empty_text"
        xor     cx, cx
        mov     si, specs_ok
        call    spec_valid
        call    cf_ax
        mov     cx, 1
        call    t_check
        ENDCASE

        CASE    "finds_program_folder"
        call    find_prog_dir
        mov     si, prog_dir
        call    asciz_len
        or      cx, cx
        jz      .none
        mov     bx, cx
        mov     al, [prog_dir + bx - 1]
        xor     ah, ah
        mov     cx, '\'
        call    t_check
        jmp     .end
.none:
        xor     ax, ax
        mov     cx, 1
        call    t_check                 ; DOS gave no path
.end:
        mov     byte [prog_dir], 0      ; the factory files are in the current folder
        ENDCASE

        mov     di, patches_dir
        mov     si, q_nowhere
        call    strcpy
        LOOKUP  "looks_up_factory_organ", q_organ, e_organ, "FACTORY\ORGAN"
        LOOKUP  "looks_up_factory_flute", q_flute, e_flute, "FACTORY\FLUTE"
        LOOKUP  "looks_up_factory_brass", q_brass, e_brass, "FACTORY\BRASS"
        LOOKUP  "looks_up_factory_bell", q_bell, e_bell, "FACTORY\BELL"
        LOOKUP  "bare_name_falls_back_to_factory", q_bare, e_bell, "FACTORY\BELL"

        CASE    "lookup_reports_a_missing_file"
        mov     si, q_none
        mov     cx, q_none_len
        call    spec_valid
        mov     word [fail_who], 1
        call    find_patch
        call    cf_ax
        mov     cx, 1
        call    t_check
        mov     ax, [fail_who]
        xor     cx, cx
        call    t_check
        mov     ax, [fail_reason]
        mov     cx, r_notfound
        call    t_check
        mov     si, q_nobare
        mov     cx, q_nobare_len
        call    spec_valid
        call    find_patch
        call    cf_ax
        mov     cx, 1
        call    t_check
        mov     ax, [fail_reason]
        mov     cx, r_notfound2
        call    t_check
        ENDCASE

        CASE    "lookup_names_a_missing_patches_folder"
        mov     byte [patches_missing], 1
        mov     si, q_pack
        mov     cx, q_pack_len
        call    spec_valid
        call    find_patch
        call    cf_ax
        mov     cx, 1
        call    t_check
        mov     ax, [fail_who]
        mov     cx, patches_dir
        call    t_check
        mov     ax, [fail_reason]
        mov     cx, r_nofolder
        call    t_check
        mov     si, q_none              ; FACTORY is never in the patches folder
        mov     cx, q_none_len
        call    spec_valid
        call    find_patch
        mov     ax, [fail_who]
        xor     cx, cx
        call    t_check
        mov     ax, [fail_reason]
        mov     cx, r_notfound
        call    t_check
        mov     byte [patches_missing], 0
        ENDCASE

        CASE    "critical_error_fails_the_call"
        xor     ax, ax
        mov     es, ax
        push    word [es:24h * 4]       ; INT 24h as it was
        push    word [es:24h * 4 + 2]
        call    crit_on
        mov     ax, [es:24h * 4]
        mov     cx, crit_fail
        call    t_check
        mov     ax, [es:24h * 4 + 2]
        mov     cx, cs
        call    t_check
        xor     ax, ax
        int     24h                     ; what DOS does on a not-ready drive
        mov     cx, 3
        call    t_check
        call    crit_off
        mov     ax, [es:24h * 4 + 2]
        pop     cx
        call    t_check
        mov     ax, [es:24h * 4]
        pop     cx
        call    t_check
        ENDCASE

        jmp     t_done

q_nowhere       db      "NOWHERE", 0

EXPECT2 e_organ, 4, 1, {22h, 21h, 18h, 08h, 0F0h, 0F0h, 0Ch, 0Ch, 00h, 00h, 01h}
EXPECT2 e_flute, 4, 1, {21h, 21h, 28h, 00h, 0B0h, 0C0h, 0Ah, 0Ah, 00h, 00h, 00h}
EXPECT2 e_brass, 4, 1, {21h, 21h, 10h, 00h, 0E0h, 0F0h, 0Bh, 0Bh, 00h, 00h, 0Ah}
EXPECT2 e_bell, 4, 1, {23h, 21h, 20h, 00h, 0F0h, 0F4h, 2Ah, 2Ah, 00h, 00h, 00h}
TEXT    q_organ, "FACTORY\ORGAN"
TEXT    q_flute, "factory\flute"
TEXT    q_brass, "FACTORY\BRASS"
TEXT    q_bell, "FACTORY\BELL"
TEXT    q_bare, "bell"
TEXT    q_none, "FACTORY\NOPE"
TEXT    q_nobare, "NOPE"
TEXT    q_pack, "PACKS\NOPE"

tblk            times PBLK_LEN db 0
tw              dw      0
