; Effects: while a game profile is on and the main voice is a patch, a tone in one of the
; profile's effect ranges (include/profile.inc) plays the effect's own patch on the effect
; voice, opl.asm's second voice, and the main voice keys off; a tone outside every effect goes
; back to the main voice. The two take turns as the game's sounds do, so a game that shares
; the speaker between its engine and its effects sounds each in a patch of its own.
;   main voice sounding, a tone in an effect:   main off; the effect's patch, if not loaded; on
;   effect voice sounding, the same slot:       a glide; another slot: off, its patch, on
;   effect voice sounding, a tone in none:      effect off; the main voice's note on, at it
;   a tone off:                                 whichever sounds, off
; opl_ctx_swap makes the effect voice current for one opl.asm call and back, here only; the
; main voice is current between calls. No effect plays in the faithful voice.
; Near calls; DS = this module's segment, which also holds RB_STATE. Every routine preserves
; all registers except its outputs, and flags. No string instructions: DF is the game's.
; Stack: at most 6 bytes over opl.asm's 16, return address included.
; SPDX-License-Identifier: MIT

        cpu     8086
%include "speaker.inc"
%include "amis.inc"
%include "profile.inc"
%include "trace.inc"

; fx_play: drive the OPL from an interpreter event (play_event's, translation on).
; In: AL = event, BX = divisor.
fx_play:
        cmp     al, EV_TONE_OFF
        je      fx_quiet
        cmp     al, EV_TONE_ON
        je      .tone
        cmp     al, EV_PITCH
        jne     .ret
.tone:
        push    si
        call    fx_find                 ; CF: SI = the effect
        jc      .effect
        pop     si
        cmp     byte [opl_fx_keyed], 0
        jne     .back
        cmp     al, EV_TONE_ON
        je      opl_note_on
        jmp     opl_pitch
.back:                                  ; the effect gives way to the main voice, at this count
        call    fx_off
        jmp     opl_note_on
.ret:
        ret

.effect:
        push    ax
        mov     ah, [si + EF_SLOT]
        cmp     byte [opl_fx_keyed], 0
        jne     .sounding
        call    opl_note_off            ; the main voice's note, if any, gives way
        jmp     .start
.sounding:
        cmp     ah, [rules_tbl + PT_FXSLOT]
        jne     .start
        call    opl_ctx_swap
        call    opl_pitch               ; the same patch: a glide
        jmp     .done
.start:
        TRACE_FX                        ; SI = the effect, AH = its slot
        call    opl_ctx_swap
        cmp     ah, [rules_tbl + PT_FXSLOT]
        je      .on
        mov     [rules_tbl + PT_FXSLOT], ah
        call    opl_note_off            ; a channel is never reprogrammed while it sounds
        mov     al, PBLK_LEN
        mul     ah
        add     ax, rules_tbl + PT_BLOCKS
        mov     si, ax
        mov     al, 1                   ; the slot's patch: the parser kept no effect without one
        call    opl_set_voice
.on:
        call    opl_note_on
.done:
        call    opl_ctx_swap
        pop     ax
        pop     si
        ret

; fx_find: the first effect whose WHILE holds and whose range holds the divisor, while the
; main voice is a patch. A profile that is off has none: /P: and /F clear PT_FXCOUNT with
; PT_ACTIVE. In: BX = divisor.
; Out: CF set and SI = the effect; CF clear when none (SI is then clobbered).
fx_find:
        cmp     byte [RB_STATE + RBS_VOICE], 0
        je      .ret                    ; CF clear from the compare
        push    ax
        push    cx
        mov     si, rules_tbl + PT_EFFECTS
        mov     cl, [rules_tbl + PT_FXCOUNT]
        mov     ah, [rules_tbl + PT_STATE]
.next:
        or      cl, cl
        jz      .out                    ; CF clear from the OR
        mov     al, [si + EF_WHILE]
        or      al, al
        jz      .range
        cmp     al, ah
        jne     .skip
.range:
        cmp     bx, [si + EF_LO]
        jb      .skip
        cmp     bx, [si + EF_HI]
        jbe     .found
.skip:
        add     si, EFFECT_LEN
        dec     cl
        jmp     .next
.found:
        stc
.out:
        pop     cx
        pop     ax
.ret:
        ret

; fx_off: key the effect voice off, when it is keyed.
fx_off:
        cmp     byte [opl_fx_keyed], 0
        je      .ret
        call    opl_ctx_swap
        call    opl_note_off
        jmp     opl_ctx_swap
.ret:
        ret

; fx_set_voice: opl_set_voice for the main voice, as an apply or a load sets it; the effect
; voice is programmed again at its next effect, so a new profile's patch or a new volume
; reaches it too. In: as opl_set_voice.
fx_set_voice:
        mov     byte [rules_tbl + PT_FXSLOT], PT_NONE
        jmp     opl_set_voice

; fx_quiet: key off whichever voice sounds (a tone off, or ReBeep letting the tone go).
fx_quiet:
        call    fx_off
        jmp     opl_note_off

; fx_init: opl_init for both voices, the main one last. The caller sets the main voice with
; fx_set_voice, which leaves the effect voice to be programmed at its first effect.
; In: AL = 2 or 3, the chip type.
fx_init:
        call    opl_ctx_swap
        call    opl_init
        call    opl_ctx_swap
        jmp     opl_init

; fx_shutdown: the effect voice silenced, then opl_shutdown for the main one and the chip.
fx_shutdown:
        call    opl_ctx_swap
        call    opl_silence
        call    opl_ctx_swap
        jmp     opl_shutdown
