/* SPDX-License-Identifier: MIT */
#include <dos.h>
#include <i86.h>
#include <string.h>

#include "log.h"
#include "rebeep.h"

#define AMIS_INT 0x2D
#define FN_INSTALLED 0x00
#define FN_STATE 0x10
#define FN_TRAPS_ON 0x12
#define FN_TRAPS_OFF 0x13
#define FLAG_TRAPS 0x02

#define SIG_LEN 16

static const char signature[SIG_LEN + 1] = "MetalHex" "REBEEP  ";

static int res_id = -1;
static int suspended;

/* Calls function `fn` of multiplex number `id`; returns AL and leaves the registers in `r`. */
static int amis(int id, int fn, union REGS *r)
{
    struct SREGS s;

    segread(&s);
    r->h.ah = (unsigned char)id;
    r->h.al = (unsigned char)fn;
    int86x(AMIS_INT, r, r, &s);
    return r->h.al;
}

static int find_rebeep(void)
{
    union REGS r;
    int id;

    if (_dos_getvect(AMIS_INT) == NULL) return -1;
    for (id = 0; id < 256; id++) {
        if (amis(id, FN_INSTALLED, &r) == 0xFF && _fmemcmp(MK_FP(r.x.dx, r.x.di), signature, SIG_LEN) == 0) return id;
    }
    return -1;
}

static void log_toggle_result(const char *what, int al, const union REGS *r)
{
    if (al == 0xFF) log_line("ReBeep (AMIS %02Xh): %s", res_id, what);
    else log_line("ReBeep (AMIS %02Xh): %s refused, exit code %u", res_id, what, (unsigned)r->h.bl);
}

int rebeep_suspend(void)
{
    union REGS r;
    int al;

    suspended = 0;
    res_id = find_rebeep();
    if (res_id < 0) return 0;
    if (amis(res_id, FN_STATE, &r) != 0xFF) {
        log_line("ReBeep (AMIS %02Xh): no state block, left alone", res_id);
        return 0;
    }
    if (!(*((unsigned char __far *)MK_FP(r.x.dx, r.x.bx) + 1) & FLAG_TRAPS)) {
        log_line("ReBeep (AMIS %02Xh): traps already off", res_id);
        return 0;
    }
    al = amis(res_id, FN_TRAPS_OFF, &r);
    log_toggle_result("traps off", al, &r);
    suspended = al == 0xFF;
    return suspended;
}

void rebeep_resume(void)
{
    union REGS r;
    int al;

    if (!suspended) return;
    suspended = 0;
    al = amis(res_id, FN_TRAPS_ON, &r);
    log_toggle_result("traps on", al, &r);
}
