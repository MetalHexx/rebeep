/* ReBeep Studio: the mouse through the INT 33h driver, used only when a driver answers. Cells are pixels / 8.
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_MOUSE_H
#define RBSTUDIO_MOUSE_H

/* Looks for a driver (a non-null INT 33h vector that is not a bare IRET, then function 0). Returns 1 when one answers.
   The cursor starts hidden. Every other call here does nothing without a driver. */
int mouse_init(void);

int mouse_present(void);

/* Shows or hides the cursor. Calls do not nest: it is either shown or hidden. */
void mouse_show(void);
void mouse_hide(void);
int mouse_visible(void);

/* Reads the position in cells (0-79, 0-24) into *x and *y and returns the buttons: bit 0 left, bit 1 right, bit 2 middle. */
int mouse_read(int *x, int *y);

/* Hides the cursor; call before leaving the program. */
void mouse_done(void);

#endif
