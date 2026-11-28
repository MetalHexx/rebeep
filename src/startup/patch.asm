; The startup part's patch file parser: a ReBeep patch (.RBP) as text into the register records
; the OPL target plays. The rules are src/studio/patch.c's, line for line (keep the two
; identical): sections [PATCH], [2OP] and optional [4OP]; keys, values and section names in
; any case; spaces and tabs trimmed; ';' comment lines, blank lines, unknown keys and unknown
; sections ignored; CRLF or LF; a duplicate key or section is invalid; at most 2048 bytes;
; FORMAT=1 and [2OP] required, [4OP] complete or absent; every value in range.
; 8086. Included after resident_end, so it is freed when going resident. DS is this module's
; segment: it holds the text as well as the state. Also home to the line and span helpers that
; files.asm's settings reader shares.
; SPDX-License-Identifier: MIT

        cpu     8086
%include "amis.inc"

PATCH_FILE_MAX  equ     2048
PROF_FILE_MAX   equ     4096            ; a profile file (.RBG)

; patch_parse
; In:  DS:SI = the text, CX = its length, ES:DI = a patch block (PBLK_LEN bytes: the name,
;      then the octave, flags, two-operator record and four-operator record of amis.inc)
; Out: CF clear: the octave, flags and records are filled; the name is the caller's.
;      CF set: SI -> a '$'-terminated reason, and the block is untouched.
;      Clobbers AX, BX, CX, DX, SI and DI; keeps ES and the stack.
patch_parse:
        push    di
        push    es
        call    pf_run
        pop     es
        pop     di
        jc      .done
        add     di, PB_OCTAVE
        mov     si, pf_out
        mov     cx, PBLK_LEN - PB_OCTAVE
        rep     movsb
        clc
.done:
        ret

; Everything past the name, as the block holds it.
PO_OCTAVE       equ     0
PO_FLAGS        equ     1
PO_REC2         equ     PB_REC2 - PB_OCTAVE
PO_REC4         equ     PB_REC4 - PB_OCTAVE

SEC_NONE        equ     0
SEC_PATCH       equ     1
SEC_2OP         equ     2
SEC_4OP         equ     3
SEC_OTHER       equ     4
SECB_PATCH      equ     1               ; bit of a section in pf_seen_sec: 1 << (SEC_x - 1)
SECB_2OP        equ     2
SECB_4OP        equ     4

HAS_FORMAT      equ     01h
HAS_OCTAVE      equ     02h
HAS_CONN        equ     01h
HAS_FB          equ     02h
HAS_OP1         equ     04h             ; OP(n+1) is HAS_OP1 << n
VOICE2_FULL     equ     0Fh             ; CONNECTION, FEEDBACK, OP1, OP2
VOICE4_FULL     equ     3Fh

OP_FIELDS       equ     12
P_AR            equ     0               ; the order of an OPn line's numbers
P_DR            equ     1
P_SL            equ     2
P_RR            equ     3
P_OL            equ     4
P_KSL           equ     5
P_MULT          equ     6
P_WAVE          equ     7
P_TREM          equ     8
P_VIB           equ     9
P_SUS           equ     10
P_KSR           equ     11

%macro FAIL 1
        mov     si, %1
        jmp     pf_fail
%endmacro

; pf_fail: abandon the parse from any depth: back to what patch_parse's call left on the
; stack, with CF set and SI the reason.
pf_fail:
        mov     sp, [pf_sp]
        stc
        ret

pf_run:
        cld
        mov     [pf_sp], sp
        cmp     cx, PATCH_FILE_MAX
        jbe     .size
        FAIL    r_size
.size:
        mov     [pf_pos], si
        add     cx, si
        mov     [pf_end], cx
        push    ds
        pop     es
        mov     di, pf_zero
        mov     cx, pf_zero_len
        xor     al, al
        rep     stosb
        mov     byte [pf_out + PO_OCTAVE], 4
.line:
        call    next_line
        jc      .finish
        call    pf_line
        jmp     .line
.finish:
        test    byte [pf_seen_sec], SECB_PATCH
        jnz     .patch
        FAIL    r_nopatch
