/* ReBeep Studio: the keyboard. An INT 09h handler tracks make and break codes, calls the old handler for the
   BIOS's own work, then empties the BIOS buffer: no key reaches DOS or INT 16h. SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_KBD_H
#define RBSTUDIO_KBD_H

/* An event is a scan code (bits 0-6) with KBD_BREAK for a release and KBD_EXT for an E0-prefixed
   key (the grey arrows, Ins, Del, Home, End, PgUp, PgDn, right Ctrl and Alt). */
#define KBD_CODE 0x007F
#define KBD_BREAK 0x0080
#define KBD_EXT 0x0100

/* Hooks INT 09h through dos_hook(), so dos_restore() puts it back. Call dos_init() first. */
void kbd_init(void);

/* Takes the oldest event off the queue. Returns 0 when it is empty. The queue holds 31 events;
   when it is full the newest are dropped. */
int kbd_next(unsigned *event);

/* Is the key (a scan code, plus KBD_EXT for an E0 key) held right now? */
int kbd_down(unsigned code);

#endif
