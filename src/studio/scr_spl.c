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

/* Without the art: the name, the stamp and the prompt on a black screen. */
static void plain_splash(void)
{
    scr_fill(0, 0, VIDEO_COLS, VIDEO_ROWS, ' ', 7, 0);
    scr_put(34, 10, "r e B e e p", 10, 0);
    scr_put(31, 12, "1-bit beeps in :: fm voices out", 7, 0);
    scr_put(34, 22, "press any key", 7, 0);
}

void splash_draw(const char *version)
{
    char stamp[STAMP_CELLS + 1];
    int len;

    if (ansi_draw(ansi_art_path("SPLASH.ANS")) != 0) {
        log_line("SPLASH.ANS not found, plain splash");
        plain_splash();
    }
    sprintf(stamp, "v%.8s", version);
    len = (int)strlen(stamp);
    scr_fill(STAMP_FIRST, STAMP_ROW, STAMP_CELLS, 1, ' ', SCR_KEEP, SCR_KEEP);
    scr_ramp(STAMP_CENTRE - (len - 1) / 2, STAMP_ROW, stamp);
    if (role_mono()) scr_remap_mono();
}
