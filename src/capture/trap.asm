; Speaker-port capture through Jemm's QPI: installs and removes the traps on 42h, 43h and
; 61h, and owns the callback QPIEMU calls on every trapped access. Resident code (386).
; Every byte a game writes goes to the interpreter and on to the real port. While the OPL
; plays a tone (translation on, mode M_TONE) or the game rests below 20 Hz (M_REST), one bit
; of the real 61h is held clear, chosen so the speaker stays where it rests (see
; mask_update), and the game reads back its own bits 0-1. Anything else (M_RAW) plays on
; the real speaker, unless /R:0 mutes it: then bit 1 is held clear in every mode.
; Port I/O on a trapped port goes through QPI 1A00h/1A01h/1A04h only: a direct IN/OUT
; would trap again.
; Near calls, DS = CS, and everything but the stack may be clobbered unless noted.
; SPDX-License-Identifier: MIT

        cpu     386
%include "speaker.inc"
%include "amis.inc"
%include "trace.inc"

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

; `masked`: the bit held clear in the real 61h while the OPL plays the tone, or 0.
MASK_SPK        equ SC_SPKR             ; bit 1: the speaker rests at 0
MASK_GATE       equ SC_GATE2            ; the gate: OUT2 stays high, so a speaker parked high rests there

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
; with the game's own bits 0-1); then untrap the three ports and clear the traps flag, set
; the mode in RB_STATE to M_SILENT and clear `masked`, so nothing stale survives until /ON
; resyncs. With the traps already off the game's 61h is stale: nothing is written to the OPL
; or 61h. The callback stays installed until uninstall. A port that was not trapped is ignored.
capture_remove:
        pushf
        cli
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS
        jz      .untrap
        call    opl_note_off
        mov     byte [masked], 0
        call    sync_real_61
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
; changes nothing). Moves a tone that is sounding between the OPL and the real speaker; a
; rest only holds the speaker, so the OPL keys nothing for it.
; The hotkey calls this inside INT 09h: the 61h handoff through QPI is the only 61h access
; allowed there, and deferring it would leave a sustained tone silent.
; Does nothing while the traps are off. Preserves every register.
capture_translation_changed:
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS
        jz      .ret
        pusha
        call    mask_update
        jnc     .done
        or      al, al
        jz      .off
        cmp     byte [RB_STATE + RBS_MODE], M_TONE
        jne     .real
        mov     bx, [RB_STATE + RBS_DIVISOR]
        call    opl_note_on
        jmp     .real
.off:
        call    opl_note_off
.real:
        call    sync_real_61
.done:
        popa
.ret:
        ret

; capture_voice_changed: the voice changed (or is being re-applied): a tone that is sounding
; on the OPL, and stays there, restarts with the new voice. One that is moving between the
; OPL and the speaker is left to capture_translation_changed, which runs next.
; Does nothing while the traps are off. Preserves every register.
capture_voice_changed:
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS
        jz      .ret
        pusha
        cmp     byte [masked], 0
        je      .done
        call    mask_wanted
        or      al, al
        jz      .done
        cmp     byte [RB_STATE + RBS_MODE], M_TONE
        jne     .done                   ; a rest: nothing is sounding
        call    opl_note_off
        mov     bx, [RB_STATE + RBS_DIVISOR]
        call    opl_note_on
.done:
        popa
.ret:
        ret

; capture_low_changed: interp_low changed (or is being re-applied, which changes nothing).
; A count below 20 Hz that the game holds turns from a rest into a tone, or back, at once,
; as the game's next write would turn it. Does nothing while the traps are off. Preserves
; every register.
capture_low_changed:
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS
        jz      .ret
        pusha
        call    interp_refresh          ; AL = event, AH = mode, BX = divisor
        call    note_state
        call    play_event
        call    mask_update
        jnc     .done
        call    sync_real_61
.done:
        popa
.ret:
        ret

; capture_mute_changed: the /R flag changed (or is being re-applied, which changes nothing).
; Muting while a held gate keeps a parked-high speaker up holds bit 1 instead: one step on
; the speaker, when the user asks for it. capture_translation_changed, which runs next,
; starts or ends masking. Does nothing while the traps are off. Preserves every register.
capture_mute_changed:
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS
        jz      .ret
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_MUTE
        jz      .ret
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRANSLATE
        jz      .ret                    ; translation off: masking ends next
        cmp     byte [masked], MASK_GATE
        jne     .ret
        mov     byte [masked], MASK_SPK
        call    sync_real_61
