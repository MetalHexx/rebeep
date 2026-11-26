/* The synth screen in parts: after a change, drawing only synth_parts(before, after) over the screen of the old state
   gives every cell a fresh synth_draw of the new state gives, for both variants and both views. The changes come through
   the editor (key events, clicks, bars, undo, the octave, the piano, Random and Mutate, the Save dialog) and, for what a
   save, the rescan or the prompt would change, straight into the fields. Also the drawing primitives: clipping and
   SCR_KEEP. */
#include <stdio.h>
#include <string.h>

#include "testlib.h"
#include "../../src/studio/editor.h"
#include "../../src/studio/kbd.h"
#include "../../src/studio/opl.h"
#include "../../src/studio/roles.h"
#include "../../src/studio/screens.h"
#include "../../src/studio/video.h"

#define CELLS (VIDEO_COLS * VIDEO_ROWS)
#define NAV_ROWS (F_FB - F_VARIANT + 1 + P_COUNT)   /* variant, octave, connection, feedback, then the parameters */

#define SC_UP (0x48 | KBD_EXT)
#define SC_DOWN (0x50 | KBD_EXT)
#define SC_LEFT (0x4B | KBD_EXT)
#define SC_RIGHT (0x4D | KBD_EXT)
#define SC_TAB 0x0F
#define SC_ESC 0x01
#define SC_BACK 0x0E
#define SC_S 0x1F
#define SC_ENTER 0x1C
#define SC_SHIFT 0x2A
#define SC_CTRL 0x1D
#define SC_ALT 0x38
#define SC_1 0x02
#define SC_Y 0x15
#define SC_F11 0x57
#define SC_F12 0x58
#define SC_Z 0x2C   /* also piano key 0 */
#define SC_X 0x2D   /* piano key 2 */
#define SC_C 0x2E   /* piano key 4 */
#define SC_A 0x1E
#define SC_B 0x30
#define SC_W 0x11
#define HELD_X 33       /* the bottom bar's cells for the names of the notes held */
#define HELD_CELLS 11

static Library lib;     /* the library the Save dialog reads: FACTORY BRASS and ORGAN, USER BRASS, the bank HEXX */
static Entry lib_rows[4];
static char err[80];
static Editor ed;      /* the editor the test drives */
static Editor shown;   /* the editor `screen` was drawn for */
static Editor other;   /* a second state to compare with, when nothing is drawn */
static unsigned short screen[CELLS];
static unsigned short want[CELLS];

static void sink(unsigned reg, unsigned char val)
{
    (void)reg;
    (void)val;
}

static void grab(unsigned short *to)
{
    int x;
    int y;

    for (y = 0; y < VIDEO_ROWS; y++) {
        for (x = 0; x < VIDEO_COLS; x++) *to++ = scr_cell(x, y);
    }
}

static void put_back(const unsigned short *from)
{
    int x;
    int y;

    for (y = 0; y < VIDEO_ROWS; y++) {
        for (x = 0; x < VIDEO_COLS; x++, from++) video_put(x, y, (unsigned char)*from, (unsigned char)(*from >> 8));
    }
}

/* The index of the first cell that is not `cells`' value, or -1. */
static int first_difference(const unsigned short *cells)
{
    int x;
    int y;

    for (y = 0; y < VIDEO_ROWS; y++) {
        for (x = 0; x < VIDEO_COLS; x++, cells++) {
            if (scr_cell(x, y) != *cells) return y * VIDEO_COLS + x;
        }
    }
    return -1;
}

/* Starts a case: the sample editor drawn in full. */
static void restart(int variant)
{
    sample_editor(&ed, variant);
    editor_apply(&ed);
    synth_draw(&ed);
    grab(screen);
    shown = ed;
}

/* Draws only the parts that differ between `shown` and `ed` over the screen of `shown` and compares every cell with a
   fresh draw of `ed`. Returns the parts. */
static unsigned step(const char *what)
{
    unsigned parts = synth_parts(&shown, &ed);

    synth_draw(&ed);
    grab(want);
    put_back(screen);
    synth_redraw(&ed, parts);
    t_checkl(first_difference(want), -1, what);
    memcpy(screen, want, sizeof screen);
    shown = ed;
    return parts;
}

static void key(unsigned code)
{
    editor_event(&ed, code);
}

