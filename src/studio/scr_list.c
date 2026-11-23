/* The patch list: the library grouped by folder, one heading rule per folder. It was drawn as an .ans, so it uses the
   standard view's colour indexes and, in the mono view, passes every cell through scr_remap_mono().
   SPDX-License-Identifier: MIT */
#include <stdio.h>
#include <string.h>

#include "ansi.h"
#include "roles.h"
#include "screens.h"
#include "video.h"

#define BODY_Y 4          /* the first list line's row */
#define LEFT 2            /* inside the frame */
#define INNER_W 76
#define NAME_X 7
#define FOUR_X 21
#define OCT_X 30
#define OVER_X 37
#define NOTE_Y 17

#define C_BAR 10
#define C_HEAD 14
#define C_NAME 15
#define C_FRAME 2
#define C_DIM 8
#define C_TEXT 7

/* Does entry `i` start a folder (so a heading rule comes before it)? */
static int new_folder(const Library *lib, int i)
{
    Entry a;
    Entry b;

    if (i == 0) return 1;
    a = *lib_entry(lib, i - 1);
    b = *lib_entry(lib, i);
    return strcmp(a.folder, b.folder) != 0;
}

/* The line of entry `e` in the list: heading rules and entries, in order, from line 0. */
static int entry_line(const Library *lib, int e)
{
    int i;
    int headings = 0;

    for (i = 0; i <= e; i++) {
        if (new_folder(lib, i)) headings++;
    }
    return e + headings;
}

int list_scroll(const Library *lib, int sel, int top)
{
    int n = lib_count(lib);
    int total;
    int line;
    int first;

    if (n == 0) return 0;
    if (sel < 0) sel = 0;
    if (sel >= n) sel = n - 1;
    total = entry_line(lib, n - 1) + 1;
    line = entry_line(lib, sel);
    first = new_folder(lib, sel) ? line - 1 : line;
    if (first < top) top = first;
    if (line >= top + LIST_ROWS) top = line - LIST_ROWS + 1;
    if (top > total - LIST_ROWS) top = total - LIST_ROWS;
    if (top < 0) top = 0;
    return top;
}

int list_item_at(const Library *lib, int top, int x, int y)
{
    int n = lib_count(lib);
    int want = top + y - BODY_Y;
    int e;

    if (x < LEFT || x >= LEFT + INNER_W || y < BODY_Y || y >= BODY_Y + LIST_ROWS) return -1;
    for (e = 0; e < n; e++) {
        int line = entry_line(lib, e);

        if (line == want) return e;
        if (line > want) break;
    }
    return -1;
}

static void shift_text(int octave, char *out)
{
    int shift = octave - 4;

    if (shift > 0) sprintf(out, "+%d", shift);
    else sprintf(out, "%d", shift);
}

static void heading_row(int y, const char *folder)
{
    int len = (int)strlen(folder);

    scr_fill(LEFT, y, INNER_W, 1, '\xC4', C_FRAME, 0);
    scr_put(4, y, " ", C_FRAME, 0);
    scr_put(5, y, folder, C_BAR, 0);
    scr_put(5 + len, y, " ", C_FRAME, 0);
}

/* Writes `a`, `b` and `c` end to end from `x` in colour `fg` (background kept); returns the column after the last. The
   pieces are drawn one by one so a name of any valid length needs no buffer. */
static int put_parts(int x, int y, const char *a, const char *b, const char *c, int fg)
{
    scr_put(x, y, a, fg, SCR_KEEP);
    x += (int)strlen(a);
    scr_put(x, y, b, fg, SCR_KEEP);
    x += (int)strlen(b);
    scr_put(x, y, c, fg, SCR_KEEP);
    return x + (int)strlen(c);
}

static void entry_row(int y, const Entry *en, int selected)
{
    char shift[8];

    scr_fill(LEFT, y, INNER_W, 1, ' ', selected ? 0 : C_TEXT, selected ? C_BAR : 0);
    scr_put(NAME_X, y, en->name, selected ? 0 : C_NAME, SCR_KEEP);
    scr_put(FOUR_X, y, en->has4 ? "\x04" : "\xFA", selected ? 0 : C_BAR, SCR_KEEP);
    shift_text(en->octave, shift);
    scr_put(OCT_X + 2 - (int)strlen(shift), y, shift, selected ? 0 : C_TEXT, SCR_KEEP);
    if (en->overrides) {
        put_parts(OVER_X, y, "overrides FACTORY\\", en->name, "", selected ? 0 : C_DIM);
    }
}

