/* The patch list's scroll window and its row hit-test, over a synthetic library: heading rules count as lines, the
   selection stays in view, and a folder's first entry brings its heading with it. Also the override text for the
   longest name the library allows. */
#include <string.h>

#include "testlib.h"
#include "../../src/studio/screens.h"
#include "../../src/studio/video.h"

#define FIRST_ROW 4

static Library lib;
static Entry rows[40];

/* Folders FACTORY (4), USER (10), PACK (16): 30 entries on 33 lines, entry 14 the first of PACK (line 17, its heading
   on line 16). */
static void build(int factory, int user, int pack)
{
    int i = 0;
    int k;

    memset(rows, 0, sizeof rows);
    for (k = 0; k < factory; k++, i++) strcpy(rows[i].folder, "FACTORY");
    for (k = 0; k < user; k++, i++) strcpy(rows[i].folder, "USER");
    for (k = 0; k < pack; k++, i++) strcpy(rows[i].folder, "PACK");
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
    for (sel = 0; sel < lib.count; sel++) ok = ok && list_scroll(&lib, sel, 0) == 0;
    t_check(ok, "top stays 0 for every selection");

    t_case("an empty list");
    build(0, 0, 0);
    t_checkl(list_scroll(&lib, 0, 5), 0, "top 0");
    t_checkl(list_item_at(&lib, 0, 10, FIRST_ROW), -1, "no row");

    t_case("the selection scrolls into view");
    build(4, 10, 16);
    t_checkl(list_scroll(&lib, 0, 0), 0, "first entry, heading above it");
    t_checkl(list_scroll(&lib, 10, 0), 1, "entry 10 is on line 12: one line down");
    t_checkl(list_scroll(&lib, 29, 0), 21, "the last entry puts the end of the list at the bottom");
    t_checkl(list_scroll(&lib, 29, 99), 21, "a top past the end is pulled back");
    t_checkl(list_scroll(&lib, 5, 21), 7, "going back up puts the entry on the top line");

    t_case("a folder's first entry brings its heading");
    t_checkl(list_scroll(&lib, 14, 21), 16, "PACK's heading is line 16, its first entry line 17");
    t_checkl(list_scroll(&lib, 4, 12), 5, "USER's first entry from below: heading line 5");
    t_checkl(list_scroll(&lib, 14, 16), 16, "already in view: top stays");

    t_case("the window holds still while the selection moves inside it");
    top = 9;
    ok = 1;
    for (sel = 7; sel <= 17; sel++) ok = ok && list_scroll(&lib, sel, top) == top;
    t_check(ok, "entries 7 to 17 lie on lines 9 to 20, the whole window");

    t_case("a click's row maps to its entry");
    t_checkl(list_item_at(&lib, 16, 10, FIRST_ROW), -1, "a heading rule is no entry");
    t_checkl(list_item_at(&lib, 16, 10, FIRST_ROW + 1), 14, "the line after the heading is PACK's first entry");
    t_checkl(list_item_at(&lib, 16, 10, FIRST_ROW + 11), 24, "the last visible line");
    t_checkl(list_item_at(&lib, 16, 10, FIRST_ROW + 12), -1, "below the body");
    t_checkl(list_item_at(&lib, 16, 10, FIRST_ROW - 1), -1, "above the body");
    t_checkl(list_item_at(&lib, 0, 1, FIRST_ROW + 1), -1, "the frame's left edge");
    t_checkl(list_item_at(&lib, 0, 78, FIRST_ROW + 1), -1, "the frame's right edge");
    t_checkl(list_item_at(&lib, 0, 2, FIRST_ROW + 1), 0, "the first column inside the frame");
    t_checkl(list_item_at(&lib, 0, 77, FIRST_ROW + 1), 0, "the last column inside the frame");

    t_case("an 8-character override name is drawn whole");
    memset(rows, 0, sizeof rows);
    strcpy(rows[0].folder, "FACTORY");
    strcpy(rows[0].name, "BRASSLNG");
    strcpy(rows[1].folder, "USER");
    strcpy(rows[1].name, "BRASSLNG");
    rows[1].overrides = 1;
    lib.entries = rows;
    lib.count = 2;
    list_draw(&lib, 1, 0, NULL);
    t_check(row_is(37, FIRST_ROW + 3, "overrides FACTORY\\BRASSLNG"), "the row's override text");
    t_check(row_is(3, 17, "USER\\BRASSLNG overrides the factory BRASSLNG. Reset to factory brings it"), "the note under the list (the screen clips its last cells)");

    return t_done();
}