.patch:
        test    byte [pf_seen_patch], HAS_FORMAT
        jnz     .format
        FAIL    r_noformat
.format:
        test    byte [pf_seen_sec], SECB_2OP
        jnz     .has2
        FAIL    r_no2op
.has2:
        cmp     byte [pf_seen], VOICE2_FULL
        je      .full2
        FAIL    r_inc2
.full2:
        mov     al, [pf_fb]
        shl     al, 1
        or      al, [pf_conn]
        mov     [pf_out + PO_REC2 + 10], al
        mov     byte [pf_out + PO_FLAGS], RBS_PF_LOADED
        test    byte [pf_seen_sec], SECB_4OP
        jz      .done
        cmp     byte [pf_seen + 1], VOICE4_FULL
        je      .full4
        FAIL    r_inc4
.full4:
        mov     al, [pf_fb + 1]         ; the first channel: feedback and CNT1 (connection bit 0)
        shl     al, 1
        mov     ah, [pf_conn + 1]
        and     ah, 1
        or      al, ah
        mov     [pf_out + PO_REC4 + 20], al
        mov     al, [pf_conn + 1]       ; the second channel: CNT2 (connection bit 1)
        shr     al, 1
        and     al, 1
        mov     [pf_out + PO_REC4 + 21], al
        or      byte [pf_out + PO_FLAGS], RBS_PF_4OP
.done:
        clc
        ret

; next_line: the next line of the text between [pf_pos] and [pf_end], trimmed.
; Out: CF set at the end of the text; otherwise SI, DX = the line [SI, DX).
next_line:
        mov     si, [pf_pos]
        cmp     si, [pf_end]
        jae     .end
        mov     bx, si
.eol:
        cmp     bx, [pf_end]
        jae     .got
        cmp     byte [bx], 10
        je      .got
        inc     bx
        jmp     .eol
.got:
        lea     ax, [bx + 1]
        mov     [pf_pos], ax
        mov     dx, bx
        call    trim
        clc
        ret
.end:
        stc
        ret

; pf_line: one trimmed line, SI, DX.
pf_line:
        cmp     si, dx
        je      .ret                    ; blank
        mov     al, [si]
        cmp     al, ';'
        je      .ret
        cmp     al, '['
        jne     .keyval
        jmp     pf_section
.keyval:
        call    split_kv
        jc      .ret
        mov     al, [pf_sec]
        cmp     al, SEC_PATCH
        jne     .voice
        jmp     pf_patchkey
.voice:
        cmp     al, SEC_2OP
        jb      .ret
        cmp     al, SEC_4OP
        ja      .ret
        jmp     pf_voicekey
.ret:
        ret                             ; before any section, or in an unknown one

; pf_section: a '[name]' line, SI, DX.
pf_section:
        mov     bx, dx
        cmp     byte [bx - 1], ']'
        jne     .header
        inc     si
        dec     dx
        call    trim
        mov     bx, w_sections
        call    find_word
        jnc     .known
        mov     byte [pf_sec], SEC_OTHER
        ret
.known:
        mov     cl, al
        mov     ah, 1
        shl     ah, cl
        test    [pf_seen_sec], ah
        jnz     .twice
        or      [pf_seen_sec], ah
        inc     al
        mov     [pf_sec], al
        ret
.header:
        FAIL    r_header
.twice:
        FAIL    r_secdup

; pf_patchkey: a KEY=VALUE of [PATCH].
pf_patchkey:
        mov     bx, w_format
        call    key_is
        jc      .octave
        test    byte [pf_seen_patch], HAS_FORMAT
        jnz     .twice
        call    value_num
        jc      .badformat
        cmp     ax, 1
        jne     .badformat
        or      byte [pf_seen_patch], HAS_FORMAT
        ret
.octave:
        mov     bx, w_octave
        call    key_is
        jc      .ret
        test    byte [pf_seen_patch], HAS_OCTAVE
        jnz     .twice
        call    value_num
        jc      .badoctave
        cmp     ax, 7
        ja      .badoctave
        mov     [pf_out + PO_OCTAVE], al
        or      byte [pf_seen_patch], HAS_OCTAVE
.ret:
        ret
.twice:
        FAIL    r_keydup
.badformat:
        FAIL    r_format
