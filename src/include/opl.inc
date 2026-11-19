; OPL2/OPL3 ports, register bases and the two channels ReBeep's one voice
; alternates between.
; SPDX-License-Identifier: MIT

%ifndef OPL_INC
%define OPL_INC

OPL_ADDR1   equ 388h            ; bank 0 index; reads return the status byte
OPL_DATA1   equ 389h
OPL_ADDR2   equ 38Ah            ; bank 1 index (OPL3)
OPL_DATA2   equ 38Bh

REG_TEST    equ 01h             ; bit 5: waveform select enable
REG_TIMER1  equ 02h
REG_TIMCTL  equ 04h             ; timer control and IRQ reset
REG_NEW     equ 105h            ; bank 1: bit 0 enables OPL3 mode

REG_AVEKSR  equ 20h             ; per operator: + offset
REG_KSLTL   equ 40h
REG_ARDR    equ 60h
REG_SLRR    equ 80h
REG_WAVE    equ 0E0h
REG_FNUMLO  equ 0A0h            ; per channel: + channel
REG_KEYBLK  equ 0B0h
REG_FBCNT   equ 0C0h

OPL_CH_A    equ 7               ; each new note takes the other channel
OPL_CH_B    equ 8               ; OPL_CH_A + 1: opl.asm loops from A to B
OP_MOD_OFS  equ 0Ah             ; channels 6-8: modulator offset = channel + 0Ah
OP_CAR_OFS  equ 3               ; carrier offset = modulator offset + 3

KEY_ON      equ 20h             ; REG_KEYBLK bit 5
OPL3_OUT    equ 30h             ; REG_FBCNT left and right output enables

%endif
