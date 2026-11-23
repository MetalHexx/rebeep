/* SPDX-License-Identifier: MIT */
#include <conio.h>
#include <dos.h>
#include <i86.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "mouse.h"
#include "video.h"

#define TEXT_SEG 0xB800
#define CGA_MODE_PORT 0x3D8
#define BLINK_BIT 0x20
#define CURSOR_HIDDEN 0x2000

static unsigned short back[VIDEO_ROWS * VIDEO_COLS];
static unsigned short __far *screen;
static unsigned char __far *bios_mode_select;
static int active;
static int has_ega;
static unsigned char saved_mode;
static unsigned saved_cursor_shape;

static unsigned char current_mode(void)
{
    union REGS r;

    r.h.ah = 0x0F;
    int86(0x10, &r, &r);
    return r.h.al;
}

static void set_mode(unsigned char mode)
{
    union REGS r;

    r.h.ah = 0x00;
    r.h.al = mode;
    int86(0x10, &r, &r);
}

static void set_cursor_shape(unsigned shape)
{
    union REGS r;

    r.h.ah = 0x01;
    r.x.cx = shape;
    int86(0x10, &r, &r);
}

static void set_cursor_pos(unsigned char row, unsigned char col)
{
    union REGS r;

    r.h.ah = 0x02;
    r.h.bh = 0;
    r.h.dh = row;
    r.h.dl = col;
    int86(0x10, &r, &r);
}

static int ega_or_vga_present(void)
{
    union REGS r;

    r.h.ah = 0x12;
    r.h.bl = 0x10;
    int86(0x10, &r, &r);
    return r.h.bl != 0x10;
}

/* Blink off means bit 7 of an attribute selects a bright background. EGA and VGA have a BIOS call
   for it; on a CGA the bit is in the mode register, and the BIOS keeps a copy at 0040:0065. */
static void set_blink(int on)
{
    if (has_ega) {
        union REGS r;

        r.x.ax = 0x1003;
        r.h.bl = on ? 1 : 0;
        int86(0x10, &r, &r);
    } else {
        unsigned char mode = *bios_mode_select;

        mode = on ? (mode | BLINK_BIT) : (mode & ~BLINK_BIT);
        outp(CGA_MODE_PORT, mode);
        *bios_mode_select = mode;
    }
}

static void clear_screen(void)
{
    union REGS r;

    r.x.ax = 0x0600;
    r.h.bh = 0x07;
    r.x.cx = 0x0000;
    r.x.dx = ((VIDEO_ROWS - 1) << 8) | (VIDEO_COLS - 1);
    int86(0x10, &r, &r);
}

void video_restore(void)
{
    if (!active) return;
    active = 0;
    set_blink(1);
    set_cursor_shape(saved_cursor_shape);
    if (current_mode() != saved_mode) set_mode(saved_mode);
    clear_screen();
    set_cursor_pos(0, 0);
}

void video_init(void)
{
    union REGS r;

    if (active) return;
    screen = (unsigned short __far *)MK_FP(TEXT_SEG, 0);
    bios_mode_select = (unsigned char __far *)MK_FP(0x40, 0x65);
    has_ega = ega_or_vga_present();

    saved_mode = current_mode();
    if (saved_mode != 2 && saved_mode != 3) set_mode(3);

    r.h.ah = 0x03;
    r.h.bh = 0;
    int86(0x10, &r, &r);
    saved_cursor_shape = r.x.cx;

    active = 1;
    atexit(video_restore);
    set_blink(0);
    set_cursor_shape(CURSOR_HIDDEN);
    video_fill(0, 0, VIDEO_COLS, VIDEO_ROWS, ' ', 0x07);
}

void video_put(int x, int y, unsigned char ch, unsigned char attr)
{
    if ((unsigned)x >= VIDEO_COLS || (unsigned)y >= VIDEO_ROWS) return;
    back[y * VIDEO_COLS + x] = ((unsigned short)attr << 8) | ch;
}

void video_fill(int x, int y, int w, int h, unsigned char ch, unsigned char attr)
{
    int col;
    int row;

    for (row = y; row < y + h; row++) {
        for (col = x; col < x + w; col++) video_put(col, row, ch, attr);
    }
}

void video_text(int x, int y, const char *s, unsigned char attr)
{
    for (; *s != '\0'; s++, x++) video_put(x, y, (unsigned char)*s, attr);
}