.badoctave:
        FAIL    r_octave

; pf_voicekey: a KEY=VALUE of [2OP] or [4OP]; pf_v says which.
pf_voicekey:
        mov     al, [pf_sec]
        sub     al, SEC_2OP
        mov     [pf_v], al
        mov     bx, w_connection
        call    key_is
        jc      .feedback
        mov     ah, HAS_CONN
        call    voice_seen
        mov     si, [pf_vs]
        mov     dx, [pf_ve]
        mov     bx, w_conn2
        cmp     byte [pf_v], 0
        je      .words
        mov     bx, w_conn4
.words:
        call    find_word
        jnc     .conn
        FAIL    r_conn
.conn:
        mov     bl, [pf_v]
        xor     bh, bh
        mov     [pf_conn + bx], al
        ret
.feedback:
        mov     bx, w_feedback
        call    key_is
        jc      .op
        mov     ah, HAS_FB
        call    voice_seen
        call    value_num
        jc      .badfb
        cmp     ax, 7
        jbe     .fb
.badfb:
        FAIL    r_fb
.fb:
        mov     bl, [pf_v]
        xor     bh, bh
        mov     [pf_fb + bx], al
        ret
.op:
        mov     ax, [pf_ke]
        sub     ax, [pf_ks]
        cmp     ax, 3
        jne     .ret
        mov     bx, [pf_ks]
        mov     al, [bx]
        call    upper
        cmp     al, 'O'
        jne     .ret
        mov     al, [bx + 1]
        call    upper
        cmp     al, 'P'
        jne     .ret
        mov     al, [bx + 2]
        sub     al, '1'                 ; the operator's index; a character below '1' wraps high
        mov     ah, [pf_v]
        add     ah, ah
        inc     ah                      ; the last index: 1, or 3 in [4OP]
        cmp     al, ah
        ja      .ret                    ; OP3 and OP4 mean nothing in [2OP]
        mov     [pf_n], al
        mov     cl, al
        mov     ah, HAS_OP1
        shl     ah, cl
        call    voice_seen
        mov     di, pf_out + PO_REC2
        mov     word [pf_stride], 2
        cmp     byte [pf_v], 0
        je      .dest
        mov     di, pf_out + PO_REC4
        mov     word [pf_stride], 4
.dest:
        mov     al, [pf_n]
        xor     ah, ah
        add     di, ax
        mov     si, [pf_vs]
        mov     dx, [pf_ve]
        jmp     parse_op
.ret:
        ret

; voice_seen: AH = a key's bit. Fails when this section already had the key; otherwise notes it.
voice_seen:
        mov     bl, [pf_v]
        xor     bh, bh
        test    [pf_seen + bx], ah
        jnz     .twice
        or      [pf_seen + bx], ah
        ret
.twice:
        FAIL    r_keydup

; parse_op: SI, DX = the value of an OPn key: the 12 numbers of P_AR..P_KSR, separated by
; spaces or tabs. Writes the five registers 20h, 40h, 60h, 80h and E0h of the operator to
; [DI], [DI + stride], ... with the mapping the studio's opl_regs2 uses.
parse_op:
        xor     bx, bx                  ; BX = the numbers read so far
.token:
        call    skip_blank
        cmp     si, dx
        jae     .counted
        cmp     bx, OP_FIELDS
        jae     .count                  ; a 13th number
        mov     cx, si                  ; the token is [CX, SI)
.end:
        cmp     si, dx
        jae     .scan
        mov     al, [si]
        call    is_blank
        je      .scan
        inc     si
        jmp     .end
.scan:
        push    dx
        push    si
        mov     dx, si
        mov     si, cx
        call    get_num
        pop     si
        pop     dx
        jc      .value
        mov     cl, [op_max + bx]
        xor     ch, ch
        cmp     ax, cx
        ja      .value
        mov     [pf_vals + bx], al
        inc     bx
        jmp     .token
.counted:
        cmp     bx, OP_FIELDS
        je      .convert
.count:
        FAIL    r_opcount
.value:
        FAIL    r_opvalue
