/* Studio suite smoke test: the generated version macros, far pointers and a studio module work in a test program. */
#include <dos.h>
#include <i86.h>
#include <stdio.h>
#include <string.h>

#include "version.h"
#include "testlib.h"
#include "../../src/studio/video.h"

#define TEXT_SEG 0xB800

static unsigned char scratch[4];

int main(void)
{
    char number[24];
    unsigned char __far *far_scratch;
    unsigned short __far *screen;

    t_case("version macros");
    sprintf(number, "%d.%d.%d", REBEEP_VER_MAJOR, REBEEP_VER_MINOR, REBEEP_VER_PATCH);
    t_check(strncmp(REBEEP_VERSION, number, strlen(number)) == 0, "REBEEP_VERSION starts with major.minor.patch");

    t_case("far pointer round trip");
    far_scratch = (unsigned char __far *)MK_FP(FP_SEG((void __far *)scratch), FP_OFF((void __far *)scratch));
    far_scratch[1] = 0xA5;
    t_checkl(scratch[1], 0xA5L, "write through a far pointer is seen by the near one");
    scratch[2] = 0x5A;
    t_checkl(far_scratch[2], 0x5AL, "write through the near pointer is seen by the far one");

    t_case("studio module: video_put clips and video_flush reaches B800");
    screen = (unsigned short __far *)MK_FP(TEXT_SEG, 0);
    video_init();
    video_put(VIDEO_COLS, 0, 'X', 0x4E);
    video_put(VIDEO_COLS - 1, VIDEO_ROWS - 1, 'Z', 0x1F);
    video_flush();
    t_checkl(screen[VIDEO_COLS], 0x0720L, "a put past the last column is clipped, not wrapped to the next row");
    t_checkl(screen[VIDEO_ROWS * VIDEO_COLS - 1], 0x1F5AL, "a put on the last cell reaches B800 after the flush");

    return t_done();
}
