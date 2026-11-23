/* SPDX-License-Identifier: MIT */
#include <dos.h>
#include <i86.h>

#include "mouse.h"

static int present;
static int visible;

static void call(unsigned ax, union REGS *r)
{
    r->x.ax = ax;
    int86(0x33, r, r);
}

int mouse_init(void)
{
    void (__interrupt __far *vec)() = _dos_getvect(0x33);
    union REGS r;

    present = 0;
    visible = 0;
    if (vec == 0 || *(unsigned char __far *)vec == 0xCF) return 0;
    call(0x0000, &r);
    present = r.x.ax == 0xFFFF;
    return present;
}

int mouse_present(void)
{
    return present;
}

void mouse_show(void)
{
    union REGS r;

    if (!present || visible) return;
    call(0x0001, &r);
    visible = 1;
}

void mouse_hide(void)
{
    union REGS r;

    if (!present || !visible) return;
    call(0x0002, &r);
    visible = 0;
}

int mouse_visible(void)
{
    return visible;
}

int mouse_read(int *x, int *y)
{
    union REGS r;

    *x = 0;
    *y = 0;
    if (!present) return 0;
    call(0x0003, &r);
    *x = r.x.cx / 8;
    *y = r.x.dx / 8;
    return r.x.bx & 7;
}

void mouse_done(void)
{
    mouse_hide();
}
