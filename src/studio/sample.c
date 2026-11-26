/* SPDX-License-Identifier: MIT */
#include <malloc.h>
#include <stdio.h>
#include <string.h>

#include "roles.h"
#include "screens.h"

#define SAMPLE_VERSION "0.1.0"
#define SPLASH_SAMPLE_PERCENT 45

/* The patch list sample's first nine rows: three folders, USER\BELL selected in the All view. */
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
    d->banks = 1;
    d->patches_ok = 1;
    d->log_ok = 1;
    strcpy(d->log_path, "C:\\REBEEP\\RBSTUDIO.LOG");
}

/* FACTORY\BRASS, 2 of 4 in its bank and 2 of 9 in the list, with operator 2's Attack Rate edited (so the * shows),
   operator 2's Attack Rate in focus, an OPL3, C4 and G4 held, no message. */
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
    strcpy(e->folder, "FACTORY");
    strcpy(e->file, "BRASS");
    e->pos = 2;
    e->total = LIST_SAMPLE_ROWS;
    e->bpos = 2;
    e->btotal = 4;
    e->held[0] = 12;
    e->held[1] = 19;
    e->nheld = 2;
    e->msgRole = R_TEXT;
}

#define LAB_COUNT 6
#define KQ4_COUNT 45
#define SQ1_COUNT 96
#define LIST_SAMPLE_TOTAL (LIST_SAMPLE_ROWS + KQ4_COUNT + LAB_COUNT + SQ1_COUNT)

static const char *const lab_names[LAB_COUNT] = {"BELL", "BELL-2", "DRUMS-1", "JAZZELEC", "POKEMON", "SUBBASS"};

static void put_entry(Entry __far *out, const char *folder, const char *name, int has4, int octave, int overrides)
{
    Entry en;

    memset(&en, 0, sizeof en);
    strcpy(en.folder, folder);
    strcpy(en.name, name);
    en.has4 = (unsigned char)has4;
    en.octave = (unsigned char)octave;
    en.overrides = (unsigned char)overrides;
    *out = en;
}

/* The sample library, built into a far block: the nine rows above, then the banks KQ4, LAB and SQ1 (the lab set's
   files: TKQ4-000, TKQ4-002, TKQ4-005 to 047; six named patches; TSQ1-000 to 095), 2-op at octave 4. Returns NULL when
   memory runs out. */
static Entry __far *sample_entries(void)
{
    Entry __far *rows = (Entry __far *)_fmalloc(sizeof(Entry) * LIST_SAMPLE_TOTAL);
    char name[9];
    int at = 0;
    int i;

    if (rows == NULL) return NULL;
    for (i = 0; i < LIST_SAMPLE_ROWS; i++, at++) {
        put_entry(&rows[at], list_rows[i].folder, list_rows[i].name, list_rows[i].has4, list_rows[i].octave,
                  list_rows[i].overrides);
    }
    for (i = 0; i < KQ4_COUNT; i++, at++) {
        sprintf(name, "TKQ4-%03d", i < 2 ? i * 2 : i + 3);
        put_entry(&rows[at], "KQ4", name, 0, 4, 0);
    }
    for (i = 0; i < LAB_COUNT; i++, at++) put_entry(&rows[at], "LAB", lab_names[i], 0, 4, 0);
    for (i = 0; i < SQ1_COUNT; i++, at++) {
        sprintf(name, "TSQ1-%03d", i);
        put_entry(&rows[at], "SQ1", name, 0, 4, 0);
    }
    return rows;
}

/* The patch list: the All view with USER\BELL selected, or (`bank`) the bank view of KQ4 with its first patch. */
static void sample_list(int bank)
{
    Library lib;
    int sel;
    int view = 0;

    memset(&lib, 0, sizeof lib);
    lib.entries = sample_entries();
    if (lib.entries == NULL) return;
    lib.count = LIST_SAMPLE_TOTAL;
    lib.cap = LIST_SAMPLE_TOTAL;
    sel = lib_find(&lib, bank ? "KQ4\\TKQ4-000" : "USER\\BELL");
    if (bank) view = list_view_back(&lib, 1, sel);
    list_draw(&lib, view, sel, list_scroll(&lib, view, sel, 0), NULL);
    lib_free(&lib);
}

static const char *const SAMPLE_SCREENS[] = {
    "detectlog", "splash", "splash-load", "menu", "patchlist", "patchlist-bank", "synth-4op", "synth-2op", "help1-4op", "help2-4op", "help1-2op",
    "help2-2op", "save-4op", "save-2op", "savedlg-4op"
};

int sample_known(const char *screen)
{
    int i;

    for (i = 0; i < (int)(sizeof SAMPLE_SCREENS / sizeof SAMPLE_SCREENS[0]); i++) {
        if (stricmp(screen, SAMPLE_SCREENS[i]) == 0) return 1;
    }
    return 0;
}

/* The Save dialog's first state for FACTORY\BRASS: the name, the bank USER, and the three lines it works out. */
static void sample_dialog(Editor *e)
{
    SaveDlg *d = &e->dlg;

    e->dialog = 1;
    strcpy(d->name, "BRASS");
    strcpy(d->folder, "USER");
    d->banks = 1;
    d->nsay = 3;
    d->ok = 1;
    d->say[0].mark = ' ';
    strcpy(d->say[0].label, "New patch:");
    strcpy(d->say[0].value, "USER\\BRASS.RBP");
    d->say[1].mark = '!';
    strcpy(d->say[1].label, "Overrides:");
    strcpy(d->say[1].value, "FACTORY\\BRASS");
    d->say[2].mark = ' ';
    strcpy(d->say[2].label, "In games:");
    strcpy(d->say[2].value, "/P:BRASS");
}

/* A help, save or Save dialog screen name is "<what>[page]-<variant>": the page digit and the variant's operator count. */
static void sample_overlay(const char *screen)
{
    Editor e;
    char detected[48];
    int variant = screen[strlen(screen) - 3] == '4' ? 4 : 2;

    sample_editor(&e, variant);
    synth_draw(&e);
    if (strnicmp(screen, "savedlg", 7) == 0) {
        sample_dialog(&e);
        dialog_draw(&e);
    } else if (strnicmp(screen, "save", 4) == 0) {
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
    } else if (stricmp(screen, "splash-load") == 0) {
        splash_draw(SAMPLE_VERSION);
        splash_loading(SPLASH_SAMPLE_PERCENT);
    } else if (stricmp(screen, "menu") == 0) {
        menu_draw(MENU_PATCHES);
    } else if (stricmp(screen, "patchlist") == 0 || stricmp(screen, "patchlist-bank") == 0) {
        sample_list(stricmp(screen, "patchlist-bank") == 0);
    } else if (stricmp(screen, "synth-4op") == 0 || stricmp(screen, "synth-2op") == 0) {
        Editor e;

        sample_editor(&e, stricmp(screen, "synth-4op") == 0 ? 4 : 2);
        synth_draw(&e);
    } else {
        sample_overlay(screen);
    }
}
