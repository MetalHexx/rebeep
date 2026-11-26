/* ReBeep Studio: the editor's logic. No drawing here; the synth screen reads the Editor these functions change.
   SPDX-License-Identifier: MIT */
#include <stdio.h>
#include <string.h>

#include "dice.h"
#include "dos.h"
#include "editor.h"
#include "kbd.h"
#include "keys.h"
#include "log.h"
#include "opl.h"
#include "roles.h"
#include "undo.h"

#define FIRST_PARAM_NAV 4   /* the rows before the parameters in the Up/Down order: variant, octave, conn, fb */
#define NAV_ROWS (FIRST_PARAM_NAV + P_COUNT)
#define USER_FOLDER "USER"
#define FACTORY_FOLDER "FACTORY"
#define DEFAULT_KEY 12   /* the piano's C4 at the patch's octave 4 */
#define OCTAVE_MAX 7
#define RBP_EXT ".RBP"
#define PROMPT_BTNS 3   /* the unsaved-changes prompt's buttons: Save, Discard, Cancel */

static Undo history;
static Patch saved;   /* the open patch as opened or last saved: undo and redo are clean only on it */
static int last_key = DEFAULT_KEY;   /* the piano key last started, 0 to 28: what Random and Mutate play; kept across editor_open */

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
    e->bpos = pos;
    e->btotal = total;
    e->msgRole = R_TEXT;
    e->mods = key_mods();
    strcpy(e->file, p->name);
    saved = *p;
    undo_clear(&history);
    editor_apply(e);
}

/* Sets the patch's place in its own bank from its place in the list. */
static void place(Editor *e, const Library *lib)
{
    int first;
    int count;

    lib_bank(lib, e->pos - 1, &first, &count);
    e->bpos = e->pos - first;
    e->btotal = count;
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
    place(e, lib);
    return 0;
}

void editor_release(Editor *e)
{
    opl_all_off();
    e->nheld = 0;
    e->audition = 0;
}

void editor_focus(Editor *e, int row)
{
    undo_break(&history);
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
    if (e->fk >= P_COUNT) editor_focus(e, e->lastP);
}

static int same_patch(const Patch *a, const Patch *b)
{
    return patch_equal(a, b) && strcmp(a->name, b->name) == 0;
}

/* Records `before` as an undo step when the patch is no longer the same, marks it dirty (even when a change lands on the
   saved values again) and reprograms the voice. Returns 1 when it changed. */
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
        max = OCTAVE_MAX;
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

    if (e->fk != key || (key != F_FB && e->cur != k)) {
        if (key != F_FB) e->cur = k;
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

    if (key < 0 || key >= ED_KEYS || is_held(e, key)) return;
    last_key = key;
    for (j = e->nheld; j > 0 && e->held[j - 1] > key; j--) e->held[j] = e->held[j - 1];
    e->held[j] = (unsigned char)key;
    e->nheld++;
    if (e->chip == 0) editor_msg(e, "No OPL: cannot play", R_WARNING);
    else opl_note_on(KB_LOW * 12 + key);
}

void editor_key_up(Editor *e, int key)
{
    int j;

    if (!is_held(e, key)) return;
    if (e->audition == key + 1) e->audition = 0;
    for (j = 0; e->held[j] != key; j++) {
    }
    for (; j + 1 < e->nheld; j++) e->held[j] = e->held[j + 1];
    e->nheld--;
    if (e->chip != 0) opl_note_off(KB_LOW * 12 + key);
}

/* Ctrl+Up and Ctrl+Down: the patch's own octave by one, as an edit like the Octave row's Left and Right. */
static void octave_step(Editor *e, int d, int repeat)
{
    Patch before = e->p;
    char text[16];
    int nv = e->p.octave + d;

    if (nv < 0) nv = 0;
    if (nv > OCTAVE_MAX) nv = OCTAVE_MAX;
    e->p.octave = (unsigned char)nv;
    commit(e, &before, F_OCTAVE, repeat);
    sprintf(text, "Octave %d", nv);
    editor_msg(e, text, R_TEXT);
}

/* After a snapshot came back: the variant shown must exist, the operator must be on screen, the patch is clean only when
   it is the opened or saved one (name included), the chip hears it. */
