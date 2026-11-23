/* ReBeep Studio: the editor's logic. No drawing here; the synth screen reads the Editor these functions change.
   SPDX-License-Identifier: MIT */
#include <stdio.h>
#include <string.h>

#include "dos.h"
#include "editor.h"
#include "kbd.h"
#include "keys.h"
#include "log.h"
#include "opl.h"
#include "roles.h"
#include "undo.h"

#define FIRST_PARAM_NAV 5   /* the rows before the parameters in the Up/Down order: name, variant, octave, conn, fb */
#define NAV_ROWS (FIRST_PARAM_NAV + P_COUNT)
#define USER_FOLDER "USER"
#define FACTORY_FOLDER "FACTORY"

static Undo history;

static int is_switch(int row)
{
    return row == P_TREM || row == P_VIB || row == P_SUS || row == P_KSR;
}

static Voice *voice_of(Editor *e)
{
    return e->n == 4 ? &e->p.v4 : &e->p.v2;
}

/* The undo key of an edit: the row and the operator it applies to. */
static unsigned undo_key(const Editor *e, int row)
{
    return (unsigned)(row << 2 | e->cur);
}

static int nav_index(int row)
{
    return row >= P_COUNT ? row - P_COUNT : FIRST_PARAM_NAV + row;
}

static int nav_row(int i)
{
    return i < FIRST_PARAM_NAV ? P_COUNT + i : i - FIRST_PARAM_NAV;
}

int editor_init(void)
{
    if (history.undo != NULL) return 0;
    return undo_init(&history);
}

void editor_done(void)
{
    undo_free(&history);
}

void editor_apply(const Editor *e)
{
    if (e->chip == 0) return;
    opl_set_voice(e->n == 4 ? &e->p.v4 : &e->p.v2, e->n, e->p.octave);
}

void editor_msg(Editor *e, const char *text, int role)
{
    strncpy(e->msg, text, sizeof e->msg - 1);
    e->msg[sizeof e->msg - 1] = '\0';
    e->msgRole = role;
}

void editor_open(Editor *e, const Patch *p, int chip, int pos, int total)
{
    opl_all_off();
    memset(e, 0, sizeof *e);
    e->p = *p;
    e->chip = chip;
    e->n = chip == 3 && p->has4 ? 4 : 2;
    e->fk = P_AR;
    e->lastP = P_AR;
    e->pos = pos;
    e->total = total;
    e->kbOct = KB_LOW;
    e->msgRole = R_TEXT;
    e->mods = key_mods();
    strcpy(e->file, p->name);
    undo_clear(&history);
    editor_apply(e);
}

int editor_load(Editor *e, const Library *lib, int i, char *err, unsigned errlen)
{
    static char path[LIB_DIR_LEN + 32];
    static Patch loaded;

    if (lib_path(lib, i, path, sizeof path) != 0) {
        strncpy(err, "No file for that patch", errlen - 1);
        err[errlen - 1] = '\0';
        return -1;
    }
    if (patch_read(path, &loaded, err, errlen) != 0) return -1;
    editor_open(e, &loaded, opl_chip(), i + 1, lib_count(lib));
    _fstrcpy(e->folder, lib_entry(lib, i)->folder);
    _fstrcpy(e->file, lib_entry(lib, i)->name);
    return 0;
}

void editor_release(Editor *e)
{
    opl_all_off();
    e->nheld = 0;
}

void editor_focus(Editor *e, int row)
{
    undo_break(&history);
    if (row != F_NAME) {
        e->saveas = 0;
        e->pend = 0;
    }
    if (row == F_NAME && e->fk != F_NAME) {
        editor_release(e);
        strcpy(e->nameBefore, e->p.name);
    }
    e->fk = row;
    if (row < P_COUNT) e->lastP = row;
}

void editor_move(Editor *e, int d)
{
    int i = nav_index(e->fk) + d;

    undo_break(&history);
    if (i < 0 || i >= NAV_ROWS) return;
    editor_focus(e, nav_row(i));
}

void editor_op(Editor *e, int k)
{
    undo_break(&history);
    if (k < 0 || k >= e->n) return;
    e->cur = k;
    if (e->fk >= P_COUNT) e->fk = e->lastP;
}

static int same_patch(const Patch *a, const Patch *b)
{
    return patch_equal(a, b) && strcmp(a->name, b->name) == 0;
}

