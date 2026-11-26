/* Undo and redo: coalescing with and without `repeat`, the 100-step cap, redo cleared by a new edit. */
#include <string.h>

#include "testlib.h"
#include "../../src/studio/undo.h"

static Undo u;
static Patch cur;

/* The patch's octave field serves as a counter here; undo does not care that it leaves 0..7. */
static void edit(unsigned key, int repeat)
{
    undo_edit(&u, &cur, key, repeat);
    cur.octave++;
}

static void fresh(void)
{
    undo_clear(&u);
    memset(&cur, 0, sizeof cur);
}

int main(void)
{
    int i;
    int steps;

    t_case("init");
    t_checkl(undo_init(&u), 0, "allocates");

    t_case("separate edits are separate steps");
    fresh();
    edit(1, 0);
    edit(1, 0);
    edit(2, 0);
    t_checkl(cur.octave, 3, "three edits made");
    t_checkl(undo_undo(&u, &cur), 1, "undo 1");
    t_checkl(cur.octave, 2, "back to 2");
    t_checkl(undo_undo(&u, &cur), 1, "undo 2");
    t_checkl(undo_undo(&u, &cur), 1, "undo 3");
    t_checkl(cur.octave, 0, "back to the start");
    t_checkl(undo_undo(&u, &cur), 0, "nothing left");

    t_case("repeat with the same key is one step");
    fresh();
    edit(5, 1);
    edit(5, 1);
    edit(5, 1);
    t_checkl(cur.octave, 3, "three edits made");
    t_checkl(undo_undo(&u, &cur), 1, "undo");
    t_checkl(cur.octave, 0, "all three undone at once");
    t_checkl(undo_undo(&u, &cur), 0, "nothing left");
    t_checkl(undo_redo(&u, &cur), 1, "redo");
    t_checkl(cur.octave, 3, "all three redone at once");
    t_checkl(undo_redo(&u, &cur), 0, "nothing more to redo");

    t_case("repeat with another key, or after undo_break, starts a new step");
    fresh();
    edit(5, 1);
    edit(6, 1);
    edit(6, 1);
    undo_break(&u);
    edit(6, 1);
    t_checkl(cur.octave, 4, "four edits made");
    undo_undo(&u, &cur);
    t_checkl(cur.octave, 3, "undo takes the last step only");
    undo_undo(&u, &cur);
    t_checkl(cur.octave, 1, "then the two key-6 edits");
    undo_undo(&u, &cur);
    t_checkl(cur.octave, 0, "then the key-5 edit");
    t_checkl(undo_undo(&u, &cur), 0, "nothing left");

    t_case("repeat does not coalesce across an undo");
    fresh();
    edit(7, 1);
    edit(7, 1);
    undo_undo(&u, &cur);
    undo_redo(&u, &cur);
    edit(7, 1);
    t_checkl(undo_undo(&u, &cur), 1, "undo");
    t_checkl(cur.octave, 2, "the edit after redo is its own step");

    t_case("a new edit clears redo");
    fresh();
    edit(1, 0);
    edit(2, 0);
    undo_undo(&u, &cur);
    edit(3, 0);
    t_checkl(undo_redo(&u, &cur), 0, "nothing to redo");
    t_checkl(undo_undo(&u, &cur), 1, "undo still works");
    t_checkl(cur.octave, 1, "back to the state before the new edit");

    t_case("undo and redo walk the whole history");
    fresh();
    for (i = 0; i < 5; i++) edit((unsigned)i, 0);
    for (i = 0; i < 5; i++) undo_undo(&u, &cur);
    t_checkl(cur.octave, 0, "all undone");
    for (i = 0; i < 5; i++) undo_redo(&u, &cur);
    t_checkl(cur.octave, 5, "all redone");

    t_case("the history keeps at most 100 steps");
    fresh();
    for (i = 0; i < 150; i++) edit((unsigned)i, 0);
    steps = 0;
    while (undo_undo(&u, &cur)) steps++;
    t_checkl(steps, UNDO_MAX, "100 undos");
    t_checkl(cur.octave, 50, "the oldest 50 edits are gone");
    steps = 0;
    while (undo_redo(&u, &cur)) steps++;
    t_checkl(steps, UNDO_MAX, "100 redos");
    t_checkl(cur.octave, 150, "back at the end");

    t_case("undo_clear empties both directions");
    fresh();
    edit(1, 0);
    edit(2, 0);
    undo_undo(&u, &cur);
    undo_clear(&u);
    t_checkl(undo_undo(&u, &cur), 0, "no undo");
    t_checkl(undo_redo(&u, &cur), 0, "no redo");

    undo_free(&u);
    return t_done();
}
