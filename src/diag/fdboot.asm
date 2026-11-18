; FDBOOT - boot sector of the release floppy image. It never stops the machine: a floppy left in
; A: hands the boot over to the first hard disk, and only asks for a key when there is none.
; `release create` copies the floppy's BPB over bytes 03h-3Dh; the code and 55AAh are kept.
; SPDX-License-Identifier: MIT

        cpu     8086
        org     7C00h

%define RELOC(x) ((x) - 7C00h + 0600h)

        jmp     short start
        nop
        times   3Eh - ($ - $$) db 0     ; BPB placeholder

start:
        cli
        xor     ax, ax
        mov     ss, ax
        mov     sp, 7C00h
        mov     ds, ax
        mov     es, ax
        sti
        cld

        ; Move out of the way: the hard disk's boot sector is read to 0000:7C00h.
        mov     si, 7C00h
        mov     di, 0600h
        mov     cx, 256
        rep movsw
        jmp     0000h:RELOC(relocated)

relocated:
        mov     si, 3                   ; tries
retry:
        mov     ax, 0201h               ; read one sector
        mov     bx, 7C00h
        mov     cx, 0001h               ; cylinder 0, sector 1
        mov     dx, 0080h               ; head 0, first hard disk
        int     13h
        jnc     read_ok
        xor     ax, ax                  ; reset the disk and try again
        mov     dx, 0080h
        int     13h
        dec     si
        jnz     retry
        jmp     short no_boot

read_ok:
        cmp     word [7C00h + 510], 0AA55h
        jne     no_boot
        mov     dl, 80h
        jmp     0000h:7C00h

no_boot:
        mov     si, RELOC(msg)
print:
        lodsb
        or      al, al
        jz      wait_key
        mov     ah, 0Eh
        mov     bx, 0007h
        int     10h
        jmp     short print

wait_key:
        xor     ax, ax
        int     16h
        int     19h

msg:    db      "Not a boot disk. Remove it and press a key.", 13, 10, 0

        times   510 - ($ - $$) db 0
        dw      0AA55h
