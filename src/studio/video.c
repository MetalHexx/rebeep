/* SPDX-License-Identifier: MIT */
#include <conio.h>
#include <dos.h>
#include <i86.h>
#include <stdlib.h>
#include <string.h>

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
