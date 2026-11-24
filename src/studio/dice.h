/* ReBeep Studio: the dice. A random voice and a small random nudge of one, for the editor's Random and Mutate keys.
   Logic only: no drawing, no chip. The tuning (floors, weights, step sizes) is the table at the top of dice.c.
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_DICE_H
#define RBSTUDIO_DICE_H

#include "patch.h"

/* Seeds the generator (xorshift32); the same seed gives the same rolls. A seed of 0 is replaced by a fixed non-zero one. */
void dice_seed(unsigned long s);

/* The next number from 0 to n - 1 (0 when n is below 2). */
int dice_below(int n);

/* Fills `v` (n = 2 or 4 operators; the others are left alone) with a random voice across the musical range. Every
   carrier of the connection it picks starts loud (Attack Rate 2 up, Output Level 50 up) and stops after the key is
   released (Release Rate 4 up); a fast Decay Rate to a low Sustain Level can still make a very short pluck. Waveform is
   0 to `wavmax`; harsh settings are rare. Every value is within its range. */
void dice_roll(Voice *v, int n, int wavmax);

/* Nudges 2 to 4 values of `v` (n operators): any operator's parameter or Feedback by one step (Output Level up to
   three), a switch or Waveform rarely. The connection never changes. A carrier's Attack Rate, Release Rate or Output Level
   is never lowered below the roll's floor (a value already below it is not lowered further). At least one value changes. */
void dice_mutate(Voice *v, int n, int wavmax);

#endif
