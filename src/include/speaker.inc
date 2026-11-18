; Speaker hardware ports and the interpreter's modes and events.
; SPDX-License-Identifier: MIT

%ifndef SPEAKER_INC
%define SPEAKER_INC

PIT_CH2     equ 42h
PIT_CTRL    equ 43h
SYS_CTRL    equ 61h

SC_GATE2    equ 01h             ; 61h bit 0: timer 2 gate
SC_SPKR     equ 02h             ; 61h bit 1: speaker data enable
SC_OUT2     equ 20h             ; 61h bit 5: timer 2 output (read only)

M_SILENT    equ 0
M_TONE      equ 1
M_RAW       equ 2               ; speaker driven, untranslatable: the real speaker must play it

EV_NONE     equ 0
EV_TONE_ON  equ 1
EV_PITCH    equ 2
EV_TONE_OFF equ 3

DIV_MIN     equ 193             ; ~6182 Hz, the top of the OPL's range
DIV_MAX     equ 59659           ; ~20 Hz

%endif