static void tap(unsigned code)
{
    key(code);
    key(code | KBD_BREAK);
}

static void chord(unsigned mod, unsigned code)
{
    key(mod);
    tap(code);
    key(mod | KBD_BREAK);
}

/* One key with a step after it. */
static unsigned press(unsigned code, const char *what)
{
    key(code);
    return step(what);
}

static unsigned release(unsigned code, const char *what)
{
    key(code | KBD_BREAK);
    return step(what);
}

static void hit_at(int kind, int k, int key_row, int bx, int bw, SynthHit *h)
{
    h->kind = kind;
    h->k = k;
    h->key = key_row;
    h->bx = bx;
    h->bw = bw;
}

static int count_changed(void)
{
    int n = 0;
    int i;

    for (i = 0; i < CELLS; i++) {
        if (scr_cell(i % VIDEO_COLS, i / VIDEO_COLS) != 0x1E6B) n++;
    }
    return n;
}

static void blank(void)
{
    video_fill(0, 0, VIDEO_COLS, VIDEO_ROWS, 'k', 0x1E);
}

static void add_row(int i, const char *folder, const char *name)
{
    strcpy(lib_rows[i].folder, folder);
    strcpy(lib_rows[i].name, name);
}

/* FACTORY BRASS and ORGAN, USER BRASS, and the bank HEXX with one patch: enough for the dialog to step through banks. */
static void make_library(void)
{
    add_row(0, "FACTORY", "BRASS");
    add_row(1, "FACTORY", "ORGAN");
    add_row(2, "USER", "BRASS");
    add_row(3, "HEXX", "ORGAN");
    lib.entries = lib_rows;
    lib.count = 4;
    lib.cap = 4;
    lib.factory = 2;
    lib.user = 1;
    lib.banks = 1;
    strcpy(lib.patchdir, "NOPATCH");
}

