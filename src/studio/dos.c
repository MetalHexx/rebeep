/* SPDX-License-Identifier: MIT */
#include <dos.h>
#include <i86.h>
#include <stdlib.h>
#include <string.h>

#include "dos.h"

#define MAX_HOOKS 8

static struct {
    unsigned intno;
    isr_t old;
} hooks[MAX_HOOKS];
static int hook_count;
static isr_t old_break, old_ctrlc, old_critical;
static char program_dir[80];

/* INT 1Bh (Ctrl+Break) and INT 23h (Ctrl+C): return to the caller and carry on. */
static void __interrupt __far ignore_break(void)
{
}

/* INT 24h: DOS 3+ takes AL = 3 as "fail the call", so a write to a read-only floppy comes back as
   an error instead of the "Abort, Retry, Fail" prompt. */
static void __interrupt __far fail_critical(union INTPACK r)
{
    r.h.al = 3;
}

void dos_hook(unsigned intno, isr_t handler, isr_t *old)
{
    if (hook_count == MAX_HOOKS) exit(3);
    _disable();
    *old = _dos_getvect(intno);
    hooks[hook_count].intno = intno;
    hooks[hook_count].old = *old;
    hook_count++;
    _dos_setvect(intno, handler);
    _enable();
}

void dos_restore(void)
{
    _disable();
    while (hook_count > 0) {
        hook_count--;
        _dos_setvect(hooks[hook_count].intno, hooks[hook_count].old);
    }
    _enable();
}

void dos_init(const char *argv0)
{
    size_t len = 0;
    size_t i;

    for (i = 0; argv0[i] != '\0'; i++) {
        if (argv0[i] == '\\' || argv0[i] == ':') len = i + 1;
    }
    if (len >= sizeof program_dir) len = 0;
    memcpy(program_dir, argv0, len);
    program_dir[len] = '\0';

    atexit(dos_restore);
    dos_hook(0x1B, ignore_break, &old_break);
    dos_hook(0x23, ignore_break, &old_ctrlc);
    dos_hook(0x24, (isr_t)fail_critical, &old_critical);
}

const char *dos_program_dir(void)
{
    return program_dir;
}
