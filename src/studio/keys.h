/* ReBeep Studio: the one table of key bindings. A screen asks which binding a key event is, in its context.
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_KEYS_H
#define RBSTUDIO_KEYS_H

/* Contexts. K_GLOBAL bindings work in every context. */
#define K_GLOBAL 0
#define K_MENU 1     /* the menu and the patch list */
#define K_SYNTH 2

/* Binding ids. */
#define KID_UP 1
#define KID_DOWN 2
#define KID_ENTER 3
#define KID_ESC 4

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

/* The Shift, Ctrl and Alt keys held now (MOD_* bits), from the kbd key-state table. */
unsigned key_mods(void);

/* The id of the binding that a kbd event (a make, not a break) triggers in `ctx` or K_GLOBAL with `mods` held,
   or 0 when there is none. */
int key_lookup(int ctx, unsigned event, unsigned mods);

#endif
