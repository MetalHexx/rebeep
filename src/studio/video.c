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
#define MONO_SEG 0xB000
#define EGA_INACTIVE 0x08      /* 0040:0087 bit 3: an EGA or VGA is fitted, another card drives the screen */
#define CGA_MODE_PORT 0x3D8
#define BLINK_BIT 0x20
#define CURSOR_HIDDEN 0x2000
#define FONT_PLANE_SEG 0xA000
#define SEQ_INDEX 0x3C4
#define SEQ_MEMORY_MODE 4
#define GC_INDEX 0x3CE
#define GC_READ_MAP 4
#define GC_MODE 5
#define GC_MISC 6

/* A mono card's attributes. */
#define A_NORMAL 0x07
#define A_BRIGHT 0x0F
#define A_INVERSE 0x70
#define BLANK_CELL ((A_NORMAL << 8) | ' ')   /* never attribute 00h, on which the mouse driver's cursor can't be seen */

static unsigned short back[VIDEO_ROWS * VIDEO_COLS];
static unsigned short __far *screen;
static unsigned char __far *bios_mode_select;
static int active;
static int has_ega;
static int ega_active;                  /* the EGA or VGA drives the screen: its BIOS calls and soft font apply */
static int mono_card;                   /* BIOS mode 7 */
static int mono_monitor;
static unsigned char mono_text[256];    /* a text cell's mono attribute by its colour attribute; 0 when it shows nothing */
static unsigned char saved_mode;
static unsigned saved_cursor_shape;
static int font_lines;    /* the cell height of the font the blocks were loaded into: 14 or 16; 0 when none are */
static int block_lines;   /* the drawing path: font_lines, or what video_set_block_lines chose */

const unsigned char VIDEO_BLOCK[15] = {0xC7, 0xCA, 0xCB, 0xCC, 0xCE, 0xCF, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8};

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

/* The display combination code (INT 10h AX=1A00h, VGA and MCGA BIOSes): 07h and 0Bh are monochrome analog monitors. */
static int analog_mono_monitor(void)
{
    union REGS r;

    r.x.ax = 0x1A00;
    int86(0x10, &r, &r);
    return r.h.al == 0x1A && (r.h.bl == 0x07 || r.h.bl == 0x0B);
}

/* The BIOS character height in scanlines (INT 10h AX=1130h, BH=0). */
static int char_height(void)
{
    union REGPACK r;

    memset(&r, 0, sizeof r);
    r.w.ax = 0x1130;
    r.w.bx = 0;
    intr(0x10, &r);
    return (int)r.w.cx;
}

/* Loads the user characters `table` (`count` glyphs of `height` bytes) from code `first` (INT 10h AX=1100h: it does not
   reprogram the CRTC, which AX=1110h would). */
static void load_glyphs(const unsigned char *table, int count, int height, int first)
{
    union REGPACK r;

    memset(&r, 0, sizeof r);
    r.w.ax = 0x1100;
    r.w.bx = (unsigned)height << 8;
    r.w.cx = count;
    r.w.dx = first;
    r.w.es = FP_SEG((const void __far *)table);
    r.w.bp = FP_OFF((const void __far *)table);
    intr(0x10, &r);
}

/* Puts the ROM font of the cell height back, without reprogramming (AX=1104h for 16 lines, 1101h for 14). */
static void load_rom_font(int height)
{
    union REGPACK r;

    memset(&r, 0, sizeof r);
    r.w.ax = height == 16 ? 0x1104 : 0x1101;
    r.w.bx = 0;
    intr(0x10, &r);
}

/* The sixteenth blocks: glyph k (1 to 15) fills the bottom min(k, height) scanlines, `height` bytes each, one after
   another. */
static unsigned char glyphs[15 * 16];

/* Loads them in three calls, one per run of codes. */
static void load_blocks(int height)
{
    int k;
    int line;

    for (k = 1; k <= 15; k++) {
        for (line = 0; line < height; line++) glyphs[(k - 1) * height + line] = line >= height - k ? 0xFF : 0x00;
    }
    load_glyphs(glyphs, 1, height, 0xC7);
    load_glyphs(glyphs + 1 * height, 3, height, 0xCA);
    load_glyphs(glyphs + 4 * height, 11, height, 0xCE);
}

static void seq_write(unsigned char index, unsigned char value)
{
    outp(SEQ_INDEX, index);
    outp(SEQ_INDEX + 1, value);
}

static void gc_write(unsigned char index, unsigned char value)
{
    outp(GC_INDEX, index);
    outp(GC_INDEX + 1, value);
}

