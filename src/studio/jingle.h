/* ReBeep Studio: the splash jingle, a short placeholder phrase on FACTORY\BELL (a built-in bell voice when that file
   is missing), played on the driver's live notes. It needs the chip already taken with opl_init; with none it does
   nothing.
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_JINGLE_H
#define RBSTUDIO_JINGLE_H

/* Loads the voice and starts the phrase. */
void jingle_start(void);

/* Call from the splash's key-wait loop: starts and releases the notes by the BIOS tick count (no timer hook), and
   stops itself after about two seconds. */
void jingle_poll(void);

/* Keys every note off at once. Safe when the jingle is not playing. */
void jingle_stop(void);

#endif
