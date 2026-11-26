/* The dice: a random voice and a nudge of one. Rolls stay within every range and the chip's Waveform limit, every carrier
   keeps the floors that make a voice heard and stop after the key is released, a harsh Feedback is rare, a seed repeats;
   a nudge never touches the connection, moves one to four values by one small step, and never takes a carrier below its
   floors. */
#include <stdio.h>
#include <string.h>

#include "testlib.h"
#include "../../src/studio/dice.h"
#include "../../src/studio/patch.h"

#define ROLLS 1000
#define MUTATES 150

/* What a carrier must keep: it is heard and it dies after the key comes up. */
#define FLOOR_AR 2
#define FLOOR_RR 4
#define FLOOR_OL 50

static int floor_of(int row)
{
    return row == P_AR ? FLOOR_AR : row == P_RR ? FLOOR_RR : row == P_OL ? FLOOR_OL : 0;
}

static int is_switch(int row)
{
    return row == P_TREM || row == P_VIB || row == P_SUS || row == P_KSR;
}

/* 1 when the connection, Feedback and every value of the first `n` operators are within their ranges. */
static int in_range(const Voice *v, int n, int wavmax)
{
    int k;
    int row;

    if (v->conn > (n == 4 ? 3 : 1) || v->fb > 7) return 0;
    for (k = 0; k < n; k++) {
        for (row = 0; row < P_COUNT; row++) {
            if (v->op[k].v[row] > (row == P_WAVE ? wavmax : P_MAX[row])) return 0;
        }
    }
    return 1;
}

static int carriers_keep_floors(const Voice *v, int n)
{
    unsigned mask = patch_carriers(v, n);
    int k;

    for (k = 0; k < n; k++) {
        if (((mask >> k) & 1) == 0) continue;
        if (v->op[k].v[P_AR] < FLOOR_AR || v->op[k].v[P_RR] < FLOOR_RR || v->op[k].v[P_OL] < FLOOR_OL) return 0;
    }
    return 1;
}

/* ROLLS rolls of an n-OP voice, with the Waveform limit 3 (an OPL2) and 7 (an OPL3) in turn. */
static void roll_case(int n)
{
    char name[48];
    Voice v;
    int conns[4] = {0, 0, 0, 0};
    int waves[8] = {0, 0, 0, 0, 0, 0, 0, 0};
    int out_of_range = 0;
    int under_floor = 0;
    int touched = 0;
    int harsh = 0;
    int trem = 0;
    int wavmax;
    int i;
    int k;

    sprintf(name, "rolls of a %d-OP voice, Waveform limit 3 and 7", n);
    t_case(name);
    dice_seed(1000UL + n);
    for (i = 0; i < ROLLS; i++) {
        wavmax = i % 2 == 0 ? 3 : 7;
        memset(&v, 0, sizeof v);
        dice_roll(&v, n, wavmax);
        if (!in_range(&v, n, wavmax)) out_of_range++;
        if (!carriers_keep_floors(&v, n)) under_floor++;
        for (k = n; k < 4; k++) {
            if (v.op[k].v[P_AR] != 0 || v.op[k].v[P_OL] != 0) touched++;
        }
        conns[v.conn & 3]++;
        if (v.fb >= 6) harsh++;
        for (k = 0; k < n; k++) {
            waves[v.op[k].v[P_WAVE] & 7]++;
            trem += v.op[k].v[P_TREM];
        }
    }
    t_checkl(out_of_range, 0, "every value within its range, Waveform within the limit");
    t_checkl(under_floor, 0, "every carrier keeps Attack Rate 2, Release Rate 4 and Output Level 50");
    t_checkl(touched, 0, "operators beyond the voice are left alone");
    t_check((long)harsh * 100 < (long)ROLLS * 15, "Feedback 6 and 7 are rare");
    t_check(harsh > 0, "but they do come up");
    for (i = 0; i < (n == 4 ? 4 : 2); i++) t_check(conns[i] > 0, "every connection is rolled");
    for (i = 0; i < 8; i++) t_check(waves[i] > 0, "every Waveform up to 7 is rolled");
    t_check(trem > 0 && trem < ROLLS * n / 2, "Tremolo is sometimes on, mostly off");
}

static void seeds(void)
{
    Voice a;
    Voice a2;
    Voice b;
    Voice b2;
    Voice c;
    int mask = 0;
    int bad = 0;
    int seen;
    int i;

    t_case("a seed gives the same voices again, another seed other ones");
    memset(&a, 0, sizeof a);
    a2 = b = b2 = c = a;
    dice_seed(77);
    dice_roll(&a, 4, 7);
    dice_roll(&a2, 4, 7);
    dice_seed(77);
    dice_roll(&b, 4, 7);
    dice_roll(&b2, 4, 7);
    dice_seed(78);
    dice_roll(&c, 4, 7);
    t_check(memcmp(&a, &b, sizeof a) == 0 && memcmp(&a2, &b2, sizeof a) == 0, "the same seed, the same two voices");
    t_check(memcmp(&a, &a2, sizeof a) != 0, "the second roll is another voice");
    t_check(memcmp(&a, &c, sizeof a) != 0, "another seed, another voice");

    t_case("dice_below stays below n, reaches each value, and a seed of 0 still rolls");
    dice_seed(5);
    for (i = 0; i < 5000; i++) {
        int r = dice_below(7);

        if (r < 0 || r >= 7) bad++;
        else mask |= 1 << r;
    }
    t_checkl(bad, 0, "nothing outside 0 to 6");
    t_checkl(mask, 127, "and each of them turns up");
    t_checkl(dice_below(1), 0, "n = 1 is always 0");
    dice_seed(0);
    seen = 0;
    for (i = 0; i < 20; i++) seen += dice_below(1000) != 0;
    t_check(seen > 10, "a seed of 0 is not stuck");
}

