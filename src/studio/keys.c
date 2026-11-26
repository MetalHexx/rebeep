/* SPDX-License-Identifier: MIT */
#include "kbd.h"
#include "keys.h"

#define SCAN_ESC 0x01
#define SCAN_1 0x02
#define SCAN_MINUS 0x0C
#define SCAN_BACKSPACE 0x0E
#define SCAN_TAB 0x0F
#define SCAN_R 0x13
#define SCAN_Y 0x15
#define SCAN_ENTER 0x1C
#define SCAN_CTRL 0x1D
#define SCAN_S 0x1F
#define SCAN_D 0x20
#define SCAN_C 0x2E
#define SCAN_LSHIFT 0x2A
#define SCAN_Z 0x2C
#define SCAN_RSHIFT 0x36
#define SCAN_ALT 0x38
#define SCAN_F1 0x3B
#define SCAN_F11 0x57
#define SCAN_F12 0x58
#define SCAN_UP 0x48
#define SCAN_PGUP 0x49
#define SCAN_LEFT 0x4B
#define SCAN_RIGHT 0x4D
#define SCAN_DOWN 0x50
#define SCAN_PGDN 0x51

const KeyBinding key_table[] = {
    {KID_UP, K_MENU, SCAN_UP, 0},
    {KID_DOWN, K_MENU, SCAN_DOWN, 0},
    {KID_ENTER, K_MENU, SCAN_ENTER, 0},
    {KID_ESC, K_MENU, SCAN_ESC, 0},
    {KID_ESC, K_SYNTH, SCAN_ESC, 0},
    {KID_UP, K_SYNTH, SCAN_UP, 0},
    {KID_DOWN, K_SYNTH, SCAN_DOWN, 0},
    {KID_LEFT, K_SYNTH, SCAN_LEFT, 0},
    {KID_RIGHT, K_SYNTH, SCAN_RIGHT, 0},
    {KID_OP1, K_SYNTH, SCAN_1, MOD_ALT},
    {KID_OP2, K_SYNTH, SCAN_1 + 1, MOD_ALT},
    {KID_OP3, K_SYNTH, SCAN_1 + 2, MOD_ALT},
    {KID_OP4, K_SYNTH, SCAN_1 + 3, MOD_ALT},
    {KID_TAB, K_SYNTH, SCAN_TAB, 0},
    {KID_BTAB, K_SYNTH, SCAN_TAB, MOD_SHIFT},
    {KID_PGUP, K_SYNTH, SCAN_PGUP, 0},
    {KID_PGDN, K_SYNTH, SCAN_PGDN, 0},
    {KID_BANK_PREV, K_SYNTH, SCAN_PGUP, MOD_CTRL},
    {KID_BANK_NEXT, K_SYNTH, SCAN_PGDN, MOD_CTRL},
    {KID_HELP, K_SYNTH, SCAN_F1, 0},
    {KID_SAVE, K_SYNTH, SCAN_S, MOD_CTRL},
    {KID_RESET, K_SYNTH, SCAN_R, MOD_CTRL},
    {KID_UNDO, K_SYNTH, SCAN_Z, MOD_CTRL},
    {KID_REDO, K_SYNTH, SCAN_Y, MOD_CTRL},
    {KID_OCT_UP, K_SYNTH, SCAN_UP, MOD_CTRL},
    {KID_OCT_DOWN, K_SYNTH, SCAN_DOWN, MOD_CTRL},
    {KID_RANDOM, K_SYNTH, SCAN_F12, 0},
    {KID_MUTATE, K_SYNTH, SCAN_F11, 0},   /* not Ctrl+F12: 86Box sends Ctrl+Alt+Del on it, DOSBox changes speed */
    {KID_HELP, K_HELP, SCAN_F1, 0},
    {KID_ESC, K_HELP, SCAN_ESC, 0},
    {KID_LEFT, K_HELP, SCAN_LEFT, 0},
    {KID_RIGHT, K_HELP, SCAN_RIGHT, 0},
    {KID_LEFT, K_PROMPT, SCAN_LEFT, 0},
    {KID_RIGHT, K_PROMPT, SCAN_RIGHT, 0},
    {KID_TAB, K_PROMPT, SCAN_TAB, 0},
    {KID_BTAB, K_PROMPT, SCAN_TAB, MOD_SHIFT},
    {KID_ENTER, K_PROMPT, SCAN_ENTER, 0},
    {KID_ESC, K_PROMPT, SCAN_ESC, 0},
    {KID_PICK1, K_PROMPT, SCAN_S, 0},
    {KID_PICK2, K_PROMPT, SCAN_D, 0},
    {KID_PICK3, K_PROMPT, SCAN_C, 0},
    {KID_UP, K_SAVE, SCAN_UP, 0},
    {KID_DOWN, K_SAVE, SCAN_DOWN, 0},
    {KID_TAB, K_SAVE, SCAN_TAB, 0},
    {KID_BTAB, K_SAVE, SCAN_TAB, MOD_SHIFT},
    {KID_LEFT, K_SAVE, SCAN_LEFT, 0},
    {KID_RIGHT, K_SAVE, SCAN_RIGHT, 0},
    {KID_ENTER, K_SAVE, SCAN_ENTER, 0},
    {KID_ESC, K_SAVE, SCAN_ESC, 0},
    {KID_BACK, K_SAVE, SCAN_BACKSPACE, 0}
};