.convert:
        mov     al, [pf_vals + P_TREM]  ; 20h: tremolo, vibrato, sustain, KSR, multiplier
        shl     al, 1
        or      al, [pf_vals + P_VIB]
        shl     al, 1
        or      al, [pf_vals + P_SUS]
        shl     al, 1
        or      al, [pf_vals + P_KSR]
        mov     cl, 4
        shl     al, cl
        or      al, [pf_vals + P_MULT]
        call    put_reg
        mov     bl, [pf_vals + P_KSL]   ; 40h: the KSL bits in the register's order, 63 - OL
        xor     bh, bh
        mov     al, [ksl_bits + bx]
        mov     cl, 6
        shl     al, cl
        mov     ah, 63
        sub     ah, [pf_vals + P_OL]
        or      al, ah
        call    put_reg
        mov     al, [pf_vals + P_AR]    ; 60h: attack, decay
        mov     cl, 4
        shl     al, cl
        or      al, [pf_vals + P_DR]
        call    put_reg
        mov     al, 15                  ; 80h: 15 - SL, release
        sub     al, [pf_vals + P_SL]
        mov     cl, 4
        shl     al, cl
        or      al, [pf_vals + P_RR]
        call    put_reg
        mov     al, [pf_vals + P_WAVE]  ; E0h as given; opl_program masks it on an OPL2
put_reg:
        mov     [di], al
        add     di, [pf_stride]
        ret

; split_kv: a trimmed line, SI, DX. Out: CF set without a '='; otherwise pf_ks/pf_ke and
; pf_vs/pf_ve = the key and the value, each trimmed.
split_kv:
        mov     bx, si
.eq:
        cmp     bx, dx
        jae     .none
        cmp     byte [bx], '='
        je      .found
        inc     bx
        jmp     .eq
.found:
        mov     [pf_le], dx
        mov     dx, bx
        push    bx
        call    trim
        mov     [pf_ks], si
        mov     [pf_ke], dx
        pop     si
        inc     si
        mov     dx, [pf_le]
        call    trim
        mov     [pf_vs], si
        mov     [pf_ve], dx
        clc
        ret
.none:
        stc
        ret

; key_is: BX = an upper-case word. Out: CF clear when the key is that word.
key_is:
        push    si
        push    dx
        mov     si, [pf_ks]
        mov     dx, [pf_ke]
        call    span_is
        pop     dx
        pop     si
        ret

; value_num: the value as a number. Out: AX, or CF set when it is not all digits.
value_num:
        mov     si, [pf_vs]
        mov     dx, [pf_ve]
        jmp     get_num

; trim: SI, DX = a span; spaces, tabs and CRs are cut from both ends. Clobbers AL and BX.
trim:
        call    skip_blank
.right:
        cmp     dx, si
        jbe     .done
        mov     bx, dx
        mov     al, [bx - 1]
        call    is_blank
        jne     .done
        dec     dx
        jmp     .right
.done:
        ret

; skip_blank: SI moves past the blanks of the span [SI, DX).
skip_blank:
        cmp     si, dx
        jae     .done
        mov     al, [si]
        call    is_blank
        jne     .done
        inc     si
        jmp     skip_blank
.done:
        ret

; is_blank: ZF set when AL is a space, a tab or a CR.
is_blank:
        cmp     al, ' '
        je      .yes
        cmp     al, 9
        je      .yes
        cmp     al, 0Dh
.yes:
        ret

; upper: AL, a lower-case letter made upper case.
upper:
        cmp     al, 'a'
        jb      .done
        cmp     al, 'z'
        ja      .done
        sub     al, 20h
.done:
        ret

; span_is: SI, DX = a span, BX = an upper-case ASCIZ word. Out: CF clear when the span is the
; word, in any case. Keeps SI and BX.
span_is:
        push    si
        push    bx
.next:
        cmp     byte [bx], 0
        je      .spent
        cmp     si, dx
        jae     .differ
        mov     al, [si]
        inc     si
        call    upper
        cmp     al, [bx]
        jne     .differ
        inc     bx
        jmp     .next
.spent:
        cmp     si, dx                  ; the word is used up: the span must be too
        jb      .differ
        clc
        jmp     .out
.differ:
        stc
.out:
        pop     bx
        pop     si
        ret

