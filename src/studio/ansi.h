/* ReBeep Studio: draws an .ans art file into the back buffer, and the shared monochrome remap that goes with the art
   screens. SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_ANSI_H
#define RBSTUDIO_ANSI_H

/* Clears the back buffer and draws `path` in the standard view's colour indexes. Understands SGR 0 1 5 22 25 30-37
   40-47 39 49 (5 is a bright background: blink is off), CUF CUP CUU CUD CUB, CR and LF; stops at 1Ah and so ignores the
   SAUCE record after it. Any other byte is a glyph. A glyph written past column 80 wraps first, so a CR LF after a full
   line adds no second break. Returns 0, or -1 when the file cannot be opened (the back buffer is then untouched). */
int ansi_draw(const char *path);

/* The path of the art file `name` beside the program ("SPLASH.ANS"), in a static buffer. */
const char *ansi_art_path(const char *name);

/* Passes every cell's foreground and background in the back buffer through the shared mono remap. It moves only index
   2 (to 12), so applying it twice changes nothing more. Art screens call it before the flush in the mono view. */
void scr_remap_mono(void);

#endif
