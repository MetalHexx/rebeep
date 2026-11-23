/* ReBeep Studio: the editor. `Editor` is the state the synth screen draws and the editing keys change; the functions
   below are those changes: navigation, values, the name, the piano, undo, and patch switching. They draw nothing.
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_EDITOR_H
#define RBSTUDIO_EDITOR_H

#include "library.h"
#include "patch.h"

/* The focused row `fk`: a parameter row is its P_* value (0 to P_COUNT - 1), the other rows follow. */
enum { F_NAME = P_COUNT, F_VARIANT, F_OCTAVE, F_CONN, F_FB };

#define ED_KEYS 29   /* piano keys on the bottom row */
#define KB_LOW 3     /* the keyboard's octave at start */
#define KB_MAX 5     /* the highest keyboard octave: its top key, 28 above the C, is still note 95 */
#define NAME_MAX_LEN 8

typedef struct {
    Patch p;  int n;              /* 2 or 4: the variant shown */
    int chip;                     /* 0, 2, 3 */
    int fk;                       /* focused row: F_NAME, F_VARIANT, F_OCTAVE, F_CONN, F_FB, or a P_* row */
    int cur, lastP;               /* operator in focus; last parameter row */
    int dirty;                    /* the * marker */
    int pos, total;               /* "12 of 40" */
    unsigned char held[29]; int nheld;   /* piano keys lit, ascending */
    int kbOct;                    /* keyboard octave, KB_LOW = 3 */
    char msg[40]; int msgRole;    /* message area; msgRole is a Role */
    char nameBefore[9];           /* the name when its row took the focus: Esc restores it */
    unsigned mods;                /* MOD_* held, as the event stream last said */
    unsigned last_make;           /* the last make event with no break since: a repeat of it is typematic */
    char folder[9], file[9];      /* the open patch's FOLDER and file name, "FACTORY" and "BELL": what a save acts on; the
                                     name in p.name is the row's text, which is only a new name once edited */
    int help;                     /* the help page shown (1 or 2), 0 for none */
    int prompt, btn;              /* the save prompt is open; its focused button 0 to 3 (Save, Save As, Discard, Cancel) */
    int pend;                     /* the leave the prompt guards, an EL_* plus 1; 0 for none */
    int saveas;                   /* the name row takes a Save As name: Enter saves it, Esc cancels */
} Editor;

/* What the main loop hands to editor_act after an event or a click. EA_SAVEAS is Enter on a Save As name; EA_PICK plus
   0 to 3 is a button of the save prompt chosen. */
enum { EA_NONE, EA_LIST, EA_PREV, EA_NEXT, EA_SAVE, EA_SAVEAS, EA_RESET, EA_PICK };

/* Where editor_leave goes: the list, the previous or next patch, or out of the program. */
enum { EL_LIST, EL_PREV, EL_NEXT, EL_EXIT };

/* What a cell of the synth screen is, from synth_hit. `k` is an operator, `key` a P_* row (an F_* row for a bar of
   Feedback, or the piano key of SH_PIANO); a bar covers `bw` cells from column `bx`. */
enum { SH_NONE, SH_NAME, SH_PREV, SH_NEXT, SH_VARIANT, SH_OCTAVE, SH_CONN, SH_CONN_CYCLE, SH_FB, SH_ROW, SH_CELL,
       SH_BAR, SH_OPHEAD, SH_PIANO, SH_HELP };

typedef struct { int kind, k, key, bx, bw; } SynthHit;

/* Allocates the undo history (once, before the first editor_open). Returns 0, or -1 when memory runs out. */
int editor_init(void);
void editor_done(void);

/* Starts editing `p`: shows its 4-OP variant on an OPL3 when it has one, clears undo, silences held notes and programs
   the voice. `chip` is 0, 2 or 3; `pos` of `total` is the patch's place in the list. The patch's origin is left unset
   (`file` is its name); editor_load sets it. */
void editor_open(Editor *e, const Patch *p, int chip, int pos, int total);

/* Reads entry `i` of the library and opens it, folder and file name included. Returns 0, or -1 with the reason in `err`. */
int editor_load(Editor *e, const Library *lib, int i, char *err, unsigned errlen);

/* Reprograms the voice shown into the chip (held notes keep sounding). Nothing happens without a chip. */
void editor_apply(const Editor *e);

/* The message area: `text` (26 characters at most) in `role`. */
void editor_msg(Editor *e, const char *text, int role);

/* Moves the focus up (-1) or down (1) the rows: name, variant, octave, connection, feedback, then the parameters.
   Focus on the name silences the piano. */
void editor_move(Editor *e, int d);

/* Focuses a row (F_NAME..F_FB or a P_* row) directly. */
void editor_focus(Editor *e, int row);

/* Selects operator `k` (ignored out of range); a focus on a non-parameter row moves to the last parameter row. */
void editor_op(Editor *e, int k);

