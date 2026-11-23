/* SPDX-License-Identifier: MIT */
#include <stdio.h>
#include <string.h>

#include "ansi.h"
#include "log.h"
#include "roles.h"
#include "screens.h"
#include "video.h"

#define COL_MARK 2
#define COL_LABEL 5
#define COL_DOTS_END 22
#define COL_VALUE 24
#define VALUE_MAX 56
#define FIRST_ROW 4

#define C_RULE 2
#define C_OK 10
#define C_WARN 14

static const char *const labels[DETLOG_LINES] = {"Sound chip", "Mouse", "Program folder", "Settings", "Patches", "Log file"};

void detlog_begin(const char *version)
{
    char title[48];

    scr_fill(0, 0, VIDEO_COLS, VIDEO_ROWS, ' ', 7, 0);
    sprintf(title, "ReBeep Studio v%.20s", version);
    scr_ramp(COL_MARK, 1, title);
    scr_fill(COL_MARK, 2, 61, 1, '\xC4', C_RULE, 0);
    if (role_mono()) scr_remap_mono();
}

/* Fills `value` for line `n` and returns 1 for a check mark, 0 for a warning. */
static int line_value(const Detect *d, int n, char *value)
{
    switch (n) {
    case 0:
        if (d->chip == 3) strcpy(value, "OPL3 (YMF262) at 388h");
        else if (d->chip == 2) strcpy(value, "OPL2 (YM3812)");
        else strcpy(value, "none found at 388h");
        if (d->chip != 0 && d->card[0] != '\0') sprintf(value + strlen(value), ", %.30s", d->card);
        return d->chip != 0;
    case 1:
        strcpy(value, d->mouse ? "driver found" : "no driver");
        return d->mouse;
    case 2:
        strcpy(value, d->folder);
        return 1;
    case 3:
        if (d->cfg_state > 0) strcpy(value, "RBSTUDIO.CFG loaded");
        else if (d->cfg_state == 0) strcpy(value, "RBSTUDIO.CFG not found, using defaults");
        else strcpy(value, "RBSTUDIO.CFG could not be read, using defaults");
        return d->cfg_state > 0;
    case 4:
        if (!d->patches_ok) {
            strcpy(value, "could not be read");
            return 0;
        }
        sprintf(value, "%d factory, %d user, %d pack%s", d->factory, d->user, d->packs, d->packs == 1 ? "" : "s");
        return 1;
    default:
        if (d->log_ok) strcpy(value, d->log_path);
        else strcpy(value, "could not be written");
        return d->log_ok;
    }
}

void detlog_line(const Detect *d, int n)
{
    char value[100];
    int row = FIRST_ROW + n;
    int ok;
    int len = (int)strlen(labels[n]);

    if (n < 0 || n >= DETLOG_LINES) return;
    ok = line_value(d, n, value);
    value[VALUE_MAX] = '\0';

    scr_fill(0, row, VIDEO_COLS, 1, ' ', 7, 0);
    if (ok) scr_put(COL_MARK, row, "\xFB", C_OK, 0);
    else scr_put(COL_MARK, row, "!", C_WARN, 0);
    scr_put(COL_LABEL, row, labels[n], 7, 0);
    if (COL_LABEL + len + 1 <= COL_DOTS_END) {
        scr_fill(COL_LABEL + len + 1, row, COL_DOTS_END - (COL_LABEL + len + 1) + 1, 1, '.', 8, 0);
    }
    scr_put(COL_VALUE, row, value, 15, 0);
    if (role_mono()) scr_remap_mono();
    log_line("%s: %s%s", labels[n], value, ok ? "" : " (!)");
}