; find_word: SI, DX = a span, BX = a list of upper-case ASCIZ words ended by an empty one.
; Out: CF clear and AL = the index of the word the span is; CF set when it is none.
find_word:
        push    bx
        xor     ah, ah
.next:
        cmp     byte [bx], 0
        je      .none
        call    span_is
        jnc     .found
.skip:
        inc     bx
        cmp     byte [bx - 1], 0
        jne     .skip
        inc     ah
        jmp     .next
.found:
        mov     al, ah
        pop     bx
        clc
        ret
.none:
        pop     bx
        stc
        ret

; get_num: SI, DX = a span of decimal digits. Out: AX = the value, held at 999 (past every
; range); CF set for an empty span or any other character. Keeps BX and CX.
get_num:
        push    bx
        push    cx
        xor     bx, bx
        cmp     si, dx
        jae     .bad
.digit:
        mov     al, [si]
        sub     al, '0'
        cmp     al, 9
        ja      .bad
        inc     si
        mov     cx, bx
        shl     bx, 1
        shl     bx, 1
        add     bx, cx
        shl     bx, 1                   ; BX * 10
        xor     ah, ah
        add     bx, ax
        cmp     bx, 999
        jbe     .more
        mov     bx, 999
.more:
        cmp     si, dx
        jb      .digit
        mov     ax, bx
        clc
        jmp     .out
.bad:
        stc
.out:
        pop     cx
        pop     bx
        ret

; ---------------------------------------------------------------- data

w_sections      db      "PATCH", 0, "2OP", 0, "4OP", 0, 0
w_format        db      "FORMAT", 0
w_octave        db      "OCTAVE", 0
w_connection    db      "CONNECTION", 0
w_feedback      db      "FEEDBACK", 0
w_conn2         db      "FM", 0, "AM", 0, 0
w_conn4         db      "FM-FM", 0, "AM-FM", 0, "FM-AM", 0, "AM-AM", 0, 0

; The largest value of each of an OPn line's numbers, and the KSL value's bits in 40h.
op_max          db      15, 15, 15, 15, 63, 3, 15, 7, 1, 1, 1, 1
ksl_bits        db      0, 2, 1, 3

r_size          db      "the file is over 2048 bytes$"
r_profsize      db      "the file is over 4096 bytes$"
r_header        db      "a section header is not [name]$"
r_secdup        db      "a section is given twice$"
r_keydup        db      "a key is given twice$"
r_format        db      "FORMAT is not 1$"
r_octave        db      "OCTAVE is not 0 to 7$"
r_conn          db      "CONNECTION is not FM or AM ([4OP]: FM-FM, AM-FM, FM-AM or AM-AM)$"
r_fb            db      "FEEDBACK is not 0 to 7$"
r_opcount       db      "an OPn line needs 12 numbers$"
r_opvalue       db      "an OPn number is not a number in its range$"
r_nopatch       db      "there is no [PATCH] section$"
r_noformat      db      "[PATCH] has no FORMAT$"
r_no2op         db      "there is no [2OP] section$"
r_inc2          db      "[2OP] needs CONNECTION, FEEDBACK, OP1 and OP2$"
r_inc4          db      "[4OP] needs CONNECTION, FEEDBACK and OP1 to OP4$"

; The parse's state: a run starts by zeroing pf_zero to pf_zero_len. pf_out is the part of the
; block past the name; the records are filled in place, as the file's keys arrive.
pf_sp           dw      0
pf_pos          dw      0
pf_end          dw      0
pf_le           dw      0
pf_ks           dw      0
pf_ke           dw      0
pf_vs           dw      0
pf_ve           dw      0
pf_stride       dw      0
pf_zero:
pf_sec          db      0
pf_v            db      0               ; 0 in [2OP], 1 in [4OP]
pf_n            db      0
pf_seen_sec     db      0
pf_seen_patch   db      0
pf_seen         db      0, 0            ; the keys seen in [2OP] and in [4OP]
pf_conn         db      0, 0
pf_fb           db      0, 0
pf_vals         times OP_FIELDS db 0
pf_out          times PBLK_LEN - PB_OCTAVE db 0
pf_zero_len     equ     $ - pf_zero
