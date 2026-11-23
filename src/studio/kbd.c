/* SPDX-License-Identifier: MIT */
#include <dos.h>

#include "dos.h"
#include "kbd.h"

#define QUEUE_SIZE 32
#define QUEUE_MASK (QUEUE_SIZE - 1)
#define EXT_STATE 0x80

static volatile unsigned char state[256];
static volatile unsigned events[QUEUE_SIZE];
static volatile unsigned char head;
static volatile unsigned char tail;
static unsigned char e0_seen;
static unsigned char pause_left;
static isr_t old_int09;

/* An inline IN, so the handler never calls the C library. */
unsigned char read_scan_code(void);
#pragma aux read_scan_code = "in al, 60h" value [al] modify exact [al];

/* The handler runs on whatever stack the interrupted code had, which the stack checker's limit does
   not describe: so no stack check, and no C library calls. It chains last, so the BIOS still sees
   the key. */
#pragma off (check_stack)
static void __interrupt __far on_key(void)
{
    unsigned char raw = read_scan_code();
    unsigned code = raw & KBD_CODE;
    unsigned char next;

    if (pause_left != 0) {
        pause_left--;
    } else if (raw == 0xE0) {
        e0_seen = 1;
    } else if (raw == 0xE1) {
        pause_left = 5;
    } else if (raw != 0x00 && raw != 0xFF) {
        unsigned ext = e0_seen ? KBD_EXT : 0;

        e0_seen = 0;
        /* E0 2A and E0 36 are the fake shifts around Print Screen and the grey keys under Num Lock. */
        if (!(ext && (code == 0x2A || code == 0x36))) {
            state[code | (ext ? EXT_STATE : 0)] = (raw & KBD_BREAK) ? 0 : 1;
            next = (head + 1) & QUEUE_MASK;
            if (next != tail) {
                events[head] = code | (raw & KBD_BREAK) | ext;
                head = next;
            }
        }
    }
    _chain_intr(old_int09);
}
#pragma on (check_stack)

void kbd_init(void)
{
    dos_hook(0x09, (isr_t)on_key, &old_int09);
}

int kbd_next(unsigned *event)
{
    if (tail == head) return 0;
    *event = events[tail];
    tail = (tail + 1) & QUEUE_MASK;
    return 1;
}

int kbd_down(unsigned code)
{
    return state[(code & KBD_CODE) | ((code & KBD_EXT) ? EXT_STATE : 0)];
}
