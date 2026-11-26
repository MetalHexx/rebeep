/* The patch list: the library in All (grouped by bank, one heading rule per bank) or one bank at a time, with the view
   switcher in the top border. It was drawn as an .ans, so it uses the standard view's colour indexes and, in the mono
   view, passes every cell through scr_remap_mono().
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
#define SWITCH_X 4        /* the switcher's left arrow, in the top border */
#define BORDER_Y 2

#define C_BAR 10
#define C_HEAD 14
#define C_NAME 15
#define C_FRAME 2
#define C_DIM 8
#define C_TEXT 7

/* Do entries a and b share a bank? The rule of lib_bank (folder names equal without regard to case). Folders are
   stored zero-padded, so equal words settle it at once: on a 386SX the compares are what a walk over the banks costs. */
static int same_bank(const Library *lib, int a, int b)
{
    const Entry __far *x = &lib->entries[a];
    const Entry __far *y = &lib->entries[b];
    const unsigned __far *p = (const unsigned __far *)x->folder;
    const unsigned __far *q = (const unsigned __far *)y->folder;
    int i;

    if (p[0] == q[0] && p[1] == q[1] && p[2] == q[2] && p[3] == q[3] && x->folder[8] == y->folder[8]) return 1;
    for (i = 0; i < (int)sizeof x->folder; i++) {
        char ca = x->folder[i];
        char cb = y->folder[i];

        if (ca >= 'a' && ca <= 'z') ca = (char)(ca - 32);
        if (cb >= 'a' && cb <= 'z') cb = (char)(cb - 32);
        if (ca != cb) return 0;
        if (ca == '\0') return 1;
    }
    return 1;
}

