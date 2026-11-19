; "REBEEPD /D": append the loaded trace build's records to D:\REBEEP\RBTRACE.TXT as one text
; line each, then empty its buffer. The trace build only; part of the startup part, so 8086
; and freed when going resident. The record layout is in include/trace.inc.
; SPDX-License-Identifier: MIT

%ifdef REBEEP_TRACE
%include "trace.inc"

; A copy is resident and of this build (change_path checked its name).
do_dump:
        mov     al, AMIS_FN_TRACE
        call    amis_call               ; DX:BX -> the trace header
        cmp     al, 0FFh
        je      .have
        DIE     msg_notrace, EXIT_FAILED
.have:
        mov     [tr_seg], dx
        mov     [tr_hdr], bx
        mov     es, dx
        pushf
        cli                             ; records below TH_COUNT never change
        mov     ax, [es:bx + TH_COUNT]
        mov     [tr_count], ax
        mov     ax, [es:bx + TH_SEEN]
        mov     [tr_seen], ax
        popf
        mov     dx, tr_path
        mov     ax, 3D01h               ; open for writing, or create
        int     21h
        jnc     .open
        mov     dx, tr_path
        xor     cx, cx
        mov     ah, 3Ch
        int     21h
        jnc     .open
        DIE     msg_trfile, EXIT_FAILED
.open:
        mov     [tr_handle], ax
        mov     bx, ax
        xor     cx, cx
        xor     dx, dx
        mov     ax, 4202h               ; to the end: each dump is appended
        int     21h
        mov     di, tr_line
        mov     si, s_tr_head
        call    tl_str
        mov     ax, [tr_count]
        call    tl_dec
        mov     si, s_tr_of
        call    tl_str
        mov     ax, [tr_seen]
        call    tl_dec
        mov     si, s_tr_cap
        call    tl_str
        mov     ax, TRACE_RECS
        call    tl_dec
        mov     al, ')'
        call    tl_char
        call    tl_write
        mov     si, s_tr_kinds
        call    tl_str
        call    tl_write
        mov     si, s_tr_cols
        call    tl_str
        call    tl_write
        mov     es, [tr_seg]
        mov     si, [tr_hdr]
        add     si, TH_SIZE
        mov     cx, [tr_count]
        jcxz    .close
.rec:
        push    cx
        call    tl_record
        call    tl_write
        pop     cx
        loop    .rec
.close:
        mov     bx, [tr_handle]
        mov     ah, 3Eh
        int     21h
        mov     es, [tr_seg]
        mov     bx, [tr_hdr]
        pushf
        cli
        mov     word [es:bx + TH_COUNT], 0
        mov     word [es:bx + TH_SEEN], 0
        popf
        mov     dx, msg_tr_done_1
        call    print
        mov     ax, [tr_count]
        call    print_dec
        mov     dx, msg_tr_done_2
        call    print
        jmp     done_ok

; tl_record: one record as text. In: ES:SI -> the record. Out: SI -> the next one.
tl_record:
        mov     ax, [es:si + TR_SEQ]
        call    tl_hex4s
        mov     ax, [es:si + TR_TICK]
        call    tl_hex4s
        mov     ax, [es:si + TR_PIT0]
        call    tl_hex4s
        mov     al, [es:si + TR_KIND]
        call    tl_kind
        mov     al, [es:si + TR_BEFORE]
        call    tl_hex2
        mov     al, '>'
        call    tl_char
        mov     al, [es:si + TR_AFTER]
        call    tl_hex2s
        mov     al, [es:si + TR_GAME]
        call    tl_hex2s
        mov     al, [es:si + TR_MODE]
        call    tl_digits
        mov     al, [es:si + TR_MASKED]
        call    tl_hex2s
        mov     ax, [es:si + TR_DIVISOR]
        call    tl_hex4s
        mov     al, [es:si + TR_FLAGS]
        call    tl_hex2
        push    si
        add     si, TR_CTX
        mov     cx, 8
.ctx:
        mov     al, ' '
        call    tl_char
        mov     al, [es:si]
        call    tl_hex2
        mov     al, '='
        call    tl_char
        mov     al, [es:si + 1]
        call    tl_hex2
        add     si, 2
        loop    .ctx
        pop     si
        add     si, TRACE_REC
        ret

