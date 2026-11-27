/* SPDX-License-Identifier: MIT */
#include <dos.h>
#include <i86.h>
#include <string.h>

#include "dos.h"
#include "jingle.h"
#include "library.h"
#include "log.h"
#include "opl.h"
#include "patch.h"

#define TICKS_PER_DAY 0x1800B0UL
#define END_TICKS 38UL   /* about two seconds at 18.2 Hz */

typedef struct {
    unsigned char onset, length, note;
} Jnote;

static const Jnote phrase[] = {{0, 14, 60}, {5, 14, 64}, {10, 14, 67}, {15, 14, 72}, {20, 18, 76}};
#define PHRASE_LEN ((int)(sizeof phrase / sizeof phrase[0]))

static int playing;
static unsigned long start_tick;
static int started[PHRASE_LEN];
static int released[PHRASE_LEN];

static unsigned long bios_ticks(void)
{
    volatile unsigned long __far *ticks = (volatile unsigned long __far *)MK_FP(0x40, 0x6C);
    unsigned long a;
    unsigned long b;

    do {
        a = *ticks;
        b = *ticks;
    } while (a != b);
    return a;
}

/* FACTORY\BELL's values, for a program folder that lost the file. */
static void builtin_bell(Patch *p)
{
    static const unsigned char mod[P_COUNT] = {15, 0, 13, 10, 31, 0, 3, 0, 0, 0, 1, 0};
    static const unsigned char car[P_COUNT] = {15, 4, 13, 10, 63, 0, 1, 0, 0, 0, 1, 0};

    memset(p, 0, sizeof *p);
    p->octave = 4;
    memcpy(p->v2.op[0].v, mod, P_COUNT);
    memcpy(p->v2.op[1].v, car, P_COUNT);
}

void jingle_start(void)
{
    static Patch p;
    static char path[128];
    static char err[80];
    int i;

    jingle_stop();
    if (opl_chip() == 0) return;
    strcpy(path, dos_program_dir());
    strcat(path, FACTORY_DIR "\\BELL.RBP");
    if (patch_read(path, &p, err, sizeof err) != 0) {
        log_line("jingle: %s, using the built-in bell", err);
        builtin_bell(&p);
    }
    opl_set_voice(&p.v2, 2, p.octave);
    for (i = 0; i < PHRASE_LEN; i++) started[i] = released[i] = 0;
    start_tick = bios_ticks();
    playing = 1;
    jingle_poll();
}

void jingle_poll(void)
{
    unsigned long now;
    unsigned long elapsed;
    int i;

    if (!playing) return;
    now = bios_ticks();
    elapsed = now >= start_tick ? now - start_tick : now + TICKS_PER_DAY - start_tick;
    for (i = 0; i < PHRASE_LEN; i++) {
        if (!started[i] && elapsed >= phrase[i].onset) {
            started[i] = 1;
            opl_note_on(phrase[i].note);
        }
        if (started[i] && !released[i] && elapsed >= (unsigned long)phrase[i].onset + phrase[i].length) {
            released[i] = 1;
            opl_note_off(phrase[i].note);
        }
    }
    if (elapsed >= END_TICKS) jingle_stop();
}

void jingle_stop(void)
{
    if (!playing) return;
    playing = 0;
    opl_all_off();
}