static void primitives(void)
{
    t_case("a fill is clipped at each edge");
    blank();
    scr_fill(-3, -2, 6, 5, '#', 4, 5);
    t_checkl(count_changed(), 9, "over the top left corner: 3 by 3 cells");
    t_check(scr_cell(0, 0) == 0x5423 && scr_cell(2, 2) == 0x5423, "the cells on the screen hold the glyph and colours");
    t_check(scr_cell(3, 0) == 0x1E6B && scr_cell(0, 3) == 0x1E6B, "the cells beside it are untouched");
    blank();
    scr_fill(77, 22, 10, 10, '#', 4, 5);
    t_checkl(count_changed(), 9, "over the bottom right corner: 3 by 3 cells");
    blank();
    scr_fill(-5, -5, 200, 200, '#', 4, 5);
    t_checkl(count_changed(), CELLS, "a rectangle past every edge covers the screen");
    blank();
    scr_fill(80, 0, 5, 5, '#', 4, 5);
    scr_fill(-5, 0, 5, 5, '#', 4, 5);
    scr_fill(0, 25, 5, 5, '#', 4, 5);
    scr_fill(0, -5, 5, 5, '#', 4, 5);
    scr_fill(10, 10, 0, 5, '#', 4, 5);
    scr_fill(10, 10, 5, -1, '#', 4, 5);
    t_checkl(count_changed(), 0, "a rectangle off the screen or empty draws nothing");
    blank();
    video_fill(-1, -1, 3, 3, 'f', 0x2F);
    video_fill(79, 24, 5, 5, 'f', 0x2F);
    t_checkl(count_changed(), 5, "video_fill clips the same way");
    t_check(scr_cell(1, 1) == 0x2F66 && scr_cell(79, 24) == 0x2F66, "and writes the attribute and glyph");

    t_case("text is clipped at each edge");
    blank();
    scr_put(-2, 3, "ABCDE", 4, 5);
    t_checkl(count_changed(), 3, "scr_put from the left of the screen keeps the rest");
    t_check(scr_cell(0, 3) == 0x5443 && scr_cell(2, 3) == 0x5445, "starting at the third character");
    blank();
    scr_put(78, 3, "XYZ", 4, 5);
    t_checkl(count_changed(), 2, "scr_put past the right edge stops at it");
    t_check(scr_cell(79, 3) == 0x5459 && scr_cell(0, 4) == 0x1E6B, "and does not wrap to the next row");
    blank();
    scr_put(0, 25, "x", 4, 5);
    scr_put(0, -1, "x", 4, 5);
    scr_put(-10, 0, "abc", 4, 5);
    scr_put(80, 0, "abc", 4, 5);
    scr_put(5, 5, "", 4, 5);
    t_checkl(count_changed(), 0, "text off the screen or empty draws nothing");
    blank();
    video_text(-2, 1, "WXYZ", 0x1F);
    video_text(78, 1, "abcd", 0x1F);
    t_checkl(count_changed(), 4, "video_text clips the same way");
    t_check(scr_cell(0, 1) == 0x1F59 && scr_cell(79, 1) == 0x1F62 && scr_cell(0, 2) == 0x1E6B, "and does not wrap");

    t_case("SCR_KEEP keeps each part of the cell");
    blank();
    scr_fill(10, 10, 2, 1, 'x', SCR_KEEP, 3);
    t_check(scr_cell(10, 10) == 0x3E78 && scr_cell(11, 10) == 0x3E78, "a kept foreground");
    blank();
    scr_fill(10, 10, 2, 1, 'x', 5, SCR_KEEP);
    t_check(scr_cell(10, 10) == 0x1578, "a kept background");
    blank();
    scr_fill(10, 10, 1, 1, 'x', 17, 18);
    t_check(scr_cell(10, 10) == 0x2178, "both given: each is its low four bits");
    blank();
    scr_paint(10, 10, 2, 1, 5, SCR_KEEP);
    t_check(scr_cell(10, 10) == 0x156B, "scr_paint keeps the glyph, and a kept background");
    scr_paint(10, 10, 2, 1, SCR_KEEP, 6);
    t_check(scr_cell(11, 10) == 0x656B, "a kept foreground");
    scr_paint(10, 10, 2, 1, SCR_KEEP, SCR_KEEP);
    t_check(scr_cell(10, 10) == 0x656B, "both kept changes nothing");
    blank();
    scr_put(10, 10, "ab", SCR_KEEP, SCR_KEEP);
    t_check(scr_cell(10, 10) == 0x1E61 && scr_cell(11, 10) == 0x1E62, "scr_put with both colours kept writes the glyphs only");
    scr_put(10, 10, "c", 2, SCR_KEEP);
    t_check(scr_cell(10, 10) == 0x1263, "scr_put with a kept background");
    blank();
    scr_ramp(-1, 0, "abc");
    scr_ramp(78, 0, "abcd");
    t_checkl(count_changed(), 4, "scr_ramp clips at both edges");
    t_check(scr_cell(0, 0) == 0x1762 && scr_cell(1, 0) == 0x1863, "the gradient counts the characters off the screen");
    t_check(scr_cell(78, 0) == 0x1861 && scr_cell(79, 0) == 0x1762, "and keeps the background");

    t_case("a box is clipped, its inside untouched");
    blank();
    scr_box(-1, -1, 4, 4, SCR_SINGLE, 7, 0);
    t_checkl(count_changed(), 5, "a box over the top left corner shows its right and bottom edges");
    t_check(scr_cell(2, 0) == 0x07B3 && scr_cell(2, 1) == 0x07B3 && scr_cell(0, 2) == 0x07C4 && scr_cell(2, 2) == 0x07D9,
            "the edge and the corner glyphs");
    blank();
    scr_box(10, 5, 4, 3, SCR_DOUBLE, 7, 0);
    t_checkl(count_changed(), 10, "a whole box draws its outline");
    t_check(scr_cell(10, 5) == 0x07C9 && scr_cell(13, 5) == 0x07BB && scr_cell(10, 7) == 0x07C8 && scr_cell(13, 7) == 0x07BC,
            "the corners");
    t_check(scr_cell(11, 5) == 0x07CD && scr_cell(12, 7) == 0x07CD && scr_cell(10, 6) == 0x07BA && scr_cell(13, 6) == 0x07BA,
            "the edges");
    t_check(scr_cell(11, 6) == 0x1E6B, "the inside");
    blank();
    scr_box(10, 5, 1, 3, SCR_SINGLE, 7, 0);
    scr_box(10, 5, 3, 1, SCR_SINGLE, 7, 0);
    t_checkl(count_changed(), 0, "a box under two cells either way draws nothing");
}

