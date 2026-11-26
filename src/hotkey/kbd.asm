; INT 09h hook: the Ctrl+Alt hotkeys. Resident code (8086).
; Runs on the interrupted program's stack with interrupts off throughout (never STI), and
; never touches port 61h: a game may bypass the BIOS, and the only 61h access ReBeep
; makes is the speaker handoff through QPI.
; Ctrl and Alt are tracked from the raw scan codes, so a game that replaces INT 09h's
; BIOS handler still works. A consumed key is never chained; its repeats and its break
; code are swallowed too.
; SPDX-License-Identifier: MIT

        cpu     8086
%include "amis.inc"

KB_CTRL         equ 01h
KB_ALT          equ 02h
KB_HELD         equ 04h                 ; a consumed key is down

kbd_isr:
        push    ax
        push    bx
        push    ds
        push    cs
        pop     ds
        in      al, 60h
        mov     ah, [kb_ext]            ; AH = this byte follows an E0 prefix
        mov     byte [kb_ext], 0
        cmp     al, 0E0h
        jne     .scan
        mov     byte [kb_ext], 1
        jmp     .chain

.scan:
        cmp     al, 1Dh                 ; Ctrl, left or right (E0 1D)
        je      .ctrl_dn
        cmp     al, 9Dh
        je      .ctrl_up
        cmp     al, 38h                 ; Alt, left or right (E0 38)
        je      .alt_dn
        cmp     al, 0B8h
        je      .alt_up
        or      ah, ah                  ; any other extended key is not ours
        jnz     .chain
        test    byte [kb_mods], KB_HELD
        jz      .match
        mov     bl, [kb_held]
        cmp     al, bl
        je      .swallow                ; typematic repeat
        or      bl, 80h
        cmp     al, bl
        jne     .match
        and     byte [kb_mods], 0FFh ^ KB_HELD
        jmp     .swallow                ; its break code

.match:
        mov     bl, [kb_mods]
        and     bl, KB_CTRL | KB_ALT
        cmp     bl, KB_CTRL | KB_ALT
        jne     .chain
        xor     bl, bl                  ; BL = 0 toggle, 1 cycle
        cmp     al, [RB_STATE + RBS_TOGGLE_KEY]
        je      .hit
        inc     bl
        cmp     al, [RB_STATE + RBS_CYCLE_KEY]
        jne     .chain
.hit:
        mov     [kb_held], al
        or      byte [kb_mods], KB_HELD
        or      bl, bl
        jnz     .cycle
        xor     byte [RB_STATE + RBS_FLAGS], RBS_F_TRANSLATE
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS
        jz      .swallow                ; traps off: the OPL is not ours, only RB_STATE changes
        call    capture_translation_changed
        jmp     .swallow
.cycle:
        test    byte [RB_STATE + RBS_PFLAGS], RBS_PF_LOADED
        jz      .swallow                ; no patch to switch to
        xor     byte [RB_STATE + RBS_VOICE], 1
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS
        jz      .swallow
        push    si
        mov     al, [RB_STATE + RBS_VOICE]
        mov     si, RB_STATE + RBS_PATCH
        call    opl_set_voice
        pop     si
        call    capture_voice_changed

.swallow:
        mov     al, 20h                 ; EOI
        out     20h, al
        pop     ds
        pop     bx
        pop     ax
        iret

.ctrl_dn:
        or      byte [kb_mods], KB_CTRL
        jmp     .chain
.ctrl_up:
        and     byte [kb_mods], 0FFh ^ KB_CTRL
        jmp     .chain
.alt_dn:
        or      byte [kb_mods], KB_ALT
        jmp     .chain
.alt_up:
        and     byte [kb_mods], 0FFh ^ KB_ALT

.chain:
        pop     ds
        pop     bx
        pop     ax
        jmp     far [cs:rb_old09]

kb_mods         db      0
kb_held         db      0               ; make code of the consumed key that is down
kb_ext          db      0               ; the previous byte was E0
