/* The patch list over a synthetic library: the scroll window and the row hit-test in All and in a bank view (heading
   rules count as lines in All, the selection stays in view, a bank's first entry brings its heading), the keys' moves,
   the view stepping and the selection a switch keeps, the back-from-the-editor rule, the switcher in the top border, and
   the override text for the longest name the library allows. */
#include <string.h>

#include "testlib.h"
#include "../../src/studio/keys.h"
#include "../../src/studio/screens.h"
#include "../../src/studio/video.h"

#define FIRST_ROW 4

static Library lib;
static Entry rows[40];

/* Folders FACTORY (4), USER (10), BANK (16): 30 entries on 33 lines in All, entry 14 the first of BANK (line 17, its
   heading on line 16); the views are All 0, FACTORY 1, USER 2, BANK 3. */
static void build(int factory, int user, int bank)
{
    int i = 0;
    int k;

    memset(rows, 0, sizeof rows);
    for (k = 0; k < factory; k++, i++) strcpy(rows[i].folder, "FACTORY");
    for (k = 0; k < user; k++, i++) strcpy(rows[i].folder, "USER");
    for (k = 0; k < bank; k++, i++) strcpy(rows[i].folder, "BANK");
    for (k = 0; k < i; k++) rows[k].name[0] = (char)('A' + k % 26);
    lib.entries = rows;
    lib.count = i;
}

static char cell_char(int x, int y)
{
    return (char)(scr_cell(x, y) & 0xFF);
}

/* Does the text drawn along row `y` from `x` equal `want`? */
static int row_is(int x, int y, const char *want)
{
    for (; *want != '\0'; want++, x++) {
        if (cell_char(x, y) != *want) return 0;
    }
    return 1;
}

