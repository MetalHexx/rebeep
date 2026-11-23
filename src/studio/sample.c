/* SPDX-License-Identifier: MIT */
#include <string.h>

#include "roles.h"
#include "screens.h"

#define SAMPLE_VERSION "0.1.0"

/* The patch list sample: three folders, USER\BELL selected. */
static const struct {
    const char *folder;
    const char *name;
    unsigned char has4, octave, overrides;
} list_rows[] = {
    {"FACTORY", "BELL", 0, 4, 0}, {"FACTORY", "BRASS", 0, 4, 0}, {"FACTORY", "FLUTE", 0, 4, 0},
    {"FACTORY", "ORGAN", 0, 4, 0}, {"USER", "BELL", 1, 5, 1}, {"USER", "MYLEAD", 1, 3, 0},
    {"USER", "SLAPBASS", 0, 4, 0}, {"HEXX", "ELEC_GTR", 0, 4, 0}, {"HEXX", "ORGAN", 0, 4, 0}
};
#define LIST_SAMPLE_ROWS ((int)(sizeof list_rows / sizeof list_rows[0]))
#define LIST_SAMPLE_SELECTED 4

/* BRASS as the mockup's first sample patch: 4-OP then 2-OP operators in the P_* order. */
static const unsigned char brass4[4][P_COUNT] = {
    {10, 4, 11, 6, 38, 1, 1, 0, 0, 1, 1, 0}, {11, 3, 13, 7, 60, 0, 1, 0, 0, 1, 1, 0},
    {9, 5, 10, 7, 30, 2, 2, 2, 0, 1, 1, 1}, {12, 2, 14, 7, 56, 1, 1, 0, 0, 1, 1, 0}
};
static const unsigned char brass2[2][P_COUNT] = {
    {10, 4, 11, 6, 40, 1, 1, 1, 0, 1, 1, 0}, {12, 3, 13, 7, 61, 0, 1, 0, 0, 1, 1, 0}
};

const char *sample_version(void)
{
    return SAMPLE_VERSION;
}

void sample_detect(Detect *d)
{
    memset(d, 0, sizeof *d);
    d->chip = 3;
    strcpy(d->card, "Sound Blaster 16");
    d->mouse = 1;
    strcpy(d->folder, "C:\\REBEEP");
    d->cfg_state = 0;
    d->factory = 4;
    d->user = 3;
    d->packs = 1;
    d->patches_ok = 1;
    d->log_ok = 1;
    strcpy(d->log_path, "C:\\REBEEP\\RBSTUDIO.LOG");
}

/* Patch 12 of 40, BRASS with operator 2's Attack Rate edited (so the * shows), operator 2's Attack Rate in focus, an
   OPL3, C4 and G4 held, no message. */
void sample_editor(Editor *e, int variant)
{
    int k;

    memset(e, 0, sizeof *e);
    strcpy(e->p.name, "BRASS");
    e->p.octave = 4;
    e->p.has4 = 1;
    e->p.v4.conn = 2;
    e->p.v4.fb = 5;
    e->p.v2.conn = 0;
    e->p.v2.fb = 5;
    for (k = 0; k < 4; k++) memcpy(e->p.v4.op[k].v, brass4[k], P_COUNT);
    for (k = 0; k < 2; k++) memcpy(e->p.v2.op[k].v, brass2[k], P_COUNT);
    e->p.v4.op[1].v[P_AR] = 12;
    e->n = variant;
    e->chip = 3;
    e->fk = P_AR;
    e->cur = 1;
    e->lastP = P_AR;
    e->dirty = 1;
    e->pos = 12;
    e->total = 40;
    e->held[0] = 12;
    e->held[1] = 19;
    e->nheld = 2;
    e->kbOct = KB_LOW;
    e->msgRole = R_TEXT;
}

static void sample_list(void)
{
    static Library lib;
    static Entry rows[LIST_SAMPLE_ROWS];
    int i;

    for (i = 0; i < LIST_SAMPLE_ROWS; i++) {
        strcpy(rows[i].folder, list_rows[i].folder);
        strcpy(rows[i].name, list_rows[i].name);
        rows[i].has4 = list_rows[i].has4;
        rows[i].octave = list_rows[i].octave;
        rows[i].overrides = list_rows[i].overrides;
    }
    lib.entries = rows;
    lib.count = LIST_SAMPLE_ROWS;
    list_draw(&lib, LIST_SAMPLE_SELECTED, 0, NULL);
}

static const char *const SAMPLE_SCREENS[] = {
    "detectlog", "splash", "menu", "patchlist", "synth-4op", "synth-2op", "help1-4op", "help2-4op", "help1-2op",
    "help2-2op", "save-4op", "save-2op"
};

int sample_known(const char *screen)
{
    int i;

    for (i = 0; i < (int)(sizeof SAMPLE_SCREENS / sizeof SAMPLE_SCREENS[0]); i++) {
        if (stricmp(screen, SAMPLE_SCREENS[i]) == 0) return 1;
    }
    return 0;
}

/* A help or save screen name is "<what>[page]-<variant>": the page digit and the variant's operator count. */
static void sample_overlay(const char *screen)
{
    Editor e;
    char detected[48];
    int variant = screen[strlen(screen) - 3] == '4' ? 4 : 2;

    sample_editor(&e, variant);
    synth_draw(&e);
    if (strnicmp(screen, "save", 4) == 0) {
        e.prompt = 1;
        e.pend = EL_NEXT + 1;
        save_draw(&e);
    } else {
        help_detected(detected, sizeof detected, 3, "Sound Blaster 16 at 220h");
        help_draw(screen[4] - '0', detected, "C:\\REBEEP\\RBSTUDIO.LOG");
    }
}

void sample_draw(const char *screen)
{
    if (stricmp(screen, "detectlog") == 0) {
        Detect d;
        int i;

        sample_detect(&d);
        detlog_begin(SAMPLE_VERSION);
        for (i = 0; i < DETLOG_LINES; i++) detlog_line(&d, i);
    } else if (stricmp(screen, "splash") == 0) {
        splash_draw(SAMPLE_VERSION);
    } else if (stricmp(screen, "menu") == 0) {
        menu_draw(MENU_PATCHES);
    } else if (stricmp(screen, "patchlist") == 0) {
        sample_list();
    } else if (stricmp(screen, "synth-4op") == 0 || stricmp(screen, "synth-2op") == 0) {
        Editor e;

        sample_editor(&e, stricmp(screen, "synth-4op") == 0 ? 4 : 2);
        synth_draw(&e);
    } else {
        sample_overlay(screen);
    }
}
