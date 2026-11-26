/* ReBeep Studio: the one table of key bindings. A screen asks which binding a key event is, in its context.
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_KEYS_H
#define RBSTUDIO_KEYS_H

/* Contexts. K_GLOBAL bindings work in every context. */
#define K_GLOBAL 0
#define K_MENU 1     /* the menu and the patch list */
#define K_SYNTH 2
#define K_HELP 3     /* the help overlay: page flip and close */
#define K_PROMPT 4   /* the unsaved-changes prompt: its buttons and their first letters */
#define K_SAVE 5     /* the Save dialog: its fields, the bank steps, Enter, Esc and Backspace */

/* Binding ids. */
#define KID_UP 1
#define KID_DOWN 2
#define KID_ENTER 3
#define KID_ESC 4
#define KID_LEFT 5
#define KID_RIGHT 6
#define KID_OP1 7    /* Alt+1 to Alt+4: KID_OP1 plus the operator */
#define KID_OP2 8
#define KID_OP3 9
#define KID_OP4 10
#define KID_TAB 11
#define KID_BTAB 12
#define KID_PGUP 13
#define KID_PGDN 14
#define KID_HELP 15
#define KID_SAVE 16
#define KID_RESET 17
#define KID_UNDO 18
#define KID_REDO 19
#define KID_OCT_UP 20    /* Ctrl+Up and Ctrl+Down: the patch's own octave */
#define KID_OCT_DOWN 21
#define KID_BACK 22
#define KID_PICK1 23   /* the prompt's first letters S (Save), D (Discard), C (Cancel): KID_PICK1 plus the button */
#define KID_PICK2 24
#define KID_PICK3 25
#define KID_RANDOM 26   /* F12: a random voice and a note; F11 (KID_MUTATE) nudges the current one */
#define KID_MUTATE 27
#define KID_BANK_PREV 28   /* Ctrl+PgUp and Ctrl+PgDn: the first patch of the previous or next bank */
#define KID_BANK_NEXT 29

#define MOD_SHIFT 1
#define MOD_CTRL 2
#define MOD_ALT 4

typedef struct {
    unsigned char id;
    unsigned char ctx;
    unsigned char scan;   /* a scan code; the E0-prefixed twin of a key (grey arrows, keypad Enter) matches too */
    unsigned char mods;   /* exactly these of MOD_SHIFT, MOD_CTRL, MOD_ALT must be held */
} KeyBinding;

extern const KeyBinding key_table[];
extern const int key_count;

/* One line of the help page's key table. `col` 0 is the left column, 1 the right; a column's rows run top to bottom in
   this order. A HEADING shows `keys` as its title; a KEYS row shows `keys` and `text` and documents the bindings in
   `ids` (0-terminated; one row may cover several, as "Up Down" does); an INFO row shows `keys` and `text` with no binding
   (Mouse, the piano's keys, a blank row). */
enum { HR_HEADING, HR_KEYS, HR_INFO };

typedef struct {
    unsigned char col;
    unsigned char kind;
    const char *keys;
    const char *text;
    const unsigned char *ids;
} HelpRow;

extern const HelpRow HELP_ROWS[];
extern const int HELP_ROW_COUNT;

/* The Shift, Ctrl and Alt keys held now (MOD_* bits), from the kbd key-state table. */
unsigned key_mods(void);

/* The id of the binding that a kbd event (a make, not a break) triggers in `ctx` or K_GLOBAL with `mods` held,
   or 0 when there is none. */
int key_lookup(int ctx, unsigned event, unsigned mods);

#define KEY_PIANO_KEYS 29

/* The piano key that a kbd event's scan code plays, make or break: 0 is the lower C, 28 the upper E. Z S X D C V G B H
   N J M from the lower C, Q 2 W 3 E R 5 T 6 Y 7 U I 9 O 0 P from the upper C. -1 for any other key. */
int key_piano(unsigned event);

/* The name character a make event types in the Save dialog: A-Z (always upper case), 0-9, '-' and, with Shift, '_'. 0 for
   any other key, and while Ctrl or Alt is held. */
char key_name_char(unsigned event, unsigned mods);

#endif
