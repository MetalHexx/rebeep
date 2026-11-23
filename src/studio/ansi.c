/* SPDX-License-Identifier: MIT */
#include <stdio.h>
#include <string.h>

#include "ansi.h"
#include "dos.h"
#include "video.h"

#define MAX_PARAMS 8

/* SGR colour n (0-7) to the PC colour index. */
static const unsigned char sgr_to_pc[8] = {0, 4, 2, 6, 1, 5, 3, 7};

/* The shared remap: colour index in, index drawn on a monochrome display (art-hand/mono.txt). */
static const unsigned char mono_remap[16] = {0, 1, 12, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15};

static char path_buf[100];

const char *ansi_art_path(const char *name)
{
    strncpy(path_buf, dos_program_dir(), 80);
    path_buf[80] = '\0';
    strcat(path_buf, name);
    return path_buf;
}

typedef struct {
    int x, y;
    int fg, bg, bold, blink;
} Pen;

static void sgr(Pen *p, const int *n, int count)
{
    static const int reset = 0;
    int i;

    if (count == 0) {
        n = &reset;
        count = 1;
    }
    for (i = 0; i < count; i++) {
        int v = n[i];

        if (v == 0) {
            p->fg = 7;
            p->bg = 0;
            p->bold = p->blink = 0;
        } else if (v == 1) p->bold = 1;
        else if (v == 5) p->blink = 1;
        else if (v == 22) p->bold = 0;
        else if (v == 25) p->blink = 0;
        else if (v >= 30 && v <= 37) p->fg = sgr_to_pc[v - 30];
        else if (v >= 40 && v <= 47) p->bg = sgr_to_pc[v - 40];
        else if (v == 39) p->fg = 7;
        else if (v == 49) p->bg = 0;
    }
}

static void csi(Pen *p, FILE *f)
{
    int n[MAX_PARAMS];
    int count = 0;
    int cur = 0;
    int have = 0;
    int c;
    int first;

    while ((c = getc(f)) != EOF && !(c >= 0x40 && c <= 0x7E)) {
        if (c >= '0' && c <= '9') {
            cur = cur * 10 + (c - '0');
            if (cur > 9999) cur = 9999;
            have = 1;
        } else if (c == ';') {
            if (count < MAX_PARAMS) n[count++] = cur;
            cur = 0;
            have = 0;
        }
    }
    if (c == EOF) return;
    if ((have || count > 0) && count < MAX_PARAMS) n[count++] = cur;
    first = count > 0 && n[0] > 0 ? n[0] : 1;

    switch (c) {
    case 'm':
        sgr(p, n, count);
        break;
    case 'H':
    case 'f':
        p->y = count > 0 && n[0] > 0 ? n[0] - 1 : 0;
        p->x = count > 1 && n[1] > 0 ? n[1] - 1 : 0;
        break;
    case 'C':
        p->x += first;
        break;
    case 'D':
        p->x -= first;
        if (p->x < 0) p->x = 0;
        break;
    case 'A':
        p->y -= first;
        if (p->y < 0) p->y = 0;
        break;
    case 'B':
        p->y += first;
        break;
    default:
        break;
    }
}

int ansi_draw(const char *path)
{
    FILE *f = fopen(path, "rb");
    Pen p;
    int c;

    if (f == NULL) return -1;
    scr_fill(0, 0, VIDEO_COLS, VIDEO_ROWS, ' ', 7, 0);
    p.x = p.y = 0;
    p.fg = 7;
    p.bg = 0;
    p.bold = p.blink = 0;

    while ((c = getc(f)) != EOF && c != 0x1A) {
        if (c == 0x1B) {
            int next = getc(f);

            if (next == '[') {
                csi(&p, f);
                continue;
            }
            if (next != EOF) ungetc(next, f);
        }
        if (c == '\r') {
            p.x = 0;
        } else if (c == '\n') {
            p.y++;
        } else {
            char glyph[2];

            if (p.x >= VIDEO_COLS) {
                p.x = 0;
                p.y++;
            }
            glyph[0] = (char)c;
            glyph[1] = '\0';
            if (c == 0) glyph[0] = ' ';
            scr_put(p.x, p.y, glyph, p.fg | (p.bold ? 8 : 0), p.bg | (p.blink ? 8 : 0));
            p.x++;
        }
    }
    fclose(f);
    return 0;
}

void scr_remap_mono(void)
{
    int x;
    int y;

    for (y = 0; y < VIDEO_ROWS; y++) {
        for (x = 0; x < VIDEO_COLS; x++) {
            unsigned attr = scr_cell(x, y) >> 8;

            scr_paint(x, y, 1, 1, mono_remap[attr & 15], mono_remap[attr >> 4]);
        }
    }
}
