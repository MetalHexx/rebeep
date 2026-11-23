/* The editor's logic without drawing: value ranges and wrap, the Waveform limit by chip, the 4-OP variant made from a
   2-OP voice, undo coalescing, the name, the piano and its releases, the keys through the key table, a bar's mouse
   values and PgUp/PgDn across folders. */
#include <string.h>

#include "testlib.h"
#include "../../src/studio/editor.h"
#include "../../src/studio/kbd.h"
#include "../../src/studio/keys.h"
#include "../../src/studio/library.h"
#include "../../src/studio/log.h"
#include "../../src/studio/opl.h"
#include "../../src/studio/patch.h"
#include "../../src/studio/screens.h"

#define PROG "\\EDTREE\\PROG\\"

static Editor e;
static Patch base;
static Library lib;
static unsigned char shadow[512];
static int keyons;   /* writes that set a key-on bit */
static int keyoffs;  /* writes to a key register that clear it */
static int writes;

static void sink(unsigned reg, unsigned char val)
{
    unsigned lo = reg & 0xFF;

    shadow[reg] = val;
    writes++;
    if (lo >= 0xB0 && lo <= 0xB8) {
        if (val & 0x20) keyons++;
        else keyoffs++;
    }
}

static void fresh_chip(int chip)
{
    memset(shadow, 0, sizeof shadow);
    keyons = 0;
    keyoffs = 0;
    writes = 0;
    opl_sink = sink;
    opl_init(chip);
}

/* A recognisable 2-OP patch: every operator value is its row number plus the operator, within the range. */
static void make_base(int conn)
{
    int k;
    int row;

    memset(&base, 0, sizeof base);
    strcpy(base.name, "BASE");
    base.octave = 4;
    base.v2.conn = (unsigned char)conn;
    base.v2.fb = 3;
    for (k = 0; k < 2; k++) {
        for (row = 0; row < P_COUNT; row++) base.v2.op[k].v[row] = (unsigned char)((row + k + 1) % (P_MAX[row] + 1));
    }
}

static void open_base(int chip, int conn)
{
    make_base(conn);
    editor_open(&e, &base, chip, 1, 3);
}

static int fk_value(int row)
{
    return e.p.v2.op[e.cur].v[row];
}

/* Walks the focused row from one end of its range to the other with Left and Right; returns the lowest and highest
   value reached. */
static void sweep(int row, int *lo, int *hi)
{
    int i;

    e.fk = row;
    for (i = 0; i < 70; i++) editor_change(&e, -1, 0);
    *lo = fk_value(row);
    for (i = 0; i < 70; i++) editor_change(&e, 1, 0);
    *hi = fk_value(row);
}

static void put_patch(const char *file, int conn)
{
    memset(&base, 0, sizeof base);
    base.octave = 4;
    base.v2.conn = (unsigned char)conn;
    base.v2.op[0].v[P_AR] = 15;
    base.v2.op[1].v[P_OL] = 63;
    patch_write(file, &base);
}

static int op_equal(const Op *a, const Op *b)
{
    return memcmp(a, b, sizeof *a) == 0;
}

static int is_silent(const Op *o, const Op *like)
{
    Op want = *like;

    want.v[P_AR] = 0;
    want.v[P_OL] = 0;
    return op_equal(o, &want);
}

