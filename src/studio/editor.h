/* ReBeep Studio: the editor. `Editor` is the state the synth screen draws and the editing keys change; the functions
   below are those changes: navigation, values, the piano, undo, the Save dialog and patch switching. They draw nothing.
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_EDITOR_H
#define RBSTUDIO_EDITOR_H

#include "library.h"
#include "patch.h"

/* The focused row `fk`: a parameter row is its P_* value (0 to P_COUNT - 1), the other rows follow. */
enum { F_VARIANT = P_COUNT, F_OCTAVE, F_CONN, F_FB };

#define ED_KEYS 29   /* piano keys on the bottom row */
#define KB_LOW 3     /* the piano's lowest octave: it always plays from here, and the patch's own octave shifts what is heard */
#define NAME_MAX_LEN 8
#define SAY_LINES 3

/* One line under the Save dialog's fields, `[mark, label, value]`: `mark` is '!' or ' '; a '!' line is drawn whole in
   the warning colour. */
typedef struct { char mark; char label[16]; char value[40]; } SayLine;

/* The Save dialog: the name and the bank to save into, and what Enter would do. The lines are worked out by the editor
   after each dialog key (it needs the library), so the drawing reads them from here. */
typedef struct {
    int field;           /* the focused field: 0 Name, 1 Bank */
    char name[9];
    int bank, banks;     /* the bank chosen: 0 is USER, 1 to `banks` are the other banks in list order, `banks` + 1 a new bank */
    char folder[9];      /* the chosen bank's folder; "" for a new bank */
    char pack[9];        /* the new bank's name, typed in the Bank field */
    int nsay;            /* lines in use */
    SayLine say[SAY_LINES];
    int ok;              /* Enter would save */
} SaveDlg;

typedef struct {
    Patch p;  int n;              /* 2 or 4: the variant shown */
    int chip;                     /* 0, 2, 3 */
    int fk;                       /* focused row: F_VARIANT, F_OCTAVE, F_CONN, F_FB, or a P_* row */
    int cur, lastP;               /* operator in focus; last parameter row */
    int dirty;                    /* the * marker */
    int pos, total;               /* the patch's place in the whole list, 1-based */
    int bpos, btotal;             /* its place in its own bank, 1-based: "2 of 4" */
    unsigned char held[29]; int nheld;   /* piano keys lit, ascending */
    char msg[40]; int msgRole;    /* message area; msgRole is a Role */
    unsigned mods;                /* MOD_* held, as the event stream last said */
    unsigned last_make;           /* the last make event with no break since: a repeat of it is typematic */
    char folder[9], file[9];      /* the open patch's bank and file name, "FACTORY" and "BELL": what a save starts from */
    int help;                     /* the help page shown (1 or 2), 0 for none */
    int prompt, btn;              /* the unsaved-changes prompt is open; its focused button 0 to 2 (Save, Discard, Cancel) */
    int pend;                     /* the leave the prompt or the dialog guards, an EL_* plus 1; 0 for none */
    int dialog;                   /* the Save dialog is open */
    SaveDlg dlg;
    int audition;                 /* the piano key plus 1 that Random or Mutate holds until its key comes up, 0 for none; not drawn */
    int diceKeys;                 /* F12 (1) and F11 (2) down, as the event stream said: the note ends when both are up */
} Editor;

/* What the main loop hands to editor_act after an event or a click. EA_SAVE opens the Save dialog. The EA_DLG_* are the
   dialog's keys: EA_DLG_EDIT a typed character or a field change, LEFT and RIGHT a bank step, ENTER save, CANCEL close.
   EA_PICK plus 0 to 2 is a button of the unsaved-changes prompt chosen. */
enum { EA_NONE, EA_LIST, EA_RESET, EA_PREV, EA_NEXT, EA_BPREV, EA_BNEXT, EA_SAVE, EA_DLG_EDIT, EA_DLG_LEFT,
       EA_DLG_RIGHT, EA_DLG_ENTER, EA_DLG_CANCEL, EA_PICK };

/* Where editor_leave goes: the list, the previous or next patch (on across banks), or the first patch of the previous
   or next bank. */
enum { EL_LIST, EL_PREV, EL_NEXT, EL_BPREV, EL_BNEXT };

/* What a cell of the synth screen is, from synth_hit. `k` is an operator, `key` a P_* row (an F_* row for a bar of
   Feedback, or the piano key of SH_PIANO); a bar covers `bw` cells from column `bx`. SH_PREV, SH_NEXT, SH_BPREV and
   SH_BNEXT are the top row's four arrows (patch, bank). */
enum { SH_NONE, SH_PREV, SH_NEXT, SH_BPREV, SH_BNEXT, SH_VARIANT, SH_OCTAVE, SH_CONN, SH_CONN_CYCLE, SH_FB, SH_ROW,
       SH_CELL, SH_BAR, SH_OPHEAD, SH_PIANO, SH_HELP };

/* What a cell of the Save dialog is, from dialog_hit: outside the window (a click there cancels), the window's body,
   the two fields, the bank arrows and the two buttons. */
enum { DH_OUT = -1, DH_NONE, DH_NAME, DH_BANK, DH_LEFT, DH_RIGHT, DH_SAVE, DH_CANCEL };

typedef struct { int kind, k, key, bx, bw; } SynthHit;

/* Allocates the undo history (once, before the first editor_open). Returns 0, or -1 when memory runs out. */
int editor_init(void);
void editor_done(void);

/* Starts editing `p`: shows its 4-OP variant on an OPL3 when it has one, clears undo, silences held notes and programs
   the voice. `chip` is 0, 2 or 3; `pos` of `total` is the patch's place in the list, and the whole list stands for its
   bank. The patch's origin is left unset (`file` is its name); editor_load sets it and the place in its bank. */