/* Changes the focused value by `d` (-1 or 1) and reprograms the voice. A switch takes Left as Off and Right as On;
   Connection wraps, the others stop at their range (Waveform at 3 on an OPL2, 7 otherwise; a value already above it
   is never raised). `repeat` is set for a typematic repeat: a held key is one undo step. Returns 1 when something
   changed. Variant switches between 2-OP and 4-OP, creating the 4-OP variant from the 2-OP voice when the patch has none. */
int editor_change(Editor *e, int d, int repeat);

/* Sets the parameter or Feedback row `key` of operator `k` to the value a mouse position `x` over a bar (`bx`, `bw`)
   gives. `repeat` is set while dragging. Returns 1 when the value changed. */
int editor_bar(Editor *e, int k, int key, int bx, int bw, int x, int repeat);

/* The name row: adds the character to the name, deletes the last one, ends editing (focus to Variant), or restores
   the name the row was focused with. editor_name_esc returns 0 when the name was untouched, so Esc leaves instead. */
void editor_name_add(Editor *e, char ch);
void editor_name_back(Editor *e);
void editor_name_enter(Editor *e);
int editor_name_esc(Editor *e);

/* The piano: key 0..28 down or up. A key already down is ignored (typematic); the piano is silent while the name row
   is focused. Down lights the key and starts the note (opl_note_on); up releases. */
void editor_key_down(Editor *e, int key);
void editor_key_up(Editor *e, int key);

/* Moves the keyboard octave by `d`, within 0 to KB_MAX, releasing the held notes. */
void editor_kb_octave(Editor *e, int d);

/* Releases every held note: on focus to the name, on a patch switch, on opening a pop-up and at exit. */
void editor_release(Editor *e);

void editor_undo(Editor *e);
void editor_redo(Editor *e);

/* One kbd event (INT 09h make or break) through the key table: Ctrl, Alt and Shift as the stream said, the piano's
   keys, the name's characters. While the help or the save prompt is open it takes the keys alone (the help flips and
   closes, the prompt moves its focus); Ctrl+A starts a Save As. Returns an EA_* for editor_act. */
int editor_event(Editor *e, unsigned event);

/* A click on the synth screen: focus, set or play what is under it (the Help control opens the help). Returns an EA_*. A
   SH_BAR press is followed by editor_bar while the button stays down. A SH_PIANO press is released with editor_key_up. */
int editor_press(Editor *e, const SynthHit *h, int x);

/* Opens the help on `page` (1 or 2), or closes it with 0. Opening silences the piano. */
void editor_help(Editor *e, int page);

/* Starts a Save As: the name row takes the focus with the current name, Enter saves it under the typed name and Esc
   cancels (and drops the leave the save prompt was guarding). */
void editor_saveas_begin(Editor *e);

/* Ctrl+S, in this order, the first that applies: a name edited in the name row is a Save As; the open USER or FACTORY
   patch equal to the FACTORY patch of its name removes USER\<name> if it exists (else there is nothing to write); a
   FACTORY or pack patch whose USER\<name> exists is refused; otherwise USER\<name>.RBP is written. A write makes the
   open patch USER\<name>, a removal makes it FACTORY\<name>; either rescans `lib` and moves `pos` to it. The patch is
   clean afterwards. Nothing but the open USER patch's own file is ever overwritten. Returns 0, or -1 with the reason in
   the message area (refused, `Disk full`, `Read-only disk`, `Can't write <path>`) and the patch as it was. */
int editor_save(Editor *e, Library *lib);

/* Saves under the name in the name row as USER\<name>.RBP: refused when the name is not valid (name_valid) or already
   in USER. The open patch becomes the new one. Returns 0 or -1 as editor_save does. */
int editor_save_as(Editor *e, Library *lib);

/* Ctrl+R: loads the factory values (the name kept) as an unsaved, undoable change when the open patch is in FACTORY or
   USER and its name exists in FACTORY; otherwise says `No factory version`. Returns 0 or -1. */
int editor_reset(Editor *e, const Library *lib);

/* Leaves the patch: to the list, to the previous or next one in list order (wrapping, on the 4-OP variant when the
   chip is an OPL3), or out of the program (EL_EXIT, which like the list returns 1). A dirty patch does not go: the save
   prompt opens for `where` and 0 is returned (editor_act continues from its buttons). Returns 1 when the caller goes
   to the list, 0 when it stays in the editor (a failed load leaves the current patch with `err` set). */
int editor_leave(Editor *e, const Library *lib, int where, char *err, unsigned errlen);

/* Performs an EA_* that editor_event or editor_press returned. The save prompt's Save goes on with the guarded leave
   only after a successful save; a refused or failed save, or a Save As cancelled, drops it and the editor stays,
   dirty, with the message showing. Discard reloads the saved patch and goes on; Cancel stays. `err` is empty unless a
   patch to switch to could not be read. Returns 1 when the caller goes to the list. */
int editor_act(Editor *e, Library *lib, int act, char *err, unsigned errlen);

#endif