void video_flush(void)
{
    _fmemcpy(screen, back, sizeof back);
}

/* Writes `ch` (or keeps the glyph when negative) and the colours that are not SCR_KEEP. */
static void put_cell(int x, int y, int ch, int fg, int bg)
{
    unsigned cell;
    unsigned attr;

    if ((unsigned)x >= VIDEO_COLS || (unsigned)y >= VIDEO_ROWS) return;
    cell = back[y * VIDEO_COLS + x];
    attr = cell >> 8;
    if (fg >= 0) attr = (attr & 0xF0) | (fg & 15);
    if (bg >= 0) attr = (attr & 0x0F) | ((bg & 15) << 4);
    back[y * VIDEO_COLS + x] = (attr << 8) | (ch >= 0 ? (unsigned)ch : (cell & 0xFF));
}

void scr_put(int x, int y, const char *cp437, int fg, int bg)
{
    for (; *cp437 != '\0'; cp437++, x++) put_cell(x, y, (unsigned char)*cp437, fg, bg);
}

void scr_fill(int x, int y, int w, int h, char ch, int fg, int bg)
{
    int col;
    int row;

    for (row = y; row < y + h; row++) {
        for (col = x; col < x + w; col++) put_cell(col, row, (unsigned char)ch, fg, bg);
    }
}

void scr_paint(int x, int y, int w, int h, int fg, int bg)
{
    int col;
    int row;

    for (row = y; row < y + h; row++) {
        for (col = x; col < x + w; col++) put_cell(col, row, -1, fg, bg);
    }
}

void scr_box(int x, int y, int w, int h, int style, int fg, int bg)
{
    static const unsigned char single[6] = {0xDA, 0xC4, 0xBF, 0xB3, 0xC0, 0xD9};
    static const unsigned char dbl[6] = {0xC9, 0xCD, 0xBB, 0xBA, 0xC8, 0xBC};
    const unsigned char *g = style == SCR_DOUBLE ? dbl : single;
    int i;

    if (w < 2 || h < 2) return;
    put_cell(x, y, g[0], fg, bg);
    put_cell(x + w - 1, y, g[2], fg, bg);
    put_cell(x, y + h - 1, g[4], fg, bg);
    put_cell(x + w - 1, y + h - 1, g[5], fg, bg);
    for (i = 1; i < w - 1; i++) {
        put_cell(x + i, y, g[1], fg, bg);
        put_cell(x + i, y + h - 1, g[1], fg, bg);
    }
    for (i = 1; i < h - 1; i++) {
        put_cell(x, y + i, g[3], fg, bg);
        put_cell(x + w - 1, y + i, g[3], fg, bg);
    }
}

void scr_ramp(int x, int y, const char *s)
{
    int n = 0;
    int i = 0;
    const char *p;

    for (p = s; *p != '\0'; p++) {
        if (*p != ' ') n++;
    }
    for (; *s != '\0'; s++, x++) {
        int fg = 15;

        if (*s != ' ') {
            if (i == 0 || i == n - 1) fg = 8;
            else if (i == 1 || i == n - 2) fg = 7;
            i++;
        }
        put_cell(x, y, (unsigned char)*s, fg, SCR_KEEP);
    }
}

unsigned scr_cell(int x, int y)
{
    if ((unsigned)x >= VIDEO_COLS || (unsigned)y >= VIDEO_ROWS) return 0;
    return back[y * VIDEO_COLS + x];
}

void scr_flush(void)
{
    int shown = mouse_visible();

    if (shown) mouse_hide();
    video_flush();
    if (shown) mouse_show();
}

int scr_dump(const char *path)
{
    unsigned char row[VIDEO_COLS * 2];
    int shown = mouse_visible();
    FILE *out;
    int y;
    int ok = 1;

    out = fopen(path, "wb");
    if (out == NULL) return -1;
    if (shown) mouse_hide();
    for (y = 0; y < VIDEO_ROWS && ok; y++) {
        _fmemcpy(row, screen + y * VIDEO_COLS, sizeof row);
        ok = fwrite(row, 1, sizeof row, out) == sizeof row;
    }
    if (shown) mouse_show();
    if (fclose(out) != 0) ok = 0;
    return ok ? 0 : -1;
}

int scr_bw80(void)
{
    return saved_mode == 2;
}