/* Reads the 15 glyphs back from the font in plane 2 (32 bytes a code) and compares them with what load_blocks wrote.
   An EGA's sequencer and graphics controller are write-only, so their values are not saved: the read sets the registers
   it needs and puts back the ones the BIOS programs for text mode 3, or for mode 7 (the memory map at B000h). */
static int blocks_match(int height)
{
    int k;
    int line;
    int same = 1;
    unsigned char __far *plane = (unsigned char __far *)MK_FP(FONT_PLANE_SEG, 0);

    _disable();
    seq_write(SEQ_MEMORY_MODE, 0x07);
    gc_write(GC_READ_MAP, 0x02);
    gc_write(GC_MODE, 0x00);
    gc_write(GC_MISC, 0x04);
    for (k = 0; k < 15 && same; k++) {
        for (line = 0; line < height; line++) {
            if (plane[VIDEO_BLOCK[k] * 32 + line] != glyphs[k * height + line]) {
                same = 0;
                break;
            }
        }
    }
    seq_write(SEQ_MEMORY_MODE, 0x03);
    gc_write(GC_READ_MAP, 0x00);
    gc_write(GC_MODE, 0x10);
    gc_write(GC_MISC, mono_card ? 0x0A : 0x0E);
    _enable();
    return same;
}

/* Blink off means bit 7 of an attribute selects a bright background. EGA and VGA have a BIOS call
   for it; on a CGA the bit is in the mode register, and the BIOS keeps a copy at 0040:0065. A mono
   card is left alone: video_flush writes it no attribute with bit 7 set. */