const int key_count = sizeof key_table / sizeof key_table[0];

static const unsigned char IDS_UPDOWN[] = {KID_UP, KID_DOWN, 0};
static const unsigned char IDS_LEFTRIGHT[] = {KID_LEFT, KID_RIGHT, 0};
static const unsigned char IDS_OPS[] = {KID_OP1, KID_OP2, KID_OP3, KID_OP4, 0};
static const unsigned char IDS_TAB[] = {KID_TAB, 0};
static const unsigned char IDS_BTAB[] = {KID_BTAB, 0};
static const unsigned char IDS_OCT[] = {KID_OCT_UP, KID_OCT_DOWN, 0};
static const unsigned char IDS_SAVE[] = {KID_SAVE, 0};
static const unsigned char IDS_RESET[] = {KID_RESET, 0};
static const unsigned char IDS_UNDO[] = {KID_UNDO, 0};
static const unsigned char IDS_REDO[] = {KID_REDO, 0};
static const unsigned char IDS_RANDOM[] = {KID_RANDOM, 0};
static const unsigned char IDS_MUTATE[] = {KID_MUTATE, 0};
static const unsigned char IDS_PAGES[] = {KID_PGUP, KID_PGDN, 0};
static const unsigned char IDS_BANKS[] = {KID_BANK_PREV, KID_BANK_NEXT, 0};
static const unsigned char IDS_ESC[] = {KID_ESC, 0};
static const unsigned char IDS_HELP[] = {KID_HELP, 0};