/* A bank is contiguous: the index after the last entry of the bank that starts at `first`, found by halving. */
static int bank_end(const Library *lib, int first)
{
    int lo = first + 1;
    int hi = lib_count(lib);

    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;

        if (same_bank(lib, mid, first)) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/* The entries `view` lists, [*first, *first + *count). A view the list does not have is All. Returns the view that
   applies: 0 for All, else the bank's number from 1. Walking to a bank costs a halving per bank before it. */
static int view_range(const Library *lib, int view, int *first, int *count)
{
    int n = lib_count(lib);
    int f = 0;
    int k;

    for (k = 1; view > 0 && f < n; k++) {
        int end = bank_end(lib, f);

        if (k == view) {
            *first = f;
            *count = end - f;
            return view;
        }
        f = end;
    }
    *first = 0;
    *count = n;
    return 0;
}

/* In All: the banks that end at or before entry `e`, and the banks in all. */
static void all_geometry(const Library *lib, int e, int *before, int *banks)
{
    int f = 0;
    int n = lib_count(lib);

    *before = 0;
    *banks = 0;
    while (f < n) {
        int end = bank_end(lib, f);

        if (end <= e) (*before)++;
        (*banks)++;
        f = end;
    }
}

/* The line of entry `e` in the view (All: its index plus the headings up to and including its bank), and the view's
   lines in all. `v` and `first` come from view_range. */
static int entry_line(const Library *lib, int v, int first, int count, int e, int *total)
{
    int before;
    int banks;

    if (v > 0) {
        *total = count;
        return e - first;
    }
    all_geometry(lib, e, &before, &banks);
    *total = count + banks;
    return e + before + 1;
}

/* In All: the entry on line `line`: a heading line gives its bank's first entry, a line past either end the last or
   first entry. The list must not be empty. */
static int all_entry_at_line(const Library *lib, int line)
{
    int n = lib_count(lib);
    int f = 0;
    int at = 0;

    if (line < 0) line = 0;
    while (f < n) {
        int end = bank_end(lib, f);

        if (line <= at + end - f) return line == at ? f : f + line - at - 1;
        at += end - f + 1;
        f = end;
    }
    return n - 1;
}

/* The entry on line `line` of the view, as all_entry_at_line, clamped to the view. */
static int entry_at_line(const Library *lib, int v, int first, int count, int line)
{
    if (v == 0) return all_entry_at_line(lib, line);
    if (line < 0) line = 0;
    return line < count ? first + line : first + count - 1;
}

int list_views(const Library *lib)
{
    int before;
    int banks;

    all_geometry(lib, -1, &before, &banks);
    return 1 + banks;
}

int list_view_step(const Library *lib, int view, int dir)
{
    int views = list_views(lib);

    if (view < 0 || view >= views) view = 0;
    return ((view + dir) % views + views) % views;
}

int list_view_pick(const Library *lib, int view, int sel)
{
    int first;
    int count;

    view_range(lib, view, &first, &count);
    if (count == 0) return 0;
    return (sel >= first && sel < first + count) ? sel : first;
}

int list_view_back(const Library *lib, int view, int sel)
{
    int before;
    int banks;

    if (view == 0 || sel < 0 || sel >= lib_count(lib)) return view;
    all_geometry(lib, sel, &before, &banks);
    return before + 1;
}

int list_move(const Library *lib, int view, int sel, int how)
{
    int first;
    int count;
    int v = view_range(lib, view, &first, &count);
    int total;
    int line;

    if (count == 0) return 0;
    if (sel < first) sel = first;
    if (sel >= first + count) sel = first + count - 1;
    switch (how) {
    case LIST_UP:
        return sel > first ? sel - 1 : sel;
    case LIST_DOWN:
        return sel + 1 < first + count ? sel + 1 : sel;
    case LIST_HOME:
        return first;
    case LIST_END:
        return first + count - 1;
    default:
        line = entry_line(lib, v, first, count, sel, &total);
        return entry_at_line(lib, v, first, count, line + (how == LIST_PGDN ? LIST_ROWS : -LIST_ROWS));
    }
}

int list_scroll(const Library *lib, int view, int sel, int top)
{
    int first;
    int count;
    int v = view_range(lib, view, &first, &count);
    int total;
    int line;
    int head;

    if (count == 0) return 0;
    if (sel < first) sel = first;
    if (sel >= first + count) sel = first + count - 1;
    line = entry_line(lib, v, first, count, sel, &total);
    head = line;
    if (v == 0 && (sel == 0 || !same_bank(lib, sel - 1, sel))) head = line - 1;
    if (head < top) top = head;
    if (line >= top + LIST_ROWS) top = line - LIST_ROWS + 1;
    if (top > total - LIST_ROWS) top = total - LIST_ROWS;
    if (top < 0) top = 0;
    return top;
}

int list_item_at(const Library *lib, int view, int top, int x, int y)
{
    int first;
    int count;
    int want = top + y - BODY_Y;
    int n = lib_count(lib);
    int f = 0;
    int at = 0;

    if (x < LEFT || x >= LEFT + INNER_W || y < BODY_Y || y >= BODY_Y + LIST_ROWS) return -1;
    if (view_range(lib, view, &first, &count) > 0) return want < count ? first + want : -1;
    while (f < n) {
        int end = bank_end(lib, f);

        if (want == at) return -1;
        if (want <= at + end - f) return f + want - at - 1;
        at += end - f + 1;
        f = end;
    }
    return -1;
}

/* In All: where the body starts at line `top`. Gives the bank holding that line, [*f, *f + *c) (*c is 0 when `top` is past
   the end), and `*off`, the line within it (0 the heading rule, else the entry *f + *off - 1). Returns the banks in all. */
static int all_start(const Library *lib, int top, int *f, int *c, int *off)
{
    int n = lib_count(lib);
    int at = 0;
    int banks = 0;
    int next = 0;

    *f = 0;
    *c = 0;
    *off = 0;
    while (next < n) {
        int end = bank_end(lib, next);

        if (*c == 0 && top <= at + end - next) {
            *f = next;
            *c = end - next;
            *off = top - at;
        }
        at += end - next + 1;
        next = end;
        banks++;
    }
    return banks;
}

/* The view's name: All, or its bank's folder. */
static void view_name(const Library *lib, int v, int first, char *out)
{
    if (v == 0) {
        strcpy(out, "All");
    } else {
        Entry en = *lib_entry(lib, first);

        strcpy(out, en.folder);
    }
}

int list_arrow_at(const Library *lib, int view, int x, int y)
{
    int first;
    int count;
    int v;
    char name[9];
    int right;

    if (y != BORDER_Y) return 0;
    v = view_range(lib, view, &first, &count);
    view_name(lib, v, first, name);
    right = SWITCH_X + 3 + (int)strlen(name);
    if (x >= SWITCH_X - 1 && x <= SWITCH_X + 1) return -1;
    if (x >= right - 1 && x <= right + 1) return 1;
    return 0;
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
    scr_put(11, 21, "the default save bank", C_DIM, 0);
    scr_put(50, 21, "\xFA", C_BAR, 0);
    scr_put(52, 21, "2-op only", C_DIM, 0);
    scr_put(2, 22, "banks", C_BAR, 0);
    scr_put(11, 22, "other folders, yours or a friend's", C_DIM, 0);
    scr_put(50, 22, "Octave", C_NAME, 0);
    scr_put(57, 22, "shift from game pitch", C_DIM, 0);

    scr_fill(0, 24, VIDEO_COLS, 1, ' ', C_TEXT, 2);
    scr_put(1, 24, "\x18\x19", C_NAME, 2);
    scr_put(4, 24, "PgUp", C_NAME, 2);
    scr_put(9, 24, "PgDn", C_NAME, 2);
    scr_put(14, 24, "Home", C_NAME, 2);
    scr_put(19, 24, "End", C_NAME, 2);
    scr_fill(23, 24, 8, 1, ' ', 0, C_TEXT);
    scr_put(24, 24, "Choose", 0, C_TEXT);
    scr_put(32, 24, "\x11\x10", C_NAME, 2);
    scr_fill(35, 24, 6, 1, ' ', 0, C_TEXT);
    scr_put(36, 24, "Bank", 0, C_TEXT);
    scr_put(42, 24, "Enter", C_NAME, 2);
    scr_fill(48, 24, 6, 1, ' ', 0, C_TEXT);
    scr_put(49, 24, "Edit", 0, C_TEXT);
    scr_put(55, 24, "Esc", C_NAME, 2);
    scr_fill(59, 24, 21, 1, ' ', 0, C_TEXT);
    scr_put(60, 24, "Menu", 0, C_TEXT);
}

/* The switcher in the top border: "<- name ->  N of M" at the left, the view's patch count at the right. */
static void switcher(const Library *lib, int v, int views, int first, int count)
{
    char name[9];
    char text[24];
    int at = SWITCH_X + 2;
    int len;

    view_name(lib, v, first, name);
    sprintf(text, "%d of %d", v + 1, views);
    scr_fill(SWITCH_X - 1, BORDER_Y, 8 + (int)(strlen(name) + strlen(text)), 1, ' ', C_FRAME, 0);
    scr_put(SWITCH_X, BORDER_Y, "\x11", C_BAR, 0);
    scr_put(at, BORDER_Y, name, C_NAME, 0);
    at += (int)strlen(name);
    scr_put(at + 1, BORDER_Y, "\x10", C_BAR, 0);
    scr_put(at + 4, BORDER_Y, text, C_TEXT, 0);

    sprintf(text, count == 1 ? "%d patch" : "%d patches", count);
    len = (int)strlen(text);
    scr_fill(75 - len, BORDER_Y, len + 2, 1, ' ', C_FRAME, 0);
    scr_put(76 - len, BORDER_Y, text, C_TEXT, 0);
}

void list_draw(const Library *lib, int view, int sel, int top, const char *msg)
{
    int first;
    int count;
    int v = view_range(lib, view, &first, &count);
    int n = lib_count(lib);
    int row = 0;
    int off;
    int f;
    int c;
    int views;

    chrome();
    if (n == 0) {
        scr_put(NAME_X, BODY_Y + 1, "No patches found.", C_TEXT, 0);
    }
    if (v > 0) {
        f = first;
        c = count;
        off = top + 1;
        views = list_views(lib);
    } else {
        views = 1 + all_start(lib, top, &f, &c, &off);
    }
    switcher(lib, v, views, first, count);
    while (row < LIST_ROWS && c > 0) {
        for (; off <= c && row < LIST_ROWS; off++, row++) {
            if (off == 0) {
                Entry en = *lib_entry(lib, f);

                heading_row(BODY_Y + row, en.folder);
            } else {
                Entry en = *lib_entry(lib, f + off - 1);

                entry_row(BODY_Y + row, &en, f + off - 1 == sel);
            }
        }
        if (v > 0 || f + c >= n) break;
        f += c;
        c = bank_end(lib, f) - f;
        off = 0;
    }

    if (msg != NULL && msg[0] != '\0') {
        char note[76];

        strncpy(note, msg, sizeof note - 1);
        note[sizeof note - 1] = '\0';
        scr_put(3, NOTE_Y, note, C_HEAD, 0);
    }
    if (role_mono()) scr_remap_mono();
}