/* Records `before` as an undo step when the patch is no longer the same, marks it dirty and reprograms the voice.
   Returns 1 when it changed. */
static int commit(Editor *e, const Patch *before, int row, int repeat)
{
    if (same_patch(before, &e->p)) return 0;
    undo_edit(&history, before, undo_key(e, row), repeat);
    e->dirty = 1;
    editor_apply(e);
    return 1;
}

/* An operator that plays nothing: the same values with Attack Rate 0 (never rises) and Output Level 0 (TL 63, which
   alone is only -47 dB). */
static void silent(Op *dst, const Op *src)
{
    *dst = *src;
    dst->v[P_AR] = 0;
    dst->v[P_OL] = 0;
}

/* The 4-OP variant that sounds like the 2-OP voice. FM becomes FM-AM (1 > 2, 3 > 4 with 3 and 4 silent); AM becomes
   AM-AM (1 alone, 2 > 3, 4 alone): operator 2 moves to 4, since no 4-OP routing hears both 1 and 2. */
static void make_variant(Patch *p)
{
    const Voice *s = &p->v2;
    Voice *v = &p->v4;

    memset(v, 0, sizeof *v);
    v->fb = s->fb;
    v->op[0] = s->op[0];
    if (s->conn == 0) {
        v->conn = 2;
        v->op[1] = s->op[1];
        silent(&v->op[2], &s->op[0]);
        silent(&v->op[3], &s->op[1]);
    } else {
        v->conn = 3;
        silent(&v->op[1], &s->op[0]);
        silent(&v->op[2], &s->op[1]);
        v->op[3] = s->op[1];
    }
    p->has4 = 1;
}

int editor_change(Editor *e, int d, int repeat)
{
    Patch before = e->p;
    unsigned char *f;
    int row = e->fk;
    int nv;
    int max;

    if (row == F_NAME) return 0;
    if (row == F_VARIANT) {
        if (e->n == 2) {
            if (!e->p.has4) {
                make_variant(&e->p);
                editor_msg(e, "New 4-OP variant from 2-OP", R_TEXT);
            }
            e->n = 4;
        } else {
            e->n = 2;
        }
        if (e->cur >= e->n) e->cur = e->n - 1;
        if (!commit(e, &before, row, repeat)) editor_apply(e);
        return 1;
    }

    if (row == F_OCTAVE) {
        f = &e->p.octave;
        max = 7;
    } else if (row == F_CONN) {
        f = &voice_of(e)->conn;
        max = e->n == 4 ? 3 : 1;
    } else if (row == F_FB) {
        f = &voice_of(e)->fb;
        max = 7;
    } else {
        f = &voice_of(e)->op[e->cur].v[row];
        max = row == P_WAVE ? (e->chip == 3 ? 7 : 3) : P_MAX[row];
    }

    if (is_switch(row)) {
        nv = d > 0 ? 1 : 0;
    } else if (row == F_CONN) {
        nv = (*f + d + max + 1) % (max + 1);
    } else {
        nv = *f + d;
        if (d > 0 && nv > max) nv = *f > max ? *f : max;
        if (nv < 0) nv = 0;
    }
    *f = (unsigned char)nv;
    return commit(e, &before, row, repeat);
}

int editor_bar(Editor *e, int k, int key, int bx, int bw, int x, int repeat)
{
    Patch before = e->p;
    unsigned char *f;
    int max;
    int at = x < bx ? 0 : x >= bx + bw ? bw - 1 : x - bx;
    int span = bw > 1 ? bw - 1 : 1;

    if (e->fk != key || e->cur != k) {
        e->cur = k;
        editor_focus(e, key);
    }
    if (key == F_FB) {
        f = &voice_of(e)->fb;
        max = 7;
    } else {
        f = &voice_of(e)->op[k].v[key];
        max = P_MAX[key];
    }
    *f = (unsigned char)((2L * at * max + span) / (2L * span));
    return commit(e, &before, key, repeat);
}

