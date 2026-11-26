/* ReBeep Studio: undo and redo of whole-patch snapshots. SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_UNDO_H
#define RBSTUDIO_UNDO_H

#include "patch.h"

#define UNDO_MAX 100   /* steps kept; the oldest is dropped beyond it */

typedef struct {
    Patch __far *undo;   /* far memory: UNDO_MAX snapshots, then UNDO_MAX for redo; set by undo_init */
    Patch __far *redo;
    int undo_count, redo_count;
    unsigned last_key;
    int have_key;
} Undo;

/* Allocates the history. Returns 0, or -1 when memory runs out. */
int undo_init(Undo *u);

/* Releases the history. */
void undo_free(Undo *u);

/* Records an edit about to happen: pushes `before` unless `repeat` is set and `key` equals the last edit's key (a
   held key, or a drag sweeping a bar, is one step). A push clears redo. */
void undo_edit(Undo *u, const Patch *before, unsigned key, int repeat);

/* Forgets the last key, so the next edit starts a new step. */
void undo_break(Undo *u);

/* Swaps `cur` with the previous (undo) or next (redo) snapshot. Returns 0 when there is nothing to do. */
int undo_undo(Undo *u, Patch *cur);
int undo_redo(Undo *u, Patch *cur);

/* Empties both histories; on a patch switch. */
void undo_clear(Undo *u);

#endif