; The line being built is DS:tr_line up to DI. Each helper below appends to it and
; preserves every register but DI (and SI for tl_str).

tl_char:
        mov     [di], al
        inc     di
        ret

; tl_str: the ASCIZ string at DS:SI.
tl_str:
        push    ax
.next:
        lodsb
        or      al, al
        jz      .done
        call    tl_char
        jmp     .next
.done:
        pop     ax
        ret

; tl_kind: AL = TK_* as its 7-letter name, then a space.
tl_kind:
        push    ax
        push    cx
        push    si
        mov     si, s_tr_unknown
        cmp     al, TK_NOTE_OFF
        ja      .name
        or      al, al
        jz      .name
        dec     al
        mov     cl, 3
        shl     al, cl
        xor     ah, ah
        mov     si, s_tr_names
        add     si, ax
.name:
        call    tl_str
        pop     si
        pop     cx
        pop     ax
        jmp     tl_space

; tl_digits: AL (0-9) as a digit, then a space.
tl_digits:
        push    ax
        add     al, '0'
        call    tl_char
        pop     ax
        jmp     tl_space

tl_hex4s:
        call    tl_hex4
        jmp     tl_space
tl_hex2s:
        call    tl_hex2
tl_space:
        push    ax
        mov     al, ' '
        call    tl_char
        pop     ax
        ret

tl_hex4:
        push    ax
        mov     al, ah
        call    tl_hex2
        pop     ax
tl_hex2:
        push    ax
        push    cx
        mov     ah, al
        mov     cl, 4
        shr     al, cl
        call    .nibble
        mov     al, ah
        and     al, 0Fh
        call    .nibble
        pop     cx
        pop     ax
        ret
.nibble:
        add     al, '0'
        cmp     al, '9'
        jbe     .put
        add     al, 'A' - '0' - 10
.put:
        jmp     tl_char

tl_dec:
        push    ax
        push    bx
        push    cx
        push    dx
        mov     bx, 10
        xor     cx, cx
.div:
        xor     dx, dx
        div     bx
        push    dx
        inc     cx
        or      ax, ax
        jnz     .div
.out:
        pop     ax
        add     al, '0'
        call    tl_char
        loop    .out
        pop     dx
        pop     cx
        pop     bx
        pop     ax
        ret

; tl_write: end the line with CRLF, write it to the file and start the next one.
tl_write:
        push    ax
        push    bx
        push    cx
        push    dx
        mov     ax, 0A0Dh
        mov     [di], ax
        add     di, 2
        mov     cx, di
        mov     dx, tr_line
        sub     cx, dx
        mov     bx, [tr_handle]
        mov     ah, 40h
        int     21h
        jc      .fail
        cmp     ax, cx
        jne     .fail
        mov     di, tr_line
        pop     dx
        pop     cx
        pop     bx
        pop     ax
        ret
.fail:
        DIE     msg_trfile, EXIT_FAILED

tr_path         db      "D:\REBEEP\RBTRACE.TXT", 0
s_tr_head       db      "# ", REBEEP_NAME, ": ", 0
s_tr_of         db      " records kept of ", 0
s_tr_cap        db      " offered (capacity ", 0
s_tr_kinds      db      "# kind: a speaker step forwarding the game's 61h write, one its 42h/43h "
                db      "write caused, one by ReBeep itself, an OPL note on, an OPL note off", 0
s_tr_names      db      "step61 ", 0, "steppit", 0, "steprb ", 0, "noteon ", 0, "noteoff", 0
s_tr_unknown    db      "kind?  ", 0
s_tr_cols       db      "# hex: seq tick pit0 kind real-before>after game61 mode masked "
                db      "divisor flags, then the game's last 8 writes (port=value, oldest first)", 0
msg_notrace     db      "The loaded ReBeep keeps no trace.", 13, 10, '$'
msg_trfile      db      "Can't write D:\REBEEP\RBTRACE.TXT.", 13, 10, '$'
msg_tr_done_1   db      "Added $"
msg_tr_done_2   db      " records to D:\REBEEP\RBTRACE.TXT and emptied the trace.", 13, 10, '$'

tr_seg          dw      0
tr_hdr          dw      0
tr_count        dw      0
tr_seen         dw      0
tr_handle       dw      0
tr_line         times 160 db 0
%endif
