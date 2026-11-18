; Resident state: RB_STATE, the vectors and handles uninstall needs, and the private stack.
; Everything the resident part touches lives below resident_end. Included first, so
; RB_STATE sits at 103h.
; SPDX-License-Identifier: MIT

%include "amis.inc"

; RB_STATE as a fresh load leaves it. A plain load overrides the config fields (voice,
; volume, keys) from the command line; a change of a loaded copy writes only the named ones.
RB_STATE:
        db      RBS_LAYOUT
        db      RBS_F_TRANSLATE         ; RBS_FLAGS: translation on, traps off until installed
        db      0                       ; RBS_VOICE: faithful
        db      12                      ; RBS_VOLUME
        db      30h                     ; RBS_TOGGLE_KEY: B
        db      31h                     ; RBS_CYCLE_KEY: N
        db      0                       ; RBS_MODE
        db      0                       ; RBS_RESERVED
        dw      0                       ; RBS_DIVISOR
        dw      0                       ; RBS_TONE_ON
        dw      0                       ; RBS_RAW
        dw      0                       ; RBS_TRAPPED
        dw      0                       ; RBS_PSP
        dd      0                       ; RBS_PREV_QPI
%if $ - RB_STATE != RBS_PREV_QPI + 4
%error RB_STATE does not match the offsets in amis.inc
%endif

rb_qpi          dd      0               ; QPI entry point (offset, segment)
rb_old09        dd      0               ; INT 09h and INT 2Dh as found at load (offset, segment)
rb_old2d        dd      0
rb_amis_id      db      0               ; ReBeep's AMIS multiplex number
rb_cb_set       db      0               ; 1 while ReBeep's callback is QPIEMU's I/O callback
game_61         db      0               ; the last byte the game wrote to 61h (what it reads back)
masked          db      0               ; 1 while the real 61h bit 1 is held clear for the OPL

; The QPI callback runs on its own stack: the client's may be tiny. client_sp and client_ss
; must stay adjacent (LSS reads them as one pointer).
in_callback     db      0
client_sp       dw      0
client_ss       dw      0

                times 320 db 0
stack_top:
