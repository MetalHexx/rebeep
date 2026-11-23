/* ReBeep Studio: the save prompt, a port of the mockup's gate(). SPDX-License-Identifier: MIT */
#include <stdio.h>
#include <string.h>

#include "roles.h"
#include "screens.h"
#include "video.h"

#define BOX_X0 17
#define BOX_X1 62
#define BOX_Y0 8
#define BOX_Y1 15
#define NAME_ROW 10
#define ASK_ROW 11
#define BTN_ROW 13
#define BTN_COUNT 4
#define BTN_GAP 2

static const char *const BTN_TEXT[BTN_COUNT] = {"Save", "Save As", "Discard", "Cancel"};

static int centered(int len, int width)
{
    int pad = (width - len) / 2;

    return pad < 0 ? 0 : pad;
}

/* The first column of each button: a space, the text, a space, and BTN_GAP cells between buttons, centred in the box. */
static void layout(int xs[BTN_COUNT])
{
    int total = BTN_GAP * (BTN_COUNT - 1);
    int x;
    int i;

    for (i = 0; i < BTN_COUNT; i++) total += (int)strlen(BTN_TEXT[i]) + 2;
    x = BOX_X0 + 1 + centered(total, BOX_X1 - BOX_X0 - 1);
    for (i = 0; i < BTN_COUNT; i++) {
        xs[i] = x;
        x += (int)strlen(BTN_TEXT[i]) + 2 + BTN_GAP;
    }
}

static const char *question(int where)
{
    switch (where) {
    case EL_LIST: return "Save it before you open the patch list?";
    case EL_PREV: return "Save it before the previous patch?";
    case EL_NEXT: return "Save it before the next patch?";
    default: return "Save it before you leave?";
    }
}

static void centre_line(int y, const char *text)
{
    scr_put(BOX_X0 + 1 + centered((int)strlen(text), BOX_X1 - BOX_X0 - 1), y, text, role(R_WINDOWTEXT), SCR_KEEP);
}

void save_draw(const Editor *e)
{
    int xs[BTN_COUNT];
    char line[24];
    int i;

    dim_under();
    window_draw(BOX_X0, BOX_Y0, BOX_X1, BOX_Y1, "Unsaved changes", NULL);
    sprintf(line, "\"%.8s\" is not saved.", e->p.name);
    centre_line(NAME_ROW, line);
    centre_line(ASK_ROW, question(e->pend - 1));

    layout(xs);
    for (i = 0; i < BTN_COUNT; i++) {
        int focused = i == e->btn;
        int bg = role(focused ? R_FOCUS : R_BUTTON);
        char first[2];
        char rest[10];

        first[0] = BTN_TEXT[i][0];
        first[1] = '\0';
        sprintf(rest, "%s ", BTN_TEXT[i] + 1);
        scr_put(xs[i], BTN_ROW, " ", SCR_KEEP, bg);
        scr_put(xs[i] + 1, BTN_ROW, first, role(focused ? R_FOCUSTEXT : R_LIT), bg);
        scr_put(xs[i] + 2, BTN_ROW, rest, role(focused ? R_FOCUSTEXT : R_VALUE), bg);
    }
}

int save_hit(int x, int y)
{
    int xs[BTN_COUNT];
    int i;

    if (x < BOX_X0 || x > BOX_X1 || y < BOX_Y0 || y > BOX_Y1) return -1;
    if (y != BTN_ROW) return BTN_COUNT;
    layout(xs);
    for (i = 0; i < BTN_COUNT; i++) {
        if (x >= xs[i] && x < xs[i] + (int)strlen(BTN_TEXT[i]) + 2) return i;
    }
    return BTN_COUNT;
}
