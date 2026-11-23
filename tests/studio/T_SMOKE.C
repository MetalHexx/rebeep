/* Studio suite smoke test: the generated version macros and far pointers work in a test program. */
#include <dos.h>
#include <i86.h>
#include <stdio.h>
#include <string.h>

#include "version.h"
#include "testlib.h"

static unsigned char scratch[4];

int main(void)
{
    char number[24];
    unsigned char __far *far_scratch;

    t_case("version macros");
    sprintf(number, "%d.%d.%d", REBEEP_VER_MAJOR, REBEEP_VER_MINOR, REBEEP_VER_PATCH);
    t_check(strncmp(REBEEP_VERSION, number, strlen(number)) == 0, "REBEEP_VERSION starts with major.minor.patch");

    t_case("far pointer round trip");
    far_scratch = (unsigned char __far *)MK_FP(FP_SEG((void __far *)scratch), FP_OFF((void __far *)scratch));
    far_scratch[1] = 0xA5;
    t_checkl(scratch[1], 0xA5L, "write through a far pointer is seen by the near one");
    scratch[2] = 0x5A;
    t_checkl(far_scratch[2], 0x5AL, "write through the near pointer is seen by the far one");

    return t_done();
}
