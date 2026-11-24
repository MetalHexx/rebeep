/* ReBeep Studio: the dice (see dice.h). SPDX-License-Identifier: MIT */
#include <string.h>

#include "dice.h"

/* ---- Tuning: retune by ear here. A weight table has one weight per value (the index is the value); a bigger weight is
   picked more often, 0 never. Patch values are the editor's: bigger SL and OL are louder; a MULT of 0 is one half. ---- */

/* A carrier is what you hear. Rolled carriers keep at least these, and Mutate never lowers one past them, so a voice is
   always heard (AR, OL) and always stops after the key is released (RR). */
#define FLOOR_AR 2
#define FLOOR_RR 4
#define FLOOR_OL 50

/* Weights by value, 0 to 15 unless noted. */

/* Attack Rate: mostly quick; a carrier takes it from FLOOR_AR up. */
static const unsigned char W_AR[16] = { 1,  1,  2,  2,  3,  3,  4,  4,  5,  6,  8, 10, 12, 14, 14, 12 };
/* Release Rate: middling; a carrier takes it from FLOOR_RR up. */
static const unsigned char W_RR[16] = { 2,  2,  2,  2,  4,  5,  6,  7,  8,  8,  8,  7,  6,  5,  4,  3 };
/* Frequency Multiplier of a carrier: mostly 1/2, 1 and 2 (values 0 to 2). */
static const unsigned char W_MULT_CAR[16] = { 20, 30, 20,  4,  3,  2,  2,  1,  1,  1,  1,  0,  0,  0,  0,  0 };
/* Frequency Multiplier of a modulator: wider, the high values rare. */
static const unsigned char W_MULT_MOD[16] = {  8, 12, 10,  8,  8,  6,  5,  4,  3,  2,  2,  1,  1,  1,  1,  1 };
/* A modulator's Output Level by eighths of 0 to 63; the loudest eighth (the harshest) is less likely. */
static const unsigned char W_MOD_OL[8] = { 3, 3, 4, 5, 6, 6, 5, 3 };
/* Waveform 0 to 7 (cut at the chip's limit): sine most often. */
static const unsigned char W_WAVE[8] = { 10, 5, 4, 3, 3, 2, 2, 2 };
/* Key Scale Level 0 to 3: mostly off. */
static const unsigned char W_KSL[4] = { 10, 2, 2, 1 };
/* Feedback 0 to 7: 6 and 7 are the harsh ones. */
static const unsigned char W_FB[8] = { 24, 20, 16, 14, 10, 8, 2, 1 };

/* Chance in 100 that a rolled operator has the switch on. */
#define PCT_TREM 20   /* Tremolo */
#define PCT_VIB 20    /* Vibrato */
#define PCT_SUS 50    /* Sustained */
#define PCT_KSR 50    /* Key Scale Rate */

/* Mutate: cells nudged per press (lowest and highest), the largest step of an Output Level (every other value moves by
   1), and how often a whole new pick is tried when no cell moved (every pick sat at a clamp). */
#define MUT_MIN 2
#define MUT_MAX 4
#define STEP_OL 3
#define MUT_TRIES 8
/* How often Mutate picks each parameter (P_* order) and, last, Feedback. Switches and Waveform are rare. */
static const unsigned char W_MUT[P_COUNT + 1] = { 4, 4, 4, 4, 6, 2, 3, 1, 1, 1, 1, 1, 3 };

/* ---- The generator ---- */

#define SEED_FALLBACK 0x2545F491UL
#define FB_MAX 7
#define OL_BUCKET 8

static unsigned long state = SEED_FALLBACK;

static unsigned long next(void)
{
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return state;
}

/* A small seed (the BIOS tick count) mixes slowly in xorshift32, so the first outputs are thrown away. */
void dice_seed(unsigned long s)
{
    int i;

    state = s != 0 ? s : SEED_FALLBACK;
    for (i = 0; i < 16; i++) next();
}

int dice_below(int n)
{
    return n > 1 ? (int)((unsigned)(next() >> 16) % (unsigned)n) : 0;
}

/* An index below `count`, picked by the weights. */
static int weighted(const unsigned char *w, int count)
{
    int total = 0;
    int r;
    int i;

    for (i = 0; i < count; i++) total += w[i];
    r = dice_below(total);
    for (i = 0; i < count - 1 && r >= w[i]; i++) r -= w[i];
    return i;
}

static int chance(int percent)
{
    return dice_below(100) < percent;
}

static int op_count(int n)
{
    return n == 4 ? 4 : 2;
}

static int wave_limit(int wavmax)
{
    return wavmax < 0 ? 0 : wavmax > P_MAX[P_WAVE] ? P_MAX[P_WAVE] : wavmax;
}

/* The lowest a carrier's `row` may be: only Attack Rate, Release Rate and Output Level have a floor. */
static int floor_of(int row)
{
    return row == P_AR ? FLOOR_AR : row == P_RR ? FLOOR_RR : row == P_OL ? FLOOR_OL : 0;
}