void editor_name_add(Editor *e, char ch)
{
    Patch before = e->p;
    size_t len = strlen(e->p.name);

    if (e->fk != F_NAME || len >= NAME_MAX_LEN) return;
    if (ch >= 'a' && ch <= 'z') ch = (char)(ch - 'a' + 'A');
    if (!((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-')) return;
    e->p.name[len] = ch;
    e->p.name[len + 1] = '\0';
    commit(e, &before, F_NAME, 1);
}

void editor_name_back(Editor *e)
{
    Patch before = e->p;
    size_t len = strlen(e->p.name);

    if (e->fk != F_NAME || len == 0) return;
    e->p.name[len - 1] = '\0';
    commit(e, &before, F_NAME, 1);
}

void editor_name_enter(Editor *e)
{
    if (e->fk == F_NAME) editor_move(e, 1);
}

int editor_name_esc(Editor *e)
{
    Patch before = e->p;

    if (e->fk != F_NAME || strcmp(e->p.name, e->nameBefore) == 0) return 0;
    strcpy(e->p.name, e->nameBefore);
    undo_break(&history);
    commit(e, &before, F_NAME, 0);
    undo_break(&history);
    return 1;
}

static int is_held(const Editor *e, int key)
{
    int j;

    for (j = 0; j < e->nheld; j++) {
        if (e->held[j] == key) return 1;
    }
    return 0;
}

void editor_key_down(Editor *e, int key)
{
    int j;

    if (key < 0 || key >= ED_KEYS || e->fk == F_NAME || is_held(e, key)) return;
    for (j = e->nheld; j > 0 && e->held[j - 1] > key; j--) e->held[j] = e->held[j - 1];
    e->held[j] = (unsigned char)key;
    e->nheld++;
    if (e->chip == 0) editor_msg(e, "No OPL: cannot play", R_WARNING);
    else opl_note_on(e->kbOct * 12 + key);
}

void editor_key_up(Editor *e, int key)
{
    int j;

    if (!is_held(e, key)) return;
    for (j = 0; e->held[j] != key; j++) {
    }
    for (; j + 1 < e->nheld; j++) e->held[j] = e->held[j + 1];
    e->nheld--;
    if (e->chip != 0) opl_note_off(e->kbOct * 12 + key);
}

void editor_kb_octave(Editor *e, int d)
{
    int nv = e->kbOct + d;

    if (nv < 0) nv = 0;
    if (nv > KB_MAX) nv = KB_MAX;
    if (nv == e->kbOct) return;
    editor_release(e);
    e->kbOct = nv;
}

/* After a snapshot came back: the variant shown must exist, the operator must be on screen, the chip hears it. */
static void restored(Editor *e)
{
    if (e->n == 4 && !e->p.has4) e->n = 2;
    if (e->cur >= e->n) e->cur = e->n - 1;
    e->dirty = 1;
    editor_apply(e);
}

void editor_undo(Editor *e)
{
    if (undo_undo(&history, &e->p)) {
        restored(e);
        editor_msg(e, "Undo", R_TEXT);
    } else {
        editor_msg(e, "Nothing to undo", R_TEXT);
    }
}

void editor_redo(Editor *e)
{
    if (undo_redo(&history, &e->p)) {
        restored(e);
        editor_msg(e, "Redo", R_TEXT);
    } else {
        editor_msg(e, "Nothing to redo", R_TEXT);
    }
}

static unsigned modifier_bit(unsigned scan)
{
    if (scan == 0x2A || scan == 0x36) return MOD_SHIFT;
    if (scan == 0x1D) return MOD_CTRL;
    if (scan == 0x38) return MOD_ALT;
    return 0;
}

/* A key while the save prompt is open: Left, Right and Tab move the focus, Enter or a first letter chooses, Esc is Cancel. */
static int prompt_key(Editor *e, unsigned event)
{
    int id = key_lookup(K_PROMPT, event, e->mods);

    switch (id) {
    case KID_LEFT: case KID_BTAB: e->btn = (e->btn + 3) % 4; break;
    case KID_RIGHT: case KID_TAB: e->btn = (e->btn + 1) % 4; break;
    case KID_ENTER: return EA_PICK + e->btn;
    case KID_ESC: return EA_PICK + 3;
    case KID_PICK1: case KID_PICK2: case KID_PICK3: case KID_PICK4: return EA_PICK + (id - KID_PICK1);
    default: break;
    }
    return EA_NONE;
}

/* A key while the help is open: F1 or Esc closes it, Left and Right flip the page. */
static void help_key(Editor *e, unsigned event)
{
    switch (key_lookup(K_HELP, event, e->mods)) {
    case KID_HELP: case KID_ESC: e->help = 0; break;
    case KID_LEFT: case KID_RIGHT: e->help = 3 - e->help; break;
    default: break;
    }
}

int editor_event(Editor *e, unsigned event)
{
    unsigned scan = event & KBD_CODE;
    unsigned bit = modifier_bit(scan);
    int brk = (event & KBD_BREAK) != 0;
    int piano = key_piano(event);
    int repeat;
    int id;

    log_trace("key %s %02X%s", brk ? "break" : "make", scan, (event & KBD_EXT) ? " E0" : "");
    if (bit != 0) {
        if (brk) e->mods &= ~bit;
        else e->mods |= bit;
        return EA_NONE;
    }
    if (brk) {
        if ((event & ~KBD_BREAK) == e->last_make) e->last_make = 0;
        if (piano >= 0) editor_key_up(e, piano);
        return EA_NONE;
    }
    repeat = event == e->last_make;
    e->last_make = event;

    if (e->prompt) return prompt_key(e, event);
    if (e->help) {
        help_key(e, event);
        return EA_NONE;
    }
    if (piano >= 0 && e->fk != F_NAME && !(e->mods & (MOD_CTRL | MOD_ALT))) {
        editor_key_down(e, piano);
        return EA_NONE;
    }
    e->msg[0] = '\0';
    id = key_lookup(K_SYNTH, event, e->mods);
    if (id == 0 && e->fk == F_NAME) {
        char ch = key_name_char(event, e->mods);

        switch (key_lookup(K_NAME, event, e->mods)) {
        case KID_ENTER:
            if (e->saveas) return EA_SAVEAS;
            editor_name_enter(e);
            return EA_NONE;
        case KID_BACK:
            editor_name_back(e);
            return EA_NONE;
        default:
            break;
        }
        if (ch != 0) editor_name_add(e, ch);
        return EA_NONE;
    }

    switch (id) {
    case KID_UP: editor_move(e, -1); break;
    case KID_DOWN: editor_move(e, 1); break;
    case KID_LEFT: editor_change(e, -1, repeat); break;
    case KID_RIGHT: editor_change(e, 1, repeat); break;
    case KID_OP1: case KID_OP2: case KID_OP3: case KID_OP4: editor_op(e, id - KID_OP1); break;
    case KID_TAB: editor_op(e, (e->cur + 1) % e->n); break;
    case KID_BTAB: editor_op(e, (e->cur + e->n - 1) % e->n); break;
    case KID_PGUP: return EA_PREV;
    case KID_PGDN: return EA_NEXT;
    case KID_HELP: editor_help(e, 1); break;
    case KID_SAVE: return EA_SAVE;
    case KID_SAVEAS: editor_saveas_begin(e); break;
    case KID_RESET: return EA_RESET;
    case KID_UNDO: editor_undo(e); break;
    case KID_REDO: editor_redo(e); break;
    case KID_OCT_UP: editor_kb_octave(e, 1); break;
    case KID_OCT_DOWN: editor_kb_octave(e, -1); break;
    case KID_ESC:
        if (e->saveas) {
            editor_name_esc(e);
            e->saveas = 0;
            e->pend = 0;
            break;
        }
        if (e->fk == F_NAME && editor_name_esc(e)) break;
        return EA_LIST;
    default: break;
    }
    return EA_NONE;
}

int editor_press(Editor *e, const SynthHit *h, int x)
{
    if (h->kind != SH_PIANO) e->msg[0] = '\0';
    switch (h->kind) {
    case SH_NAME: editor_focus(e, F_NAME); break;
    case SH_PREV: return EA_PREV;
    case SH_NEXT: return EA_NEXT;
    case SH_HELP: editor_help(e, 1); break;
    case SH_VARIANT:
        if (e->fk == F_VARIANT) editor_change(e, 1, 0);
        editor_focus(e, F_VARIANT);
        break;
    case SH_OCTAVE: editor_focus(e, F_OCTAVE); break;
    case SH_CONN:
        editor_focus(e, F_CONN);
        break;
    case SH_CONN_CYCLE:
        editor_focus(e, F_CONN);
        editor_change(e, 1, 0);
        break;
    case SH_FB: editor_focus(e, F_FB); break;
    case SH_ROW: editor_focus(e, h->key); break;
    case SH_CELL: {
        int was = e->fk == h->key && e->cur == h->k;

        e->cur = h->k;
        editor_focus(e, h->key);
        if (was && is_switch(h->key)) editor_change(e, voice_of(e)->op[h->k].v[h->key] ? -1 : 1, 0);
        break;
    }
    case SH_BAR: editor_bar(e, h->k, h->key, h->bx, h->bw, x, 0); break;
    case SH_OPHEAD: editor_op(e, h->k); break;
    case SH_PIANO: editor_key_down(e, h->key); break;
    default: break;
    }
    return EA_NONE;
}

void editor_help(Editor *e, int page)
{
    if (page != 0) editor_release(e);
    e->help = page;
}

void editor_saveas_begin(Editor *e)
{
    editor_release(e);
    editor_focus(e, F_NAME);
    e->saveas = 1;
    editor_msg(e, "Save As: type a name", R_TEXT);
}

/* The message for a refused save: "USER\<name><tail>". */
static void say_user(Editor *e, const char *name, const char *tail)
{
    char text[sizeof e->msg];

    sprintf(text, "USER\\%s%s", name, tail);
    editor_msg(e, text, R_WARNING);
}

/* The message for a write or removal that failed, with the reason DOS gave. */
static void say_failed(Editor *e, const char *what, const char *name)
{
    char text[sizeof e->msg];

    switch (dos_write_why()) {
    case DOS_WHY_FULL: editor_msg(e, "Disk full", R_WARNING); break;
    case DOS_WHY_PROTECTED: editor_msg(e, "Read-only disk", R_WARNING); break;
    default:
        sprintf(text, "Can't %s USER\\%s.RBP", what, name);
        editor_msg(e, text, R_WARNING);
        break;
    }
}

/* Is there a USER patch "name": listed, or a file under that name even when it cannot be read as a patch. */
static int user_exists(const Library *lib, const char *name)
{
    static char path[LIB_DIR_LEN + 32];
    char spec[24];

    sprintf(spec, USER_FOLDER "\\%s", name);
    return lib_find(lib, spec) >= 0 || (lib_user_path(lib, name, path, sizeof path) == 0 && dos_is_file(path));
}

/* Reads the FACTORY patch "name". Returns 0, or -1 when it is not listed or cannot be read. */
static int read_factory(const Library *lib, const char *name, Patch *out)
{
    static char path[LIB_DIR_LEN + 32];
    char spec[24];
    char err[40];
    int i;

    sprintf(spec, FACTORY_FOLDER "\\%s", name);
    i = lib_find(lib, spec);
    if (i < 0 || lib_path(lib, i, path, sizeof path) != 0) return -1;
    return patch_read(path, out, err, sizeof err);
}

/* The open patch is FOLDER\name now: the list is read again and pos follows it. */
static void reopened(Editor *e, Library *lib, const char *folder, const char *name)
{
    char spec[24];

    strcpy(e->folder, folder);
    strcpy(e->file, name);
    strcpy(e->nameBefore, e->p.name);
    e->dirty = 0;
    e->saveas = 0;
    sprintf(spec, "%s\\%s", folder, name);
    if (lib_rescan(lib) == 0) {
        int i = lib_find(lib, spec);

        if (i >= 0) e->pos = i + 1;
    }
    e->total = lib_count(lib);
}

static int write_user(Editor *e, Library *lib, const char *name)
{
    static char path[LIB_DIR_LEN + 32];

    if (lib_user_path(lib, name, path, sizeof path) != 0 || patch_write(path, &e->p) != 0) {
        say_failed(e, "write", name);
        return -1;
    }
    reopened(e, lib, USER_FOLDER, name);
    editor_msg(e, "Saved", R_TEXT);
    return 0;
}

int editor_save_as(Editor *e, Library *lib)
{
    editor_release(e);
    if (!name_valid(e->p.name)) {
        editor_msg(e, "Not a valid name", R_WARNING);
        return -1;
    }
    if (user_exists(lib, e->p.name)) {
        say_user(e, e->p.name, " already exists");
        return -1;
    }
    return write_user(e, lib, e->p.name);
}

int editor_save(Editor *e, Library *lib)
{
    static Patch factory;
    static char path[LIB_DIR_LEN + 32];
    int in_user = strcmp(e->folder, USER_FOLDER) == 0;
    int in_factory = strcmp(e->folder, FACTORY_FOLDER) == 0;

    editor_release(e);
    if (strcmp(e->p.name, e->file) != 0) return editor_save_as(e, lib);
    if ((in_user || in_factory) && read_factory(lib, e->file, &factory) == 0 && patch_equal(&e->p, &factory)) {
        if (!user_exists(lib, e->file)) {
            e->dirty = 0;
            editor_msg(e, "Nothing to save", R_TEXT);
            return 0;
        }
        if (lib_user_path(lib, e->file, path, sizeof path) != 0 || remove(path) != 0) {
            say_failed(e, "remove", e->file);
            return -1;
        }
        reopened(e, lib, FACTORY_FOLDER, e->file);
        editor_msg(e, "Override removed", R_TEXT);
        return 0;
    }
    if (!in_user && user_exists(lib, e->file)) {
        say_user(e, e->file, " exists: use Save As");
        return -1;
    }
    return write_user(e, lib, e->file);
}

int editor_reset(Editor *e, const Library *lib)
{
    static Patch factory;
    Patch before = e->p;

    editor_release(e);
    if ((strcmp(e->folder, USER_FOLDER) != 0 && strcmp(e->folder, FACTORY_FOLDER) != 0) ||
        read_factory(lib, e->file, &factory) != 0) {
        editor_msg(e, "No factory version", R_WARNING);
        return -1;
    }
    undo_break(&history);
    strcpy(factory.name, e->p.name);
    e->p = factory;
    if (e->n == 4 && !e->p.has4) e->n = 2;
    if (e->cur >= e->n) e->cur = e->n - 1;
    if (!commit(e, &before, e->fk, 0)) editor_apply(e);
    undo_break(&history);
    editor_msg(e, "Factory values loaded", R_TEXT);
    return 0;
}

/* Goes to the list, or to the previous or next patch in list order, without asking. */
static int go(Editor *e, const Library *lib, int where, char *err, unsigned errlen)
{
    int total = lib_count(lib);
    int i;

    err[0] = '\0';
    editor_release(e);
    if (where == EL_LIST || where == EL_EXIT) return 1;
    if (total <= 0) return 0;
    i = (e->pos - 1 + (where == EL_NEXT ? 1 : -1) + total) % total;
    editor_load(e, lib, i, err, errlen);
    return 0;
}

int editor_leave(Editor *e, const Library *lib, int where, char *err, unsigned errlen)
{
    err[0] = '\0';
    if (e->dirty) {
        editor_release(e);
        e->prompt = 1;
        e->btn = 0;
        e->pend = where + 1;
        return 0;
    }
    return go(e, lib, where, err, errlen);
}

/* Goes on with the leave the prompt was guarding, if any. */
static int proceed(Editor *e, const Library *lib, int where, char *err, unsigned errlen)
{
    e->pend = 0;
    return where >= 0 ? go(e, lib, where, err, errlen) : 0;
}

/* Button n of the save prompt. */
static int pick(Editor *e, Library *lib, int n, char *err, unsigned errlen)
{
    int where = e->pend - 1;

    e->prompt = 0;
    switch (n) {
    case 0:
        if (editor_save(e, lib) != 0) {
            e->pend = 0;
            return 0;
        }
        return proceed(e, lib, where, err, errlen);
    case 1:
        editor_saveas_begin(e);
        return 0;
    case 2:
        if (e->pos < 1 || editor_load(e, lib, e->pos - 1, err, errlen) != 0) e->dirty = 0;
        err[0] = '\0';
        return proceed(e, lib, where, err, errlen);
    default:
        e->pend = 0;
        return 0;
    }
}

int editor_act(Editor *e, Library *lib, int act, char *err, unsigned errlen)
{
    int where;

    err[0] = '\0';
    switch (act) {
    case EA_LIST: return editor_leave(e, lib, EL_LIST, err, errlen);
    case EA_PREV: return editor_leave(e, lib, EL_PREV, err, errlen);
    case EA_NEXT: return editor_leave(e, lib, EL_NEXT, err, errlen);
    case EA_SAVE: editor_save(e, lib); break;
    case EA_RESET: editor_reset(e, lib); break;
    case EA_SAVEAS:
        where = e->pend - 1;
        if (editor_save_as(e, lib) != 0) {
            e->pend = 0;
            break;
        }
        editor_name_enter(e);
        return proceed(e, lib, where, err, errlen);
    default:
        if (act >= EA_PICK) return pick(e, lib, act - EA_PICK, err, errlen);
        break;
    }
    return 0;
}
