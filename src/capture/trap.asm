; Speaker-port capture through Jemm's QPI: installs and removes the traps on 42h, 43h and
; 61h, and owns the callback QPIEMU calls on every trapped access. Resident code (386).
; Port I/O on a trapped port goes through QPI 1A00h/1A01h/1A04h only: a direct IN/OUT
; would trap again.
; Near calls, DS = CS, and everything but the stack may be clobbered unless noted.
; SPDX-License-Identifier: MIT

        cpu     386
%include "speaker.inc"
%include "amis.inc"

QPI_READ        equ 1A00h               ; DX = port -> BL
QPI_WRITE       equ 1A01h               ; DX = port, BL = byte
QPI_IO          equ 1A04h               ; CX = type, DX = port, EBX = value in / out
QPI_GET_CB      equ 1A06h               ; -> ES:DI (0:0 = none)
QPI_SET_CB      equ 1A07h               ; ES:DI
QPI_TRAP        equ 1A09h               ; DX = port, CF = already trapped
QPI_UNTRAP      equ 1A0Ah               ; DX = port

; CL on entry to the callback.
TYPE_OUT        equ 04h
TYPE_SIZE       equ 18h                 ; 00 byte, 08 word, 10 dword
TYPE_DWORD      equ 10h

; Offsets into the frame that `pushad`, `push ds`, `push es` build (ES is lowest).
IMG_ES          equ 0
IMG_DS          equ 2
IMG_EDX         equ 24
IMG_ECX         equ 28
IMG_EAX         equ 32

TRAP_PORTS      equ 3

; capture_install: trap 42h, 43h and 61h, with interrupts off throughout.
; The first call also installs the callback, remembering the previous one in RB_STATE.
; Out: CF clear on success (traps flag set, capture_sync called). CF set: a port was
;      already trapped (exit code 5); everything this call did is undone, so the machine,
;      QPIEMU's callback included, is as it was.
capture_install:
        pushf
        cli
        cmp     byte [rb_cb_set], 0
        jne     .ports
        call    capture_hook
.ports:
        xor     si, si                  ; byte offset into trap_ports
.next:
        mov     dx, [trap_ports + si]
        mov     ax, QPI_TRAP
        push    si
        call    far [rb_qpi]
        pop     si
        jc      .clear
        add     si, 2
        cmp     si, TRAP_PORTS * 2
        jb      .next
        mov     byte [rb_cb_set], 1
        or      byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS
        call    capture_sync
        popf
        clc
        ret
.clear:
        or      si, si                  ; SI = bytes of ports this call trapped
        jz      .cleared
        sub     si, 2
        mov     dx, [trap_ports + si]
        mov     ax, QPI_UNTRAP
        push    si
        call    far [rb_qpi]
        pop     si
        jmp     .clear
.cleared:
        cmp     byte [rb_cb_set], 0
        jne     .refused
        call    capture_unhook          ; rb_cb_set is set only by a complete install
.refused:
        popf
        stc
        ret

; capture_remove: untrap the three ports and clear the traps flag. The callback stays
; installed until uninstall. A port that was not trapped is ignored.
capture_remove:
        pushf
        cli
        xor     si, si
.next:
        mov     dx, [trap_ports + si]
        mov     ax, QPI_UNTRAP
        push    si
        call    far [rb_qpi]
        pop     si
        add     si, 2
        cmp     si, TRAP_PORTS * 2
        jb      .next
        and     byte [RB_STATE + RBS_FLAGS], 0FFh ^ RBS_F_TRAPS
        popf
        ret

; capture_hook: remember QPIEMU's current callback in RB_STATE and install ours.
capture_hook:
        mov     ax, QPI_GET_CB
        call    far [rb_qpi]
        mov     [RB_STATE + RBS_PREV_QPI], di
        mov     [RB_STATE + RBS_PREV_QPI + 2], es
        push    cs
        pop     es
        mov     di, qpi_callback
        mov     ax, QPI_SET_CB
        call    far [rb_qpi]
        ret

; capture_unhook: give QPIEMU back the callback capture_hook found.
capture_unhook:
        les     di, [RB_STATE + RBS_PREV_QPI]
        mov     ax, QPI_SET_CB
        call    far [rb_qpi]
        mov     byte [rb_cb_set], 0
        ret