/* The path bar, the frame, the headings, the legend and the key line. */
static void chrome(void)
{
    scr_fill(0, 0, VIDEO_COLS, VIDEO_ROWS, ' ', C_TEXT, 0);
    scr_fill(0, 0, VIDEO_COLS, 1, ' ', C_NAME, 2);
    scr_put(1, 0, "ReBeep  " "\xAF" "  Patch Editor  " "\xAF" "  Choose a patch", C_NAME, 2);
    scr_box(1, 2, 78, 17, SCR_SINGLE, C_FRAME, 0);
    scr_put(NAME_X, 3, "Name", C_HEAD, 0);
    scr_put(20, 3, "4-op", C_HEAD, 0);
    scr_put(28, 3, "Octave", C_HEAD, 0);

    scr_put(2, 20, "FACTORY", C_BAR, 0);
    scr_put(11, 20, "ships with ReBeep, never changed", C_DIM, 0);
    scr_put(50, 20, "\x04", C_BAR, 0);
    scr_put(52, 20, "has a 4-op variant", C_DIM, 0);
    scr_put(2, 21, "USER", C_BAR, 0);
    scr_put(11, 21, "your own patches", C_DIM, 0);
    scr_put(50, 21, "\xFA", C_BAR, 0);
    scr_put(52, 21, "2-op only", C_DIM, 0);
    scr_put(2, 22, "packs", C_BAR, 0);
    scr_put(11, 22, "any other folder, such as a friend's", C_DIM, 0);
    scr_put(50, 22, "Octave", C_NAME, 0);
    scr_put(57, 22, "shift from game pitch", C_DIM, 0);

    scr_fill(0, 24, VIDEO_COLS, 1, ' ', C_TEXT, 2);
    scr_put(1, 24, "\x18\x19", C_NAME, 2);
    scr_fill(4, 24, 8, 1, ' ', 0, C_TEXT);
    scr_put(5, 24, "Choose", 0, C_TEXT);
    scr_put(13, 24, "Enter", C_NAME, 2);
    scr_fill(19, 24, 6, 1, ' ', 0, C_TEXT);
    scr_put(20, 24, "Edit", 0, C_TEXT);
    scr_put(26, 24, "Esc", C_NAME, 2);
    scr_fill(30, 24, 50, 1, ' ', 0, C_TEXT);
    scr_put(31, 24, "Menu", 0, C_TEXT);
}

void list_draw(const Library *lib, int sel, int top, const char *msg)
{
    int n = lib_count(lib);
    int e;
    int line = 0;

    chrome();
    if (n == 0) {
        scr_put(NAME_X, BODY_Y + 1, "No patches found.", C_TEXT, 0);
    }
    for (e = 0; e < n; e++) {
        Entry en = *lib_entry(lib, e);

        if (new_folder(lib, e)) {
            if (line >= top && line < top + LIST_ROWS) heading_row(BODY_Y + line - top, en.folder);
            line++;
        }
        if (line >= top && line < top + LIST_ROWS) entry_row(BODY_Y + line - top, &en, e == sel);
        line++;
    }

    if (msg != NULL && msg[0] != '\0') {
        char note[76];

        strncpy(note, msg, sizeof note - 1);
        note[sizeof note - 1] = '\0';
        scr_put(3, NOTE_Y, note, C_HEAD, 0);
    } else if (sel >= 0 && sel < n) {
        Entry en = *lib_entry(lib, sel);

        if (en.overrides) {
            int next = put_parts(3, NOTE_Y, en.folder, "\\", en.name, C_HEAD);

            put_parts(next + 1, NOTE_Y, "overrides the factory ", en.name, ". Reset to factory brings it back.", C_TEXT);
        }
    }
    if (role_mono()) scr_remap_mono();
}
