/* The resident-ReBeep control: a fake ReBeep answers AMIS on INT 2Dh and the module's scan, signature check and
   traps off/on calls are checked against it. */
#include <dos.h>
#include <i86.h>
#include <stdio.h>
#include <string.h>

#include "testlib.h"
#include "../../src/studio/log.h"
#include "../../src/studio/rebeep.h"

#define AMIS_INT 0x2D
#define STUB_ID 0xF3
#define TRAPS_FLAG 0x02

/* Spelled here on purpose: not shared with rebeep.c, so a typo in either shows up. */
static const char good_sig[17] = "MetalHexREBEEP  ";
static const char other_sig[17] = "MetalHexOTHERPRG";

static volatile unsigned char state_block[4];
static volatile int answer_state;   /* 0 = 10h gives no state block */
static volatile int refuse;         /* 1 = 12h and 13h refuse with exit code 7 */
static volatile int count_12;
static volatile int count_13;
static const char *sig = good_sig;
static unsigned sig_seg, sig_off, state_seg, state_off;

#pragma off (check_stack)
static void __interrupt __far stub(union INTPACK r)
{
    if (r.h.ah != STUB_ID) {
        r.h.al = 0;
        return;
    }
    switch (r.h.al) {
    case 0x00:
        r.h.al = 0xFF;
        r.w.dx = sig_seg;
        r.w.di = sig_off;
        break;
    case 0x10:
        if (answer_state) {
            r.h.al = 0xFF;
            r.w.dx = state_seg;
            r.w.bx = state_off;
        } else {
            r.h.al = 0;
        }
        break;
    case 0x12:
    case 0x13:
        if (r.h.al == 0x12) count_12++;
        else count_13++;
        if (refuse) {
            r.h.al = 0;
            r.h.bl = 7;
        } else {
            if (r.h.al == 0x12) state_block[1] |= TRAPS_FLAG;
            else state_block[1] &= (unsigned char)~TRAPS_FLAG;
            r.h.al = 0xFF;
        }
        break;
    default:
        r.h.al = 0;
        break;
    }
}
#pragma on (check_stack)

static void reset(int traps_on, const char *signature)
{
    sig = signature;
    sig_off = FP_OFF((void __far *)sig);
    sig_seg = FP_SEG((void __far *)sig);
    state_block[1] = traps_on ? TRAPS_FLAG : 0;
    answer_state = 1;
    refuse = 0;
    count_12 = 0;
    count_13 = 0;
}

static long log_size(void)
{
    FILE *f = fopen("AMIS.LOG", "rb");
    long n;

    if (f == NULL) return -1;
    fseek(f, 0, SEEK_END);
    n = ftell(f);
    fclose(f);
    return n;
}

int main(void)
{
    void (__interrupt __far *old)();
    void __far *p;

    p = (void __far *)state_block;
    state_off = FP_OFF(p);
    state_seg = FP_SEG(p);

    old = _dos_getvect(AMIS_INT);
    _dos_setvect(AMIS_INT, stub);
    log_open("AMIS.LOG");

    t_case("traps on: suspend turns them off once, resume turns them on");
    reset(1, good_sig);
    t_checkl(rebeep_suspend(), 1, "suspend reports it");
    t_checkl(count_13, 1, "one 13h");
    t_checkl(count_12, 0, "no 12h yet");
    t_check(!(state_block[1] & TRAPS_FLAG), "traps are off");
    rebeep_resume();
    t_checkl(count_12, 1, "one 12h");
    t_check((state_block[1] & TRAPS_FLAG) != 0, "traps are on again");
    rebeep_resume();
    t_checkl(count_12, 1, "a second resume sends nothing");
    t_checkl(count_13, 1, "and no more 13h");

    t_case("traps already off: nothing is sent");
    reset(0, good_sig);
    t_checkl(rebeep_suspend(), 0, "suspend returns 0");
    rebeep_resume();
    t_checkl(count_13, 0, "no 13h");
    t_checkl(count_12, 0, "no 12h");

    t_case("a refused 13h: 0, and no 12h later");
    reset(1, good_sig);
    refuse = 1;
    t_checkl(rebeep_suspend(), 0, "suspend returns 0");
    t_checkl(count_13, 1, "13h was tried");
    rebeep_resume();
    t_checkl(count_12, 0, "no 12h");

    t_case("no state block: left alone");
    reset(1, good_sig);
    answer_state = 0;
    t_checkl(rebeep_suspend(), 0, "suspend returns 0");
    t_checkl(count_13, 0, "no 13h");

    t_case("another program on the multiplex: not ReBeep, nothing logged");
    reset(1, other_sig);
    log_open("AMIS.LOG");
    t_checkl(rebeep_suspend(), 0, "suspend returns 0");
    rebeep_resume();
    t_checkl(count_13, 0, "no 13h");
    t_checkl(count_12, 0, "no 12h");
    t_checkl(log_size(), 0, "the log is empty");

    t_case("the log names what was done");
    reset(1, good_sig);
    log_open("AMIS.LOG");
    rebeep_suspend();
    rebeep_resume();
    t_check(log_size() > 0, "lines were logged");

    log_close();
    _dos_setvect(AMIS_INT, old);
    return t_done();
}