void editor_open(Editor *e, const Patch *p, int chip, int pos, int total);

/* Reads entry `i` of the library and opens it, folder and file name included. Returns 0, or -1 with the reason in `err`. */
int editor_load(Editor *e, const Library *lib, int i, char *err, unsigned errlen);

/* Reprograms the voice shown into the chip (held notes keep sounding). Nothing happens without a chip. */
void editor_apply(const Editor *e);

/* The message area: `text` (26 characters at most) in `role`. */
void editor_msg(Editor *e, const char *text, int role);

/* Moves the focus up (-1) or down (1) the rows: variant, octave, connection, feedback, then the parameters. */
void editor_move(Editor *e, int d);

/* Focuses a row (F_VARIANT..F_FB or a P_* row) directly. */
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

/* The piano: key 0..28 down or up. A key already down is ignored (typematic). Down lights the key and starts the note
   (opl_note_on, from KB_LOW: the patch's octave shifts it); up releases. */
void editor_key_down(Editor *e, int key);
void editor_key_up(Editor *e, int key);

/* Releases every held note: on a patch switch, on opening a pop-up and at exit. */
void editor_release(Editor *e);

void editor_undo(Editor *e);
void editor_redo(Editor *e);

/* One kbd event (INT 09h make or break) through the key table: Ctrl, Alt and Shift as the stream said, and the piano's
   keys. Ctrl+Up and Ctrl+Down change the patch's octave by one within 0 to 7: an edit like the Octave row's, one undo
   step for a held key, and the message `Octave N`. While the help, the unsaved-changes prompt or the Save dialog is open
   it takes the keys alone (the help flips and closes, the prompt moves its focus, the dialog types, steps and changes
   field). Returns an EA_* for editor_act. */
int editor_event(Editor *e, unsigned event);

/* A click on the synth screen: focus, set or play what is under it (the Help control opens the help; the four arrows of
   the top row return EA_PREV, EA_NEXT, EA_BPREV and EA_BNEXT). A second click on a focused Variant, Connection, Octave,
   Waveform or switch changes it. Returns an EA_*. A SH_BAR press is followed by editor_bar while the button stays down. A
   SH_PIANO press is released with editor_key_up. */
int editor_press(Editor *e, const SynthHit *h, int x);

/* A click while the Save dialog is open, on what dialog_hit says is under it (a DH_*): a field takes the focus, an
   arrow steps the bank (and focuses it), Save is Enter, and Cancel or a click outside the window is Esc. Returns an EA_*
   for editor_act. */
int editor_dialog_press(Editor *e, int hit);

/* Opens the help on `page` (1 or 2), or closes it with 0. Opening silences the piano. */
void editor_help(Editor *e, int page);

/* The Save dialog saves the open patch, or a copy of it, as BANK\NAME.RBP in USER, another bank or a new one (never
   FACTORY, never outside the patches folder). EA_SAVE opens it (and the unsaved-changes prompt's Save, for the leave the
   prompt guards); EA_DLG_ENTER saves when the lines under the fields allow it. A save writes the file with the safe save
   (making a new bank's folder first) and lists it; a patch equal to its FACTORY one, saved into USER, removes
   USER\NAME.RBP instead and the open patch becomes FACTORY\NAME. Afterwards the open patch is that file, clean, and the
   message says `Saved BANK\NAME` or `Override removed`. A refused Enter does nothing and the dialog stays; a failed
   write or removal keeps the old file, closes the dialog and says why (`Disk full`, `Read-only disk`, `Can't write
   BANK\NAME.RBP`), the patch as it was, unsaved. */

/* Ctrl+R: loads the factory values (the name kept) as an unsaved, undoable change when the open patch is in FACTORY or
   USER and its name exists in FACTORY; otherwise says `No factory version`. Returns 0 or -1. */
int editor_reset(Editor *e, const Library *lib);

/* F12 (Random, `mutate` 0) or F11 (Mutate): replaces the variant shown with a random voice, or nudges it, as one
   unsaved, undoable step (the other variant, Octave and the name stay), then plays the last piano key started (key 12
   until one is). The note is held until F12 or F11 comes up, like a piano key; a key the piano already holds is
   re-keyed and stays the piano's. Held notes take the new voice. Waveform stops at 3 unless the chip is an OPL3. Says "Random. Ctrl+Z
   to go back" or "Mutated. Ctrl+Z to go back". Returns 1 when the voice changed. */
int editor_dice(Editor *e, int mutate);

/* Leaves the patch: to the list, to the previous or next one in list order (on into the next bank and wrapping at the
   ends, on the 4-OP variant when the chip is an OPL3), or to the first patch of the previous or next bank that has
   one (wrapping). A dirty patch does not go: the prompt opens for `where` and 0 is returned (editor_act continues from
   its buttons). Returns 1 when the caller goes to the list, 0 when it stays in the editor (a failed load leaves the
   current patch with `err` set). */
int editor_leave(Editor *e, const Library *lib, int where, char *err, unsigned errlen);

/* Performs an EA_* that editor_event or editor_press returned, and works out the Save dialog's lines after each of its
   keys. The prompt's Save opens the dialog, and the guarded leave goes on only after a successful save; Esc, a cancel or
   a failed save drops it and the editor stays, dirty, with the message showing. Discard reloads the saved patch and
   goes on; Cancel stays. `err` is empty unless a patch to switch to could not be read. Returns 1 when the caller goes
   to the list. */
int editor_act(Editor *e, Library *lib, int act, char *err, unsigned errlen);

#endif
