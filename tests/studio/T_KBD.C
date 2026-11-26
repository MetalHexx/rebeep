/* The keyboard hook leaves nothing in the BIOS keyboard buffer, so DOS never sees a studio key: DOS pauses on Ctrl+S.
   DOSBox-X doesn't pause, so the buffer is what's checked. */
#include <dos.h>
#include <i86.h>

#include "testlib.h"
#include "../../src/studio/dos.h"
#include "../../src/studio/kbd.h"

#define CTRL_S 0x1F13   /* scan code 1Fh, character 13h */

/* Is a key waiting in the BIOS buffer? Its head and tail, at 0040:001A and 001C, differ. */
static int bios_key_waiting(void)
{
    volatile unsigned __far *head = (volatile unsigned __far *)MK_FP(0x40, 0x1A);
    volatile unsigned __far *tail = (volatile unsigned __far *)MK_FP(0x40, 0x1C);

    return *head != *tail;
}

/* Puts a key in the BIOS buffer (INT 16h AH=05h). */
static void bios_put_key(unsigned key)
{
    union REGS r;

    r.h.ah = 0x05;
    r.w.cx = key;
    int86(0x16, &r, &r);
}

int main(int argc, char **argv)
{
    union REGS r;

    (void)argc;
    dos_init(argv[0]);

    t_case("kbd_init empties the BIOS buffer");
    bios_put_key(CTRL_S);
    t_check(bios_key_waiting(), "the key waits before the hook");
    kbd_init();
    t_check(!bios_key_waiting(), "no key waits after the hook");

    t_case("a keyboard interrupt leaves the BIOS buffer empty");
    bios_put_key(CTRL_S);
    t_check(bios_key_waiting(), "the key waits before the interrupt");
    r.w.ax = 0;
    int86(0x09, &r, &r);
    t_check(!bios_key_waiting(), "no key waits after the interrupt");

    dos_restore();
    return t_done();
}
