; ReBeep's AMIS identity and the layout of its published state block.
; SPDX-License-Identifier: MIT

%ifndef AMIS_INC
%define AMIS_INC

; The 16 signature bytes AMIS function 00h returns at DX:DI.
%define AMIS_SIG_MFR    "MetalHex"
%define AMIS_SIG_PROD   "REBEEP  "

AMIS_FN_STATE   equ 10h         ; private function: AL = FFh, DX:BX -> RB_STATE

; RB_STATE, layout version 1: byte offsets.
RBS_VERSION     equ 0           ; db layout version
RBS_FLAGS       equ 1           ; db bit0 translation on, bit1 traps on, bit2 OPL3
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

%endif
