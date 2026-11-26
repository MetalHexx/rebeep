/* The synth screen's envelope band in sixteenth blocks: the heights an operator's envelope draws (the mockup's envLevels
   rounded to 4 * lines - 1, worked out once and pinned here) in every column at 16 and 14 lines, the cells that carry them,
   and the half-block drawing kept for cards without the blocks. The slow attacks at 63 are where a 32-bit product would
   wrap. */
#include <string.h>

#include "testlib.h"
#include "../../src/studio/screens.h"
#include "../../src/studio/roles.h"
#include "../../src/studio/video.h"

#define ENV_X 24
#define ENV_W 55
#define BAND_Y 19
#define BAND_ROWS 4

typedef struct { int ar, dr, sl, rr, ol, sus; } Env;

static const Env SLOW = {1, 7, 6, 5, 63, 1};
static const Env MEDIUM = {5, 9, 3, 8, 63, 0};
static const Env FAST = {12, 5, 10, 4, 40, 1};
static const Env SILENT = {0, 7, 6, 5, 63, 1};

static const char *const HALF_GLYPH[BAND_ROWS] = {
    "    vv                                                 ",
    "  v^  ^^^^^^^^^^^^^^^^^^^vvv                           ",
    " v                          ^^vvv                      ",
    "v                                ^^^vv_________________"
};

static const char *const HALF_FG[BAND_ROWS] = {
    "8888AA8888888888888888888888888888888888888888888888888",
    "88AA22AAAAAAAAAAAAAAAAAAAAAA888888888888888888888888888",
    "8A22222222222222222222222222AAAAA8888888888888888888888",
    "A22222222222222222222222222222222AAAAA88888888888888888"
};

static const char *const HALF_BG[BAND_ROWS] = {
    "0000000000000000000000000000000000000000000000000000000",
    "0002222222222222222222222000000000000000000000000000000",
    "0022222222222222222222222222220000000000000000000000000",
    "0222222222222222222222222222222222220000000000000000000"
};


static const unsigned char SLOW_ATTACK[ENV_W] = {
    3, 7, 12, 17, 21, 25, 29, 32, 36, 39, 42, 45, 48, 50, 52, 54, 56, 58, 59, 60, 61, 62, 62, 63, 63,
    60, 57, 53, 50, 46, 43, 39, 35, 32, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    27, 24, 21, 19, 16
};

static const unsigned char MEDIUM_ATTACK[ENV_W] = {
    4, 10, 17, 22, 28, 33, 38, 42, 46, 50, 53, 55, 58, 59, 61, 62, 63, 63, 59, 55, 50, 45, 41, 36, 32,
    27, 23, 18, 14, 10, 6, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
};

static const unsigned char EGA_SLOW_ATTACK[ENV_W] = {
    2, 6, 11, 14, 18, 22, 25, 28, 31, 34, 37, 39, 42, 44, 46, 47, 49, 50, 51, 53, 53, 54, 55, 55, 55,
    53, 50, 46, 43, 40, 37, 34, 31, 28, 25, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24,
    24, 21, 19, 16, 14
};

static const unsigned char FAST_ATTACK[ENV_W] = {
    7, 20, 29, 36, 39, 40, 38, 36, 34, 33, 31, 29, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28, 26, 25, 23, 21, 20, 18, 16, 15, 13, 11, 9, 8, 6, 4, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0
};

/* The sample editor's patch (the one the reference screens show) with operator 2's envelope set to `env`, drawn. */
static void draw_with(const Env *env)
{
    Editor e;
    Op *op;

    sample_editor(&e, 4);
    op = &e.p.v4.op[e.cur];
    op->v[P_AR] = (unsigned char)env->ar;
    op->v[P_DR] = (unsigned char)env->dr;
    op->v[P_SL] = (unsigned char)env->sl;
    op->v[P_RR] = (unsigned char)env->rr;
    op->v[P_OL] = (unsigned char)env->ol;
    op->v[P_SUS] = (unsigned char)env->sus;
    synth_draw(&e);
}

/* The scanlines a cell lights, or -1 when it is none of the band's cells: ground (an underscore only on the bottom row),
   a whole cell of the body colour, or a block of the body colour over the ground. */
static int cell_lit(unsigned cell, int bottom, int lines)
{
    unsigned ch = cell & 0xFF;
    int fg = (cell >> 8) & 15;
    int bg = (cell >> 12) & 15;
    int k;

    if (ch == '_') return bottom && fg == role(R_DIM) && bg == role(R_GROUND) ? 0 : -1;
    if (ch == ' ') {
        if (bg == role(R_GROUND)) return 0;
        return fg == bg ? lines : -1;
    }
    for (k = 0; k < 15 && VIDEO_BLOCK[k] != ch; k++) {}
    if (k + 1 >= lines || bg != role(R_GROUND) || fg == bg) return -1;
    return k + 1;
}

