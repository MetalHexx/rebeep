; The INT 2Dh (AMIS) handler: identifies ReBeep, publishes RB_STATE, switches the traps
; and uninstalls. Resident code (8086); the functions are in include/amis.inc.
; Everything here runs with interrupts off (INT clears IF) and makes no DOS call: the
; command-line copy that asks for an uninstall frees the memory afterwards.
; SPDX-License-Identifier: MIT

        cpu     8086
%include "amis.inc"
%include "exitcode.inc"

amis_isr:
        cmp     ah, [cs:rb_amis_id]
        je      .ours
.chain:
        cmp     word [cs:rb_old2d + 2], 0       ; no previous handler: nobody to ask
        jne     .go
        cmp     word [cs:rb_old2d], 0
        je      .none
.go:
        jmp     far [cs:rb_old2d]
.none:
        iret

.ours:
        cmp     al, AMIS_FN_INSTALLED
        je      .installed
        cmp     al, AMIS_FN_HOOKS
        je      .hooks
        cmp     al, AMIS_FN_STATE
        je      .state
        cmp     al, AMIS_FN_APPLY
        jb      .unknown
        cmp     al, AMIS_FN_UNINSTALL
        ja      .unknown
        push    ds
        push    es
        push    si
        push    di
        push    cs
        pop     ds
        cmp     al, AMIS_FN_APPLY
        je      .apply
        cmp     al, AMIS_FN_TRAPS_ON
        je      .traps_on
        cmp     al, AMIS_FN_TRAPS_OFF
        je      .traps_off
        call    rb_uninstall
        jc      .refused
        mov     bx, [RB_STATE + RBS_PSP]
        jmp     .ok
.refused:
        mov     bl, EXIT_REFUSED
        jmp     .fail

.apply:
        call    rb_apply_low            ; the interpreter's: it applies with the traps off too
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS
        jz      .ok
        call    rb_apply_config
        jmp     .ok

.traps_on:
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS
        jnz     .ok
        mov     al, [opl_type]
        call    rb_opl_start
        call    capture_install
        jnc     .ok
        call    opl_shutdown            ; the traps were refused: give the OPL back
        mov     bl, EXIT_TRAPPED
        jmp     .fail

.traps_off:
        test    byte [RB_STATE + RBS_FLAGS], RBS_F_TRAPS
        jz      .ok
        call    capture_remove
        call    opl_shutdown

.ok:
        mov     al, 0FFh
        jmp     .done
.fail:
        xor     al, al
.done:
        pop     di
        pop     si
        pop     es
        pop     ds
        iret

.unknown:
        xor     al, al
        iret

.installed:
        mov     al, 0FFh
        mov     cx, (REBEEP_VER_MAJOR << 8) | REBEEP_VER_MINOR
        mov     dx, cs
        mov     di, rb_ident
        iret
.hooks:
        mov     al, AMIS_FN_HOOKS
        mov     dx, cs
        mov     bx, rb_hooks
        iret
.state:
        mov     al, 0FFh
        mov     dx, cs
        mov     bx, RB_STATE
        iret

; rb_opl_start: take over the OPL with the configured voice and volume.
; In:  AL = 2 or 3, the chip type
rb_opl_start:
        call    opl_init
        mov     al, [RB_STATE + RBS_VOICE]
        call    opl_set_voice
        mov     al, [RB_STATE + RBS_VOLUME]
        jmp     opl_set_volume

; rb_apply_low: hand RB_STATE's /L flag to the interpreter. It takes effect from the game's
; next speaker write. Clobbers AL.
rb_apply_low:
        mov     al, [RB_STATE + RBS_FLAGS]
        and     al, RBS_F_LOWFM
        mov     [interp_low], al
        ret

; rb_apply_config: push RB_STATE's voice, volume and translation flag to the engine.
; Only valid while the traps are on, when the OPL is ours.
rb_apply_config:
        mov     al, [RB_STATE + RBS_VOICE]
        call    opl_set_voice
        mov     al, [RB_STATE + RBS_VOLUME]
        call    opl_set_volume
        call    capture_voice_changed
        jmp     capture_translation_changed

; rb_uninstall: unhook everything, from ReBeep's own state and the IVT alone.
; Out: CF set, nothing changed, when INT 09h, INT 2Dh or QPIEMU's callback no longer
;      points at ReBeep: a program that hooked in after us would be left with a dead link.
; The traps and the OPL are touched only while the traps are on; once /OFF has run the
; OPL belongs to whatever game is running.
rb_uninstall:
        xor     ax, ax
        mov     es, ax
        mov     ax, cs
        cmp     [es:09h * 4 + 2], ax
        jne     .refuse
        cmp     word [es:09h * 4], kbd_isr
        jne     .refuse
        cmp     [es:2Dh * 4 + 2], ax
        jne     .refuse
        cmp     word [es:2Dh * 4], amis_isr
        jne     .refuse
        call    capture_owns_callback
        jc      .refuse
        mov     al, [RB_STATE + RBS_FLAGS]
        and     al, RBS_F_TRAPS
        push    ax
        jz      .released
        call    capture_remove
.released:
        call    capture_unhook
        xor     ax, ax
        mov     es, ax
        mov     ax, [rb_old09]
        mov     [es:09h * 4], ax
        mov     ax, [rb_old09 + 2]
        mov     [es:09h * 4 + 2], ax
        mov     ax, [rb_old2d]
        mov     [es:2Dh * 4], ax
        mov     ax, [rb_old2d + 2]
        mov     [es:2Dh * 4 + 2], ax
        pop     ax
        or      al, al
        jz      .done
        call    opl_shutdown
.done:
        clc
        ret
.refuse:
        stc
        ret

; What function 00h returns at DX:DI: the 16 signature bytes, then a description that
; the command-line copy compares to tell versions apart.
rb_ident:
        db      AMIS_SIG_MFR, AMIS_SIG_PROD
        db      "ReBeep ", REBEEP_VERSION, 0

; Function 04h's list: interrupt number and handler entry, INT 2Dh last.
rb_hooks:
        db      09h
        dw      kbd_isr
        db      2Dh
        dw      amis_isr