static void set_blink(int on)
{
    if (ega_active) {
        union REGS r;

        r.x.ax = 0x1003;
        r.h.bl = on ? 1 : 0;
        int86(0x10, &r, &r);
    } else if (!mono_card) {
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
    if (font_lines != 0) {
        /* The ROM font alone lacks a mono mode's own nine-column glyphs; its mode set loads both. */
        if (mono_card) set_mode(7);
        else load_rom_font(font_lines);
    }
    font_lines = 0;
    block_lines = 0;
    set_blink(1);
    set_cursor_shape(saved_cursor_shape);
    if (current_mode() != saved_mode) set_mode(saved_mode);
    clear_screen();
    set_cursor_pos(0, 0);
}

static void build_mono_text(void)
{
    int attr;

    for (attr = 0; attr < 256; attr++) {
        int fg = attr & 15;
        int bg = attr >> 4;

        if (bg != 0 && bg != 8) mono_text[attr] = A_INVERSE;
        else if (fg >= 9) mono_text[attr] = A_BRIGHT;
        else if (fg != 0 || bg == 8) mono_text[attr] = A_NORMAL;
        else mono_text[attr] = 0;
    }
}

void video_init(void)
{
    union REGS r;

    if (active) return;
    bios_mode_select = (unsigned char __far *)MK_FP(0x40, 0x65);
    has_ega = ega_or_vga_present();

    saved_mode = current_mode();
    if (saved_mode != 2 && saved_mode != 3 && saved_mode != 7) set_mode(3);
    mono_card = current_mode() == 7;   /* a mono card stays in mode 7 whatever mode is asked of it */
    screen = (unsigned short __far *)MK_FP(mono_card ? MONO_SEG : TEXT_SEG, 0);
    ega_active = has_ega && (*(unsigned char __far *)MK_FP(0x40, 0x87) & EGA_INACTIVE) == 0;
    mono_monitor = saved_mode == 2 || mono_card || analog_mono_monitor();
    if (mono_card) build_mono_text();

    r.h.ah = 0x03;
    r.h.bh = 0;
    int86(0x10, &r, &r);
    saved_cursor_shape = r.x.cx;
    /* Some mono BIOSes report a colour card's underline, which sits mid-cell in a mono card's 14 lines. */
    if (mono_card && !ega_active && saved_cursor_shape == 0x0607) saved_cursor_shape = 0x0B0C;

    active = 1;
    atexit(video_restore);
    if (ega_active) {
        int height = char_height();

        if (height == 14 || height == 16) {
            load_blocks(height);
            font_lines = height;
            if (blocks_match(height)) block_lines = height;
        }
    }
    /* Only after the font load: an IBM EGA's reprograms every video register, turning blink and the cursor back on. */
    set_blink(0);
    set_cursor_shape(CURSOR_HIDDEN);
    video_fill(0, 0, VIDEO_COLS, VIDEO_ROWS, ' ', 0x07);
}

int video_block_lines(void)
{
    return block_lines;
}

int video_blocks_in_font(void)
{
    return font_lines != 0 && blocks_match(font_lines);
}

void video_set_block_lines(int lines)
{
    block_lines = lines;
}

/* The cells a draw writes. A run is clipped once and then written straight into `back`: a cell becomes
   (cell & keep) | set, so a kept glyph or colour is only a bit of `keep`. */

/* Clips the rectangle to the screen. Returns 0 when nothing is left. */
static int clip_rect(int *x, int *y, int *w, int *h)
{
    int x1 = *x + *w;
    int y1 = *y + *h;

    if (*x < 0) *x = 0;
    if (*y < 0) *y = 0;
    if (x1 > VIDEO_COLS) x1 = VIDEO_COLS;
    if (y1 > VIDEO_ROWS) y1 = VIDEO_ROWS;
    *w = x1 - *x;
    *h = y1 - *y;
    return *w > 0 && *h > 0;
}

/* The bits of a cell a draw keeps and the bits it sets, for the glyph `ch` (kept when negative) and the colours
   (each kept when negative). */
static void cell_bits(int ch, int fg, int bg, unsigned *keep, unsigned *set)
{
    unsigned k = 0;
    unsigned s = 0;

    if (ch >= 0) s |= (unsigned char)ch;
    else k |= 0x00FF;
    if (fg >= 0) s |= (unsigned)(fg & 15) << 8;
    else k |= 0x0F00;
    if (bg >= 0) s |= (unsigned)(bg & 15) << 12;
    else k |= 0xF000;
    *keep = k;
    *set = s;
}

static void write_rect(int x, int y, int w, int h, int ch, int fg, int bg)
{
    unsigned keep;
    unsigned set;

    if (!clip_rect(&x, &y, &w, &h)) return;
    cell_bits(ch, fg, bg, &keep, &set);
    for (; h > 0; h--, y++) {
        unsigned short *p = back + y * VIDEO_COLS + x;
        unsigned short *end = p + w;

        if (keep == 0) {
            for (; p < end; p++) *p = set;
        } else {
            for (; p < end; p++) *p = (*p & keep) | set;
        }
    }
}

/* The start of the run of `*len` characters of a row from column `x`, clipped to the row, or NULL when none of it is
   on the screen. `*skip` is how many leading characters fall off the left edge. */
static unsigned short *clip_run(int x, int y, int *skip, int *len)
{
    int n = *len;

    *skip = 0;
    if ((unsigned)y >= VIDEO_ROWS) return NULL;
    if (x < 0) {
        *skip = -x;
        n += x;
        x = 0;
    }
    if (x + n > VIDEO_COLS) n = VIDEO_COLS - x;
    if (n <= 0) return NULL;
    *len = n;
    return back + y * VIDEO_COLS + x;
}

void video_put(int x, int y, unsigned char ch, unsigned char attr)
{
    if ((unsigned)x >= VIDEO_COLS || (unsigned)y >= VIDEO_ROWS) return;
    back[y * VIDEO_COLS + x] = ((unsigned short)attr << 8) | ch;
}

void video_fill(int x, int y, int w, int h, unsigned char ch, unsigned char attr)
{
    unsigned short cell = ((unsigned short)attr << 8) | ch;

    if (!clip_rect(&x, &y, &w, &h)) return;
    for (; h > 0; h--, y++) {
        unsigned short *p = back + y * VIDEO_COLS + x;
        unsigned short *end = p + w;

        for (; p < end; p++) *p = cell;
    }
}

void video_text(int x, int y, const char *s, unsigned char attr)
{
    int len = (int)strlen(s);
    int skip;
    unsigned short *p = clip_run(x, y, &skip, &len);
    unsigned short *end;

    if (p == NULL) return;
    s += skip;
    for (end = p + len; p < end; p++, s++) *p = ((unsigned short)attr << 8) | (unsigned char)*s;
}

/* What a mono card shows of a colour cell. It has no colours, only normal, bright and inverted, so a coloured background
   inverts its text, and a shape made of colours (a space, block or shade) becomes the blocks that cover its parts that
   are not black. */

/* Bright for the colours 9 to 15. */
static unsigned short lit_cell(int colour, unsigned char ch)
{
    return (unsigned short)(((colour >= 9 ? A_BRIGHT : A_NORMAL) << 8) | ch);
}

/* A cell in two halves of colours `first` (the upper or left one) and `second`; the glyphs cover one half each. Both
   lit is a solid block, bright when both colours are. */
static unsigned short mono_halves(int first, int second, unsigned char first_half, unsigned char second_half)
{
    if (first != 0 && second != 0) return lit_cell(first < second ? first : second, 0xDB);
    if (first != 0) return lit_cell(first, first_half);
    if (second != 0) return lit_cell(second, second_half);
    return BLANK_CELL;
}

static unsigned short mono_cell(unsigned short cell)
{
    unsigned char ch = (unsigned char)cell;
    unsigned char attr = (unsigned char)(cell >> 8);
    int fg = attr & 15;
    int bg = attr >> 4;

    switch (ch) {
    case 0x00:
    case 0x20:
    case 0xFF:
        if (bg != 0 && fg == bg) return lit_cell(fg, 0xDB);   /* a space in one colour is a solid shape */
        return mono_text[attr] == A_INVERSE ? (A_INVERSE << 8) | ' ' : BLANK_CELL;
    case 0xDB:
        return mono_halves(fg, fg, 0xDB, 0xDB);
    case 0xDF:
        return mono_halves(fg, bg, 0xDF, 0xDC);
    case 0xDC:
        return mono_halves(bg, fg, 0xDF, 0xDC);
    case 0xDD:
        return mono_halves(fg, bg, 0xDD, 0xDE);
    case 0xDE:
        return mono_halves(bg, fg, 0xDD, 0xDE);
    case 0xB0:
    case 0xB1:
    case 0xB2:
        if (fg != 0 && bg != 0) return lit_cell(fg < bg ? fg : bg, 0xDB);
        if (fg != 0) return lit_cell(fg, ch);
        return bg != 0 ? (unsigned short)((A_INVERSE << 8) | ch) : BLANK_CELL;
    default:
        return mono_text[attr] != 0 ? (unsigned short)((mono_text[attr] << 8) | ch) : BLANK_CELL;
    }
}

/* Converts the back buffer cell by cell; a run of equal cells, most of a screen, is converted once. */
static void flush_mono(void)
{
    const unsigned short *p = back;
    const unsigned short *end = back + VIDEO_ROWS * VIDEO_COLS;
    unsigned short __far *to = screen;
    unsigned short cell = BLANK_CELL;
    unsigned short shown = BLANK_CELL;

    for (; p < end; p++, to++) {
        if (*p != cell) {
            cell = *p;
            shown = mono_cell(cell);
        }
        *to = shown;
    }
}

void video_flush(void)
{
    if (mono_card) flush_mono();
    else _fmemcpy(screen, back, sizeof back);
}

void scr_put(int x, int y, const char *cp437, int fg, int bg)
{
    int len = (int)strlen(cp437);
    int skip;
    unsigned short *p = clip_run(x, y, &skip, &len);
    unsigned short *end;
    unsigned keep;
    unsigned set;

    if (p == NULL) return;
    cell_bits(0, fg, bg, &keep, &set);
    cp437 += skip;
    for (end = p + len; p < end; p++, cp437++) *p = (*p & keep) | set | (unsigned char)*cp437;
}

void scr_fill(int x, int y, int w, int h, char ch, int fg, int bg)
{
    write_rect(x, y, w, h, (unsigned char)ch, fg, bg);
}

void scr_paint(int x, int y, int w, int h, int fg, int bg)
{
    write_rect(x, y, w, h, -1, fg, bg);
}

void scr_box(int x, int y, int w, int h, int style, int fg, int bg)
{
    static const unsigned char single[6] = {0xDA, 0xC4, 0xBF, 0xB3, 0xC0, 0xD9};
    static const unsigned char dbl[6] = {0xC9, 0xCD, 0xBB, 0xBA, 0xC8, 0xBC};
    const unsigned char *g = style == SCR_DOUBLE ? dbl : single;

    if (w < 2 || h < 2) return;
    write_rect(x, y, 1, 1, g[0], fg, bg);
    write_rect(x + w - 1, y, 1, 1, g[2], fg, bg);
    write_rect(x, y + h - 1, 1, 1, g[4], fg, bg);
    write_rect(x + w - 1, y + h - 1, 1, 1, g[5], fg, bg);
    write_rect(x + 1, y, w - 2, 1, g[1], fg, bg);
    write_rect(x + 1, y + h - 1, w - 2, 1, g[1], fg, bg);
    write_rect(x, y + 1, 1, h - 2, g[3], fg, bg);
    write_rect(x + w - 1, y + 1, 1, h - 2, g[3], fg, bg);
}

void scr_ramp(int x, int y, const char *s)
{
    int n = 0;
    int i = 0;
    const char *p;
    int on_row = (unsigned)y < VIDEO_ROWS;

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
        if (on_row && (unsigned)x < VIDEO_COLS) {
            unsigned short *cell = back + y * VIDEO_COLS + x;

            *cell = (*cell & 0xF000) | ((unsigned)fg << 8) | (unsigned char)*s;
        }
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

int scr_mono(void)
{
    return mono_monitor;
}

int scr_mono_card(void)
{
    return mono_card;
}
