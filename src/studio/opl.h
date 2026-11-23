/* ReBeep Studio: the OPL2/OPL3 driver. The studio owns the chip while it runs: live notes on every channel, two- or
   four-operator voices programmed from a patch's values.
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_OPL_H
#define RBSTUDIO_OPL_H

#include "patch.h"

#define OPL_NOTES 96   /* note 0 = C0 .. 95 = B7 */

/* The timer test at 388h, as the game's opl.asm does it. Returns 0 none, 2 OPL2, 3 OPL3, and picks the write delays
   for that chip. Always uses the ports, never opl_sink. */
int opl_detect(void);

/* The card named by BLASTER, "Sound Blaster 16 at 220h" (the port omitted when the A field is missing), or "" when
   BLASTER is not set. */
void opl_card(char *buf, unsigned len);

/* Takes the chip: 01h = 20h; on an OPL3 105h = 01h and 104h = 00h; every channel keyed off. `chip` is 2 or 3; anything
   else leaves the driver without a chip. The driver has no voice until opl_set_voice. */
void opl_init(int chip);

/* The chip opl_init took: 2 or 3, or 0 before opl_init and after opl_shutdown. */
int opl_chip(void);

/* Keys every channel off, sets every carrier's TL to 63, and on an OPL3 leaves 104h and 105h at 0. */
void opl_shutdown(void);

/* Programs `v` into every channel of its mode. `ops` is 2 or 4; `octave` 0..7 is the patch's, 4 = the game's pitch.
   Switching between 2 and 4 keys every channel off before 104h changes. On an OPL2 a four-operator voice is kept but
   no note plays and nothing is written (beyond keying off notes that were sounding). A change within the same mode
   leaves sounding notes sounding with the new voice. */
void opl_set_voice(const Voice *v, int ops, int octave);

/* Starts `note` (0 = C0). A note already sounding keeps its slot. Otherwise it takes a free slot, else the oldest
   sounding one. Returns the slot, or -1 when there is no chip, no voice, the note is out of range, or the voice is
   four-operator on an OPL2. Slots: 0..8 on an OPL2, 0..17 on an OPL3 with a two-operator voice, 0..5 for the
   four-operator pairs. */
int opl_note_on(int note);

void opl_note_off(int note);

/* Keys off every slot of the current voice. */
void opl_all_off(void);

/* Every register write goes here when set; NULL writes to the ports. Tests record. `reg` is 000h-1FFh, bit 8 = bank 1. */
extern void (*opl_sink)(unsigned reg, unsigned char val);

/* The voice's registers in the order the game's patch records use: the modulator then the carrier of 20h, 40h, 60h,
   80h and E0h, then C0h (feedback and connection; an OPL3's output bits are added when written). `chip` 2 masks the
   waveform to 0..3. */
void opl_regs2(const Voice *v, int chip, unsigned char rec[11]);

/* Four-operator: op1..op4 of 20h, 40h, 60h, 80h, E0h (20 bytes), then the first channel's C0h (FB*2 + CNT1) and the
   second channel's (CNT2). */
void opl_regs4(const Voice *v, int chip, unsigned char rec[22]);

#endif