/* Each step draws the screen twice and DOSBox-X gives a program 60 s at its default speed, so a case changes each field the
   drawing reads once, and several fields at once when no two of them show in the same part. */

/* Opens a case named for the view and variant being run. */
static void kase(int variant, const char *name)
{
    char text[64];

    sprintf(text, "%s %d-OP: %s", role_mono() ? "mono" : "colour", variant, name);
    t_case(text);
}

static void piano(int variant, int thorough)
{
    kase(variant, "piano keys");
    restart(variant);
    t_checkl(press(SC_Z, "a piano key down"), SD_BOTTOM, "lights the key and names the note: the bottom bar alone");
    t_checkl(press(SC_Z, "a typematic repeat of it"), 0, "a repeat changes nothing");
    t_checkl(release(SC_Z, "the key up"), SD_BOTTOM, "puts the bottom bar back");
    if (!thorough) return;
    press(SC_Z, "a key with notes already held");
    press(SC_X, "a second");
    press(SC_C, "a third: the notes no longer fit");
    release(SC_X, "the second up, not the last");
    release(SC_Z, "the first up");
    release(SC_C, "the third up");
    editor_msg(&ed, "Can't write HEXX\\ELEC_GTR.RBP", R_WARNING);
    step("a long message");
    press(SC_Z, "a key down: the message has less room");
    release(SC_Z, "the key up: the message has room again");
}

/* A modifier is no part, and no draw: only the parts are checked, once the screen is known to be unchanged. */
static void modifiers(int variant)
{
    kase(variant, "a modifier alone changes nothing");
    restart(variant);
    key(SC_SHIFT);
    t_checkl(step("Shift down"), 0, "Shift down is no part");
    key(SC_SHIFT | KBD_BREAK);
    t_checkl(synth_parts(&shown, &ed), 0, "Shift up is no part");
    key(SC_CTRL);
    key(SC_ALT);
    t_checkl(synth_parts(&shown, &ed), 0, "Ctrl and Alt are no part");
    key(SC_ALT | KBD_BREAK);
    key(SC_CTRL | KBD_BREAK);
    key(SC_Z);
    other = ed;
    key(SC_SHIFT);
    t_checkl(synth_parts(&other, &ed), 0, "a modifier with a note held is no part either");
    key(SC_SHIFT | KBD_BREAK);
    key(SC_SHIFT | KBD_BREAK);
}

/* The focus two rows at a time down the whole order, then a value changed on each kind of row (the focus set straight to it). */
static void rows(int variant, int thorough)
{
    static const int kinds[] = {P_AR, P_MULT, P_WAVE, F_OCTAVE, F_CONN, F_FB};
    int i;

    kase(variant, "focus and values on every kind of row");
    restart(variant);
    if (thorough) {
        editor_focus(&ed, F_VARIANT);
        step("focus on Variant");
        for (i = 0; i < NAV_ROWS / 2; i++) {
            tap(SC_DOWN);
            tap(SC_DOWN);
            step("Down through the rows");
        }
    } else {
        for (i = F_VARIANT; i <= F_FB; i += 2) {
            editor_focus(&ed, i);
            step("focus on a row beyond the parameters");
        }
    }
    for (i = 0; i < (int)(sizeof kinds / sizeof kinds[0]); i++) {
        if (!thorough && (kinds[i] == F_OCTAVE || kinds[i] == P_WAVE)) continue;
        editor_focus(&ed, kinds[i]);
        tap(SC_RIGHT);
        step("Right on a row");
    }
    editor_focus(&ed, P_AR);
    (variant == 4 ? &ed.p.v4 : &ed.p.v2)->op[ed.cur].v[P_AR] = 0;
    step("a parameter at its lowest");
}

static void operators(int variant, int thorough)
{
    kase(variant, "operator and variant switches");
    restart(variant);
    ed.fk = P_AR;
    tap(SC_TAB);
    step("Tab");
    if (thorough) {
        key(SC_SHIFT);
        tap(SC_TAB);
        key(SC_SHIFT | KBD_BREAK);
        step("Shift+Tab");
        chord(SC_ALT, SC_1 + 2);
        step("Alt+3");
    }
    editor_focus(&ed, F_VARIANT);
    tap(SC_RIGHT);
    t_checkl(step("Variant switched"), SD_ALL, "a variant switch is every part");
    ed.cur = ed.n - 1;
    step("the last operator selected");
    tap(SC_RIGHT);
    t_checkl(step("a switch back with the last operator selected"), SD_ALL, "and so is the way back");
}

