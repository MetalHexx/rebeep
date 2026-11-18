; QPICHK - reports whether Jemm's QPIEMU (the QEMM-style port trapping API
; ReBeep needs) is installed. Run at boot by D:\ENV\BOOT.BAT.
; Exit code: 0 = QPI present, 1 = not present.
; SPDX-License-Identifier: MIT

        cpu     8086
        org     100h

start:
        ; QPIEMU's own detection call: INT 2Fh AX=1684h BX=4354h.
        ; Success: AL = 0 and ES:DI = the QPI entry point.
        xor     di, di
        mov     es, di
        mov     ax, 1684h
        mov     bx, 4354h
        int     2Fh
        or      al, al
        jnz     absent
        mov     ax, es
        or      ax, di
        jz      absent

        mov     [qpi], di
        mov     [qpi + 2], es
        mov     ah, 03h                 ; QPI_GetVersion -> BX = version
        call    far [qpi]
        mov     [ver], bx

        mov     dx, msg_ok
        call    print
        mov     al, [ver + 1]
        call    hexbyte
        mov     dl, '.'
        call    putc
        mov     al, [ver]
        call    hexbyte
        mov     dx, msg_crlf
        call    print
        mov     ax, 4C00h
        int     21h

absent:
        mov     dx, msg_no
        call    print
        mov     ax, 4C01h
        int     21h

; print a $-terminated string at DS:DX
print:
        mov     ah, 09h
        int     21h
        ret

; print the character in DL
putc:
        mov     ah, 02h
        int     21h
        ret

; print AL as two hex digits
hexbyte:
        push    ax
        mov     cl, 4
        shr     al, cl
        call    hexdigit
        pop     ax
        and     al, 0Fh
hexdigit:
        add     al, '0'
        cmp     al, '9'
        jbe     .out
        add     al, 'A' - '9' - 1
.out:
        mov     dl, al
        jmp     putc

msg_ok   db      "QPICHK: QPI ready (QPIEMU), version $"
msg_no   db      "QPICHK: no QPI. Boot the 'ReBeep dev' entry so Jemm loads, then run JLOAD QPIEMU.DLL", 13, 10, "$"
msg_crlf db      13, 10, "$"

qpi     dw      0, 0
ver     dw      0