int main(void)
{
    int lo;
    int hi;
    int row;
    int ok;
    int i;
    char err[80];
    SynthHit hit;
    int x;

    t_case("init");
    t_checkl(editor_init(), 0, "undo history allocates");
    fresh_chip(3);

    t_case("each parameter row stays within its range");
    open_base(3, 0);
    ok = 1;
    for (row = 0; row < P_COUNT; row++) {
        sweep(row, &lo, &hi);
        if (row == P_WAVE) ok = ok && lo == 0 && hi == 7;
        else if (row == P_TREM || row == P_VIB || row == P_SUS || row == P_KSR) ok = ok && lo == 0 && hi == 1;
        else ok = ok && lo == 0 && hi == P_MAX[row];
    }
    t_check(ok, "0 to the row's maximum, Waveform to 7 on an OPL3, switches 0 and 1");

    t_case("a switch takes Left as Off and Right as On");
    e.fk = P_TREM;
    editor_change(&e, -1, 0);
    editor_change(&e, -1, 0);
    t_checkl(fk_value(P_TREM), 0, "Left twice stays Off");
    editor_change(&e, 1, 0);
    editor_change(&e, 1, 0);
    t_checkl(fk_value(P_TREM), 1, "Right twice stays On");

    t_case("Waveform stops at 3 on an OPL2 and a higher value is never raised");
    fresh_chip(2);
    open_base(2, 0);
    sweep(P_WAVE, &lo, &hi);
    t_checkl(hi, 3, "up to 3 on an OPL2");
    e.p.v2.op[0].v[P_WAVE] = 5;
    editor_change(&e, 1, 0);
    t_checkl(fk_value(P_WAVE), 5, "5 stays 5 on Right");
    editor_change(&e, -1, 0);
    t_checkl(fk_value(P_WAVE), 4, "Left steps down");
    fresh_chip(3);

    t_case("Connection wraps, Feedback and Octave stop");
    open_base(3, 0);
    e.fk = F_CONN;
    editor_change(&e, -1, 0);
    t_checkl(e.p.v2.conn, 1, "2-OP: FM wraps to AM");
    editor_change(&e, 1, 0);
    t_checkl(e.p.v2.conn, 0, "AM wraps to FM");
    e.p.has4 = 1;
    e.p.v4.conn = 0;
    e.n = 4;
    editor_change(&e, -1, 0);
    t_checkl(e.p.v4.conn, 3, "4-OP: FM-FM wraps to AM-AM");
    editor_change(&e, 1, 0);
    t_checkl(e.p.v4.conn, 0, "AM-AM wraps to FM-FM");
    e.n = 2;
    e.fk = F_FB;
    for (i = 0; i < 20; i++) editor_change(&e, 1, 0);
    t_checkl(e.p.v2.fb, 7, "Feedback tops out at 7");
    for (i = 0; i < 20; i++) editor_change(&e, -1, 0);
    t_checkl(e.p.v2.fb, 0, "and bottoms out at 0");
    e.fk = F_OCTAVE;
    for (i = 0; i < 20; i++) editor_change(&e, 1, 0);
    t_checkl(e.p.octave, 7, "Octave tops out at 7");
    for (i = 0; i < 20; i++) editor_change(&e, -1, 0);
    t_checkl(e.p.octave, 0, "and bottoms out at 0");

    t_case("a change marks the patch dirty and reprograms the voice; no change does neither");
    open_base(3, 0);
    t_checkl(e.dirty, 0, "a fresh patch is clean");
    e.fk = P_OL;
    e.cur = 1;
    e.p.v2.op[1].v[P_OL] = P_MAX[P_OL];
    fresh_chip(3);
    editor_change(&e, 1, 0);
    t_checkl(e.dirty, 0, "Right at the maximum changes nothing");
    editor_change(&e, -1, 0);
    t_checkl(e.dirty, 1, "Left does");
    t_check(writes > 0, "the registers were written");

    t_case("a 2-OP FM voice becomes FM-AM");
    open_base(3, 0);
    e.fk = F_VARIANT;
    editor_change(&e, 1, 0);
    t_checkl(e.n, 4, "4-OP shown");
    t_checkl(e.p.has4, 1, "the patch has the variant");
    t_checkl(e.p.v4.conn, 2, "FM-AM");
    t_checkl(e.p.v4.fb, 3, "feedback copied");
    t_check(op_equal(&e.p.v4.op[0], &base.v2.op[0]) && op_equal(&e.p.v4.op[1], &base.v2.op[1]), "operators 1 and 2 copied");
    t_check(is_silent(&e.p.v4.op[2], &base.v2.op[0]) && is_silent(&e.p.v4.op[3], &base.v2.op[1]),
            "operators 3 and 4 are copies with Attack Rate 0 and Output Level 0");
    t_check(strcmp(e.msg, "New 4-OP variant from 2-OP") == 0, "the message says so");
    t_checkl(e.dirty, 1, "the patch is dirty");
    editor_change(&e, 1, 0);
    t_checkl(e.n, 2, "Right again shows 2-OP");
    editor_change(&e, 1, 0);
    t_check(e.n == 4 && e.p.v4.conn == 2, "and 4-OP again keeps the variant");

    t_case("a 2-OP AM voice becomes AM-AM");
    open_base(3, 1);
    e.fk = F_VARIANT;
    editor_change(&e, -1, 0);
    t_checkl(e.p.v4.conn, 3, "AM-AM");
    t_check(op_equal(&e.p.v4.op[0], &base.v2.op[0]), "operator 1 copied");
    t_check(op_equal(&e.p.v4.op[3], &base.v2.op[1]), "operator 2 copied into operator 4");
    t_check(is_silent(&e.p.v4.op[1], &base.v2.op[0]) && is_silent(&e.p.v4.op[2], &base.v2.op[1]), "operators 2 and 3 silent");

    t_case("the variant is one undoable edit");
    editor_undo(&e);
    t_checkl(e.p.has4, 0, "undo removes the variant");
    t_checkl(e.n, 2, "and shows 2-OP");
    editor_redo(&e);
    t_check(e.p.has4 == 1 && e.p.v4.conn == 3, "redo brings it back");

    t_case("a held key is one undo step, separate presses are separate steps");
    open_base(3, 0);
    e.fk = P_DR;
    e.cur = 0;
    e.p.v2.op[0].v[P_DR] = 0;
    editor_change(&e, 1, 0);
    for (i = 0; i < 4; i++) editor_change(&e, 1, 1);
    t_checkl(fk_value(P_DR), 5, "five steps up");
    editor_undo(&e);
    t_checkl(fk_value(P_DR), 0, "one undo returns the whole sweep");
    t_check(strcmp(e.msg, "Undo") == 0, "the message says Undo");
    editor_redo(&e);
    t_checkl(fk_value(P_DR), 5, "redo restores the exact value");
    t_check(strcmp(e.msg, "Redo") == 0, "the message says Redo");
    editor_change(&e, 1, 0);
    editor_change(&e, 1, 0);
    editor_undo(&e);
    t_checkl(fk_value(P_DR), 6, "two presses undo one at a time");
    editor_change(&e, 1, 1);
    editor_move(&e, 1);
    editor_move(&e, -1);
    editor_change(&e, 1, 1);
    t_checkl(fk_value(P_DR), 8, "7, then 8 after the focus went and came back");
    editor_undo(&e);
    t_checkl(fk_value(P_DR), 7, "moving focus ends a held-key step");

    t_case("nothing to undo or redo");
    open_base(3, 0);
    editor_undo(&e);
    t_check(strcmp(e.msg, "Nothing to undo") == 0, "undo says so");
    editor_redo(&e);
    t_check(strcmp(e.msg, "Nothing to redo") == 0, "redo says so");

    t_case("Up and Down walk the rows in order");
    open_base(3, 0);
    e.fk = F_NAME;
    editor_move(&e, 1);
    t_checkl(e.fk, F_VARIANT, "name, then variant");
    editor_move(&e, 1);
    t_checkl(e.fk, F_OCTAVE, "octave");
    editor_move(&e, 1);
    t_checkl(e.fk, F_CONN, "connection");
    editor_move(&e, 1);
    t_checkl(e.fk, F_FB, "feedback");
    editor_move(&e, 1);
    t_checkl(e.fk, P_AR, "then the parameters");
    for (i = 0; i < 20; i++) editor_move(&e, 1);
    t_checkl(e.fk, P_KSR, "the last parameter row is the end");
    for (i = 0; i < 30; i++) editor_move(&e, -1);
    t_checkl(e.fk, F_NAME, "the name row is the top");

    t_case("operators: Alt digits, Tab and the 2-OP limit");
    open_base(3, 0);
    editor_op(&e, 1);
    t_checkl(e.cur, 1, "operator 2");
    editor_op(&e, 3);
    t_checkl(e.cur, 1, "operator 4 does not exist at 2-OP");
    e.fk = F_FB;
    editor_op(&e, 0);
    t_checkl(e.fk, e.lastP, "a non-parameter focus moves to the last parameter row");

    t_case("the name: characters, folding, length, Backspace, Esc and Enter");
    open_base(3, 0);
    e.p.name[0] = '\0';
    editor_name_add(&e, 'a');
    t_checkl(e.p.name[0], 0, "ignored while the name row is not focused");
    editor_focus(&e, F_NAME);
    editor_name_add(&e, 'a');
    editor_name_add(&e, 'z');
    editor_name_add(&e, '9');
    editor_name_add(&e, '_');
    editor_name_add(&e, '-');
    editor_name_add(&e, ' ');
    editor_name_add(&e, '.');
    editor_name_add(&e, '\\');
    t_check(strcmp(e.p.name, "AZ9_-") == 0, "lower case folded, others refused");
    editor_name_add(&e, 'b');
    editor_name_add(&e, 'c');
    editor_name_add(&e, 'd');
    editor_name_add(&e, 'e');
    t_check(strcmp(e.p.name, "AZ9_-BCD") == 0, "eight characters at most");
    editor_name_back(&e);
    t_check(strcmp(e.p.name, "AZ9_-BC") == 0, "Backspace deletes");
    t_checkl(e.dirty, 1, "typing marks the patch dirty");
    t_check(editor_name_esc(&e) == 1 && e.p.name[0] == '\0', "Esc restores the old name (empty here)");
    t_checkl(editor_name_esc(&e), 0, "Esc on an untouched name is left to the screen");
    editor_name_add(&e, 'q');
    editor_name_enter(&e);
    t_checkl(e.fk, F_VARIANT, "Enter ends editing");
    t_check(strcmp(e.p.name, "Q") == 0, "and keeps the name");
    editor_focus(&e, F_NAME);
    editor_name_add(&e, 'r');
    editor_name_add(&e, 's');
    editor_undo(&e);
    t_check(strcmp(e.p.name, "Q") == 0, "a typed run is one undo step");

    t_case("the piano: a key lights and sounds, a repeat is ignored, release stops it");
    fresh_chip(3);
    open_base(3, 0);
    keyons = 0;
    editor_key_down(&e, 0);
    editor_key_down(&e, 0);
    t_checkl(e.nheld, 1, "a typematic make does not add a second key");
    t_checkl(keyons, 1, "and does not retrigger the note");
    editor_key_down(&e, 28);
    editor_key_down(&e, 7);
    t_check(e.nheld == 3 && e.held[0] == 0 && e.held[1] == 7 && e.held[2] == 28, "held keys are kept ascending");
    keyoffs = 0;
    editor_key_up(&e, 7);
    t_check(e.nheld == 2 && keyoffs == 1, "a break releases the note");
    editor_key_up(&e, 7);
    t_checkl(keyoffs, 1, "a break for a key not down does nothing");

    t_case("every held note is released on the name, on a switch of focus to it, and on a pop-up");
    keyoffs = 0;
    editor_focus(&e, F_NAME);
    t_checkl(e.nheld, 0, "focus on the name clears the lit keys");
    t_check(keyoffs >= 1, "and keys the notes off");
    editor_key_down(&e, 3);
    t_checkl(e.nheld, 0, "the piano is silent while the name is focused");
    editor_focus(&e, P_AR);
    editor_key_down(&e, 3);
    editor_key_down(&e, 4);
    keyoffs = 0;
    editor_release(&e);
    t_check(e.nheld == 0 && keyoffs >= 2, "release stops every note");

    t_case("the keyboard octave moves within the range and releases the notes");
    editor_key_down(&e, 3);
    editor_kb_octave(&e, 1);
    t_check(e.kbOct == KB_LOW + 1 && e.nheld == 0, "up one octave");
    for (i = 0; i < 10; i++) editor_kb_octave(&e, 1);
    t_checkl(e.kbOct, KB_MAX, "stops at the top");
    for (i = 0; i < 10; i++) editor_kb_octave(&e, -1);
    t_checkl(e.kbOct, 0, "and at the bottom");

    t_case("no chip: the editor edits, the piano says it cannot play");
    open_base(0, 0);
    e.fk = P_AR;
    editor_change(&e, 1, 0);
    t_checkl(e.dirty, 1, "still edits");
    editor_key_down(&e, 2);
    t_check(strstr(e.msg, "cannot play") != NULL, "the message area says it cannot play");
    fresh_chip(3);

    t_case("the keys through the key table");
    open_base(3, 0);
    e.mods = 0;
    editor_event(&e, 0x2C);
    editor_event(&e, 0x2C);
    t_checkl(e.nheld, 1, "Z down, then its typematic repeat: one key");
    editor_event(&e, 0x2C | KBD_BREAK);
    t_checkl(e.nheld, 0, "Z up releases it");
    editor_event(&e, 0x1D);
    editor_event(&e, 0x48 | KBD_EXT);
    t_checkl(e.kbOct, KB_LOW + 1, "Ctrl+Up raises the keyboard octave");
    editor_event(&e, 0x2C);
    t_checkl(e.nheld, 0, "a piano letter with Ctrl held plays nothing");
    editor_event(&e, 0x1D | KBD_BREAK);
    t_checkl(editor_event(&e, 0x49 | KBD_EXT), EA_PREV, "PgUp asks for the previous patch");
    t_checkl(editor_event(&e, 0x01), EA_LIST, "Esc asks for the list");
    editor_event(&e, 0x50 | KBD_EXT);
    t_checkl(e.fk, P_DR, "Down moves the focus");
    editor_event(&e, 0x4D | KBD_EXT);
    editor_event(&e, 0x4D | KBD_EXT);
    editor_event(&e, 0x4D | KBD_EXT | KBD_BREAK);
    editor_event(&e, 0x1D);
    editor_event(&e, 0x2C);
    t_check(strcmp(e.msg, "Undo") == 0, "Ctrl+Z undoes");
    editor_event(&e, 0x1D | KBD_BREAK);
    editor_event(&e, 0x2C | KBD_BREAK);
    editor_focus(&e, F_NAME);
    e.p.name[0] = '\0';
    editor_event(&e, 0x1E);
    editor_event(&e, 0x1E | KBD_BREAK);
    editor_event(&e, 0x2A);
    editor_event(&e, 0x0C);
    editor_event(&e, 0x0C | KBD_BREAK);
    editor_event(&e, 0x2A | KBD_BREAK);
    t_check(strcmp(e.p.name, "A_") == 0, "typing in the name row: A, then Shift+minus");

    t_case("a click on a bar sets the value from the position");
    open_base(3, 0);
    synth_hit(&e, 24, 6, &hit);
    t_check(hit.kind == SH_CELL && hit.k == 0 && hit.key == P_AR, "the value text of operator 1's Attack Rate");
    synth_hit(&e, 30, 7, &hit);
    t_check(hit.kind == SH_BAR && hit.k == 0 && hit.key == P_DR && hit.bw > 0, "a bar");
    editor_press(&e, &hit, hit.bx + hit.bw - 1);
    t_checkl(e.p.v2.op[0].v[P_DR], 15, "the last cell is the maximum");
    editor_press(&e, &hit, hit.bx);
    t_checkl(e.p.v2.op[0].v[P_DR], 0, "the first cell is 0");
    editor_press(&e, &hit, hit.bx + hit.bw / 2);
    for (i = 0; i < hit.bw; i++) editor_bar(&e, 0, P_DR, hit.bx, hit.bw, hit.bx + i, 1);
    t_checkl(e.p.v2.op[0].v[P_DR], 15, "the drag ends at the maximum");
    editor_undo(&e);
    t_checkl(e.p.v2.op[0].v[P_DR], 0, "a click and the drag after it are one step");
    synth_hit(&e, 66, 3, &hit);
    t_checkl(hit.kind, SH_BAR, "the Feedback bar");
    e.cur = 1;
    editor_press(&e, &hit, hit.bx + hit.bw - 1);
    t_check(e.p.v2.fb == 7 && e.cur == 1, "a click on it sets Feedback and keeps the selected operator");
    for (x = 0; x < 79; x++) {
        synth_hit(&e, x, 0, &hit);
        if (hit.kind == SH_OCTAVE) break;
    }
    t_checkl(hit.kind, SH_OCTAVE, "the Octave control");
    e.p.octave = 6;
    editor_press(&e, &hit, x);
    t_check(e.fk == F_OCTAVE && e.p.octave == 6, "a first click only focuses Octave");
    editor_press(&e, &hit, x);
    t_checkl(e.p.octave, 7, "a second click steps it");
    editor_press(&e, &hit, x);
    t_checkl(e.p.octave, 0, "and wraps from 7 to 0");
    synth_hit(&e, 24, 13, &hit);
    t_check(hit.kind == SH_CELL && hit.key == P_WAVE, "operator 1's Waveform cell");
    e.p.v2.op[0].v[P_WAVE] = 6;
    editor_press(&e, &hit, 24);
    t_check(e.fk == P_WAVE && e.p.v2.op[0].v[P_WAVE] == 6, "a first click only focuses Waveform");
    editor_press(&e, &hit, 24);
    t_checkl(e.p.v2.op[0].v[P_WAVE], 7, "a second click steps it on an OPL3");
    editor_press(&e, &hit, 24);
    t_checkl(e.p.v2.op[0].v[P_WAVE], 0, "and wraps from 7 to 0");
    fresh_chip(2);
    open_base(2, 0);
    e.p.v2.op[0].v[P_WAVE] = 3;
    editor_press(&e, &hit, 24);
    editor_press(&e, &hit, 24);
    t_checkl(e.p.v2.op[0].v[P_WAVE], 0, "on an OPL2 it wraps from 3 to 0");
    e.p.v2.op[0].v[P_WAVE] = 5;
    editor_press(&e, &hit, 24);
    t_checkl(e.p.v2.op[0].v[P_WAVE], 0, "a value above the limit goes down, never up");
    fresh_chip(3);
    open_base(3, 0);
    synth_hit(&e, 3 + 12, 24, &hit);
    t_check(hit.kind == SH_PIANO && hit.key == 12, "a piano key");
    synth_hit(&e, 74, 24, &hit);
    t_checkl(hit.kind, SH_HELP, "F1 Help");

    t_case("PgUp and PgDn walk the list order across folders and wrap");
    put_patch("EDTREE\\PROG\\FACTORY\\AAA.RBP", 0);
    put_patch("EDTREE\\PROG\\FACTORY\\BBB.RBP", 1);
    put_patch("EDTREE\\PROG\\PATCHES\\USER\\CCC.RBP", 0);
    put_patch("EDTREE\\PROG\\PATCHES\\PACK\\DDD.RBP", 1);
    log_open("EDTREE.LOG");
    memset(&lib, 0, sizeof lib);
    t_checkl(lib_scan(&lib, PROG, NULL), 0, "scan");
    t_checkl(editor_load(&e, &lib, 0, err, sizeof err), 0, "load the first patch");
    t_check(strcmp(e.p.name, "AAA") == 0 && e.pos == 1 && e.total == 4, "AAA is 1 of 4");
    editor_key_down(&e, 5);
    e.fk = P_AR;
    editor_change(&e, -1, 0);
    editor_change(&e, 1, 0);
    keyoffs = 0;
    t_checkl(editor_leave(&e, &lib, EL_NEXT, err, sizeof err), 0, "PgDn on a dirty patch asks first");
    t_check(e.prompt == 1 && strcmp(e.p.name, "AAA") == 0, "the prompt is open over AAA");
    t_checkl(editor_act(&e, &lib, EA_PICK + 2, err, sizeof err), 0, "Discard goes on to the next patch");
    t_check(strcmp(e.p.name, "BBB") == 0 && e.pos == 2, "FACTORY\\BBB");
    t_check(e.nheld == 0 && keyoffs >= 1, "the held note was released");
    t_checkl(e.dirty, 0, "the new patch is clean");
    editor_undo(&e);
    t_check(strcmp(e.msg, "Nothing to undo") == 0, "switching patch cleared undo");
    editor_leave(&e, &lib, EL_NEXT, err, sizeof err);
    t_check(strcmp(e.p.name, "CCC") == 0, "then the USER folder");
    editor_leave(&e, &lib, EL_NEXT, err, sizeof err);
    t_check(strcmp(e.p.name, "DDD") == 0, "then the pack");
    editor_leave(&e, &lib, EL_NEXT, err, sizeof err);
    t_check(strcmp(e.p.name, "AAA") == 0 && e.pos == 1, "PgDn from the last wraps to the first");
    editor_leave(&e, &lib, EL_PREV, err, sizeof err);
    t_check(strcmp(e.p.name, "DDD") == 0 && e.pos == 4, "PgUp from the first wraps to the last");
    t_checkl(editor_leave(&e, &lib, EL_LIST, err, sizeof err), 1, "leaving for the list");
    lib_free(&lib);
    log_close();

    opl_sink = NULL;
    editor_done();
    return t_done();
}
