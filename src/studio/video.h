/* ReBeep Studio: the 80x25 text screen. Everything is drawn in colour into a back buffer of char/attribute words and
   flushed in one go: to B800:0000 as it is, or, on a mono card, converted to B000:0000. SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_VIDEO_H
#define RBSTUDIO_VIDEO_H

#define VIDEO_COLS 80
#define VIDEO_ROWS 25

/* Sets 80x25 colour text unless the mode is 2 (BW80), 3 or 7 (a mono card: MDA, Hercules, or an EGA or VGA set up for a
   mono monitor), loads the blocks, turns blink off (bit 7 of an attribute then selects a bright background), hides the
   cursor and clears the back buffer. video_restore() undoes it and is registered to run at exit; it also clears the
   screen. Safe to call again. */
void video_init(void);
void video_restore(void);

/* VIDEO_BLOCK[k - 1] fills the bottom k scanlines. C0h-DFh copy the 8th pixel column into the 9th on VGA, so the blocks
   join. video_init loads them into the font over line-drawing codes no screen uses, on an EGA or VGA, and video_restore
   puts the ROM font back. */
extern const unsigned char VIDEO_BLOCK[15];   /* C7 CA CB CC CE CF D0 D1 D2 D3 D4 D5 D6 D7 D8 */

/* The scanlines a cell has while the blocks are loaded and read back from the font (16 VGA, 14 EGA); 0 when they are
   not: draw half blocks. */
int video_block_lines(void);

/* Reads the 15 loaded glyphs back from the font and returns 1 when all are there; 0 when none were loaded or the font
   does not hold them. video_init does it once after the load and keeps the half blocks when it fails, so a BIOS that
   ignores the load never shows its line-drawing glyphs under the reserved codes. */
int video_blocks_in_font(void);

/* Chooses the drawing path regardless of the card: 16, 14 or 0. For /DUMP, which draws one set of reference screens on
   every card, and for tests. Call after video_init, which sets it from the card. */
void video_set_block_lines(int lines);

/* Back-buffer drawing. Coordinates are 0-based; anything off the screen is clipped. Each call (these and the scr_* ones
   below) clips once and writes its run straight into the buffer: draw a rectangle or a string in one call, not a cell at a
   time. */
void video_put(int x, int y, unsigned char ch, unsigned char attr);
void video_fill(int x, int y, int w, int h, unsigned char ch, unsigned char attr);
void video_text(int x, int y, const char *s, unsigned char attr);

/* Copies the whole back buffer to the screen; on a mono card, converts each cell to normal, bright and inverted. */
void video_flush(void);

/* The screen layer the program draws through. Text is CP437 bytes, so a C literal writes a glyph above 7Fh as a hex
   escape in a literal of its own ("\xFB" "  text"). A colour of SCR_KEEP leaves that part of the cell as it is. */
#define SCR_KEEP (-1)
#define SCR_SINGLE 0
#define SCR_DOUBLE 1

/* Writes the bytes of `cp437` along row `y` from `x`; clipped to the screen. */
void scr_put(int x, int y, const char *cp437, int fg, int bg);

/* Fills a rectangle with the glyph `ch`. */
void scr_fill(int x, int y, int w, int h, char ch, int fg, int bg);

/* Sets colours only, glyphs untouched. */
void scr_paint(int x, int y, int w, int h, int fg, int bg);

/* The outline of a rectangle (the corners included), single or double line; the inside is untouched. */
void scr_box(int x, int y, int w, int h, int style, int fg, int bg);

/* Writes `s` with the splash gradient: over the non-space characters the first and last are 8, the second and
   second-to-last 7, the rest 15. The background stays as it is. */
void scr_ramp(int x, int y, const char *s);

/* The back buffer's cell as attribute << 8 | character, or 0 off the screen. */
unsigned scr_cell(int x, int y);

/* video_flush with the mouse cursor hidden for the copy, so the driver's cursor never lands in the back buffer's view. */
void scr_flush(void);

/* Writes the 4000 bytes of screen memory (character, attribute for each cell, row by row) to `path`, with the mouse
   cursor hidden. Call after scr_flush. Returns 0, or -1 when the file cannot be written. */
int scr_dump(const char *path);

/* 1 for a monochrome display: BIOS mode 2 at start, a mono card, or a mono analog monitor the VGA BIOS reports. Valid
   after video_init. */
int scr_mono(void);

/* 1 on a mono card (mode 7), where colour shows nothing: a screen that tells two things apart by colour alone draws them
   differently there. Valid after video_init. */
int scr_mono_card(void);

#endif
