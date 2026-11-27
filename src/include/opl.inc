; OPL2/OPL3 ports, register bases, the two channels (or, in a four-operator voice, the
; two channel pairs) ReBeep's main voice alternates between, and the effect voice's one.
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
REG_4OP     equ 104h            ; bank 1: bits 0-5 join channel pairs (0,3) (1,4) (2,5) of each bank

REG_AVEKSR  equ 20h             ; per operator: + offset
REG_KSLTL   equ 40h
REG_ARDR    equ 60h
REG_SLRR    equ 80h
REG_WAVE    equ 0E0h
REG_FNUMLO  equ 0A0h            ; per channel: + channel
REG_KEYBLK  equ 0B0h
REG_FBCNT   equ 0C0h

OPL_CH_A    equ 7               ; each new note takes the other channel
OPL_CH_B    equ 8               ; OPL_CH_A + 1: opl.asm writes B's registers one above A's
OP_MOD_OFS  equ 0Ah             ; channels 6-8: modulator offset = channel + 0Ah
OP_CAR_OFS  equ 3               ; carrier offset = modulator offset + 3

; Four-operator voice: bank 1's pairs 0+3 (A) and 1+4 (B), OPL3 channels 9+12 and 10+13.
OPL4_CH_A   equ 100h            ; the first channel of pair A, bank bit included; B's is next
OPL4_CH_B   equ OPL4_CH_A + 1
OPL4_ENABLE equ 18h             ; REG_4OP bits 3 and 4: pairs A and B
OPL4_OP1    equ 00h             ; pair A's operators 1 to 4: bank 1 offsets; B's are one more
OPL4_OP2    equ 03h
OPL4_OP3    equ 08h
OPL4_OP4    equ 0Bh
OPL4_CH2    equ 3               ; the pair's second channel, for C0h

; The effect voice (engine/fx.asm): channel 6, or a four-operator patch on bank 1's pair 2+5.
; Each register is the main voice's first channel's (or pair's) plus the difference.
OPL_FX_CH   equ 6               ; channel 7's registers - 1, free on an OPL2 and an OPL3
OPL4_FX_CH  equ 102h            ; pair A's registers + 2
OPL4_FX_ENABLE equ 20h          ; REG_4OP bit 5: pair 2+5 of bank 1

KEY_ON      equ 20h             ; REG_KEYBLK bit 5
OPL3_OUT    equ 30h             ; REG_FBCNT left and right output enables

%endif