const HelpRow HELP_ROWS[] = {
    {0, HR_HEADING, "MOVING AND EDITING", "", 0},
    {0, HR_KEYS, "Up Down", "previous / next row", IDS_UPDOWN},
    {0, HR_KEYS, "Left Right", "value down / up", IDS_LEFTRIGHT},
    {0, HR_KEYS, "Alt+1 to 4", "operator 1 to 4", IDS_OPS},
    {0, HR_KEYS, "Tab", "next operator", IDS_TAB},
    {0, HR_KEYS, "Shift+Tab", "previous operator", IDS_BTAB},
    {0, HR_INFO, "Mouse", "click to focus or set", 0},
    {0, HR_INFO, "", "", 0},
    {0, HR_HEADING, "PLAYING", "", 0},
    {0, HR_INFO, "Z to M", "lower white keys", 0},
    {0, HR_INFO, "S D G H J", "lower black keys", 0},
    {0, HR_INFO, "Q to P", "upper white keys", 0},
    {0, HR_INFO, "Digits", "upper black keys", 0},
    {1, HR_HEADING, "PATCH", "", 0},
    {1, HR_KEYS, "Ctrl+S", "save, or save a copy", IDS_SAVE},
    {1, HR_KEYS, "Ctrl+Up Down", "octave up / down", IDS_OCT},
    {1, HR_KEYS, "Ctrl+R", "reset to factory", IDS_RESET},
    {1, HR_KEYS, "F12", "random sound", IDS_RANDOM},
    {1, HR_KEYS, "F11", "mutate sound", IDS_MUTATE},
    {1, HR_KEYS, "Ctrl+Z", "undo", IDS_UNDO},
    {1, HR_KEYS, "Ctrl+Y", "redo", IDS_REDO},
    {1, HR_KEYS, "PgUp PgDn", "previous / next patch", IDS_PAGES},
    {1, HR_KEYS, "Ctrl+PgUp Dn", "previous / next bank", IDS_BANKS},
    {1, HR_KEYS, "Esc", "back one level", IDS_ESC},
    {1, HR_KEYS, "F1", "this help", IDS_HELP}
};

const int HELP_ROW_COUNT = sizeof HELP_ROWS / sizeof HELP_ROWS[0];

static const unsigned char PIANO_SCAN[KEY_PIANO_KEYS] = {
    0x2C, 0x1F, 0x2D, 0x20, 0x2E, 0x2F, 0x22, 0x30, 0x23, 0x31, 0x24, 0x32,
    0x10, 0x03, 0x11, 0x04, 0x12, 0x13, 0x06, 0x14, 0x07, 0x15, 0x08, 0x16, 0x17, 0x0A, 0x18, 0x0B, 0x19
};

unsigned key_mods(void)
{
    unsigned mods = 0;

    if (kbd_down(SCAN_LSHIFT) || kbd_down(SCAN_RSHIFT)) mods |= MOD_SHIFT;
    if (kbd_down(SCAN_CTRL) || kbd_down(SCAN_CTRL | KBD_EXT)) mods |= MOD_CTRL;
    if (kbd_down(SCAN_ALT) || kbd_down(SCAN_ALT | KBD_EXT)) mods |= MOD_ALT;
    return mods;
}

int key_lookup(int ctx, unsigned event, unsigned mods)
{
    int i;

    if (event & KBD_BREAK) return 0;
    for (i = 0; i < key_count; i++) {
        const KeyBinding *b = &key_table[i];

        if ((b->ctx == ctx || b->ctx == K_GLOBAL) && b->scan == (event & KBD_CODE) && b->mods == mods) return b->id;
    }
    return 0;
}

int key_piano(unsigned event)
{
    int i;

    if (event & KBD_EXT) return -1;
    for (i = 0; i < KEY_PIANO_KEYS; i++) {
        if (PIANO_SCAN[i] == (event & KBD_CODE)) return i;
    }
    return -1;
}

char key_name_char(unsigned event, unsigned mods)
{
    unsigned scan = event & KBD_CODE;

    if ((event & (KBD_BREAK | KBD_EXT)) || (mods & (MOD_CTRL | MOD_ALT))) return 0;
    if (scan == SCAN_MINUS) return (mods & MOD_SHIFT) ? '_' : '-';
    if (scan >= 0x02 && scan <= 0x0A) return (char)('1' + scan - 0x02);
    if (scan == 0x0B) return '0';
    if (scan >= 0x10 && scan <= 0x19) return "QWERTYUIOP"[scan - 0x10];
    if (scan >= 0x1E && scan <= 0x26) return "ASDFGHJKL"[scan - 0x1E];
    if (scan >= 0x2C && scan <= 0x32) return "ZXCVBNM"[scan - 0x2C];
    return 0;
}