static void restored(Editor *e)
{
    if (e->n == 4 && !e->p.has4) e->n = 2;
    if (e->cur >= e->n) e->cur = e->n - 1;
    e->dirty = !same_patch(&saved, &e->p);
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

/* Which of Random's and Mutate's keys an event is, whatever modifiers are held: 1 for F12, 2 for F11, 0 for any other. */
static int dice_key(unsigned event)
{
    int id = (event & KBD_EXT) ? 0 : key_lookup(K_SYNTH, event & ~KBD_BREAK, 0);

    return id == KID_RANDOM ? 1 : id == KID_MUTATE ? 2 : 0;
}

/* Releases the note Random or Mutate started, if it is still held. */
static void audition_end(Editor *e)
{
    int key = e->audition - 1;

    e->audition = 0;
    if (key >= 0) editor_key_up(e, key);
}

/* A key while the unsaved-changes prompt is open: Left, Right and Tab move the focus, Enter or a first letter chooses,
   Esc is Cancel. */
static int prompt_key(Editor *e, unsigned event)
{
    int id = key_lookup(K_PROMPT, event, e->mods);

    switch (id) {
    case KID_LEFT: case KID_BTAB: e->btn = (e->btn + PROMPT_BTNS - 1) % PROMPT_BTNS; break;
    case KID_RIGHT: case KID_TAB: e->btn = (e->btn + 1) % PROMPT_BTNS; break;
    case KID_ENTER: return EA_PICK + e->btn;
    case KID_ESC: return EA_PICK + PROMPT_BTNS - 1;
    case KID_PICK1: case KID_PICK2: case KID_PICK3: return EA_PICK + (id - KID_PICK1);
    default: break;
    }
    return EA_NONE;
}

/* A key while the Save dialog is open: Up, Down and Tab change field, Left and Right step the bank, Enter saves, Esc
   cancels; a typed character or Backspace edits the Name, or the new bank's name when the Bank field holds one. What
   needs the library (the bank steps, the lines) is left to editor_act. */
static int dialog_key(Editor *e, unsigned event)
{
    SaveDlg *d = &e->dlg;
    char *text = d->field == 0 ? d->name : d->newbank;
    int typing = d->field == 0 || d->bank == d->banks + 1;
    size_t len = strlen(text);
    char ch;

    switch (key_lookup(K_SAVE, event, e->mods)) {
    case KID_UP: case KID_DOWN: case KID_TAB: case KID_BTAB:
        d->field = 1 - d->field;
        return EA_DLG_EDIT;
    case KID_LEFT: return EA_DLG_LEFT;
    case KID_RIGHT: return EA_DLG_RIGHT;
    case KID_ENTER: return EA_DLG_ENTER;
    case KID_ESC: return EA_DLG_CANCEL;
    case KID_BACK:
        if (!typing || len == 0) return EA_NONE;
        text[len - 1] = '\0';
        return EA_DLG_EDIT;
    default: break;
    }
    ch = key_name_char(event, e->mods);
    if (ch == 0 || !typing || len >= NAME_MAX_LEN) return EA_NONE;
    text[len] = ch;
    text[len + 1] = '\0';
    return EA_DLG_EDIT;
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
    int dice = dice_key(event);
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
        if (dice != 0) {
            e->diceKeys &= ~dice;
            if (e->diceKeys == 0) audition_end(e);
        }
        return EA_NONE;
    }
    repeat = event == e->last_make;
    e->last_make = event;
    e->diceKeys |= dice;

    if (e->prompt) return prompt_key(e, event);
    if (e->dialog) return dialog_key(e, event);
    if (e->help) {
        help_key(e, event);
        return EA_NONE;
    }
    if (piano >= 0 && !(e->mods & (MOD_CTRL | MOD_ALT))) {
        editor_key_down(e, piano);
        return EA_NONE;
    }
    id = key_lookup(K_SYNTH, event, e->mods);
    if ((id == KID_RANDOM || id == KID_MUTATE) && repeat) return EA_NONE;
    e->msg[0] = '\0';

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
    case KID_BANK_PREV: return EA_BPREV;
    case KID_BANK_NEXT: return EA_BNEXT;
    case KID_HELP: editor_help(e, 1); break;
    case KID_SAVE: return EA_SAVE;
    case KID_RESET: return EA_RESET;
    case KID_UNDO: editor_undo(e); break;
    case KID_REDO: editor_redo(e); break;
    case KID_OCT_UP: octave_step(e, 1, repeat); break;
    case KID_OCT_DOWN: octave_step(e, -1, repeat); break;
    case KID_RANDOM: editor_dice(e, 0); break;
    case KID_MUTATE: editor_dice(e, 1); break;
    case KID_ESC: return EA_LIST;
    default: break;
    }
    return EA_NONE;
}

