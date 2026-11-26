/* Saving: Ctrl+S into the right path for a factory, bank and user patch, override removal only when the values equal the
   factory patch and never from a bank patch, a name edit as Save As, Save As validation, Reset to factory, the save prompt
   guarding a leave, a failed write that keeps the old file, and the help table covering every non-piano binding. The tree
   is built on the DOSBox-X C: at run time. */
#include <dos.h>
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

#define PROG "\\SVTREE\\PROG\\"
#define PATCHES "SVTREE\\PROG\\PATCHES\\"
#define FACTORY "SVTREE\\PROG\\FACTORY\\"

#define SC_ESC 0x01
#define SC_ENTER 0x1C
#define SC_CTRL 0x1D
#define SC_A 0x1E
#define SC_S 0x1F
#define SC_D 0x20
#define SC_C 0x2E
#define SC_R 0x13
#define SC_F1 0x3B
#define SC_LEFT 0x4B
#define SC_RIGHT 0x4D
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

/* The tree before each case: the factory BELL and ORGAN, the USER ORGAN and BELL (overrides), and the bank HEXX with an
   ORGAN equal to the factory one and a SOLO. Files a case added are removed. */
static void fresh(void)
{
    remove(PATCHES "USER\\BELL.RBP");
    remove(PATCHES "USER\\NEWNAME.RBP");
    remove(PATCHES "USER\\SOLO.RBP");
    remove(PATCHES "USER\\BELL2.RBP");
    remove(PATCHES "USER\\ORGAN.RBP");
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

static void type_name(const char *name)
{
    int i;

    editor_focus(&e, F_NAME);
    while (e.p.name[0] != '\0') editor_name_back(&e);
    for (i = 0; name[i] != '\0'; i++) editor_name_add(&e, name[i]);
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

int main(void)
{
    int i;

    opl_sink = sink;
    opl_init(3);
    log_open("SVTREE.LOG");
    memset(&lib, 0, sizeof lib);
    editor_init();
    fresh();

    t_case("Ctrl+S on a changed factory patch writes USER\\NAME and the list marks it");
    open_patch("FACTORY\\BELL");
    tweak();
    t_checkl(act_on(ctrl_key(SC_S)), 0, "stays in the editor");
    t_checkl(file_ar(PATCHES "USER\\BELL.RBP"), 8, "USER\\BELL.RBP holds the changed value");
    t_checkl(file_ar(FACTORY "BELL.RBP"), 7, "FACTORY\\BELL is untouched");
    t_check(strcmp(e.folder, "USER") == 0 && entry_is(e.pos, "USER", "BELL"), "the open patch is USER\\BELL");
    t_check(lib_entry(&lib, e.pos - 1)->overrides == 1, "the list marks it as an override");
    t_check(e.dirty == 0 && strcmp(e.msg, "Saved") == 0, "clean, with Saved");

    t_case("a second Ctrl+S rewrites USER\\NAME");
    tweak();
    t_checkl(act_on(ctrl_key(SC_S)), 0, "second save");
    t_checkl(file_ar(PATCHES "USER\\BELL.RBP"), 9, "USER\\BELL.RBP holds the newer value");
    t_check(strcmp(e.msg, "Saved") == 0, "Saved, not refused");

    t_case("Ctrl+S on a bank patch writes a copy in USER; on a user patch rewrites it");
    fresh();
    open_patch("HEXX\\SOLO");
    tweak();
    act_on(ctrl_key(SC_S));
    t_checkl(file_ar(PATCHES "USER\\SOLO.RBP"), 8, "USER\\SOLO.RBP is the copy");
    t_checkl(file_ar(PATCHES "HEXX\\SOLO.RBP"), 7, "the bank file is untouched");
    t_check(strcmp(e.folder, "USER") == 0 && strcmp(e.file, "SOLO") == 0, "the open patch is USER\\SOLO");
    fresh();
    open_patch("USER\\ORGAN");
    tweak();
    act_on(ctrl_key(SC_S));
    t_checkl(file_ar(PATCHES "USER\\ORGAN.RBP"), 6, "USER\\ORGAN rewritten in place");
    t_check(!exists(PATCHES "USER\\ORGAN.BAK") && !exists(PATCHES "USER\\ORGAN.$$$"), "no leftovers");

    t_case("Ctrl+S on HEXX\\ORGAN with USER\\ORGAN present writes nothing and says so");
    fresh();
    open_patch("HEXX\\ORGAN");
    tweak();
    t_checkl(act_on(ctrl_key(SC_S)), 0, "stays");
    t_check(strcmp(e.msg, "USER\\ORGAN exists: use Save As") == 0, "the message");
    t_checkl(file_ar(PATCHES "USER\\ORGAN.RBP"), 5, "USER\\ORGAN is untouched");
    t_check(e.dirty == 1 && strcmp(e.folder, "HEXX") == 0, "still dirty and still HEXX\\ORGAN");

    t_case("a bank patch equal to the factory one never removes the user file");
    fresh();
    open_patch("HEXX\\ORGAN");
    editor_change(&e, 1, 0);
    editor_change(&e, -1, 0);
    act_on(ctrl_key(SC_S));
    t_checkl(file_ar(PATCHES "USER\\ORGAN.RBP"), 5, "USER\\ORGAN still there");
    t_check(strcmp(e.msg, "USER\\ORGAN exists: use Save As") == 0, "refused");

    t_case("FACTORY\\BELL open with USER\\BELL present: changed values are refused");
    fresh();
    with_user_bell();
    open_patch("FACTORY\\BELL");
    tweak();
    act_on(ctrl_key(SC_S));
    t_check(strcmp(e.msg, "USER\\BELL exists: use Save As") == 0, "the message");
    t_checkl(file_ar(PATCHES "USER\\BELL.RBP"), 3, "USER\\BELL untouched");
    t_check(e.dirty == 1, "still dirty");

    t_case("FACTORY\\BELL open with USER\\BELL present: equal values remove USER\\BELL");
    editor_undo(&e);
    act_on(ctrl_key(SC_S));
    t_check(!exists(PATCHES "USER\\BELL.RBP"), "USER\\BELL is gone");
    t_check(strcmp(e.msg, "Override removed") == 0, "the message");
    t_check(strcmp(e.folder, "FACTORY") == 0 && entry_is(e.pos, "FACTORY", "BELL"), "the open patch is FACTORY\\BELL");
    t_check(lib_find(&lib, "USER\\BELL") < 0, "the list lost the override");
    t_check(e.dirty == 0, "clean");
    act_on(ctrl_key(SC_S));
    t_check(strcmp(e.msg, "Nothing to save") == 0 && !exists(PATCHES "USER\\BELL.RBP"), "again: nothing to write");

    t_case("Reset to factory is an unsaved, undoable change, and saving it removes the override");
    fresh();
    with_user_bell();
    open_patch("USER\\BELL");
    t_checkl(act_on(ctrl_key(SC_R)), 0, "Ctrl+R");
    t_check(strcmp(e.msg, "Factory values loaded") == 0, "the message");
    t_checkl(e.p.v2.op[0].v[P_AR], 7, "the factory value is loaded");
    t_check(e.dirty == 1, "unsaved");
    t_checkl(file_ar(PATCHES "USER\\BELL.RBP"), 3, "the file is not touched yet");
    editor_undo(&e);
    t_checkl(e.p.v2.op[0].v[P_AR], 3, "undo brings the user values back");
    act_on(ctrl_key(SC_R));
    act_on(ctrl_key(SC_S));
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

    t_case("Ctrl+S after a name edit is a Save As; the patch it came from stays");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    type_name("BELL2");
    act_on(ctrl_key(SC_S));
    t_checkl(file_ar(PATCHES "USER\\BELL2.RBP"), 8, "USER\\BELL2.RBP written");
    t_check(!exists(PATCHES "USER\\BELL.RBP"), "no USER\\BELL");
    t_checkl(file_ar(FACTORY "BELL.RBP"), 7, "FACTORY\\BELL unchanged");
    t_check(strcmp(e.folder, "USER") == 0 && strcmp(e.file, "BELL2") == 0 && e.dirty == 0, "now USER\\BELL2, clean");

    t_case("Save As refuses an invalid or existing name");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    type_name("12345");
    t_checkl(editor_save_as(&e, &lib), -1, "all digits");
    t_check(strcmp(e.msg, "Not a valid name") == 0, "says so");
    type_name("");
    t_checkl(editor_save_as(&e, &lib), -1, "empty");
    strcpy(e.p.name, "A.B");
    t_checkl(editor_save_as(&e, &lib), -1, "a character outside the set");
    type_name("ORGAN");
    t_checkl(editor_save_as(&e, &lib), -1, "a name in USER");
    t_check(strcmp(e.msg, "USER\\ORGAN already exists") == 0, "says so");
    t_checkl(file_ar(PATCHES "USER\\ORGAN.RBP"), 5, "USER\\ORGAN untouched");
    t_check(e.dirty == 1, "dirty throughout");
    type_name("NEWNAME");
    t_checkl(editor_save_as(&e, &lib), 0, "a free name saves");
    t_checkl(file_ar(PATCHES "USER\\NEWNAME.RBP"), 8, "written");

    t_case("Ctrl+A focuses the name; Enter saves it, Esc cancels");
    fresh();
    open_patch("HEXX\\SOLO");
    tweak();
    t_checkl(ctrl_key(SC_A), EA_NONE, "Ctrl+A needs no further action");
    t_check(e.fk == F_NAME && e.saveas == 1 && strcmp(e.p.name, "SOLO") == 0, "the name row, in edit mode, with the name");
    editor_name_back(&e);
    key(SC_ESC);
    t_check(strcmp(e.p.name, "SOLO") == 0 && e.saveas == 0, "Esc cancels and restores the name");
    ctrl_key(SC_A);
    type_name("NEWNAME");
    ctrl_key(SC_A);
    t_checkl(act_on(key(SC_ENTER)), 0, "Enter saves");
    t_checkl(file_ar(PATCHES "USER\\NEWNAME.RBP"), 8, "under the typed name");
    t_check(e.fk != F_NAME && e.saveas == 0, "the name row is left");

    t_case("moving off the name row with Tab disarms Save As, so Esc goes back to the list");
    fresh();
    open_patch("HEXX\\SOLO");
    tweak();
    ctrl_key(SC_A);
    t_check(e.saveas == 1, "Save As is armed");
    key(SC_TAB);
    t_check(e.fk != F_NAME && e.saveas == 0 && e.pend == 0, "Tab leaves the name row and disarms it");
    t_checkl(key(SC_ESC), EA_LIST, "Esc steps back to the list");

    t_case("leaving a dirty patch asks first, with the question for each place");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    t_checkl(act_on(EA_NEXT), 0, "PgDn does not go");
    t_check(e.prompt == 1 && e.pend == EL_NEXT + 1 && e.btn == 0, "the prompt is open on Save, for the next patch");
    t_check(strcmp(e.p.name, "BELL") == 0, "still BELL");
    t_checkl(key(SC_RIGHT), EA_NONE, "Right moves the focus");
    t_checkl(e.btn, 1, "to Save As");
    key(SC_TAB);
    key(SC_TAB);
    t_checkl(e.btn, 3, "Tab, Tab to Cancel");
    t_checkl(key(SC_ENTER), EA_PICK + 3, "Enter chooses the focused button");
    t_checkl(act_on(EA_PICK + 3), 0, "Cancel");
    t_check(e.prompt == 0 && e.pend == 0 && e.dirty == 1 && strcmp(e.p.name, "BELL") == 0, "stays, dirty");
    t_checkl(act_on(EA_LIST), 0, "Esc to the list asks too");
    t_check(e.prompt == 1 && e.pend == EL_LIST + 1, "for the list");
    t_checkl(key(SC_ESC), EA_PICK + 3, "Esc is Cancel");
    act_on(EA_PICK + 3);
    t_checkl(act_on(ctrl_key(SC_S)), 0, "save");
    t_checkl(act_on(EA_LIST), 1, "a clean patch leaves for the list at once");
    t_check(e.prompt == 0, "no prompt");

    t_case("the prompt's Save goes on only after the save worked");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    act_on(EA_NEXT);
    t_checkl(act_on(key(SC_ENTER)), 0, "Enter on Save");
    t_check(file_ar(PATCHES "USER\\BELL.RBP") == 8, "saved first");
    t_check(e.prompt == 0 && e.dirty == 0, "clean, no prompt");
    t_check(strcmp(e.folder, "USER") == 0 && strcmp(e.file, "ORGAN") == 0, "then moved on to the next patch");

    t_case("leaving by PgDn, choosing Save and having the write refused leaves the patch open and dirty");
    fresh();
    open_patch("HEXX\\ORGAN");
    tweak();
    i = e.pos;
    act_on(EA_NEXT);
    t_checkl(key(SC_S), EA_PICK, "S chooses Save");
    t_checkl(act_on(EA_PICK), 0, "Save");
    t_check(strcmp(e.msg, "USER\\ORGAN exists: use Save As") == 0, "the message is showing");
    t_check(e.prompt == 0 && e.pend == 0 && e.dirty == 1 && e.pos == i && strcmp(e.folder, "HEXX") == 0, "open and dirty");
    t_checkl(file_ar(PATCHES "USER\\ORGAN.RBP"), 5, "USER\\ORGAN untouched");

    t_case("Discard reloads the saved patch and goes on; the file is not written");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    i = e.pos;
    act_on(EA_NEXT);
    t_checkl(key(SC_D), EA_PICK + 2, "D chooses Discard");
    act_on(EA_PICK + 2);
    t_check(e.pos != i && e.dirty == 0 && e.prompt == 0, "on the next patch, clean");
    t_check(!exists(PATCHES "USER\\BELL.RBP"), "nothing saved");
    open_patch("FACTORY\\BELL");
    tweak();
    act_on(EA_LIST);
    t_checkl(act_on(EA_PICK + 2), 1, "Discard before the list goes to the list");
    t_checkl(e.p.v2.op[0].v[P_AR], 7, "the saved values are back");

    t_case("Save As from the prompt goes on after the save; Esc drops the leave");
    fresh();
    open_patch("FACTORY\\BELL");
    tweak();
    i = e.pos;
    act_on(EA_NEXT);
    t_checkl(key(SC_A), EA_PICK + 1, "A chooses Save As");
    act_on(EA_PICK + 1);
    t_check(e.prompt == 0 && e.saveas == 1 && e.fk == F_NAME && e.pend == EL_NEXT + 1, "the name row takes over");
    key(SC_ESC);
    t_check(e.saveas == 0 && e.pend == 0 && e.pos == i && e.dirty == 1, "Esc: the leave is dropped, the patch stays dirty");
    act_on(EA_NEXT);
    act_on(EA_PICK + 1);
    type_name("NEWNAME");
    t_checkl(act_on(key(SC_ENTER)), 0, "Enter saves and moves on");
    t_checkl(file_ar(PATCHES "USER\\NEWNAME.RBP"), 8, "NEWNAME written");
    t_check(e.dirty == 0 && e.pend == 0 && !(strcmp(e.folder, "USER") == 0 && strcmp(e.file, "NEWNAME") == 0), "on another patch");
    open_patch("FACTORY\\BELL");
    tweak();
    act_on(EA_NEXT);
    act_on(EA_PICK + 1);
    type_name("ORGAN");
    act_on(key(SC_ENTER));
    t_check(strcmp(e.msg, "USER\\ORGAN already exists") == 0 && e.pend == 0 && e.dirty == 1, "a refused Save As drops the leave");
    t_check(strcmp(e.folder, "FACTORY") == 0, "still on the synth screen's patch");

    t_case("a failed write says why and keeps the old file");
    fresh();
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
    t_checkl(editor_save(&e, &lib), -1, "the save fails");
    t_check(strcmp(e.msg, "Can't write USER\\ORGAN.RBP") == 0, "the message names the file");
    t_checkl(file_ar(PATCHES "USER\\ORGAN.RBP"), 5, "the old file is intact");
    t_check(e.dirty == 1 && strcmp(e.folder, "USER") == 0, "still dirty, still open");
    _dos_setfileattr(PATCHES "USER\\ORGAN.$$$", _A_NORMAL);
    remove(PATCHES "USER\\ORGAN.$$$");
    t_checkl(editor_save(&e, &lib), 0, "once writable it saves");

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

    lib_free(&lib);
    log_close();
    opl_sink = NULL;
    editor_done();
    return t_done();
}
