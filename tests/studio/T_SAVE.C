/* Saving through the Save dialog: what each row of its table says and does (a new patch, the patch you opened, another
   file of that name, a factory name in USER, an override that matches or is removed, an existing or a new bank, the
   refusals), the starting bank, the bank steps, the mouse, a new bank's folder made even under a long path, a failed
   write that keeps the old file, the list full, Reset to factory, the unsaved-changes prompt guarding a leave, the help's
   keys, and every non-piano binding documented by a help row. The tree is built on the DOSBox-X C: at run time. */
#include <direct.h>
#include <dos.h>
#include <malloc.h>
#include <stdio.h>
#include <string.h>

#include "testlib.h"
#include "../../src/studio/dos.h"
#include "../../src/studio/editor.h"
#include "../../src/studio/kbd.h"
#include "../../src/studio/keys.h"
#include "../../src/studio/library.h"
#include "../../src/studio/log.h"
#include "../../src/studio/opl.h"
#include "../../src/studio/patch.h"
#include "../../src/studio/screens.h"

#define PROG "\\SVTREE\\PROG\\"
#define PATCHES "SVTREE\\PROG\\PATCHES\\"
#define FACTORY "SVTREE\\PROG\\FACTORY\\"
#define LONG_PROG "\\SVTREE\\LONGDIR1\\LONGDIR2\\LONGDIR3\\LONGDIR4\\LONGDIR5\\LONGDIR6\\LONGDIR7\\"
#define LONG_PATCHES "SVTREE\\LONGDIR1\\LONGDIR2\\LONGDIR3\\LONGDIR4\\LONGDIR5\\LONGDIR6\\LONGDIR7\\PATCHES\\"

#define SC_ESC 0x01
#define SC_BACK 0x0E
#define SC_ENTER 0x1C
#define SC_CTRL 0x1D
#define SC_SHIFT 0x2A
#define SC_S 0x1F
#define SC_D 0x20
#define SC_C 0x2E
#define SC_R 0x13
#define SC_F1 0x3B
#define SC_MINUS 0x0C
#define SC_UP (0x48 | KBD_EXT)
#define SC_DOWN (0x50 | KBD_EXT)
#define SC_LEFT (0x4B | KBD_EXT)
#define SC_RIGHT (0x4D | KBD_EXT)
#define SC_TAB 0x0F

static Editor e;
static Library lib;
static Patch patch;
static Patch read_back;
static char err[80];

static void sink(unsigned reg, unsigned char val)
{
    (void)reg;
    (void)val;
}

/* A recognisable patch: Attack Rate of operator 1 is `ar`, the rest is fixed. */
static void put_patch(const char *file, int ar)
{
    memset(&patch, 0, sizeof patch);
    patch.octave = 4;
    patch.v2.conn = 0;
    patch.v2.fb = 2;
    patch.v2.op[0].v[P_AR] = (unsigned char)ar;
    patch.v2.op[0].v[P_OL] = 40;
    patch.v2.op[1].v[P_OL] = 50;
    patch.v2.op[1].v[P_AR] = 15;
    patch_write(file, &patch);
}

/* Reads the tree on disk into `lib` from scratch. */
static void reload(void)
{
    lib_open(&lib, PROG, NULL);
    lib_load(&lib, NULL, NULL);
}

/* The tree before each case: the factory BELL and ORGAN, the USER ORGAN, and the bank HEXX with an ORGAN equal to the
   factory one and a SOLO. Files a case added are removed. */
static void fresh(void)
{
    remove(PATCHES "USER\\BELL.RBP");
    remove(PATCHES "USER\\BELL2.RBP");
    remove(PATCHES "USER\\SOLO.RBP");
    remove(PATCHES "USER\\ORGAN.RBP");
    remove(PATCHES "HEXX\\BELL2.RBP");
    remove(PATCHES "MYBANK\\BELL.RBP");
    rmdir(PATCHES "MYBANK");
    _dos_setfileattr(PATCHES "USER\\ORGAN.$$$", _A_NORMAL);
    remove(PATCHES "USER\\ORGAN.$$$");
    put_patch(FACTORY "BELL.RBP", 7);
    put_patch(FACTORY "ORGAN.RBP", 9);
    put_patch(PATCHES "USER\\ORGAN.RBP", 5);
    put_patch(PATCHES "HEXX\\ORGAN.RBP", 9);
    put_patch(PATCHES "HEXX\\SOLO.RBP", 7);
    reload();
}

static void with_user_bell(void)
{
    put_patch(PATCHES "USER\\BELL.RBP", 3);
    reload();
}

static void open_patch(const char *spec)
{
    int i = lib_find(&lib, spec);

    if (i < 0 || editor_load(&e, &lib, i, err, sizeof err) != 0) t_check(0, spec);
}

static int exists(const char *path)
{
    return dos_is_file(path);
}

/* The Attack Rate of operator 1 in the file at `path`, or -1 when it is missing or unreadable. */
static int file_ar(const char *path)
{
    if (patch_read(path, &read_back, err, sizeof err) != 0) return -1;
    return read_back.v2.op[0].v[P_AR];
}

static void tweak(void)
{
    e.fk = P_AR;
    e.cur = 0;
    editor_change(&e, 1, 0);
}

/* A key with Ctrl held: returns what editor_event said for the make. */
static int ctrl_key(unsigned scan)
{
    int act;

    editor_event(&e, SC_CTRL);
    act = editor_event(&e, scan);
    editor_event(&e, scan | KBD_BREAK);
    editor_event(&e, SC_CTRL | KBD_BREAK);
    return act;
}

