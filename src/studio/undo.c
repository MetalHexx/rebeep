/* SPDX-License-Identifier: MIT */
#include <malloc.h>
#include <stddef.h>
#include <string.h>

#include "undo.h"

int undo_init(Undo *u)
{
    memset(u, 0, sizeof *u);
    u->undo = (Patch __far *)_fmalloc(sizeof(Patch) * UNDO_MAX * 2);
    if (u->undo == NULL) return -1;
    u->redo = u->undo + UNDO_MAX;
    return 0;
}

void undo_free(Undo *u)
{
    if (u->undo != NULL) _ffree(u->undo);
    memset(u, 0, sizeof *u);
}

void undo_clear(Undo *u)
{
    u->undo_count = 0;
    u->redo_count = 0;
    u->have_key = 0;
}

void undo_break(Undo *u)
{
    u->have_key = 0;
}

void undo_edit(Undo *u, const Patch *before, unsigned key, int repeat)
{
    int same = repeat && u->have_key && u->last_key == key;

    u->last_key = key;
    u->have_key = 1;
    if (same) return;
    if (u->undo_count == UNDO_MAX) {
        _fmemmove(u->undo, u->undo + 1, sizeof(Patch) * (UNDO_MAX - 1));
        u->undo_count--;
    }
    u->undo[u->undo_count++] = *before;
    u->redo_count = 0;
}

int undo_undo(Undo *u, Patch *cur)
{
    if (u->undo_count == 0) return 0;
    u->redo[u->redo_count++] = *cur;
    *cur = u->undo[--u->undo_count];
    u->have_key = 0;
    return 1;
}

int undo_redo(Undo *u, Patch *cur)
{
    if (u->redo_count == 0) return 0;
    u->undo[u->undo_count++] = *cur;
    *cur = u->redo[--u->redo_count];
    u->have_key = 0;
    return 1;
}
