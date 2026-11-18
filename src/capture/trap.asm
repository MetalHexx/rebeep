; Speaker-port capture through Jemm's QPI: installs and removes the traps on 42h, 43h and
; 61h, and owns the callback QPIEMU calls on every trapped access. Resident code (386).
; Every byte a game writes goes to the interpreter and on to the real port. While the OPL
; plays a tone (translation on, mode M_TONE) the real 61h has bit 1 clear, and the game
; reads back its own 61h. Anything else (M_RAW) plays on the real speaker.
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

; capture_remove: with the traps on, first undo any masking (OPL key off, then the real 61h
; with the game's own bit 1); then untrap the three ports and clear the traps flag, set the
; mode in RB_STATE to M_SILENT and clear `masked`, so nothing stale survives until /ON
; resyncs. With the traps already off the game's 61h is stale: nothing is written to the OPL
; or 61h. The callback stays installed until uninstall. A port that was not trapped is ignored.
capture_remove:
        pushf
        cli
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS
        jz      .untrap
        call    opl_note_off
        mov     byte [masked], 0
        call    sync_real_bit1
.untrap:
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
        mov     byte [RB_STATE + RBS_MODE], M_SILENT
        mov     byte [masked], 0
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

; capture_sync: the traps have just been installed; adopt the real 61h as the game's own and
; refresh RB_STATE. The mode comes back M_SILENT or M_RAW, never M_TONE, so the OPL has
; nothing to key off.
capture_sync:
        mov     dx, SYS_CTRL
        call    qpi_in
        mov     [game_61], bl
        mov     al, bl
        call    interp_sync
        mov     [RB_STATE + RBS_MODE], ah
        mov     word [RB_STATE + RBS_DIVISOR], 0
        mov     byte [masked], 0
        ret

; capture_translation_changed: the translation flag changed (or is being re-applied, which
; changes nothing). Moves a tone that is sounding between the OPL and the real speaker.
; The hotkey calls this inside INT 09h: the speaker-bit handoff through QPI is the only 61h
; access allowed there, and deferring it would leave a sustained tone silent.
; Does nothing while the traps are off. Preserves every register.
capture_translation_changed:
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS
        jz      .ret
        pusha
        call    mask_wanted
        cmp     al, [masked]
        je      .done
        mov     [masked], al
        or      al, al
        jz      .off
        mov     bx, [RB_STATE + RBS_DIVISOR]
        call    opl_note_on
        jmp     .real
.off:
        call    opl_note_off
.real:
        call    sync_real_bit1
.done:
        popa
.ret:
        ret

; capture_voice_changed: the voice changed (or is being re-applied): a tone that is sounding
; on the OPL restarts with the new voice. Does nothing while the traps are off.
; Preserves every register.
capture_voice_changed:
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS
        jz      .ret
        pusha
        call    mask_wanted
        or      al, al
        jz      .done
        call    opl_note_off
        mov     bx, [RB_STATE + RBS_DIVISOR]
        call    opl_note_on
.done:
        popa
.ret:
        ret

; mask_wanted: Out: AL = 1 when the OPL should be playing the tone (translation on, mode
; M_TONE), else 0. Preserves every other register.
mask_wanted:
        xor     al, al
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRANSLATE
        jz      .ret
        cmp     byte [RB_STATE + RBS_MODE], M_TONE
        jne     .ret
        inc     al
.ret:
        ret

; sync_real_bit1: write the real 61h with bit 1 clear when `masked`, else the game's own.
; Preserves every register.
sync_real_bit1:
        push    ax
        push    bx
        push    dx
        mov     dx, SYS_CTRL
        call    qpi_in
        and     bl, 0FFh ^ SC_SPKR
        cmp     byte [masked], 0
        jne     .write
        mov     al, [game_61]
        and     al, SC_SPKR
        or      bl, al
.write:
        call    qpi_out
        pop     dx
        pop     bx
        pop     ax
        ret

; qpi_in: the real value of a port, bypassing the traps.
; In:  DX = port.  Out: BL = value.  Clobbers AX; DX, ES and DI survive.
qpi_in:
        push    dx
        push    es
        push    di
        mov     ax, QPI_READ
        call    far [cs:rb_qpi]
        pop     di
        pop     es
        pop     dx
        ret

; qpi_out: write a port, bypassing the traps.
; In:  DX = port, BL = byte.  Clobbers AX; DX, ES and DI survive.
qpi_out:
        push    dx
        push    es
        push    di
        mov     ax, QPI_WRITE
        call    far [cs:rb_qpi]
        pop     di
        pop     es
        pop     dx
        ret

; play_event: drive the OPL from an interpreter event while translation is on.
; In:  AL = event, BX = divisor
play_event:
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRANSLATE
        jz      .ret
        cmp     al, EV_TONE_ON
        je      opl_note_on
        cmp     al, EV_PITCH
        je      opl_pitch
        cmp     al, EV_TONE_OFF
        je      opl_note_off
.ret:
        ret

; note_state: record what interp_write reported in RB_STATE: the mode and divisor, and the
; tone-on and raw counts (a raw count is an entry into M_RAW). Preserves every register.
; In:  AL = event, AH = mode, BX = divisor
note_state:
        cmp     al, EV_TONE_ON
        jne     .raw
        inc     word [RB_STATE + RBS_TONE_ON]
.raw:
        cmp     ah, M_RAW
        jne     .store
        cmp     byte [RB_STATE + RBS_MODE], M_RAW
        je      .store
        inc     word [RB_STATE + RBS_RAW]
.store:
        mov     [RB_STATE + RBS_MODE], ah
        mov     [RB_STATE + RBS_DIVISOR], bx
        ret

; qpi_callback: a far procedure QPIEMU calls on a trapped access. AL/AX/EAX is the
; client's EAX (OUT data in AL), BX the client's BX, CL the access type, DX the port;
; IF and TF are clear. QPIEMU restores only ECX, EDX and the flags, so every other
; register is saved and restored here. Accesses to our ports go through handle_access.
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
        jne     .handle
        inc     word [RB_STATE + RBS_TRAPPED]
.handle:
        call    handle_access
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

; handle_access: the port semantics for one trapped access.
;   OUT 42h/43h: interpreter, forward the byte, drive the OPL; when that moves the tone
;                between OPL and speaker, re-issue 61h.
;   OUT 61h:     interpreter, remember the game's byte, forward it with bit 1 cleared while
;                the OPL plays the tone, drive the OPL.
;   IN 61h:      the real value with bit 1 replaced by the game's own.
; Anything else (IN 42h/43h, word and dword accesses) is forwarded unchanged.
; In:  ES:DI -> the saved frame
handle_access:
        mov     dx, [es:di + IMG_EDX]
        mov     cl, [es:di + IMG_ECX]
        test    cl, TYPE_SIZE
        jnz     forward_access
        test    cl, TYPE_OUT
        jnz     .out
        cmp     dx, SYS_CTRL
        jne     forward_access
        call    qpi_in
        mov     al, bl
        and     al, 0FFh ^ SC_SPKR
        mov     ah, [game_61]
        and     ah, SC_SPKR
        or      al, ah
        mov     [es:di + IMG_EAX], al
        ret

.out:
        mov     al, [es:di + IMG_EAX]
        call    interp_write            ; AL = event, AH = mode, BX = divisor
        call    note_state
        cmp     dx, SYS_CTRL
        je      .sys
        push    ax
        push    bx
        mov     bl, [es:di + IMG_EAX]
        call    qpi_out
        pop     bx
        pop     ax
        call    play_event
        call    mask_wanted
        cmp     al, [masked]
        je      .done
        mov     [masked], al
        jmp     sync_real_bit1
.done:
        ret

.sys:
        push    ax
        push    bx
        mov     bl, [es:di + IMG_EAX]
        mov     [game_61], bl
        call    mask_wanted
        mov     [masked], al
        or      al, al
        jz      .send
        and     bl, 0FFh ^ SC_SPKR
.send:
        call    qpi_out
        pop     bx
        pop     ax
        jmp     play_event

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