static int key(unsigned scan)
{
    int act = editor_event(&e, scan);

    editor_event(&e, scan | KBD_BREAK);
    return act;
}

static int act_on(int act)
{
    return editor_act(&e, &lib, act, err, sizeof err);
}

/* A key through the editor and the main loop: what editor_act then says. */
static int press(unsigned scan)
{
    return act_on(key(scan));
}

/* Ctrl+S, with the dialog's lines worked out. */
static void open_dialog(void)
{
    act_on(ctrl_key(SC_S));
}

static unsigned scan_of(char c)
{
    static const char top[] = "QWERTYUIOP";
    static const char home[] = "ASDFGHJKL";
    static const char bottom[] = "ZXCVBNM";
    const char *at;

    if (c >= '1' && c <= '9') return 0x02u + (unsigned)(c - '1');
    if (c == '0') return 0x0B;
    if (c == '-' || c == '_') return SC_MINUS;
    if ((at = strchr(top, c)) != NULL) return 0x10u + (unsigned)(at - top);
    if ((at = strchr(home, c)) != NULL) return 0x1Eu + (unsigned)(at - home);
    if ((at = strchr(bottom, c)) != NULL) return 0x2Cu + (unsigned)(at - bottom);
    return 0;
}

/* Types `text` into the focused field, a character at a time. */
static void type_text(const char *text)
{
    for (; *text != '\0'; text++) {
        if (*text == '_') editor_event(&e, SC_SHIFT);
        press(scan_of(*text));
        if (*text == '_') editor_event(&e, SC_SHIFT | KBD_BREAK);
    }
}

/* Replaces the dialog's Name. */
static void name_is(const char *name)
{
    e.dlg.field = 0;
    while (e.dlg.name[0] != '\0') press(SC_BACK);
    type_text(name);
}

/* The bank chosen is `bank` steps from USER, stepping Right. */
static void bank_step(int steps)
{
    while (steps-- > 0) press(SC_RIGHT);
}

/* Moves to the Bank field, to a new bank, and types its name. */
static void new_bank(const char *name)
{
    bank_step(e.dlg.banks + 1 - e.dlg.bank);
    press(SC_TAB);
    type_text(name);
}

/* Is line `i` of the dialog [mark, label, value]. */
static int says(int i, char mark, const char *label, const char *value)
{
    const SayLine *l = &e.dlg.say[i];

    return i < e.dlg.nsay && l->mark == mark && strcmp(l->label, label) == 0 && strcmp(l->value, value) == 0;
}

static int entry_is(int pos, const char *folder, const char *name)
{
    const Entry __far *en = lib_entry(&lib, pos - 1);

    return en != NULL && _fstrcmp(en->folder, folder) == 0 && _fstrcmp(en->name, name) == 0;
}

static int documented(int id)
{
    int i;
    int j;

    for (i = 0; i < HELP_ROW_COUNT; i++) {
        if (HELP_ROWS[i].ids == NULL) continue;
        for (j = 0; HELP_ROWS[i].ids[j] != 0; j++) {
            if (HELP_ROWS[i].ids[j] == id) return 1;
        }
    }
    return 0;
}

/* The refusals under the fields, which the dialog is left open for. */
static void refused(const char *what, char mark, const char *label, const char *value)
{
    t_check(says(0, mark, label, value) && e.dlg.nsay == 1 && e.dlg.ok == 0, what);
}

