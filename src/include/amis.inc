; ReBeep's AMIS identity and the layout of its published state block.
; SPDX-License-Identifier: MIT

%ifndef AMIS_INC
%define AMIS_INC

; The 16 signature bytes AMIS function 00h returns at DX:DI.
%define AMIS_SIG_MFR    "MetalHex"
%define AMIS_SIG_PROD   "REBEEP  "

; AMIS functions (AH = ReBeep's multiplex number, AL = function). Anything else returns AL = 00h.
AMIS_FN_INSTALLED equ 00h       ; AL = FFh, CX = version (major << 8 | minor), DX:DI -> signature
                                ; then ASCIZ "ReBeep <version>"
AMIS_FN_HOOKS   equ 04h         ; AL = 04h, DX:BX -> hooked interrupts: db number, dw handler (09h, 2Dh)
AMIS_FN_STATE   equ 10h         ; private function: AL = FFh, DX:BX -> RB_STATE
AMIS_FN_APPLY   equ 11h         ; apply RB_STATE's voice, volume, translation and /L flags; AL = FFh
AMIS_FN_TRAPS_ON  equ 12h       ; AL = FFh, or AL = 00h and BL = exit code; a no-op when already on
AMIS_FN_TRAPS_OFF equ 13h       ; the same, releasing the OPL
AMIS_FN_UNINSTALL equ 14h       ; AL = FFh and BX = PSP segment to free, or AL = 00h and BL = 8

; RB_STATE, layout version 1: byte offsets.
RBS_VERSION     equ 0           ; db layout version
RBS_FLAGS       equ 1           ; db bit0 translation on, bit1 traps on, bit2 OPL3,
                                ;    bit3 play notes below 20 Hz (/L:1) instead of resting
RBS_VOICE       equ 2           ; db 0 faithful, 1-4
RBS_VOLUME      equ 3           ; db 0-15
RBS_TOGGLE_KEY  equ 4           ; db scan code
RBS_CYCLE_KEY   equ 5           ; db scan code
RBS_MODE        equ 6           ; db interpreter mode (M_*)
RBS_RESERVED    equ 7           ; db 0
RBS_DIVISOR     equ 8           ; dw valid in M_TONE
RBS_TONE_ON     equ 10          ; dw tone-on count (wraps)
RBS_RAW         equ 12          ; dw entries into M_RAW (wraps)
RBS_TRAPPED     equ 14          ; dw trapped writes (wraps)
RBS_PSP         equ 16          ; dw resident PSP segment
RBS_PREV_QPI    equ 18          ; dd previous QPI callback (offset, segment)

RBS_LAYOUT      equ 1
RBS_F_TRANSLATE equ 01h
RBS_F_TRAPS     equ 02h
RBS_F_OPL3      equ 04h
RBS_F_LOWFM     equ 08h

%endif
