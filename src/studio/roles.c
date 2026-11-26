/* SPDX-License-Identifier: MIT */
#include "roles.h"

/* colour, mono: the mono column repeats the colour where the mockup's table has none. */
static const unsigned char table[R_COUNT][2] = {
    {0, 0},    /* ground */
    {7, 7},    /* text */
    {15, 15},  /* value */
    {8, 8},    /* frame */
    {8, 8},    /* dim */
    {8, 8},    /* shadow */
    {10, 10},  /* lit */
    {2, 2},    /* body */
    {10, 15},  /* carrier */
    {7, 7},    /* modulator */
    {10, 10},  /* accent */
    {10, 10},  /* focus */
    {0, 0},    /* focusText */
    {7, 7},    /* keys */
    {14, 14},  /* warning */
    {2, 8},    /* window */
    {15, 15},  /* windowText */
    {14, 10},  /* windowAccent */
    {10, 7},   /* windowFrame */
    {8, 0},    /* windowShadow */
    {8, 0}     /* button */
};

static int mono_view;

void role_set_mono(int mono)
{
    mono_view = mono != 0;
}

int role_mono(void)
{
    return mono_view;
}

int role(Role r)
{
    return table[r][mono_view];
}