/* A second click on the focused Octave or Waveform: the next value, wrapping to 0 after the top. A Waveform already
   above the chip's limit drops to 0 rather than rising. */
static void click_step(Editor *e)
{
    Patch before = e->p;
    int row = e->fk;
    unsigned char *f = row == F_OCTAVE ? &e->p.octave : &voice_of(e)->op[e->cur].v[P_WAVE];
    int max = row == F_OCTAVE || e->chip == 3 ? 7 : 3;

    *f = (unsigned char)(*f >= max ? 0 : *f + 1);
    commit(e, &before, row, 0);
}

int editor_press(Editor *e, const SynthHit *h, int x)
{
    if (h->kind != SH_PIANO) e->msg[0] = '\0';
    switch (h->kind) {
    case SH_PREV: return EA_PREV;
    case SH_NEXT: return EA_NEXT;
    case SH_BPREV: return EA_BPREV;
    case SH_BNEXT: return EA_BNEXT;
    case SH_HELP: editor_help(e, 1); break;
    case SH_VARIANT:
        if (e->fk == F_VARIANT) editor_change(e, 1, 0);
        editor_focus(e, F_VARIANT);
        break;
    case SH_OCTAVE: {
        int was = e->fk == F_OCTAVE;

        editor_focus(e, F_OCTAVE);
        if (was) click_step(e);
        break;
    }
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
        else if (was && h->key == P_WAVE) click_step(e);
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

/* The message for a write or removal that failed, with the reason DOS gave. */
static void say_failed(Editor *e, const char *what, const char *folder, const char *name)
{
    char text[sizeof e->msg];

    switch (dos_write_why()) {
    case DOS_WHY_FULL: editor_msg(e, "Disk full", R_WARNING); break;
    case DOS_WHY_PROTECTED: editor_msg(e, "Read-only disk", R_WARNING); break;
    default:
        sprintf(text, "Can't %s %s\\%s" RBP_EXT, what, folder, name);
        editor_msg(e, text, R_WARNING);
        break;
    }
}

/* Is there a patch "name" in `folder`: listed, or a file under that name even when it cannot be read as a patch. */
static int file_exists(const Library *lib, const char *folder, const char *name)
{
    static char path[LIB_DIR_LEN + 32];
    char spec[24];

    sprintf(spec, "%s\\%s", folder, name);
    return lib_find(lib, spec) >= 0 || (lib_bank_path(lib, folder, name, path, sizeof path) == 0 && dos_is_file(path));
}

/* Is the FACTORY patch "name" listed. */
static int in_factory(const Library *lib, const char *name)
{
    char spec[24];

    sprintf(spec, FACTORY_FOLDER "\\%s", name);
    return lib_find(lib, spec) >= 0;
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

/* The open patch is saved as FOLDER\name now, at index `at` of the list the caller has just updated (-1: not listed, pos
   stays). The next edit starts a new undo step, so undo can get back to what was saved. */
static void reopened(Editor *e, const Library *lib, const char *folder, const char *name, int at)
{
    strcpy(e->folder, folder);
    strcpy(e->file, name);
    saved = e->p;
    undo_break(&history);
    e->dirty = 0;
    if (at >= 0) e->pos = at + 1;
    e->total = lib_count(lib);
    place(e, lib);
}

/* The banks the Save dialog offers besides USER, in list order (FACTORY and USER are not among them). For k from 1, puts
   the k-th in `out` and returns 0, or returns -1 past the last; for k 0 returns how many there are (`out` is not used). */
static int dialog_bank(const Library *lib, int k, char *out)
{
    int i = 0;
    int n = 0;

    while (i < lib_count(lib)) {
        char folder[9];
        int first;
        int count;

        lib_bank(lib, i, &first, &count);
        _fstrcpy(folder, lib_entry(lib, first)->folder);
        if (strcmp(folder, FACTORY_FOLDER) != 0 && strcmp(folder, USER_FOLDER) != 0 && ++n == k) {
            strcpy(out, folder);
            return 0;
        }
        i = first + count;
    }
    return k == 0 ? n : -1;
}

/* Makes the dialog's bank `bank` (0 to banks + 1, wrapping) the chosen one and its folder the name shown. */
static void dialog_choose(Editor *e, const Library *lib, int bank)
{
    SaveDlg *d = &e->dlg;
    int n = d->banks + 2;

    d->bank = (bank + n) % n;
    if (d->bank == 0) strcpy(d->folder, USER_FOLDER);
    else if (d->bank == d->banks + 1) d->folder[0] = '\0';
    else dialog_bank(lib, d->bank, d->folder);
}

/* The FACTORY patch of the name the dialog last asked about, kept until the name changes or the dialog opens again. */
static Patch factory_copy;
static char factory_name[9];
static int factory_state;   /* 0 not read, 1 read, -1 not there or unreadable */

/* Do the open patch's values equal the FACTORY patch "name". */
static int factory_equal(const Editor *e, const Library *lib, const char *name)
{
    if (factory_state == 0 || strcmp(factory_name, name) != 0) {
        strcpy(factory_name, name);
        factory_state = read_factory(lib, name, &factory_copy) == 0 ? 1 : -1;
    }
    return factory_state > 0 && patch_equal(&e->p, &factory_copy);
}

static void say(SaveDlg *d, int bang, const char *label, const char *value)
{
    SayLine *l = &d->say[d->nsay++];

    l->mark = bang ? '!' : ' ';
    sprintf(l->label, "%.15s", label);
    sprintf(l->value, "%.39s", value);
}

/* Creates the folder a file path is in. */
static int make_folder(char *path)
{
    char *cut = strrchr(path, '\\');
    int made;

    if (cut == NULL) return -1;
    *cut = '\0';
    made = dos_make_dir(path);
    *cut = '\\';
    return made;
}

/* Writes the open patch as BANK\name.RBP and lists it. Returns 0, or -1 with the old file kept and the reason in the
   message area. */
static int dialog_write(Editor *e, Library *lib, const char *bank, const char *name)
{
    static char path[LIB_DIR_LEN + 32];
    static Patch out;
    char text[sizeof e->msg];
    int at;

    out = e->p;
    strcpy(out.name, name);
    if (lib_bank_path(lib, bank, name, path, sizeof path) != 0 || make_folder(path) != 0 || patch_write(path, &out) != 0) {
        say_failed(e, "write", bank, name);
        return -1;
    }
    e->p = out;
    at = lib_put(lib, bank, &out);
    if (at < 0) log_line("%s\\%s is saved but not listed: the patch list is full", bank, name);
    reopened(e, lib, bank, name, at);
    sprintf(text, "Saved %s\\%s", bank, name);
    editor_msg(e, text, R_TEXT);
    return 0;
}

/* Deletes USER\name.RBP, the override the open patch equals the factory patch of, and goes back to FACTORY\name. Returns
   0, or -1 with the file kept and the reason in the message area. */
static int dialog_remove(Editor *e, Library *lib, const char *name)
{
    static char path[LIB_DIR_LEN + 32];
    char spec[24];

    if (lib_bank_path(lib, USER_FOLDER, name, path, sizeof path) != 0 || dos_remove(path) != 0) {
        say_failed(e, "remove", USER_FOLDER, name);
        return -1;
    }
    lib_drop(lib, USER_FOLDER, name);
    strcpy(e->p.name, name);
    sprintf(spec, FACTORY_FOLDER "\\%s", name);
    reopened(e, lib, FACTORY_FOLDER, name, lib_find(lib, spec));
    editor_msg(e, "Override removed", R_TEXT);
    return 0;
}

/* The refusal of the new bank's name typed in the Bank field, as a line under the fields. Returns 1 when it is refused. */
static int bank_refused(Editor *e, const Library *lib)
{
    SaveDlg *d = &e->dlg;
    char text[40];
    char other[9];
    int k;

    if (d->newbank[0] == '\0') {
        say(d, 0, "Bank name:", "type it in Bank");
        return 1;
    }
    if (!folder_valid(d->newbank)) {
        say(d, 1, "Bank name:", "up to 8 letters, digits, - and _");
        return 1;
    }
    if (stricmp(d->newbank, FACTORY_FOLDER) == 0 || stricmp(d->newbank, USER_FOLDER) == 0) {
        say(d, 1, "Bank name:", "FACTORY and USER are taken");
        return 1;
    }
    for (k = 1; k <= d->banks; k++) {
        dialog_bank(lib, k, other);
        if (stricmp(d->newbank, other) == 0) {
            sprintf(text, "%s exists, choose it with \x11 \x10", d->newbank);
            say(d, 1, "Bank name:", text);
            return 1;
        }
    }
    return 0;
}

/* What the Save dialog says Enter would do, as up to three lines, and with `enter` set what Enter does when the lines
   allow it: the one place that decides, so the dialog says what the save does. Returns 1 when it saved or removed, -1
   when that failed, else 0. */
static int dialog_plan(Editor *e, Library *lib, int enter)
{
    SaveDlg *d = &e->dlg;
    const char *name = d->name;
    int is_new = d->bank == d->banks + 1;
    const char *bank = is_new ? d->newbank : d->folder;
    int in_user = d->bank == 0;
    int exists;
    int removing = 0;
    char file[24];
    char spec[24];
    char text[40];

    d->nsay = 0;
    d->ok = 0;
    if (!name_valid(name)) {
        say(d, 1, "Name:", "up to 8 letters, digits, - and _");
        return 0;
    }
    if (is_new && bank_refused(e, lib)) return 0;

    sprintf(file, "%s\\%s" RBP_EXT, bank, name);
    sprintf(spec, "%s\\%s", bank, name);
    exists = !is_new && file_exists(lib, bank, name);
    if (in_user && factory_equal(e, lib, name)) {
        sprintf(text, FACTORY_FOLDER "\\%s", name);
        say(d, 0, "Matches:", text);
        if (!exists) {
            say(d, 0, "Nothing to save", "");
            return 0;
        }
        say(d, 0, "Removes:", file);
        removing = 1;
    } else {
        if (lib_find(lib, spec) < 0 && lib_count(lib) >= LIB_MAX) {
            sprintf(text, "the list is full (%d)", LIB_MAX);
            say(d, 1, "Patches:", text);
            return 0;
        }
        if (is_new) {
            say(d, 0, "New bank:", bank);
            say(d, 0, "New patch:", file);
        } else if (strcmp(bank, e->folder) == 0 && strcmp(name, e->file) == 0) {
            say(d, 0, "Updates:", file);
        } else {
            say(d, exists, exists ? "Replaces:" : "New patch:", file);
        }
        if (in_user && in_factory(lib, name)) {
            sprintf(text, FACTORY_FOLDER "\\%s", name);
            say(d, !exists, "Overrides:", text);
        }
        sprintf(text, "/P:%s", in_user ? name : spec);
        say(d, 0, "In games:", text);
    }
    d->ok = 1;
    if (!enter) return 0;
    return (removing ? dialog_remove(e, lib, name) : dialog_write(e, lib, bank, name)) == 0 ? 1 : -1;
}

/* Opens the Save dialog on the open patch's name and bank (a FACTORY patch starts on USER). */
static void dialog_open(Editor *e, Library *lib)
{
    SaveDlg *d = &e->dlg;
    char folder[9];
    int k;
    int bank = 0;

    editor_release(e);
    memset(d, 0, sizeof *d);
    strcpy(d->name, e->p.name);
    d->banks = dialog_bank(lib, 0, NULL);
    for (k = 1; k <= d->banks && bank == 0; k++) {
        dialog_bank(lib, k, folder);
        if (strcmp(folder, e->folder) == 0) bank = k;
    }
    dialog_choose(e, lib, bank);
    factory_state = 0;
    e->prompt = 0;
    e->dialog = 1;
    dialog_plan(e, lib, 0);
}

int editor_dialog_press(Editor *e, int hit)
{
    switch (hit) {
    case DH_OUT: case DH_CANCEL: return EA_DLG_CANCEL;
    case DH_NAME: e->dlg.field = 0; return EA_DLG_EDIT;
    case DH_BANK: e->dlg.field = 1; return EA_DLG_EDIT;
    case DH_LEFT: e->dlg.field = 1; return EA_DLG_LEFT;
    case DH_RIGHT: e->dlg.field = 1; return EA_DLG_RIGHT;
    case DH_SAVE: return EA_DLG_ENTER;
    default: return EA_NONE;
    }
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

int editor_dice(Editor *e, int mutate)
{
    Patch before = e->p;
    int wavmax = e->chip == 3 ? 7 : 3;
    int key = last_key;
    int changed;

    undo_break(&history);
    if (mutate) dice_mutate(voice_of(e), e->n, wavmax);
    else dice_roll(voice_of(e), e->n, wavmax);
    changed = commit(e, &before, e->fk, 0);
    undo_break(&history);
    editor_msg(e, mutate ? "Mutated. Ctrl+Z to go back" : "Random. Ctrl+Z to go back", R_TEXT);
    if (is_held(e, key)) {
        if (e->chip != 0) {
            opl_note_off(KB_LOW * 12 + key);
            opl_note_on(KB_LOW * 12 + key);
        }
    } else {
        editor_key_down(e, key);
        if (is_held(e, key)) e->audition = key + 1;
    }
    return changed;
}

/* Goes to the list, or to the previous or next patch in list order (on into the next bank, wrapping at the ends), or to
   the first patch of the previous or next bank, without asking. */
static int go(Editor *e, const Library *lib, int where, char *err, unsigned errlen)
{
    int total = lib_count(lib);
    int first;
    int count;
    int i;

    err[0] = '\0';
    editor_release(e);
    if (where == EL_LIST) return 1;
    if (total <= 0) return 0;
    if (where == EL_PREV || where == EL_NEXT) {
        i = (e->pos - 1 + (where == EL_NEXT ? 1 : -1) + total) % total;
    } else {
        lib_bank(lib, e->pos - 1, &first, &count);
        if (where == EL_BNEXT) i = first + count < total ? first + count : 0;
        else lib_bank(lib, first > 0 ? first - 1 : total - 1, &i, &count);
    }
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

/* Button n of the unsaved-changes prompt: Save opens the dialog for the same leave. */
static int pick(Editor *e, Library *lib, int n, char *err, unsigned errlen)
{
    int where = e->pend - 1;

    e->prompt = 0;
    switch (n) {
    case 0:
        dialog_open(e, lib);
        return 0;
    case 1:
        if (e->pos < 1 || editor_load(e, lib, e->pos - 1, err, errlen) != 0) e->dirty = 0;
        err[0] = '\0';
        return proceed(e, lib, where, err, errlen);
    default:
        e->pend = 0;
        return 0;
    }
}

/* The Save dialog's keys and clicks: the lines are worked out again after each, and Enter's work is done by the same
   function. The leave the prompt guards goes on after a save, and is dropped by a cancel or a failed save. */
static int dialog_act(Editor *e, Library *lib, int act, char *err, unsigned errlen)
{
    int where = e->pend - 1;
    int done;

    if (!e->dialog) return 0;
    switch (act) {
    case EA_DLG_LEFT: dialog_choose(e, lib, e->dlg.bank - 1); dialog_plan(e, lib, 0); break;
    case EA_DLG_RIGHT: dialog_choose(e, lib, e->dlg.bank + 1); dialog_plan(e, lib, 0); break;
    case EA_DLG_ENTER:
        done = dialog_plan(e, lib, 1);
        if (done == 0) break;
        e->dialog = 0;
        if (done > 0) return proceed(e, lib, where, err, errlen);
        e->pend = 0;
        break;
    case EA_DLG_CANCEL:
        e->dialog = 0;
        e->pend = 0;
        break;
    default: dialog_plan(e, lib, 0); break;
    }
    return 0;
}

int editor_act(Editor *e, Library *lib, int act, char *err, unsigned errlen)
{
    err[0] = '\0';
    switch (act) {
    case EA_LIST: return editor_leave(e, lib, EL_LIST, err, errlen);
    case EA_PREV: return editor_leave(e, lib, EL_PREV, err, errlen);
    case EA_NEXT: return editor_leave(e, lib, EL_NEXT, err, errlen);
    case EA_BPREV: return editor_leave(e, lib, EL_BPREV, err, errlen);
    case EA_BNEXT: return editor_leave(e, lib, EL_BNEXT, err, errlen);
    case EA_SAVE: dialog_open(e, lib); break;
    case EA_RESET: editor_reset(e, lib); break;
    default:
        if (act >= EA_PICK) return pick(e, lib, act - EA_PICK, err, errlen);
        if (act >= EA_DLG_EDIT) return dialog_act(e, lib, act, err, errlen);
        break;
    }
    return 0;
}
