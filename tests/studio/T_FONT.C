/* SUITE: MACHINES */
/* The soft font of sixteenth blocks under each display machine (argument cga, ega or vgaonly): video_init picks the path
   from what the font holds, not from what the BIOS reports, so a card without the blocks draws half blocks. */
#include <dos.h>
#include <i86.h>
#include <string.h>

#include "testlib.h"
#include "../../src/studio/video.h"

int main(int argc, char **argv)
{
    const char *machine = argc > 1 ? argv[1] : "";
    int want = 0;
    union REGPACK r;

    if (stricmp(machine, "ega") == 0) want = 14;
    else if (stricmp(machine, "vgaonly") == 0) want = 16;

    t_case("the drawing path follows the card");
    video_init();
    t_checkl(video_block_lines(), want, "block lines: 14 on an EGA, 16 on a VGA, 0 on a CGA");

    t_case("the loaded blocks read back from the font");
    t_checkl(video_blocks_in_font(), want != 0, "all 15 glyphs are in the font after the load");

    t_case("a font without the blocks reads back as missing");
    if (want != 0) {
        memset(&r, 0, sizeof r);
        r.w.ax = want == 16 ? 0x1104 : 0x1101;
        intr(0x10, &r);
        t_checkl(video_blocks_in_font(), 0, "the ROM font put back holds none of the blocks");
    }
    video_restore();
    return t_done();
}
