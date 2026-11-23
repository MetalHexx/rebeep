/* ReBeep Studio: the editor's state, one struct for the synth screen to draw and the editing keys to change.
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_EDITOR_H
#define RBSTUDIO_EDITOR_H

#include "patch.h"

/* The focused row `fk`: a parameter row is its P_* value (0 to P_COUNT - 1), the other rows follow. */
enum { F_NAME = P_COUNT, F_VARIANT, F_OCTAVE, F_CONN, F_FB };

#define ED_KEYS 29   /* piano keys on the bottom row */
#define KB_LOW 3     /* the keyboard's octave at start */

typedef struct {
    Patch p;  int n;              /* 2 or 4: the variant shown */
    int chip;                     /* 0, 2, 3 */
    int fk;                       /* focused row: F_NAME, F_VARIANT, F_OCTAVE, F_CONN, F_FB, or a P_* row */
    int cur, lastP;               /* operator in focus; last parameter row */
    int dirty;                    /* the * marker */
    int pos, total;               /* "12 of 40" */
    unsigned char held[29]; int nheld;   /* piano keys lit, ascending */
    int kbOct;                    /* keyboard octave, KB_LOW = 3 */
    char msg[27]; int msgRole;    /* message area; msgRole is a Role */
} Editor;

#endif