/* Counts the values of the first `n` operators and Feedback that differ between `a` and `b`; `big` counts those that
   moved by more than a step (3 for Output Level, 1 for the rest) and `rare` those of a switch or Waveform. */
static int count_changes(const Voice *a, const Voice *b, int n, int *big, int *rare)
{
    int changes = 0;
    int k;
    int row;
    int d;

    *big = 0;
    *rare = 0;
    d = a->fb > b->fb ? a->fb - b->fb : b->fb - a->fb;
    if (d != 0) {
        changes++;
        if (d > 1) (*big)++;
    }
    for (k = 0; k < n; k++) {
        for (row = 0; row < P_COUNT; row++) {
            d = a->op[k].v[row] > b->op[k].v[row] ? a->op[k].v[row] - b->op[k].v[row] : b->op[k].v[row] - a->op[k].v[row];
            if (d == 0) continue;
            changes++;
            if (d > (row == P_OL ? 3 : 1)) (*big)++;
            if (is_switch(row) || row == P_WAVE) (*rare)++;
        }
    }
    return changes;
}

/* 1 when no carrier's Attack Rate, Release Rate or Output Level went below its floor, or below where it already was. */
static int floors_kept(const Voice *before, const Voice *after, int n)
{
    static const int rows[3] = {P_AR, P_RR, P_OL};
    unsigned mask = patch_carriers(before, n);
    int k;
    int i;

    for (k = 0; k < n; k++) {
        if (((mask >> k) & 1) == 0) continue;
        for (i = 0; i < 3; i++) {
            int was = before->op[k].v[rows[i]];
            int limit = was < floor_of(rows[i]) ? was : floor_of(rows[i]);

            if (after->op[k].v[rows[i]] < limit) return 0;
        }
    }
    return 1;
}

static void mutate_case(const char *from, const Voice *start, int n, int wavmax)
{
    char name[64];
    Voice v = *start;
    Voice before;
    int none = 0;
    int many = 0;
    int moved_conn = 0;
    int too_big = 0;
    int out_of_range = 0;
    int below_floor = 0;
    int touched = 0;
    int changed_all = 0;
    int rare_all = 0;
    int changes;
    int big;
    int rare;
    int i;

    sprintf(name, "mutate a %d-OP voice from %s, Wave to %d", n, from, wavmax);
    t_case(name);
    dice_seed(2000UL + n * 10 + wavmax);
    for (i = 0; i < MUTATES; i++) {
        before = v;
        dice_mutate(&v, n, wavmax);
        changes = count_changes(&before, &v, n, &big, &rare);
        if (changes < 1) none++;
        if (changes > 4) many++;
        if (v.conn != before.conn) moved_conn++;
        too_big += big;
        changed_all += changes;
        rare_all += rare;
        if (!in_range(&v, n, wavmax)) out_of_range++;
        if (!floors_kept(&before, &v, n)) below_floor++;
        if (memcmp(&before.op[n], &v.op[n], (unsigned)(4 - n) * sizeof(Op)) != 0) touched++;
    }
    t_checkl(moved_conn, 0, "the connection never changes");
    t_checkl(none, 0, "at least one value changes every time");
    t_checkl(many, 0, "no more than four values change");
    t_checkl(too_big, 0, "each value moves one step: 1, or up to 3 for Output Level");
    t_checkl(out_of_range, 0, "every value stays within its range and the Waveform limit");
    t_checkl(below_floor, 0, "no carrier is lowered below a floor, or lower than it was when under one");
    t_checkl(touched, 0, "operators beyond the voice are left alone");
    t_check((long)rare_all * 10 < (long)changed_all * 3, "switches and Waveform change rarely");
}

static void mutate_all(int n, int wavmax)
{
    Voice rolled;
    Voice zero;
    Voice top;
    int k;
    int row;

    memset(&zero, 0, sizeof zero);
    memset(&top, 0, sizeof top);
    top.conn = (unsigned char)(n == 4 ? 1 : 0);
    top.fb = 7;
    for (k = 0; k < 4; k++) {
        for (row = 0; row < P_COUNT; row++) top.op[k].v[row] = row == P_WAVE ? (unsigned char)wavmax : P_MAX[row];
    }
    memset(&rolled, 0, sizeof rolled);
    dice_seed(3000);
    dice_roll(&rolled, n, wavmax);
    mutate_case("a roll", &rolled, n, wavmax);
    mutate_case("all zeros", &zero, n, wavmax);
    mutate_case("all at max", &top, n, wavmax);
}

int main(void)
{
    roll_case(2);
    roll_case(4);
    seeds();
    mutate_all(2, 3);
    mutate_all(2, 7);
    mutate_all(4, 3);
    mutate_all(4, 7);
    return t_done();
}