.ret:
        ret

; mask_wanted: Out: AL = 1 when the real speaker must be held (translation on, and mode
; M_TONE, which the OPL plays, or M_REST, or any mode under /R:0), else 0. Preserves every
; other register.
mask_wanted:
        xor     al, al
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRANSLATE
        jz      .ret
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_MUTE
        jnz     .yes
        cmp     byte [RB_STATE + RBS_MODE], M_TONE
        je      .yes
        cmp     byte [RB_STATE + RBS_MODE], M_REST
        jne     .ret
.yes:
        inc     al
.ret:
        ret

; mask_update: bring `masked` in line with mask_wanted. When masking starts it picks the bit
; to hold clear from the real 61h: a speaker parked high (real bits 0-1 = 10, so OUT2 is
; high) keeps resting there with the gate held clear; anything else holds bit 1 clear and
; the speaker rests at 0. Under /R:0 it always holds bit 1, so the game's own bit-1 writes
; never reach the speaker. A mask that holds keeps its kind: picking again mid-note would
; swap a held gate for a held bit 1, a step on the speaker.
; Out: CF set when `masked` changed, with AL = 1 (masking started) or 0 (ended).
;      CF clear when it already agreed. AH is clobbered; every other register survives.
mask_update:
        call    mask_wanted
        cmp     byte [masked], 0
        je      .unmasked
        or      al, al
        jnz     .same
        mov     byte [masked], 0
        stc
        ret
.unmasked:
        or      al, al
        jz      .same
        mov     al, MASK_SPK
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_MUTE
        jnz     .pick
        push    bx
        push    dx
        mov     dx, SYS_CTRL
        call    qpi_in                  ; clobbers AX
        pop     dx
        and     bl, SC_GATE2 | SC_SPKR
        mov     al, MASK_GATE
        cmp     bl, SC_SPKR
        pop     bx
        je      .pick
        mov     al, MASK_SPK
.pick:
        mov     [masked], al
        mov     al, 1
        stc
        ret
.same:
        clc
        ret

; sync_real_61: write the real 61h's bits 0-1 as the game's own, less the bit `masked`
; holds clear. Preserves every register.
sync_real_61:
        push    ax
        push    bx
        push    dx
        mov     dx, SYS_CTRL
        call    qpi_in
        and     bl, 0FFh ^ (SC_GATE2 | SC_SPKR)
        mov     al, [masked]
        not     al
        and     al, [game_61]
        and     al, SC_GATE2 | SC_SPKR
        or      bl, al
        OUT_REAL_61
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
        TRACE_EVENT
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
        TRACE_SITE TK_REBEEP
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
;   OUT 61h:     interpreter, remember the game's byte, forward it less the bit `masked`
;                holds clear, drive the OPL.
;   IN 61h:      the real value with bits 0-1 replaced by the game's own. While the gate is
;                held clear the real OUT2 stands still, so bit 5 flips on every read instead:
;                a game waiting for its edge must not hang.
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
        mov     al, [game_61]
        and     al, SC_GATE2 | SC_SPKR
        and     bl, 0FFh ^ (SC_GATE2 | SC_SPKR)
        or      al, bl
        cmp     byte [masked], MASK_GATE
        jne     .view
        xor     byte [out2_fake], SC_OUT2
        and     al, 0FFh ^ SC_OUT2
        or      al, [out2_fake]
.view:
        mov     [es:di + IMG_EAX], al
        ret

.out:
        mov     al, [es:di + IMG_EAX]
        TRACE_NOTE
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
        TRACE_SITE TK_GAMEPIT
        call    mask_update
        jc      sync_real_61
        ret

.sys:
        push    ax
        push    bx
        mov     bl, [es:di + IMG_EAX]
        mov     [game_61], bl
        call    mask_update             ; before the forward: a new mask reads the real port
        mov     al, [masked]
        not     al
        and     bl, al
        TRACE_SITE TK_GAME61
        OUT_REAL_61
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