int main(void)
{
    int sel;
    int top;
    int ok;

    t_case("a list that fits never scrolls");
    build(3, 4, 2);   /* 9 entries and 3 headings: 12 lines, the whole body */
    ok = 1;
    for (sel = 0; sel < lib.count; sel++) ok = ok && list_scroll(&lib, 0, sel, 0) == 0;
    t_check(ok, "top stays 0 for every selection");

    t_case("an empty list");
    build(0, 0, 0);
    t_checkl(list_scroll(&lib, 0, 0, 5), 0, "top 0");
    t_checkl(list_item_at(&lib, 0, 0, 10, FIRST_ROW), -1, "no row");

    t_case("the selection scrolls into view");
    build(4, 10, 16);
    t_checkl(list_scroll(&lib, 0, 0, 0), 0, "first entry, heading above it");
    t_checkl(list_scroll(&lib, 0, 10, 0), 1, "entry 10 is on line 12: one line down");
    t_checkl(list_scroll(&lib, 0, 29, 0), 21, "the last entry puts the end of the list at the bottom");
    t_checkl(list_scroll(&lib, 0, 29, 99), 21, "a top past the end is pulled back");
    t_checkl(list_scroll(&lib, 0, 5, 21), 7, "going back up puts the entry on the top line");

    t_case("a bank's first entry brings its heading");
    t_checkl(list_scroll(&lib, 0, 14, 21), 16, "BANK's heading is line 16, its first entry line 17");
    t_checkl(list_scroll(&lib, 0, 4, 12), 5, "USER's first entry from below: heading line 5");
    t_checkl(list_scroll(&lib, 0, 14, 16), 16, "already in view: top stays");

    t_case("the window holds still while the selection moves inside it");
    top = 9;
    ok = 1;
    for (sel = 7; sel <= 17; sel++) ok = ok && list_scroll(&lib, 0, sel, top) == top;
    t_check(ok, "entries 7 to 17 lie on lines 9 to 20, the whole window");

    t_case("a click's row maps to its entry");
    t_checkl(list_item_at(&lib, 0, 16, 10, FIRST_ROW), -1, "a heading rule is no entry");
    t_checkl(list_item_at(&lib, 0, 16, 10, FIRST_ROW + 1), 14, "the line after the heading is BANK's first entry");
    t_checkl(list_item_at(&lib, 0, 16, 10, FIRST_ROW + 11), 24, "the last visible line");
    t_checkl(list_item_at(&lib, 0, 16, 10, FIRST_ROW + 12), -1, "below the body");
    t_checkl(list_item_at(&lib, 0, 16, 10, FIRST_ROW - 1), -1, "above the body");
    t_checkl(list_item_at(&lib, 0, 0, 1, FIRST_ROW + 1), -1, "the frame's left edge");
    t_checkl(list_item_at(&lib, 0, 0, 78, FIRST_ROW + 1), -1, "the frame's right edge");
    t_checkl(list_item_at(&lib, 0, 0, 2, FIRST_ROW + 1), 0, "the first column inside the frame");
    t_checkl(list_item_at(&lib, 0, 0, 77, FIRST_ROW + 1), 0, "the last column inside the frame");

    t_case("the hit test agrees with counting the lines, in All");
    ok = 1;
    {
        int line_of[40];
        int line = 0;
        int e;
        int y;

        for (e = 0; e < lib.count; e++) {
            if (e == 0 || strcmp(rows[e].folder, rows[e - 1].folder) != 0) line++;
            line_of[e] = line++;
        }
        for (top = 0; top <= line - 12; top++) {
            for (y = 0; y < 12; y++) {
                int want = -1;

                for (e = 0; e < lib.count; e++) {
                    if (line_of[e] == top + y) want = e;
                }
                if (list_item_at(&lib, 0, top, 10, FIRST_ROW + y) != want) ok = 0;
            }
        }
    }
    t_check(ok, "every row of every window maps to the entry on that line, none for a heading");
    t_checkl(list_item_at(&lib, 0, 0, 10, FIRST_ROW), -1, "line 0 is FACTORY's heading");
    t_checkl(list_item_at(&lib, 0, 0, 10, FIRST_ROW + 4), 3, "FACTORY's last entry");
    t_checkl(list_item_at(&lib, 0, 0, 10, FIRST_ROW + 5), -1, "USER's heading");
    t_checkl(list_item_at(&lib, 0, 0, 10, FIRST_ROW + 6), 4, "USER's first entry, across the boundary");
    t_checkl(list_item_at(&lib, 0, 21, 10, FIRST_ROW + 11), 29, "the last line of the list");

    t_case("a bank view lists its bank's range with no heading line");
    t_checkl(list_views(&lib), 4, "All and three banks");
    t_checkl(list_item_at(&lib, 2, 0, 10, FIRST_ROW), 4, "USER's first entry is on the first row");
    t_checkl(list_item_at(&lib, 2, 0, 10, FIRST_ROW + 9), 13, "its last entry");
    t_checkl(list_item_at(&lib, 2, 0, 10, FIRST_ROW + 10), -1, "below the last entry");
    t_checkl(list_item_at(&lib, 3, 4, 10, FIRST_ROW), 18, "BANK scrolled four lines");
    t_checkl(list_item_at(&lib, 3, 4, 10, FIRST_ROW + 11), 29, "BANK's last line");
    t_checkl(list_scroll(&lib, 2, 13, 0), 0, "ten entries fit the body");
    t_checkl(list_scroll(&lib, 3, 29, 0), 4, "BANK's last entry puts the end at the bottom");
    t_checkl(list_scroll(&lib, 3, 14, 4), 0, "its first entry is line 0: no heading above it");
    t_checkl(list_scroll(&lib, 3, 20, 0), 0, "entry 20 is line 6: inside the first window");
    t_checkl(list_scroll(&lib, 3, 3, 0), 0, "a selection outside the view is taken as the view's first");

    t_case("PgUp, PgDn, Home and End");
    t_checkl(list_move(&lib, 0, 5, LIST_HOME), 0, "Home goes to the first patch");
    t_checkl(list_move(&lib, 0, 5, LIST_END), 29, "End goes to the last");
    t_checkl(list_move(&lib, 2, 5, LIST_HOME), 4, "Home in a bank: its first");
    t_checkl(list_move(&lib, 2, 5, LIST_END), 13, "End in a bank: its last");
    t_checkl(list_move(&lib, 0, 0, LIST_UP), 0, "Up at the top stays");
    t_checkl(list_move(&lib, 0, 29, LIST_DOWN), 29, "Down at the end stays");
    t_checkl(list_move(&lib, 2, 4, LIST_UP), 4, "Up at a bank's first stays in the bank");
    t_checkl(list_move(&lib, 2, 13, LIST_DOWN), 13, "Down at a bank's last stays in the bank");
    t_checkl(list_move(&lib, 0, 3, LIST_DOWN), 4, "Down crosses into the next bank in All");
    t_checkl(list_move(&lib, 0, 0, LIST_PGDN), 11, "PgDn is a screenful of lines: entry 0 is line 1, line 13 is entry 11");
    t_checkl(list_move(&lib, 0, 3, LIST_PGDN), 14, "PgDn onto a heading line gives that bank's first entry");
    t_checkl(list_move(&lib, 0, 22, LIST_PGDN), 29, "PgDn near the end stops at the last");
    t_checkl(list_move(&lib, 0, 29, LIST_PGDN), 29, "PgDn at the end stays");
    t_checkl(list_move(&lib, 0, 29, LIST_PGUP), 17, "PgUp is a screenful back");
    t_checkl(list_move(&lib, 0, 14, LIST_PGUP), 4, "PgUp onto USER's heading gives USER's first");
    t_checkl(list_move(&lib, 0, 5, LIST_PGUP), 0, "PgUp near the top stops at the first");
    t_checkl(list_move(&lib, 0, 0, LIST_PGUP), 0, "PgUp at the top stays");
    t_checkl(list_move(&lib, 3, 14, LIST_PGDN), 26, "PgDn in a bank moves twelve entries");
    t_checkl(list_move(&lib, 3, 26, LIST_PGDN), 29, "and stops at the bank's last");
    t_checkl(list_move(&lib, 3, 29, LIST_PGUP), 17, "PgUp in a bank moves twelve back");
    t_checkl(list_move(&lib, 3, 14, LIST_PGUP), 14, "and stops at the bank's first");
    t_checkl(list_move(&lib, 2, 4, LIST_PGDN), 13, "PgDn in a short bank goes to its last");

    t_case("the views step, wrapping, and only banks with patches are views");
    t_checkl(list_view_step(&lib, 0, 1), 1, "Right from All is the first bank");
    t_checkl(list_view_step(&lib, 3, 1), 0, "Right from the last bank wraps to All");
    t_checkl(list_view_step(&lib, 0, -1), 3, "Left from All wraps to the last bank");
    t_checkl(list_view_step(&lib, 2, -1), 1, "Left steps back");
    build(3, 0, 2);
    t_checkl(list_views(&lib), 3, "an empty USER is no view");
    t_checkl(list_view_step(&lib, 1, 1), 2, "Right from FACTORY is the next bank with patches");
    t_checkl(list_view_step(&lib, 2, -1), 1, "and back");
    build(0, 0, 0);
    t_checkl(list_views(&lib), 1, "an empty library has All only");
    t_checkl(list_view_step(&lib, 0, 1), 0, "which wraps to itself");
    t_checkl(list_view_pick(&lib, 0, 0), 0, "with nothing to select");

    t_case("a switch keeps the selected patch when the view lists it, else selects the view's first");
    build(4, 10, 16);
    t_checkl(list_view_pick(&lib, 0, 11), 11, "All lists everything");
    t_checkl(list_view_pick(&lib, 2, 11), 11, "USER lists entry 11");
    t_checkl(list_view_pick(&lib, 3, 11), 14, "BANK does not: its first");
    t_checkl(list_view_pick(&lib, 1, 11), 0, "FACTORY does not: its first");
    t_checkl(list_view_pick(&lib, 1, -1), 0, "no selection: the view's first");
    t_checkl(list_view_pick(&lib, 9, 29), 29, "a view the library does not have is All");

    t_case("back from the editor: All stays All, a bank view shows the bank of the patch you ended on");
    t_checkl(list_view_back(&lib, 0, 20), 0, "All stays All");
    t_checkl(list_view_back(&lib, 3, 20), 3, "the same bank");
    t_checkl(list_view_back(&lib, 3, 29), 3, "the bank's last patch");
    t_checkl(list_view_back(&lib, 3, 13), 2, "Ctrl+PgUp carried it into USER");
    t_checkl(list_view_back(&lib, 1, 14), 3, "and PgDn into BANK");
    t_checkl(list_view_back(&lib, 2, 0), 1, "or back to FACTORY");

    t_case("the keys of the list");
    t_checkl(key_lookup(K_MENU, 0x4B, 0), KID_LEFT, "Left");
    t_checkl(key_lookup(K_MENU, 0x4D, 0), KID_RIGHT, "Right");
    t_checkl(key_lookup(K_MENU, 0x49, 0), KID_PGUP, "PgUp");
    t_checkl(key_lookup(K_MENU, 0x51, 0), KID_PGDN, "PgDn");
    t_checkl(key_lookup(K_MENU, 0x47, 0), KID_HOME, "Home");
    t_checkl(key_lookup(K_MENU, 0x4F, 0), KID_END, "End");
    t_checkl(key_lookup(K_MENU, 0x49, MOD_CTRL), 0, "Ctrl+PgUp is not the list's");

    t_case("the switcher in the top border");
    list_draw(&lib, 0, 0, 0, NULL);
    t_check(row_is(4, 2, "\x11 All \x10  1 of 4"), "All and its place among the views");
    t_check(row_is(66, 2, "30 patches"), "the library's count at the right");
    t_check(row_is(5, FIRST_ROW, "FACTORY"), "All starts with the first bank's heading rule");
    list_draw(&lib, 2, 4, 0, NULL);
    t_check(row_is(4, 2, "\x11 USER \x10  3 of 4"), "a bank's name and place");
    t_check(row_is(66, 2, "10 patches"), "and its patch count");
    t_check(row_is(7, FIRST_ROW, "E"), "a bank view starts with its first patch");
    t_check(cell_char(5, FIRST_ROW) == ' ', "no heading rule in a bank view");
    t_checkl(list_arrow_at(&lib, 0, 4, 2), -1, "the left arrow");
    t_checkl(list_arrow_at(&lib, 0, 10, 2), 1, "the right arrow after All");
    t_checkl(list_arrow_at(&lib, 2, 8, 2), 0, "no arrow on the name");
    t_checkl(list_arrow_at(&lib, 2, 12, 2), 1, "the right arrow follows the name");
    t_checkl(list_arrow_at(&lib, 0, 4, 3), 0, "only in the top border");
    t_checkl(list_arrow_at(&lib, 0, 30, 2), 0, "and not the rule");

    t_case("an 8-character override name is drawn whole");
    memset(rows, 0, sizeof rows);
    strcpy(rows[0].folder, "FACTORY");
    strcpy(rows[0].name, "BRASSLNG");
    strcpy(rows[1].folder, "USER");
    strcpy(rows[1].name, "BRASSLNG");
    rows[1].overrides = 1;
    lib.entries = rows;
    lib.count = 2;
    list_draw(&lib, 0, 1, 0, NULL);
    t_check(row_is(37, FIRST_ROW + 3, "overrides FACTORY\\BRASSLNG"), "the row's override text");
    t_check(row_is(3, 17, "                  "), "nothing under the list: the row already says it");
    list_draw(&lib, 0, 1, 0, "Cannot open it");
    t_check(row_is(3, 17, "Cannot open it"), "a message is shown under the list");

    return t_done();
}