static void undo_redo(int variant)
{
    kase(variant, "undo and redo");
    restart(variant);
    ed.fk = P_AR;
    tap(SC_RIGHT);
    tap(SC_DOWN);
    tap(SC_RIGHT);
    step("two changes");
    chord(SC_CTRL, SC_Z);
    step("Ctrl+Z");
    chord(SC_CTRL, SC_Z);
    chord(SC_CTRL, SC_Y);
    step("Ctrl+Z, Ctrl+Y");
}

/* Random and Mutate change many values at once and light the last piano key; its key going up puts the bar back. */
static void dice(int variant, int thorough)
{
    kase(variant, "Random and Mutate");
    restart(variant);
    press(SC_F12, "Random");
    release(SC_F12, "Random's key up");
    press(SC_F11, "Mutate");
    release(SC_F11, "Mutate's key up");
    if (!thorough) return;
    press(SC_Z, "a piano key held");
    press(SC_F12, "Random over a held key");
    release(SC_F12, "F12 up leaves the piano's key lit");
    release(SC_Z, "the piano key up");
}

/* The notes held, as the bottom bar names them. */
static void held_names(char *out)
{
    int x;

    for (x = 0; x < HELD_CELLS; x++) out[x] = (char)(scr_cell(HELD_X + x, 24) & 0xFF);
    out[HELD_CELLS] = '\0';
    for (x = HELD_CELLS - 1; x >= 0 && out[x] == ' '; x--) out[x] = '\0';
}

/* The held notes are named by the pitch you hear: the patch's octave shifts the piano's, and 4 is no shift. */
static void octave_names(void)
{
    char names[HELD_CELLS + 1];
    int i;

    t_case("the held notes are named by the pitch you hear");
    restart(4);
    held_names(names);
    t_check(strcmp(names, "C4 G4") == 0, "octave 4: C4 and G4");
    chord(SC_CTRL, SC_UP);
    t_checkl(step("Ctrl+Up with notes held"), SD_TOP | SD_BOTTOM, "the octave and the names are redrawn");
    held_names(names);
    t_check(strcmp(names, "C5 G5") == 0, "octave 5: a note higher");
    for (i = 0; i < 2; i++) chord(SC_CTRL, SC_UP);
    step("up to the top");
    held_names(names);
    t_check(strcmp(names, "C7 G7") == 0, "octave 7");
    for (i = 0; i < 7; i++) chord(SC_CTRL, SC_DOWN);
    step("down to the bottom");
    held_names(names);
    t_check(strcmp(names, "C0 G0") == 0, "octave 0");
}

/* A key meant for the Save dialog, with what the editor asks of the main loop done. */
static void dialog_key(unsigned code)
{
    editor_act(&ed, &lib, editor_event(&ed, code), err, sizeof err);
    editor_event(&ed, code | KBD_BREAK);
}

/* What the dialog's last key changed: the dialog redraws the whole screen or nothing. It is then the state shown. */
static void dialog_parts(unsigned want, const char *what)
{
    t_checkl(synth_parts(&shown, &ed), want, what);
    shown = ed;
}

static void dialog_fields(int variant)
{
    kase(variant, "the Save dialog");
    restart(variant);
    key(SC_CTRL);
    dialog_key(SC_S);
    key(SC_CTRL | KBD_BREAK);
    t_checkl(ed.dialog, 1, "Ctrl+S opens the dialog");
    dialog_parts(SD_ALL, "opens: every part");
    dialog_key(SC_W);
    dialog_parts(SD_ALL, "a character typed in Name");
    dialog_key(SC_BACK);
    dialog_parts(SD_ALL, "Backspace");
    dialog_key(SC_RIGHT);
    dialog_parts(SD_ALL, "Right steps the bank, and the lines say another thing");
    dialog_key(SC_TAB);
    dialog_parts(SD_ALL, "Tab moves to the Bank field");
    dialog_key(SC_RIGHT);
    dialog_parts(SD_ALL, "Right again: a new bank");
    dialog_key(SC_W);
    dialog_parts(SD_ALL, "its name typed in the Bank field");
    dialog_key(SC_BACK);
    dialog_parts(SD_ALL, "and deleted again");
    dialog_key(SC_BACK);
    dialog_parts(0, "Backspace on an empty name changes nothing");
    dialog_key(SC_ENTER);
    dialog_parts(0, "Enter while the lines refuse changes nothing");
    t_checkl(ed.dialog, 1, "the dialog stays");
    dialog_key(SC_LEFT);
    dialog_parts(SD_ALL, "Left steps back");
    dialog_key(SC_ESC);
    t_checkl(ed.dialog, 0, "Esc closes the dialog");
    dialog_parts(SD_ALL, "closes: every part");
}

