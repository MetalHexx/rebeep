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
AMIS_FN_APPLY   equ 11h         ; apply RB_STATE's voice (and patch), volume, translation, /L and /R flags; AL = FFh
AMIS_FN_TRAPS_ON  equ 12h       ; AL = FFh, or AL = 00h and BL = exit code; a no-op when already on
AMIS_FN_TRAPS_OFF equ 13h       ; the same, releasing the OPL
AMIS_FN_UNINSTALL equ 14h       ; AL = FFh and BX = PSP segment to free, or AL = 00h and BL = 8
AMIS_FN_TRACE   equ 15h         ; trace build only: AL = FFh, DX:BX -> the trace buffer (trace.inc)

; RB_STATE, layout version 2: byte offsets.
RBS_VERSION     equ 0           ; db layout version
RBS_FLAGS       equ 1           ; db bit0 translation on, bit1 traps on, bit2 OPL3,
                                ;    bit3 play notes below 20 Hz (/L:1) instead of resting,
                                ;    bit4 mute what can't be translated (/R:0)
RBS_VOICE       equ 2           ; db 0 faithful, 1 the loaded patch
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
RBS_PATCH       equ 22          ; db 18: ASCIZ "FOLDER\NAME" of the loaded patch, "" when none
RBS_OCTAVE      equ 40          ; db 0..7, 4 = the game's pitch
RBS_PFLAGS      equ 41          ; db bit0 a patch is loaded (RBS_REC2 is valid), bit1 it has a
                                ;    4-OP variant (RBS_REC4 is valid)
RBS_REC2        equ 42          ; 11 bytes: the two-operator record, in opl.asm's register order
RBS_REC4        equ 53          ; 22 bytes: op1..op4 of 20h, 40h, 60h, 80h, E0h, then C0h of the
                                ;    first and of the second channel

RBS_LAYOUT      equ 2
RBS_PF_LOADED   equ 01h
RBS_PF_4OP      equ 02h

; The patch block: RB_STATE from RBS_PATCH to the end of RBS_REC4. The patch parser fills one, and
; opl_set_voice plays the record of one (RB_STATE's, or a test's).
PBLK_LEN        equ RBS_REC4 + 22 - RBS_PATCH
PB_OCTAVE       equ RBS_OCTAVE - RBS_PATCH
PB_FLAGS        equ RBS_PFLAGS - RBS_PATCH
PB_REC2         equ RBS_REC2 - RBS_PATCH
PB_REC4         equ RBS_REC4 - RBS_PATCH
RBS_F_TRANSLATE equ 01h
RBS_F_TRAPS     equ 02h
RBS_F_OPL3      equ 04h
RBS_F_LOWFM     equ 08h
RBS_F_MUTE      equ 10h

%endif