/* ---- A whole voice ---- */

/* A value from `lo` up to the end of a 16-value weight table. */
static int weighted_from(const unsigned char *w, int lo)
{
    return lo + weighted(w + lo, 16 - lo);
}

static void roll_op(Op *o, int carrier, int wavmax)
{
    int bucket;

    o->v[P_AR] = (unsigned char)weighted_from(W_AR, carrier ? floor_of(P_AR) : 0);
    o->v[P_DR] = (unsigned char)dice_below(P_MAX[P_DR] + 1);
    o->v[P_SL] = (unsigned char)dice_below(P_MAX[P_SL] + 1);
    o->v[P_RR] = (unsigned char)weighted_from(W_RR, carrier ? floor_of(P_RR) : 0);
    if (carrier) o->v[P_OL] = (unsigned char)(FLOOR_OL + dice_below(P_MAX[P_OL] + 1 - FLOOR_OL));
    else {
        bucket = weighted(W_MOD_OL, 8);
        o->v[P_OL] = (unsigned char)(bucket * OL_BUCKET + dice_below(OL_BUCKET));
    }
    o->v[P_KSL] = (unsigned char)weighted(W_KSL, 4);
    o->v[P_MULT] = (unsigned char)weighted(carrier ? W_MULT_CAR : W_MULT_MOD, 16);
    o->v[P_WAVE] = (unsigned char)weighted(W_WAVE, wavmax + 1);
    o->v[P_TREM] = (unsigned char)chance(PCT_TREM);
    o->v[P_VIB] = (unsigned char)chance(PCT_VIB);
    o->v[P_SUS] = (unsigned char)chance(PCT_SUS);
    o->v[P_KSR] = (unsigned char)chance(PCT_KSR);
}

void dice_roll(Voice *v, int n, int wavmax)
{
    unsigned carriers;
    int k;

    n = op_count(n);
    wavmax = wave_limit(wavmax);
    v->conn = (unsigned char)dice_below(n == 4 ? 4 : 2);
    v->fb = (unsigned char)weighted(W_FB, FB_MAX + 1);
    carriers = patch_carriers(v, n);
    for (k = 0; k < n; k++) roll_op(&v->op[k], (int)((carriers >> k) & 1), wavmax);
}

/* ---- A nudge ---- */

static int is_switch(int row)
{
    return row == P_TREM || row == P_VIB || row == P_SUS || row == P_KSR;
}

/* A cell not yet picked: an operator's row, or (row P_COUNT) Feedback, numbered operator * (P_COUNT + 1) + row. Feedback
   is one cell, numbered as operator 0's, whichever operator was drawn. */
static int pick_cell(int n, const int *used, int nused)
{
    int cell;
    int k;
    int row;
    int i;

    do {
        k = dice_below(n);
        row = weighted(W_MUT, P_COUNT + 1);
        cell = (row == P_COUNT ? 0 : k) * (P_COUNT + 1) + row;
        for (i = 0; i < nused && used[i] != cell; i++) {
        }
    } while (i < nused);
    return cell;
}

/* Moves one cell by a step, clamped to its range; a carrier's floored row is not lowered past its floor (a value
   already under the floor is not lowered at all). */
static void nudge(Voice *v, int cell, int carrier, int wavmax)
{
    int k = cell / (P_COUNT + 1);
    int row = cell % (P_COUNT + 1);
    unsigned char *f = row == P_COUNT ? &v->fb : &v->op[k].v[row];
    int max = row == P_COUNT ? FB_MAX : row == P_WAVE ? wavmax : P_MAX[row];
    int lo = 0;
    int d;
    int nv;

    if (is_switch(row)) {
        *f ^= 1;
        return;
    }
    d = row == P_OL ? 1 + dice_below(STEP_OL) : 1;
    if (dice_below(2) == 0) d = -d;
    if (d < 0 && carrier) lo = *f < floor_of(row) ? *f : floor_of(row);
    nv = *f + d;
    if (nv < lo) nv = lo;
    if (nv > max) nv = max;
    *f = (unsigned char)nv;
}

void dice_mutate(Voice *v, int n, int wavmax)
{
    Voice before = *v;
    unsigned carriers;
    int used[MUT_MAX];
    int picks;
    int tries;
    int i;

    n = op_count(n);
    wavmax = wave_limit(wavmax);
    carriers = patch_carriers(v, n);
    for (tries = 0; tries < MUT_TRIES; tries++) {
        picks = MUT_MIN + dice_below(MUT_MAX - MUT_MIN + 1);
        for (i = 0; i < picks; i++) {
            used[i] = pick_cell(n, used, i);
            nudge(v, used[i], (int)((carriers >> (used[i] / (P_COUNT + 1))) & 1), wavmax);
        }
        if (memcmp(v, &before, sizeof before) != 0) return;
    }
    v->op[0].v[P_TREM] ^= 1;
}
