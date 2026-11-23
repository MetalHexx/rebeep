/* SPDX-License-Identifier: MIT */
#include "kbd.h"
#include "keys.h"

#define SCAN_ESC 0x01
#define SCAN_ENTER 0x1C
#define SCAN_CTRL 0x1D
#define SCAN_LSHIFT 0x2A
#define SCAN_RSHIFT 0x36
#define SCAN_ALT 0x38
#define SCAN_UP 0x48
#define SCAN_DOWN 0x50

const KeyBinding key_table[] = {
    {KID_UP, K_MENU, SCAN_UP, 0},
    {KID_DOWN, K_MENU, SCAN_DOWN, 0},
    {KID_ENTER, K_MENU, SCAN_ENTER, 0},
    {KID_ESC, K_MENU, SCAN_ESC, 0},
    {KID_ESC, K_SYNTH, SCAN_ESC, 0}
};

const int key_count = sizeof key_table / sizeof key_table[0];

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
