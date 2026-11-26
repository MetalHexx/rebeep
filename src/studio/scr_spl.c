/* SPDX-License-Identifier: MIT */
#include <stdio.h>
#include <string.h>

#include "ansi.h"
#include "log.h"
#include "roles.h"
#include "screens.h"
#include "video.h"

#define STAMP_ROW 16
#define STAMP_FIRST 56
#define STAMP_CELLS 9
#define STAMP_CENTRE 60

#define PROMPT_ROW 23    /* the art's "press any key" line, centred on column 60 like the rest */
#define PROMPT_FIRST 50
#define PROMPT_CELLS 22
#define PLAIN_X 34
#define PLAIN_ROW 22
#define PLAIN_CELLS 20

static int plain;   /* the splash drawn last had no art */

/* Without the art: the name, the stamp and the prompt on a black screen. */
static void plain_splash(void)
{
    scr_fill(0, 0, VIDEO_COLS, VIDEO_ROWS, ' ', 7, 0);
    scr_put(34, 10, "r e B e e p", 10, 0);
    scr_put(31, 12, "1-bit beeps in :: fm voices out", 7, 0);
    scr_put(PLAIN_X, PLAIN_ROW, "press any key", 7, 0);
}

static void draw_splash(const char *version, int quiet)
{
    char stamp[STAMP_CELLS + 1];
    int len;

    plain = ansi_draw(ansi_art_path("SPLASH.ANS")) != 0;
    if (plain) {
        if (!quiet) log_line("SPLASH.ANS not found, plain splash");
        plain_splash();
    }
    sprintf(stamp, "v%.8s", version);
    len = (int)strlen(stamp);
    scr_fill(STAMP_FIRST, STAMP_ROW, STAMP_CELLS, 1, ' ', SCR_KEEP, SCR_KEEP);
    scr_ramp(STAMP_CENTRE - (len - 1) / 2, STAMP_ROW, stamp);
    if (role_mono()) scr_remap_mono();
}

void splash_draw(const char *version)
{
    draw_splash(version, 0);
}

void splash_ready(const char *version)
{
    draw_splash(version, 1);
}

void splash_loading(int percent)
{
    char text[24];
    int len;

    sprintf(text, "Loading patches %d%%", percent);
    len = (int)strlen(text);
    if (plain) {
        scr_fill(PLAIN_X, PLAIN_ROW, PLAIN_CELLS, 1, ' ', 7, 0);
        scr_put(PLAIN_X, PLAIN_ROW, text, 7, 0);
    } else {
        scr_fill(PROMPT_FIRST, PROMPT_ROW, PROMPT_CELLS, 1, ' ', SCR_KEEP, SCR_KEEP);
        scr_ramp(STAMP_CENTRE - (len - 1) / 2, PROMPT_ROW, text);
    }
}