int main(void)
{
    static Library full;
    static Library saved;
    int i;

    opl_sink = sink;
    opl_init(3);
    log_open("SVTREE.LOG");
    memset(&lib, 0, sizeof lib);
    editor_init();
    fresh();

    t_case("Ctrl+S opens the dialog on the patch's name, a factory patch on USER");
    open_patch("FACTORY\\BELL");
    tweak();
    t_checkl(ctrl_key(SC_S), EA_SAVE, "Ctrl+S asks for the dialog");
    t_checkl(act_on(EA_SAVE), 0, "the dialog opens, the editor stays");
    t_check(e.dialog == 1 && e.prompt == 0 && e.pend == 0, "open, no prompt and no leave behind it");
    t_check(strcmp(e.dlg.name, "BELL") == 0 && e.dlg.field == 0, "the name is filled in and focused");
    t_check(e.dlg.bank == 0 && strcmp(e.dlg.folder, "USER") == 0, "FACTORY is never written: the bank starts on USER");
    t_check(e.dlg.nsay == 3 && says(0, ' ', "New patch:", "USER\\BELL.RBP"), "New patch: USER\\BELL.RBP");
    t_check(says(1, '!', "Overrides:", "FACTORY\\BELL"), "! Overrides: FACTORY\\BELL, new");
    t_check(says(2, ' ', "In games:", "/P:BELL") && e.dlg.ok == 1, "In games: /P:BELL, and Enter would save");
    t_check(!exists(PATCHES "USER\\BELL.RBP"), "nothing written yet");
    t_checkl(press(SC_ESC), 0, "Esc cancels");
    t_check(e.dialog == 0 && e.dirty == 1 && !exists(PATCHES "USER\\BELL.RBP"), "closed, still unsaved, nothing written");
    editor_undo(&e);
    t_checkl(e.dirty, 0, "undo after the cancel is clean");
    editor_redo(&e);
    t_checkl(e.dirty, 1, "and redo is unsaved");

    t_case("Enter at once saves a factory patch as its USER override");
    open_dialog();
    t_checkl(press(SC_ENTER), 0, "Enter stays in the editor");
    t_checkl(file_ar(PATCHES "USER\\BELL.RBP"), 8, "USER\\BELL.RBP holds the changed value");
    t_checkl(file_ar(FACTORY "BELL.RBP"), 7, "FACTORY\\BELL is untouched");
    t_check(strcmp(e.folder, "USER") == 0 && strcmp(e.file, "BELL") == 0 && entry_is(e.pos, "USER", "BELL"), "the open patch is USER\\BELL");
    t_check(lib_entry(&lib, e.pos - 1)->overrides == 1, "the list marks it as an override");
    t_check(e.dirty == 0 && e.dialog == 0 && strcmp(e.msg, "Saved USER\\BELL") == 0, "clean, closed, with Saved USER\\BELL");
    t_check(e.bpos == 1 && e.btotal == 2 && e.total == 6, "1 of 2 in USER");

    t_case("your own override, saved again: Updates, and no ! on the override");
    tweak();
    open_dialog();
    t_check(e.dlg.nsay == 3 && says(0, ' ', "Updates:", "USER\\BELL.RBP"), "Updates: USER\\BELL.RBP");
    t_check(says(1, ' ', "Overrides:", "FACTORY\\BELL"), "Overrides: FACTORY\\BELL without a !");
    t_check(says(2, ' ', "In games:", "/P:BELL"), "In games: /P:BELL");
    press(SC_ENTER);
    t_checkl(file_ar(PATCHES "USER\\BELL.RBP"), 9, "USER\\BELL.RBP holds the newer value");
    t_check(!exists(PATCHES "USER\\BELL.BAK") && !exists(PATCHES "USER\\BELL.$$$"), "no leftovers");

    t_case("a new name saves a copy: New patch, and no override for a name the factory lacks");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    open_dialog();
    name_is("BELL2");
    t_check(e.dlg.nsay == 2 && says(0, ' ', "New patch:", "USER\\BELL2.RBP") && says(1, ' ', "In games:", "/P:BELL2"), "the lines follow the name");
    press(SC_ENTER);
    t_checkl(file_ar(PATCHES "USER\\BELL2.RBP"), 8, "USER\\BELL2.RBP written");
    t_check(!exists(PATCHES "USER\\BELL.RBP"), "no USER\\BELL");
    t_checkl(file_ar(FACTORY "BELL.RBP"), 7, "FACTORY\\BELL unchanged");
    t_check(strcmp(e.folder, "USER") == 0 && strcmp(e.file, "BELL2") == 0 && strcmp(e.p.name, "BELL2") == 0 && e.dirty == 0,
            "now USER\\BELL2, clean");
    t_check(strcmp(e.msg, "Saved USER\\BELL2") == 0 && entry_is(e.pos, "USER", "BELL2"), "listed, with the message");

    t_case("another file of that name: ! Replaces, and only the replaced file changes");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    open_dialog();
    name_is("ORGAN");
    t_check(e.dlg.nsay == 3 && says(0, '!', "Replaces:", "USER\\ORGAN.RBP"), "! Replaces: USER\\ORGAN.RBP");
    t_check(says(1, ' ', "Overrides:", "FACTORY\\ORGAN") && says(2, ' ', "In games:", "/P:ORGAN"), "the override already exists");
    bank_step(1);
    t_check(strcmp(e.dlg.folder, "HEXX") == 0 && says(0, '!', "Replaces:", "HEXX\\ORGAN.RBP"), "! Replaces: HEXX\\ORGAN.RBP in the bank");
    t_check(e.dlg.nsay == 2 && says(1, ' ', "In games:", "/P:HEXX\\ORGAN"), "In games: /P:HEXX\\ORGAN");
    bank_step(2);
    t_check(e.dlg.bank == 0 && says(0, '!', "Replaces:", "USER\\ORGAN.RBP"), "back on USER");
    press(SC_ENTER);
    t_checkl(file_ar(PATCHES "USER\\ORGAN.RBP"), 8, "USER\\ORGAN replaced");
    t_checkl(file_ar(PATCHES "HEXX\\ORGAN.RBP"), 9, "HEXX\\ORGAN untouched");
    t_check(strcmp(e.folder, "USER") == 0 && strcmp(e.file, "ORGAN") == 0 && e.dirty == 0, "the open patch is USER\\ORGAN");

    t_case("the patch you opened from another bank updates there, with no warning");
    fresh();
    open_patch("HEXX\\SOLO");
    tweak();
    open_dialog();
    t_check(e.dlg.bank == 1 && strcmp(e.dlg.folder, "HEXX") == 0, "the bank starts on its own");
    t_check(e.dlg.nsay == 2 && says(0, ' ', "Updates:", "HEXX\\SOLO.RBP") && says(1, ' ', "In games:", "/P:HEXX\\SOLO"), "Updates: HEXX\\SOLO.RBP");
    press(SC_ENTER);
    t_checkl(file_ar(PATCHES "HEXX\\SOLO.RBP"), 8, "HEXX\\SOLO rewritten in place");
    t_check(!exists(PATCHES "USER\\SOLO.RBP"), "no copy in USER");
    t_check(strcmp(e.folder, "HEXX") == 0 && e.dirty == 0, "still HEXX\\SOLO, clean");
    t_check(e.bpos == 2 && e.btotal == 2, "2 of 2 in HEXX");

    t_case("a copy into an existing bank");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    open_dialog();
    bank_step(1);
    name_is("BELL2");
    t_check(e.dlg.nsay == 2 && says(0, ' ', "New patch:", "HEXX\\BELL2.RBP") && says(1, ' ', "In games:", "/P:HEXX\\BELL2"), "New patch: HEXX\\BELL2.RBP");
    press(SC_ENTER);
    t_checkl(file_ar(PATCHES "HEXX\\BELL2.RBP"), 8, "HEXX\\BELL2.RBP written");
    t_check(strcmp(e.folder, "HEXX") == 0 && strcmp(e.file, "BELL2") == 0 && entry_is(e.pos, "HEXX", "BELL2"), "the open patch is HEXX\\BELL2");
    t_check(e.bpos == 1 && e.btotal == 3, "1 of 3 in HEXX");
    t_check(!exists(PATCHES "USER\\BELL2.RBP"), "nothing in USER");

    t_case("a copy into a new bank makes its folder and lists it in its place");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    open_dialog();
    new_bank("MYBANK");
    t_checkl(e.dlg.field, 1, "the Bank field takes the name");
    t_check(e.dlg.nsay == 3 && says(0, ' ', "New bank:", "MYBANK") && says(1, ' ', "New patch:", "MYBANK\\BELL.RBP"), "New bank, New patch");
    t_check(says(2, ' ', "In games:", "/P:MYBANK\\BELL") && e.dlg.ok == 1, "In games: /P:MYBANK\\BELL");
    t_check(!dos_is_dir(PATCHES "MYBANK"), "the folder is not made yet");
    press(SC_ENTER);
    t_check(dos_is_dir(PATCHES "MYBANK"), "the folder is made");
    t_checkl(file_ar(PATCHES "MYBANK\\BELL.RBP"), 8, "MYBANK\\BELL.RBP written");
    t_check(strcmp(e.folder, "MYBANK") == 0 && strcmp(e.file, "BELL") == 0 && entry_is(e.pos, "MYBANK", "BELL"), "the open patch is MYBANK\\BELL");
    t_check(e.pos == 6 && e.bpos == 1 && e.btotal == 1 && e.total == 6, "listed after HEXX: 1 of 1, 6 of 6");
    t_check(strcmp(e.msg, "Saved MYBANK\\BELL") == 0, "Saved MYBANK\\BELL");
    t_check(!exists(PATCHES "USER\\BELL.RBP"), "USER untouched");

    t_case("values equal to the factory patch remove the override");
    fresh();
    with_user_bell();
    open_patch("USER\\BELL");
    t_checkl(act_on(ctrl_key(SC_R)), 0, "Ctrl+R");
    t_check(strcmp(e.msg, "Factory values loaded") == 0 && e.dirty == 1, "the factory values, unsaved");
    t_checkl(file_ar(PATCHES "USER\\BELL.RBP"), 3, "the file is not touched yet");
    open_dialog();
    t_check(e.dlg.nsay == 2 && says(0, ' ', "Matches:", "FACTORY\\BELL") && says(1, ' ', "Removes:", "USER\\BELL.RBP"), "Matches, Removes");
    t_checkl(e.dlg.ok, 1, "Enter would save");
    t_checkl(press(SC_ENTER), 0, "Enter");
    t_check(!exists(PATCHES "USER\\BELL.RBP"), "USER\\BELL is gone");
    t_check(strcmp(e.msg, "Override removed") == 0 && e.dialog == 0, "Override removed");
    t_check(strcmp(e.folder, "FACTORY") == 0 && entry_is(e.pos, "FACTORY", "BELL"), "the open patch is FACTORY\\BELL");
    t_check(lib_find(&lib, "USER\\BELL") < 0 && e.dirty == 0, "the list lost the override, clean");
    t_checkl(file_ar(FACTORY "BELL.RBP"), 7, "the factory patch is untouched");

    t_case("values equal to the factory patch with no override: Nothing to save, and Enter does nothing");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    editor_undo(&e);
    t_checkl(e.dirty, 0, "undone back to the factory patch: clean");
    open_dialog();
    t_check(e.dlg.nsay == 2 && says(0, ' ', "Matches:", "FACTORY\\BELL") && says(1, ' ', "Nothing to save", ""), "Matches, Nothing to save");
    t_checkl(e.dlg.ok, 0, "Enter would not save");
    t_checkl(press(SC_ENTER), 0, "Enter");
    t_check(e.dialog == 1 && !exists(PATCHES "USER\\BELL.RBP") && e.dirty == 0, "nothing written, the dialog stays");
    bank_step(1);
    t_check(says(0, ' ', "New patch:", "HEXX\\BELL.RBP") && e.dlg.ok == 1, "only USER matches: in another bank it is a copy");
    press(SC_ESC);

    t_case("a bank patch equal to the factory one updates its bank; the removal is offered in USER only");
    fresh();
    open_patch("HEXX\\ORGAN");
    editor_change(&e, 1, 0);
    editor_change(&e, -1, 0);
    open_dialog();
    t_check(e.dlg.bank == 1 && says(0, ' ', "Updates:", "HEXX\\ORGAN.RBP") && e.dlg.ok == 1, "it updates HEXX\\ORGAN");
    bank_step(2);
    t_check(e.dlg.bank == 0 && says(0, ' ', "Matches:", "FACTORY\\ORGAN") && says(1, ' ', "Removes:", "USER\\ORGAN.RBP"), "in USER it would remove the override");
    press(SC_ESC);
    t_checkl(file_ar(PATCHES "USER\\ORGAN.RBP"), 5, "USER\\ORGAN still there");

    t_case("the refusals leave Enter doing nothing");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    open_dialog();
    name_is("");
    refused("an empty name", '!', "Name:", "up to 8 letters, digits, - and _");
    name_is("12345");
    refused("a name of digits", '!', "Name:", "up to 8 letters, digits, - and _");
    type_text("A");
    t_check(e.dlg.ok == 1, "a letter makes it a name");
    name_is("A_B-9");
    t_check(e.dlg.ok == 1 && strcmp(e.dlg.name, "A_B-9") == 0, "letters, digits, - and _ are names");
    name_is("ABCDEFGH");
    type_text("I");
    t_check(strcmp(e.dlg.name, "ABCDEFGH") == 0, "at most eight characters");
    name_is("");
    t_checkl(press(SC_ENTER), 0, "Enter on a refused name");
    t_check(e.dialog == 1 && e.dirty == 1, "the dialog stays open");
    name_is("BELL");
    bank_step(e.dlg.banks + 1);
    refused("a new bank with no name", ' ', "Bank name:", "type it in Bank");
    press(SC_TAB);
    type_text("123");
    refused("a bank of digits", '!', "Bank name:", "up to 8 letters, digits, - and _");
    press(SC_BACK);
    press(SC_BACK);
    press(SC_BACK);
    type_text("HEXX");
    refused("a bank that exists", '!', "Bank name:", "HEXX exists, choose it with \x11 \x10");
    press(SC_BACK);
    press(SC_BACK);
    press(SC_BACK);
    press(SC_BACK);
    type_text("USER");
    refused("USER is taken", '!', "Bank name:", "FACTORY and USER are taken");
    for (i = 0; i < 4; i++) press(SC_BACK);
    type_text("FACTORY");
    refused("FACTORY is taken", '!', "Bank name:", "FACTORY and USER are taken");
    t_checkl(press(SC_ENTER), 0, "Enter");
    t_check(e.dialog == 1 && !dos_is_dir(PATCHES "FACTORY") && file_ar(FACTORY "BELL.RBP") == 7, "FACTORY is never written");
    t_check(e.dlg.nsay == 1, "the refusal stays up");
    press(SC_ESC);

    t_case("Left and Right step USER, the banks and a new bank, never FACTORY");
    fresh();
    open_patch("FACTORY\\BELL");
    open_dialog();
    t_check(e.dlg.banks == 1 && e.dlg.bank == 0, "USER, and one other bank");
    press(SC_RIGHT);
    t_check(e.dlg.bank == 1 && strcmp(e.dlg.folder, "HEXX") == 0, "Right: HEXX");
    press(SC_RIGHT);
    t_check(e.dlg.bank == 2 && e.dlg.folder[0] == '\0', "Right: a new bank");
    press(SC_RIGHT);
    t_check(e.dlg.bank == 0 && strcmp(e.dlg.folder, "USER") == 0, "Right: back to USER");
    press(SC_LEFT);
    t_check(e.dlg.bank == 2, "Left from USER: the new bank");
    press(SC_LEFT);
    t_check(strcmp(e.dlg.folder, "HEXX") == 0, "Left: HEXX");
    press(SC_TAB);
    press(SC_RIGHT);
    t_checkl(e.dlg.field, 1, "the bank steps from either field");
    for (i = 0; i < 12; i++) {
        press(SC_RIGHT);
        t_check(strcmp(e.dlg.folder, "FACTORY") != 0, "FACTORY is never offered");
    }
    press(SC_UP);
    t_checkl(e.dlg.field, 0, "Up changes field");
    press(SC_DOWN);
    t_checkl(e.dlg.field, 1, "Down changes field");
    press(SC_TAB);
    t_checkl(e.dlg.field, 0, "Tab changes field");
    editor_event(&e, SC_SHIFT);
    press(SC_TAB);
    editor_event(&e, SC_SHIFT | KBD_BREAK);
    t_checkl(e.dlg.field, 1, "so does Shift+Tab");
    press(SC_ESC);

    t_case("the dialog starts on the open patch's own bank");
    fresh();
    open_patch("USER\\ORGAN");
    open_dialog();
    t_check(e.dlg.bank == 0 && strcmp(e.dlg.folder, "USER") == 0, "USER\\ORGAN: USER");
    press(SC_ESC);
    open_patch("HEXX\\ORGAN");
    open_dialog();
    t_check(e.dlg.bank == 1 && strcmp(e.dlg.folder, "HEXX") == 0, "HEXX\\ORGAN: HEXX");
    press(SC_ESC);
    open_patch("FACTORY\\ORGAN");
    open_dialog();
    t_check(e.dlg.bank == 0 && strcmp(e.dlg.folder, "USER") == 0, "FACTORY\\ORGAN: USER");
    press(SC_ESC);

    t_case("the mouse: fields focus, the arrows step, a click outside cancels");
    t_checkl(dialog_hit(24, 9), DH_NAME, "the Name field");
    t_checkl(dialog_hit(32, 9), DH_NAME, "to its last cell");
    t_checkl(dialog_hit(26, 10), DH_BANK, "the Bank field");
    t_checkl(dialog_hit(22, 10), DH_LEFT, "the left arrow");
    t_checkl(dialog_hit(34, 10), DH_RIGHT, "the right arrow");
    t_checkl(dialog_hit(32, 16), DH_SAVE, "the Save button");
    t_checkl(dialog_hit(43, 16), DH_CANCEL, "the Cancel button");
    t_checkl(dialog_hit(40, 12), DH_NONE, "the window itself");
    t_checkl(dialog_hit(11, 12), DH_OUT, "left of the window");
    t_checkl(dialog_hit(68, 12), DH_OUT, "right of it, on the shadow");
    t_checkl(dialog_hit(30, 19), DH_OUT, "below it");
    open_patch("FACTORY\\BELL");
    tweak();
    open_dialog();
    t_checkl(act_on(editor_dialog_press(&e, DH_BANK)), 0, "a click on the Bank field");
    t_checkl(e.dlg.field, 1, "focuses it");
    t_checkl(act_on(editor_dialog_press(&e, DH_NAME)), 0, "a click on the Name field");
    t_checkl(e.dlg.field, 0, "focuses it");
    t_checkl(act_on(editor_dialog_press(&e, DH_RIGHT)), 0, "a click on the right arrow");
    t_check(e.dlg.bank == 1 && e.dlg.field == 1, "steps the bank and focuses it");
    act_on(editor_dialog_press(&e, DH_LEFT));
    t_checkl(e.dlg.bank, 0, "the left arrow steps back");
    t_checkl(editor_dialog_press(&e, DH_NONE), EA_NONE, "a click on the window does nothing");
    t_checkl(act_on(editor_dialog_press(&e, DH_SAVE)), 0, "Save is Enter");
    t_check(e.dialog == 0 && file_ar(PATCHES "USER\\BELL.RBP") == 8, "it saved");
    tweak();
    open_dialog();
    act_on(editor_dialog_press(&e, DH_OUT));
    t_check(e.dialog == 0 && e.dirty == 1, "a click outside cancels");
    open_dialog();
    act_on(editor_dialog_press(&e, DH_CANCEL));
    t_check(e.dialog == 0 && e.dirty == 1, "Cancel is Esc");

    t_case("a new bank's folder is made under a long patches path too");
    log_line("long path case");
    lib_free(&lib);
    memset(&lib, 0, sizeof lib);
    lib_open(&lib, LONG_PROG, NULL);
    lib_load(&lib, NULL, NULL);
    t_check(strlen(lib.patchdir) + strlen("\\NEWB") > 80, "a new bank's folder path is over 80 characters");
    memset(&patch, 0, sizeof patch);
    strcpy(patch.name, "LONGONE");
    patch.octave = 4;
    patch.v2.op[0].v[P_AR] = 6;
    editor_open(&e, &patch, 3, 1, 1);
    tweak();
    open_dialog();
    new_bank("NEWB");
    t_checkl(e.dlg.ok, 1, "Enter would save");
    press(SC_ENTER);
    t_check(e.dialog == 0 && e.dirty == 0 && strcmp(e.folder, "NEWB") == 0, "saved into NEWB");
    t_checkl(file_ar(LONG_PATCHES "NEWB\\LONGONE.RBP"), 7, "the file is there");
    remove(LONG_PATCHES "NEWB\\LONGONE.RBP");
    lib_free(&lib);
    memset(&lib, 0, sizeof lib);
    fresh();

    t_case("a failed write says why, closes the dialog and keeps the old file");
    open_patch("USER\\ORGAN");
    tweak();
    {
        FILE *f = fopen(PATCHES "USER\\ORGAN.$$$", "wb");

        if (f != NULL) {
            fputs("locked", f);
            fclose(f);
        }
    }
    t_checkl((long)_dos_setfileattr(PATCHES "USER\\ORGAN.$$$", _A_RDONLY), 0, "make the scratch file read-only");
    open_dialog();
    t_check(says(0, ' ', "Updates:", "USER\\ORGAN.RBP") && e.dlg.ok == 1, "the dialog allows it");
    t_checkl(press(SC_ENTER), 0, "Enter");
    t_check(strcmp(e.msg, "Can't write USER\\ORGAN.RBP") == 0, "the message names the file");
    t_checkl(file_ar(PATCHES "USER\\ORGAN.RBP"), 5, "the old file is intact");
    t_check(e.dialog == 0 && e.dirty == 1 && strcmp(e.folder, "USER") == 0 && e.pend == 0, "closed, still dirty, still open");
    editor_undo(&e);
    t_checkl(e.dirty, 0, "undo after the failed write is clean");
    editor_redo(&e);
    t_checkl(e.dirty, 1, "the values that were not written are unsaved");
    _dos_setfileattr(PATCHES "USER\\ORGAN.$$$", _A_NORMAL);
    remove(PATCHES "USER\\ORGAN.$$$");
    open_dialog();
    press(SC_ENTER);
    t_check(e.dirty == 0 && file_ar(PATCHES "USER\\ORGAN.RBP") == 6, "once writable it saves");

    t_case("with the list full a new patch is refused, and an existing name is still allowed");
    full.entries = (Entry __far *)_fmalloc(sizeof(Entry) * LIB_MAX);
    t_check(full.entries != NULL, "room for 2048 entries");
    if (full.entries != NULL) {
        for (i = 0; i < LIB_MAX; i++) {
            Entry en;

            memset(&en, 0, sizeof en);
            strcpy(en.folder, "USER");
            sprintf(en.name, "N%d", i);
            full.entries[i] = en;
        }
        full.count = LIB_MAX;
        full.cap = LIB_MAX;
        full.user = LIB_MAX;
        strcpy(full.patchdir, "SVTREE\\PROG\\PATCHES");
        saved = lib;
        lib = full;
        editor_open(&e, &patch, 3, 1, LIB_MAX);
        strcpy(e.p.name, "BELL");
        strcpy(e.folder, "FACTORY");
        e.dirty = 1;
        open_dialog();
        name_is("NEWONE");
        refused("a new patch", '!', "Patches:", "the list is full (2048)");
        press(SC_ENTER);
        t_check(e.dialog == 1 && e.dirty == 1, "Enter does nothing");
        name_is("N7");
        t_check(e.dlg.ok == 1 && says(0, '!', "Replaces:", "USER\\N7.RBP"), "a name already listed can still be saved over");
        press(SC_ESC);
        lib = saved;
        _ffree(full.entries);
    }
    memset(&full, 0, sizeof full);

    t_case("Reset to factory is an unsaved, undoable change, and saving it removes the override");
    fresh();
    with_user_bell();
    open_patch("USER\\BELL");
    t_checkl(act_on(ctrl_key(SC_R)), 0, "Ctrl+R");
    t_check(strcmp(e.msg, "Factory values loaded") == 0, "the message");
    t_checkl(e.p.v2.op[0].v[P_AR], 7, "the factory value is loaded");
    editor_undo(&e);
    t_checkl(e.p.v2.op[0].v[P_AR], 3, "undo brings the user values back");
    act_on(ctrl_key(SC_R));
    open_dialog();
    press(SC_ENTER);
    t_check(!exists(PATCHES "USER\\BELL.RBP") && strcmp(e.msg, "Override removed") == 0, "saving removes it");

    t_case("Reset to factory is refused on a bank patch, even one named like a factory patch");
    fresh();
    open_patch("HEXX\\ORGAN");
    editor_change(&e, 1, 0);
    act_on(ctrl_key(SC_R));
    t_check(strcmp(e.msg, "No factory version") == 0, "the message");
    t_checkl(e.p.v2.op[0].v[P_AR], 10, "the values stay");
    open_patch("HEXX\\SOLO");
    act_on(ctrl_key(SC_R));
    t_check(strcmp(e.msg, "No factory version") == 0, "no factory SOLO either");

    t_case("after a save, only the saved patch is clean");
    fresh();
    open_patch("HEXX\\SOLO");
    tweak();
    open_dialog();
    press(SC_ENTER);
    editor_change(&e, 1, 1);   /* a typematic repeat after the save is a step of its own */
    editor_undo(&e);
    t_check(e.p.v2.op[0].v[P_AR] == 8 && e.dirty == 0, "undo to the saved values is clean");
    editor_undo(&e);
    t_check(e.p.v2.op[0].v[P_AR] == 7 && e.dirty == 1, "past them, to the opened values, is unsaved");
    editor_redo(&e);
    t_checkl(e.dirty, 0, "redo back to the saved values is clean");
    editor_redo(&e);
    t_checkl(e.dirty, 1, "and past them is unsaved");

    t_case("after a Save as, the old name is unsaved");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    editor_change(&e, -1, 0);
    open_dialog();
    name_is("BELL2");
    press(SC_ENTER);
    tweak();
    editor_undo(&e);
    t_check(strcmp(e.p.name, "BELL2") == 0 && e.dirty == 0, "undo to the saved BELL2 is clean");
    editor_undo(&e);
    editor_undo(&e);
    t_check(strcmp(e.p.name, "BELL") == 0 && e.p.v2.op[0].v[P_AR] == 7 && e.dirty == 1, "BELL with the saved values is unsaved");
    editor_redo(&e);
    editor_redo(&e);
    t_check(strcmp(e.p.name, "BELL2") == 0 && e.dirty == 0, "redo back to BELL2 is clean");

    t_case("after a removed override, undo back is clean");
    fresh();
    with_user_bell();
    open_patch("USER\\BELL");
    act_on(ctrl_key(SC_R));
    open_dialog();
    press(SC_ENTER);
    tweak();
    editor_undo(&e);
    t_check(e.p.v2.op[0].v[P_AR] == 7 && e.dirty == 0, "clean on the factory values");
    editor_undo(&e);
    t_check(e.p.v2.op[0].v[P_AR] == 3 && e.dirty == 1, "the removed override's values are unsaved");

    t_case("leaving a dirty patch asks first, with three buttons");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    t_checkl(act_on(EA_NEXT), 0, "PgDn does not go");
    t_check(e.prompt == 1 && e.pend == EL_NEXT + 1 && e.btn == 0, "the prompt is open on Save, for the next patch");
    t_check(strcmp(e.p.name, "BELL") == 0, "still BELL");
    t_checkl(key(SC_RIGHT), EA_NONE, "Right moves the focus");
    t_checkl(e.btn, 1, "to Discard");
    key(SC_TAB);
    t_checkl(e.btn, 2, "Tab to Cancel");
    key(SC_TAB);
    t_checkl(e.btn, 0, "and round to Save");
    key(SC_LEFT);
    t_checkl(e.btn, 2, "Left from Save wraps to Cancel");
    t_checkl(key(SC_ENTER), EA_PICK + 2, "Enter chooses the focused button");
    t_checkl(act_on(EA_PICK + 2), 0, "Cancel");
    t_check(e.prompt == 0 && e.pend == 0 && e.dirty == 1 && strcmp(e.p.name, "BELL") == 0, "stays, dirty");
    t_checkl(act_on(EA_LIST), 0, "Esc to the list asks too");
    t_check(e.prompt == 1 && e.pend == EL_LIST + 1, "for the list");
    t_checkl(key(SC_ESC), EA_PICK + 2, "Esc is Cancel");
    act_on(EA_PICK + 2);
    act_on(EA_NEXT);
    t_checkl(key(SC_C), EA_PICK + 2, "C chooses Cancel");
    act_on(EA_PICK + 2);
    t_check(e.prompt == 0 && e.dirty == 1, "stays, dirty");
    open_dialog();
    t_checkl(press(SC_ENTER), 0, "save");
    t_checkl(act_on(EA_LIST), 1, "a clean patch leaves for the list at once");
    t_check(e.prompt == 0, "no prompt");

    t_case("the prompt's Save opens the dialog, and the leave goes on only after the save");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    act_on(EA_NEXT);
    t_checkl(key(SC_S), EA_PICK, "S chooses Save");
    t_checkl(act_on(EA_PICK), 0, "Save");
    t_check(e.prompt == 0 && e.dialog == 1 && e.pend == EL_NEXT + 1, "the dialog is open, still guarding the leave");
    t_check(strcmp(e.dlg.name, "BELL") == 0 && e.dlg.bank == 0, "on the patch's name, in USER");
    t_check(file_ar(PATCHES "USER\\BELL.RBP") == -1 && strcmp(e.folder, "FACTORY") == 0, "nothing saved yet, no move");
    t_checkl(press(SC_ENTER), 0, "Enter");
    t_checkl(file_ar(PATCHES "USER\\BELL.RBP"), 8, "saved first");
    t_check(e.dialog == 0 && e.prompt == 0 && e.pend == 0 && e.dirty == 0, "clean, nothing open");
    t_check(strcmp(e.folder, "USER") == 0 && strcmp(e.file, "ORGAN") == 0, "then moved on to the next patch");

    t_case("the leave goes on to a bank, and to the list, after a save from the prompt");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    act_on(EA_BNEXT);
    t_check(e.prompt == 1 && e.pend == EL_BNEXT + 1, "the prompt guards a bank jump");
    act_on(EA_PICK);
    press(SC_ENTER);
    t_check(strcmp(e.folder, "HEXX") == 0 && strcmp(e.file, "ORGAN") == 0 && e.dirty == 0, "saved into USER, then on to the first patch of the next bank");
    tweak();
    act_on(EA_LIST);
    act_on(EA_PICK);
    t_checkl(press(SC_ENTER), 1, "a save then goes to the list");

    t_case("Esc in the dialog drops the leave, and so does a failed save");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    i = e.pos;
    act_on(EA_NEXT);
    act_on(EA_PICK);
    press(SC_ESC);
    t_check(e.dialog == 0 && e.prompt == 0 && e.pend == 0 && e.pos == i && e.dirty == 1, "Esc: the leave is dropped, the patch stays dirty");
    t_check(strcmp(e.folder, "FACTORY") == 0 && !exists(PATCHES "USER\\BELL.RBP"), "still FACTORY\\BELL, nothing written");
    fresh();
    open_patch("USER\\ORGAN");
    tweak();
    i = e.pos;
    {
        FILE *f = fopen(PATCHES "USER\\ORGAN.$$$", "wb");

        if (f != NULL) {
            fputs("locked", f);
            fclose(f);
        }
    }
    _dos_setfileattr(PATCHES "USER\\ORGAN.$$$", _A_RDONLY);
    act_on(EA_NEXT);
    act_on(EA_PICK);
    press(SC_ENTER);
    t_check(strcmp(e.msg, "Can't write USER\\ORGAN.RBP") == 0, "the message is showing");
    t_check(e.dialog == 0 && e.pend == 0 && e.dirty == 1 && e.pos == i, "a failed write drops the leave: open and dirty");
    _dos_setfileattr(PATCHES "USER\\ORGAN.$$$", _A_NORMAL);
    remove(PATCHES "USER\\ORGAN.$$$");

    t_case("Discard reloads the saved patch and goes on; the file is not written");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    i = e.pos;
    act_on(EA_NEXT);
    t_checkl(key(SC_D), EA_PICK + 1, "D chooses Discard");
    act_on(EA_PICK + 1);
    t_check(e.pos != i && e.dirty == 0 && e.prompt == 0, "on the next patch, clean");
    t_check(!exists(PATCHES "USER\\BELL.RBP"), "nothing saved");
    open_patch("FACTORY\\BELL");
    tweak();
    act_on(EA_LIST);
    t_checkl(act_on(EA_PICK + 1), 1, "Discard before the list goes to the list");
    t_checkl(e.p.v2.op[0].v[P_AR], 7, "the saved values are back");

    t_case("F1 opens the help over silenced notes; Left flips, F1 and Esc close");
    fresh();
    open_patch("FACTORY\\BELL");
    editor_key_down(&e, 3);
    t_check(e.nheld == 1, "a note is held");
    key(SC_F1);
    t_check(e.help == 1 && e.nheld == 0, "page 1, notes stopped");
    key(SC_LEFT);
    t_checkl(e.help, 2, "Left flips to page 2");
    key(SC_RIGHT);
    t_checkl(e.help, 1, "Right flips back");
    key(0x2C);
    t_check(e.nheld == 0, "the piano is quiet under the help");
    key(SC_F1);
    t_checkl(e.help, 0, "F1 closes");
    key(SC_F1);
    key(SC_ESC);
    t_checkl(e.help, 0, "Esc closes");
    t_check(act_on(EA_NONE) == 0, "and does not leave the synth screen");

    t_case("every non-piano binding of the synth screen is documented by a help row");
    for (i = 0; i < key_count; i++) {
        if (key_table[i].ctx == K_SYNTH || key_table[i].ctx == K_GLOBAL) {
            char what[40];

            sprintf(what, "binding %d (scan %02X)", key_table[i].id, key_table[i].scan);
            t_check(documented(key_table[i].id), what);
        }
    }
    t_check(documented(KID_BANK_PREV) && documented(KID_BANK_NEXT), "Ctrl+PgUp and Ctrl+PgDn are under Ctrl+PgUp Dn");

    lib_free(&lib);
    log_close();
    opl_sink = NULL;
    editor_done();
    return t_done();
}