/* A press on each kind of control, then bars pressed and dragged. */
static void clicks(int variant, int thorough)
{
    static const struct {
        int kind, k, key;
    } press_on[] = {
        {SH_VARIANT, 0, 0}, {SH_VARIANT, 0, 0}, {SH_OCTAVE, 0, 0}, {SH_CONN_CYCLE, 0, 0}, {SH_FB, 0, 0}, {SH_ROW, 0, P_SL},
        {SH_CELL, 1, P_TREM}, {SH_CELL, 1, P_TREM}, {SH_CELL, 0, P_WAVE}, {SH_OPHEAD, 1, 0}, {SH_PIANO, 0, 7}, {SH_HELP, 0, 0}
    };
    SynthHit hit;
    int i;

    kase(variant, "presses on controls, bars and drags");
    restart(variant);
    for (i = 0; i < (int)(sizeof press_on / sizeof press_on[0]); i++) {
        if (!thorough && i % 4 != 0) continue;
        hit_at(press_on[i].kind, press_on[i].k, press_on[i].key, 0, 0, &hit);
        editor_press(&ed, &hit, 0);
        step("a press");
        if (hit.kind == SH_PIANO) {
            editor_key_up(&ed, hit.key);
            step("the piano key released");
        }
    }
    ed.help = 0;
    hit_at(SH_BAR, 1, P_OL, 30, 8, &hit);
    editor_press(&ed, &hit, 30);
    editor_bar(&ed, 1, P_OL, 30, 8, 34, 1);
    step("a press on a bar and a drag");
    editor_bar(&ed, 0, F_FB, 63, 7, 66, 1);
    chord(SC_CTRL, SC_UP);
    step("a drag over the Feedback bar and the patch's octave up with notes held");
}

/* Changes in the Editor that a save, the rescan after it, a reset or the prompt make, set straight into the fields. */
static void direct(int variant, int thorough)
{
    Voice *v;

    kase(variant, "fields set directly");
    restart(variant);
    v = variant == 4 ? &ed.p.v4 : &ed.p.v2;
    if (thorough) {
        ed.dirty = 0;
        t_checkl(step("clean"), SD_TOP, "the marker is the top bar's");
    }
    ed.bpos = 100;
    ed.btotal = 120;
    v->fb = 7;
    strcpy(ed.msg, "Saved");
    v->op[ed.cur].v[P_MULT] = 5;
    v->op[ed.cur].v[P_AR] = 3;
    t_checkl(step("a place in its bank, Feedback, a message, a multiplier and an attack rate"),
             SD_TOP | SD_VOICE | SD_GRID | SD_BAND | SD_BOTTOM, "each shows in its own part");
    strcpy(ed.folder, "HEXX");
    t_checkl(step("another bank"), SD_TOP, "the bank's name is the top bar's");
    ed.p.octave = 7;
    ed.held[0] = 0;
    ed.held[1] = 28;
    ed.nheld = 2;
    step("octave 7 and the lowest and highest keys held");
    strcpy(ed.p.name, "ABCDEFGH");
    strcpy(ed.folder, "ABCDEFGH");
    ed.msgRole = R_WARNING;
    v->conn = 1;
    step("eight-character names, a message role and another connection");
    ed.chip = 2;
    v->op[0].v[P_WAVE] = 6;
    v->op[1].v[P_WAVE] = 5;
    step("an OPL2: the Waveform limit and the 4-OP warning");
    ed.chip = 3;
    step("an OPL3 again");
}

