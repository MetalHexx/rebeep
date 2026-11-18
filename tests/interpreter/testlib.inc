; Result printing for the T_* test programs. Output goes to stdout, which the
; suite redirects to RESULT.TXT: PASS/FAIL lines, then DONE <n> last.
; A case runs CASE, any number of checks (t_check / t_checkd), then ENDCASE.
; Only the first failed check of a case is reported.
; SPDX-License-Identifier: MIT

        cpu     8086

; Start a case: print name when it ends, clear its failure state.
%macro CASE 1
        jmp     short %%go
%%name: db      %1, '$'
%%go:
        mov     dx, %%name
        call    t_begin
%endmacro

%macro ENDCASE 0
        call    t_endcase
%endmacro

t_begin:
        mov     [t_name], dx
        mov     byte [t_bad], 0
        mov     word [t_step], 0
        ret

; t_check: AX (actual) must equal CX (expected).
t_check:
        cmp     byte [t_bad], 0
        jne     .done
        inc     word [t_step]
        cmp     ax, cx
        je      .done
        mov     [t_gotax], ax
        mov     [t_wantax], cx
        mov     [t_gotbx], bx
        mov     [t_wantbx], bx
        mov     byte [t_bad], 1
.done:
        ret

; t_checkd: as t_check, and BX (actual) must equal SI (expected).
t_checkd:
        call    t_check
        cmp     byte [t_bad], 0
        jne     .done
        cmp     bx, si
        je      .done
        mov     [t_gotax], ax
        mov     [t_wantax], cx
        mov     [t_gotbx], bx
        mov     [t_wantbx], si
        mov     byte [t_bad], 1
.done:
        ret

t_endcase:
        inc     word [t_count]
        cmp     byte [t_bad], 0
        jne     .fail
        mov     dx, s_pass
        call    t_print
        mov     dx, [t_name]
        call    t_print
        mov     dx, s_crlf
        jmp     t_print
.fail:
        mov     dx, s_fail
        call    t_print
        mov     dx, [t_name]
        call    t_print
        mov     dx, s_step
        call    t_print
        mov     ax, [t_step]
        call    t_printdec
        mov     dx, s_got
        call    t_print
        mov     ax, [t_gotax]
        call    t_hexword
        mov     dl, '/'
        call    t_putc
        mov     ax, [t_gotbx]
        call    t_hexword
        mov     dx, s_want
        call    t_print
        mov     ax, [t_wantax]
        call    t_hexword
        mov     dl, '/'
        call    t_putc
        mov     ax, [t_wantbx]
        call    t_hexword
        mov     dx, s_crlf
        jmp     t_print

; Prints DONE <n> last and exits.
t_done:
        mov     dx, s_done
        call    t_print
        mov     ax, [t_count]
        call    t_printdec
        mov     dx, s_crlf
        call    t_print
        mov     ax, 4C00h
        int     21h

t_print:
        mov     ah, 09h
        int     21h
        ret

t_putc:
        mov     ah, 02h
        int     21h
        ret

t_printdec:
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
        pop     dx
        add     dl, '0'
        call    t_putc
        loop    .out
        pop     dx
        pop     cx
        pop     bx
        pop     ax
        ret

t_hexword:
        push    ax
        mov     al, ah
        call    t_hexbyte
        pop     ax
t_hexbyte:
        push    ax
        push    cx
        push    dx
        push    ax
        mov     cl, 4
        shr     al, cl
        call    t_hexdigit
        pop     ax
        and     al, 0Fh
        call    t_hexdigit
        pop     dx
        pop     cx
        pop     ax
        ret
t_hexdigit:
        add     al, '0'
        cmp     al, '9'
        jbe     .out
        add     al, 'A' - '9' - 1
.out:
        mov     dl, al
        jmp     t_putc

s_pass  db      "PASS $"
s_fail  db      "FAIL $"
s_step  db      ": step $"
s_got   db      " got $"
s_want  db      " want $"
s_done  db      "DONE $"
s_crlf  db      13, 10, "$"

t_name  dw      0
t_bad   db      0
t_step  dw      0
t_count dw      0
t_gotax dw      0
t_wantax dw     0
t_gotbx dw      0
t_wantbx dw     0