; capture_owns_callback: Out: CF set when QPIEMU's callback is not ReBeep's.
capture_owns_callback:
        mov     ax, QPI_GET_CB
        call    far [rb_qpi]
        mov     ax, es
        mov     dx, cs
        cmp     ax, dx
        jne     .no
        cmp     di, qpi_callback
        jne     .no
        clc
        ret
.no:
        stc
        ret

; Hooks for the port semantics, called with DS = CS and interrupts off.
; capture_sync: the traps have just been installed; adopt the real port state.
; capture_translation_changed, capture_voice_changed: the flag or the voice changed (or
; is being re-applied, so these must be harmless to repeat).
capture_sync:
capture_translation_changed:
capture_voice_changed:
        ret

; qpi_callback: a far procedure QPIEMU calls on a trapped access. AL/AX/EAX is the
; client's EAX (OUT data in AL), BX the client's BX, CL the access type, DX the port;
; IF and TF are clear. QPIEMU restores only ECX, EDX and the flags, so every other
; register is saved and restored here. For now every access to our ports is forwarded
; unchanged.
qpi_callback:
        cmp     dx, PIT_CH2
        je      .ours
        cmp     dx, PIT_CTRL
        je      .ours
        cmp     dx, SYS_CTRL
        je      .ours
        cmp     word [cs:RB_STATE + RBS_PREV_QPI + 2], 0
        jne     .chain
        cmp     word [cs:RB_STATE + RBS_PREV_QPI], 0
        je      .none
.chain:
        jmp     far [cs:RB_STATE + RBS_PREV_QPI]
.none:
        retf

.ours:
        cmp     byte [cs:in_callback], 0
        jne     .reenter
        mov     byte [cs:in_callback], 1
        pushad
        push    ds
        push    es
        mov     [cs:client_sp], sp
        mov     [cs:client_ss], ss
        push    cs
        pop     ss
        mov     sp, stack_top
        push    cs
        pop     ds
        les     di, [client_sp]
        mov     al, [es:di + IMG_ECX]
        and     al, TYPE_OUT | TYPE_SIZE
        cmp     al, TYPE_OUT            ; a byte OUT
        jne     .forward
        inc     word [RB_STATE + RBS_TRAPPED]
.forward:
        call    forward_access
        lss     sp, [client_sp]
        pop     es
        pop     ds
        popad
        mov     byte [cs:in_callback], 0
        retf

; ReBeep's own access to one of these ports was trapped again: forward it on the stack
; it arrived on, with the client's registers saved there.
.reenter:
        pushad
        push    ds
        push    es
        mov     di, sp
        push    ss
        pop     es
        call    forward_access
        pop     es
        pop     ds
        popad
        retf

; forward_access: pass the trapped access through QPI unchanged. An IN stores the value
; into the frame's EAX, in the accessed width, leaving the rest of EAX alone.
; In:  ES:DI -> the saved frame
forward_access:
        mov     dx, [es:di + IMG_EDX]
        mov     cl, [es:di + IMG_ECX]
        test    cl, TYPE_SIZE
        jnz     .wide
        test    cl, TYPE_OUT
        jnz     .out8
        mov     ax, QPI_READ
        push    es
        push    di
        call    far [cs:rb_qpi]
        pop     di
        pop     es
        mov     [es:di + IMG_EAX], bl
        ret
.out8:
        mov     bl, [es:di + IMG_EAX]
        mov     ax, QPI_WRITE
        call    far [cs:rb_qpi]
        ret
.wide:
        mov     ebx, [es:di + IMG_EAX]
        test    cl, TYPE_DWORD
        jnz     .go
        movzx   ebx, bx
.go:
        movzx   cx, cl
        mov     ax, QPI_IO
        push    es
        push    di
        call    far [cs:rb_qpi]
        pop     di
        pop     es
        test    byte [es:di + IMG_ECX], TYPE_OUT
        jnz     .done
        test    byte [es:di + IMG_ECX], TYPE_DWORD
        jnz     .in32
        mov     [es:di + IMG_EAX], bx
        ret
.in32:
        mov     [es:di + IMG_EAX], ebx
.done:
        ret

trap_ports      dw      PIT_CH2, PIT_CTRL, SYS_CTRL