/* What the overlays read is every part; no draw is needed to know. */
static void overlays(void)
{
    t_case("a pop-up is every part");
    restart(4);
    other = ed;
    other.help = 1;
    t_checkl(synth_parts(&ed, &other), SD_ALL, "the help opens");
    other.help = 2;
    t_checkl(synth_parts(&ed, &other), SD_ALL, "its other page");
    other = ed;
    other.prompt = 1;
    other.pend = EL_NEXT + 1;
    t_checkl(synth_parts(&ed, &other), SD_ALL, "the prompt opens");
    ed = other;
    other.btn = 2;
    t_checkl(synth_parts(&ed, &other), SD_ALL, "its focused button moves");
    other.btn = 0;
    other.pend = EL_LIST + 1;
    t_checkl(synth_parts(&ed, &other), SD_ALL, "the leave it guards changes");
    other.prompt = 0;
    t_checkl(synth_parts(&ed, &other), SD_ALL, "the prompt closes");
    other = ed;
    other.prompt = 0;
    other.dialog = 1;
    t_checkl(synth_parts(&ed, &other), SD_ALL, "the Save dialog opens");
    ed = other;
    other.dlg.field = 1;
    t_checkl(synth_parts(&ed, &other), SD_ALL, "its focused field moves");
    other = ed;
    strcpy(other.dlg.name, "BRASS");
    t_checkl(synth_parts(&ed, &other), SD_ALL, "its name changes");
    other = ed;
    other.dlg.ok = 1;
    t_checkl(synth_parts(&ed, &other), SD_ALL, "Save lights");
    other = ed;
    other.dlg.nsay = 1;
    t_checkl(synth_parts(&ed, &other), SD_ALL, "a line is added");
    ed = other;
    other.dlg.say[0].mark = '!';
    t_checkl(synth_parts(&ed, &other), SD_ALL, "a line gets its mark");
    other = ed;
    strcpy(other.dlg.say[0].value, "USER");
    t_checkl(synth_parts(&ed, &other), SD_ALL, "a line's value changes");
    other = ed;
    t_checkl(synth_parts(&ed, &other), 0, "an open dialog that did not change is no part");
    other.dialog = 0;
    t_checkl(synth_parts(&ed, &other), SD_ALL, "the dialog closes");
}

/* The parts that must not be drawn as well as the ones that must. */
static void selective(void)
{
    t_case("a change draws only the parts that show it");
    restart(4);
    ed.fk = P_AR;
    shown = ed;
    tap(SC_DOWN);
    t_checkl(step("focus to the next parameter"), SD_GRID, "a focus move between parameters is the grid");
    ed.fk = P_MULT;
    tap(SC_RIGHT);
    t_checkl(step("Multiplier"), SD_GRID, "a value the band does not show is the grid alone");
    ed.fk = P_AR;
    tap(SC_LEFT);
    t_checkl(step("Attack Rate"), SD_GRID | SD_BAND, "Attack Rate is the grid and the envelope");
    ed.dirty = 0;
    step("clean");
    tap(SC_LEFT);
    t_checkl(step("a first edit"), SD_TOP | SD_GRID | SD_BAND, "a first edit also lights the marker");
    editor_focus(&ed, F_FB);
    step("focus on Feedback");
    tap(SC_RIGHT);
    t_checkl(step("Feedback"), SD_VOICE, "Feedback is the voice block alone");
    editor_focus(&ed, F_OCTAVE);
    step("focus on Octave");
    tap(SC_RIGHT);
    t_checkl(step("Octave"), SD_TOP | SD_BOTTOM, "Octave is the top bar and the names of the notes held");
}

int main(void)
{
    t_case("init");
    t_checkl(editor_init(), 0, "the undo history allocates");
    opl_sink = sink;
    opl_init(3);
    make_library();

    primitives();
    selective();
    overlays();

    piano(4, 1);
    modifiers(4);
    rows(4, 1);
    operators(4, 1);
    undo_redo(4);
    dice(4, 1);
    octave_names();
    dialog_fields(4);
    clicks(4, 1);
    direct(4, 1);

    piano(2, 0);
    dialog_fields(2);
    rows(2, 0);
    operators(2, 0);
    dice(2, 0);
    clicks(2, 0);
    direct(2, 0);

    role_set_mono(1);
    rows(4, 0);
    dice(4, 0);
    role_set_mono(0);

    opl_sink = NULL;
    editor_done();
    return t_done();
}
