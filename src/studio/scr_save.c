/* ReBeep Studio: the unsaved-changes prompt and the Save dialog, ports of the mockup's gate() and saveBox().
   SPDX-License-Identifier: MIT */
#include <stdio.h>
#include <string.h>

#include "roles.h"
#include "screens.h"
#include "video.h"

#define BOX_X0 17
#define BOX_X1 62
#define BOX_Y0 8
#define BOX_Y1 14
#define NAME_ROW 10
#define BTN_ROW 12
#define BTN_COUNT 3
#define BTN_GAP 2

static const char *const BTN_TEXT[BTN_COUNT] = {"Save", "Discard", "Cancel"};

static int centered(int len, int width)
{
    int pad = (width - len) / 2;

    return pad < 0 ? 0 : pad;
}

/* The first column of each button: a space, the text, a space, and BTN_GAP cells after each button (the last one too, as
   the mockup centres them), centred in the box. */
static void layout(int xs[BTN_COUNT])
{
    int total = BTN_GAP * BTN_COUNT;
    int x;
    int i;

    for (i = 0; i < BTN_COUNT; i++) total += (int)strlen(BTN_TEXT[i]) + 2;
    x = BOX_X0 + 1 + centered(total, BOX_X1 - BOX_X0 - 1);
    for (i = 0; i < BTN_COUNT; i++) {
        xs[i] = x;
        x += (int)strlen(BTN_TEXT[i]) + 2 + BTN_GAP;
    }
}

void save_draw(const Editor *e)
{
    int xs[BTN_COUNT];
    char line[24];
    int i;

    dim_under();
    window_draw(BOX_X0, BOX_Y0, BOX_X1, BOX_Y1, "Unsaved changes", NULL);
    sprintf(line, "\"%.8s\" is not saved.", e->p.name);
    scr_put(BOX_X0 + 1 + centered((int)strlen(line), BOX_X1 - BOX_X0 - 1), NAME_ROW, line, role(R_WINDOWTEXT), SCR_KEEP);

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

#define DLG_X0 12
#define DLG_X1 67
#define DLG_Y0 7
#define DLG_Y1 18
#define DLG_LABEL_X 15
#define DLG_FIELD_X 24
#define DLG_FIELD_W 9   /* eight characters and a cursor cell */
#define DLG_NAME_ROW 9
#define DLG_BANK_ROW 10
#define DLG_BANK_PREV_X 22
#define DLG_BANK_NEXT_X 34
#define DLG_HINT_X 36
#define DLG_SAY_ROW 12
#define DLG_SAY_MARK_X 15
#define DLG_SAY_LABEL_X 17
#define DLG_SAY_VALUE_X 29
#define DLG_BTN_ROW 16
#define DLG_BTN_GAP 3

static const char DLG_FOOT[] = " \x18\x19 field   \x11 \x10 bank   Enter saves   Esc cancels ";

/* A field: eight characters and a cursor cell; the focused one takes the focus colours and, while it takes text, shows
   the cursor. */
static void field_draw(int y, const char *text, int focused, int typing)
{
    char cells[DLG_FIELD_W + 1];

    sprintf(cells, "%-*s", DLG_FIELD_W, text);
    scr_put(DLG_FIELD_X, y, cells, role(focused ? R_FOCUSTEXT : R_VALUE), role(focused ? R_FOCUS : R_BUTTON));
    if (focused && typing && strlen(text) < DLG_FIELD_W - 1) {
        scr_put(DLG_FIELD_X + (int)strlen(text), y, "_", role(R_FOCUSTEXT), SCR_KEEP);
    }
}

/* The buttons' first columns: Save, then Cancel, centred in the window as the mockup does. */
static void dlg_buttons(int xs[2])
{
    xs[0] = DLG_X0 + 1 + centered(6 + 8 + DLG_BTN_GAP, DLG_X1 - DLG_X0 - 1);
    xs[1] = xs[0] + 6 + DLG_BTN_GAP;
}

void dialog_draw(const Editor *e)
{
    const SaveDlg *d = &e->dlg;
    int is_new = d->bank == d->banks + 1;
    const char *hint = d->bank == 0 ? "default" : is_new ? "new bank" : "existing bank";
    int xs[2];
    int i;

    dim_under();
    window_draw(DLG_X0, DLG_Y0, DLG_X1, DLG_Y1, "Save", NULL);
    scr_put(DLG_X0 + 1 + centered((int)strlen(DLG_FOOT), DLG_X1 - DLG_X0 - 1), DLG_Y1, DLG_FOOT, role(R_WINDOWACCENT),
            role(R_WINDOW));

    scr_put(DLG_LABEL_X, DLG_NAME_ROW, "Name", role(R_WINDOWTEXT), SCR_KEEP);
    field_draw(DLG_NAME_ROW, d->name, d->field == 0, 1);
    scr_put(DLG_LABEL_X, DLG_BANK_ROW, "Bank", role(R_WINDOWTEXT), SCR_KEEP);
    scr_put(DLG_BANK_PREV_X, DLG_BANK_ROW, "\x11", role(R_WINDOWACCENT), SCR_KEEP);
    field_draw(DLG_BANK_ROW, is_new ? d->newbank : d->folder, d->field == 1, is_new);
    scr_put(DLG_BANK_NEXT_X, DLG_BANK_ROW, "\x10", role(R_WINDOWACCENT), SCR_KEEP);
    scr_put(DLG_HINT_X, DLG_BANK_ROW, hint, role(R_WINDOWTEXT), SCR_KEEP);

    for (i = 0; i < d->nsay; i++) {
        const SayLine *l = &d->say[i];
        int colour = role(l->mark == '!' ? R_WARNING : R_WINDOWTEXT);

        if (l->mark == '!') scr_put(DLG_SAY_MARK_X, DLG_SAY_ROW + i, "!", colour, SCR_KEEP);
        scr_put(DLG_SAY_LABEL_X, DLG_SAY_ROW + i, l->label, colour, SCR_KEEP);
        if (l->value[0] != '\0') scr_put(DLG_SAY_VALUE_X, DLG_SAY_ROW + i, l->value, colour, SCR_KEEP);
    }

    dlg_buttons(xs);
    scr_put(xs[0], DLG_BTN_ROW, " Save ", role(d->ok ? R_FOCUSTEXT : R_TEXT), role(d->ok ? R_FOCUS : R_BUTTON));
    scr_put(xs[1], DLG_BTN_ROW, " Cancel ", role(R_VALUE), role(R_BUTTON));
}

int dialog_hit(int x, int y)
{
    int xs[2];

    if (x < DLG_X0 || x > DLG_X1 || y < DLG_Y0 || y > DLG_Y1) return DH_OUT;
    dlg_buttons(xs);
    if (y == DLG_NAME_ROW && x >= DLG_FIELD_X && x < DLG_FIELD_X + DLG_FIELD_W) return DH_NAME;
    if (y == DLG_BANK_ROW) {
        if (x == DLG_BANK_PREV_X) return DH_LEFT;
        if (x == DLG_BANK_NEXT_X) return DH_RIGHT;
        if (x >= DLG_FIELD_X && x < DLG_FIELD_X + DLG_FIELD_W) return DH_BANK;
    }
    if (y == DLG_BTN_ROW) {
        if (x >= xs[0] && x < xs[0] + 6) return DH_SAVE;
        if (x >= xs[1] && x < xs[1] + 8) return DH_CANCEL;
    }
    return DH_NONE;
}