/* The scanlines column `i` lights, or -1 when its cells are not a body: whole cells from the bottom, at most one block,
   then clear cells, and an underscore on the bottom row exactly when nothing is lit. */
static int column_height(int i, int lines)
{
    int total = 0;
    int rising = 1;
    int r;

    for (r = BAND_ROWS - 1; r >= 0; r--) {
        unsigned cell = scr_cell(ENV_X + i, BAND_Y + r);
        int lit = cell_lit(cell, r == BAND_ROWS - 1, lines);

        if (lit < 0 || (!rising && lit != 0)) return -1;
        if (lit != lines) rising = 0;
        total += lit;
    }
    if (total == 0 && (scr_cell(ENV_X + i, BAND_Y + BAND_ROWS - 1) & 0xFF) != '_') return -1;
    return total;
}

static void heights(const char *name, const Env *env, int lines, const unsigned char *want)
{
    int i;
    int bad = 0;
    int first = -1;

    t_case(name);
    video_set_block_lines(lines);
    draw_with(env);
    for (i = 0; i < ENV_W; i++) {
        if (column_height(i, lines) != want[i]) {
            bad++;
            if (first < 0) first = i;
        }
    }
    t_checkl(bad, 0, "columns that differ from the mockup's heights");
    if (bad != 0) t_checkl(column_height(first, lines), want[first], "the first differing column's height");
}

static void silent(void)
{
    int i;
    int ok = 1;

    t_case("a silent operator draws the ground and a dim underscore");
    video_set_block_lines(16);
    draw_with(&SILENT);
    for (i = 0; i < ENV_W; i++) {
        int r;

        for (r = 0; r < BAND_ROWS; r++) {
            unsigned cell = scr_cell(ENV_X + i, BAND_Y + r);
            unsigned want_ch = r == BAND_ROWS - 1 ? '_' : ' ';

            if ((cell & 0xFF) != want_ch || ((cell >> 12) & 15) != role(R_GROUND)) ok = 0;
            if (want_ch == '_' && ((cell >> 8) & 15) != role(R_DIM)) ok = 0;
        }
    }
    t_check(ok, "every column is ground, with the underscore on the bottom row");
}

static void blocks_only_in_the_band(void)
{
    int x;
    int y;
    int k;
    int bad = 0;

    t_case("the blocks stay inside the envelope band");
    video_set_block_lines(16);
    draw_with(&SLOW);
    for (y = 0; y < VIDEO_ROWS; y++) {
        for (x = 0; x < VIDEO_COLS; x++) {
            unsigned ch = scr_cell(x, y) & 0xFF;

            for (k = 0; k < 15; k++) {
                if (ch == VIDEO_BLOCK[k] && !(y >= BAND_Y && y < BAND_Y + BAND_ROWS && x >= ENV_X && x < ENV_X + ENV_W)) bad++;
            }
        }
    }
    t_checkl(bad, 0, "block glyphs outside the band");
}

static int hex(char c)
{
    return c <= '9' ? c - '0' : c - 'A' + 10;
}

/* The band, with the blocks off, is today's half-block drawing: the rim as the foreground of a half block. */
static void half_blocks(void)
{
    int r;
    int i;
    int bad = 0;

    t_case("without the blocks the band is the half-block drawing");
    video_set_block_lines(0);
    {
        Editor e;

        sample_editor(&e, 4);
        synth_draw(&e);
    }
    for (r = 0; r < BAND_ROWS; r++) {
        for (i = 0; i < ENV_W; i++) {
            unsigned cell = scr_cell(ENV_X + i, BAND_Y + r);
            char want = HALF_GLYPH[r][i];
            unsigned ch = want == 'v' ? 0xDC : want == '^' ? 0xDF : (unsigned)want;

            if ((cell & 0xFF) != ch || (int)((cell >> 12) & 15) != hex(HALF_BG[r][i])) bad++;
            else if (want != ' ' && (int)((cell >> 8) & 15) != hex(HALF_FG[r][i])) bad++;
        }
    }
    t_checkl(bad, 0, "cells that differ from the half-block band");
}

int main(void)
{
    role_set_mono(0);
    heights("16 lines: a slow attack at full level (AR 1, OL 63)", &SLOW, 16, SLOW_ATTACK);
    heights("16 lines: a medium attack at full level (AR 5, OL 63)", &MEDIUM, 16, MEDIUM_ATTACK);
    heights("16 lines: a fast attack with a release", &FAST, 16, FAST_ATTACK);
    heights("14 lines: heights top out at 55", &SLOW, 14, EGA_SLOW_ATTACK);
    silent();
    blocks_only_in_the_band();
    half_blocks();
    video_set_block_lines(0);
    return t_done();
}
