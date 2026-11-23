/* SPDX-License-Identifier: MIT */
#include <string.h>

#include "ansi.h"
#include "log.h"
#include "roles.h"
#include "screens.h"
#include "video.h"

#define ITEM_X 6
#define ITEM_W 34
#define ITEM_ROW0 8
#define NOTE_X 28
#define ABOUT_X 46
#define ABOUT_W 28
#define ABOUT_ROW0 7
#define ABOUT_H 9

#define C_BAR 10
#define C_TITLE 14

typedef struct {
    const char *name;
    const char *note;
    const char *about[4];   /* rows 10, 11, 13 and 14 of the About box */
} Item;

static const Item items[MENU_ITEMS] = {
    {"Patch Editor", "", {"Design, hear and save", "your own OPL patches.", "Start from any factory", "or user patch."}},
    {"Game Profiles", "coming soon", {"Coming soon.", "", "", ""}},
    {"Settings", "coming soon", {"Coming soon.", "", "", ""}},
    {"Exit", "", {"Back to DOS.", "", "", ""}}
};

static const int about_rows[4] = {10, 11, 13, 14};

/* Without the art: the frame, the title and the two boxes the item rows and About text go into. */
static void plain_menu(void)
{
    scr_fill(0, 0, VIDEO_COLS, VIDEO_ROWS, ' ', 7, 0);
    scr_box(0, 0, VIDEO_COLS, VIDEO_ROWS, SCR_DOUBLE, 10, 0);
    scr_put(31, 3, "M A I N   M E N U", 15, 0);
    scr_box(5, 6, 36, 11, SCR_SINGLE, 2, 0);
    scr_put(8, 6, "Menu", 14, 0);
    scr_box(45, 6, 30, 11, SCR_SINGLE, 2, 0);
    scr_put(48, 6, "About", 14, 0);
    scr_put(16, 20, "\x18 \x19  move        Enter  select        Esc  exit", 7, 0);
}

void menu_select(int sel)
{
    int i;
    const Item *it = &items[sel];

    for (i = 0; i < MENU_ITEMS; i++) {
        int row = ITEM_ROW0 + 2 * i;
        int on = i == sel;
        int fg = on ? 0 : 7;

        scr_fill(ITEM_X, row, ITEM_W, 1, ' ', fg, on ? C_BAR : 0);
        if (on) scr_put(8, row, "\x10", 0, C_BAR);
        scr_put(10, row, items[i].name, fg, SCR_KEEP);
        scr_put(NOTE_X, row, items[i].note, on ? 0 : 8, SCR_KEEP);
    }

    scr_fill(ABOUT_X, ABOUT_ROW0, ABOUT_W, ABOUT_H, ' ', 7, 0);
    scr_put(ABOUT_X + 2, 8, it->name, C_TITLE, 0);
    for (i = 0; i < 4; i++) scr_put(ABOUT_X + 2, about_rows[i], it->about[i], 7, 0);
    if (role_mono()) scr_remap_mono();
}

void menu_draw(int sel)
{
    if (ansi_draw(ansi_art_path("MENU.ANS")) != 0) {
        log_line("MENU.ANS not found, plain menu");
        plain_menu();
    }
    menu_select(sel);
}

int menu_item_at(int x, int y)
{
    if (x < ITEM_X || x >= ITEM_X + ITEM_W || y < ITEM_ROW0 || (y - ITEM_ROW0) % 2 != 0) return -1;
    y = (y - ITEM_ROW0) / 2;
    return y < MENU_ITEMS ? y : -1;
}

void soon_draw(int item)
{
    int len = (int)strlen(items[item].name);

    scr_fill(0, 0, VIDEO_COLS, VIDEO_ROWS, ' ', 7, 0);
    scr_fill(0, 0, VIDEO_COLS, 1, ' ', 15, 2);
    scr_put(1, 0, "ReBeep", 15, 2);
    scr_put(9, 0, "\xAF", 15, 2);
    scr_put(12, 0, items[item].name, 15, 2);
    scr_box(1, 2, 78, 21, SCR_SINGLE, 2, 0);
    scr_put(40 - len / 2, 11, items[item].name, 14, 0);
    scr_put(34, 13, "Coming soon.", 7, 0);
    scr_fill(0, 24, VIDEO_COLS, 1, ' ', 0, 7);
    scr_put(1, 24, "Esc", 15, 2);
    scr_put(5, 24, "Menu", 0, 7);
    if (role_mono()) scr_remap_mono();
}
