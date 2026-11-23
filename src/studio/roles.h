/* ReBeep Studio: the one colour table. A screen asks for a role, never for a colour; each role has an index for the
   colour view and one for a monochrome display. SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_ROLES_H
#define RBSTUDIO_ROLES_H

typedef enum {
    R_GROUND, R_TEXT, R_VALUE, R_FRAME, R_DIM, R_SHADOW, R_LIT, R_BODY, R_CARRIER, R_MODULATOR, R_ACCENT,
    R_FOCUS, R_FOCUSTEXT, R_KEYS, R_WARNING, R_WINDOW, R_WINDOWTEXT, R_WINDOWACCENT, R_WINDOWFRAME,
    R_WINDOWSHADOW, R_BUTTON, R_COUNT
} Role;

/* The view: mono when the BIOS mode was 2 (BW80) at start or /VIEW:MONO was given (main sets it). */
void role_set_mono(int mono);
int role_mono(void);

/* The colour index (0-15) of `r` for the current view. */
int role(Role r);

#endif
