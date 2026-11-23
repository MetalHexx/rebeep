/* ReBeep Studio. SPDX-License-Identifier: MIT */
#include <conio.h>
#include <dos.h>
#include <i86.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "version.h"
#include "dos.h"
#include "kbd.h"
#include "video.h"

#define BENCH_FRAMES 200
#define BENCH_FILE "BENCH.TXT"
#define TICKS_PER_DAY 0x1800B0UL
#define SCAN_ESC 0x01

#define EXIT_OK 0
#define EXIT_USAGE 1
#define EXIT_IO 2

static void usage(void)
{
    printf("ReBeep Studio %s\n", REBEEP_VERSION);
    printf("Usage: RBSTUDIO [/BENCH]\n");
    printf("  /BENCH  redraw the whole screen %d times, print the time and write %s\n", BENCH_FRAMES, BENCH_FILE);
    printf("  /?      show this help\n");
}

static void draw_box(int x, int y, int w, int h, unsigned char attr)
{
    int i;

    video_put(x, y, 0xC9, attr);
    video_put(x + w - 1, y, 0xBB, attr);
    video_put(x, y + h - 1, 0xC8, attr);
    video_put(x + w - 1, y + h - 1, 0xBC, attr);
    for (i = 1; i < w - 1; i++) {
        video_put(x + i, y, 0xCD, attr);
        video_put(x + i, y + h - 1, 0xCD, attr);
    }
    for (i = 1; i < h - 1; i++) {
        video_put(x, y + i, 0xBA, attr);
        video_put(x + w - 1, y + i, 0xBA, attr);
    }
}

/* One full redraw into the back buffer. `frame` shifts the glyphs so successive frames differ. */
static void draw_screen(unsigned frame, const char *last_key)
{
    static const char hex[] = "0123456789ABCDEF";
    char line[VIDEO_COLS + 1];
    int x;
    int y;

    video_fill(0, 0, VIDEO_COLS, VIDEO_ROWS, ' ', 0x07);
    video_fill(0, 0, VIDEO_COLS, 1, ' ', 0x1F);
    sprintf(line, "ReBeep Studio %s - test screen", REBEEP_VERSION);
    video_text(2, 0, line, 0x1F);
    draw_box(0, 1, VIDEO_COLS, 23, 0x0B);

    video_text(4, 2, "Attributes: background down, foreground across", 0x0F);
    video_text(56, 2, "Character set", 0x0F);
    for (y = 0; y < 16; y++) {
        for (x = 0; x < 16; x++) {
            unsigned char attr = (unsigned char)((y << 4) | x);

            video_put(4 + x * 3, 4 + y, ' ', attr);
            video_put(5 + x * 3, 4 + y, (unsigned char)hex[(x + frame) & 15], attr);
            video_put(6 + x * 3, 4 + y, ' ', attr);
            video_put(56 + x, 4 + y, (unsigned char)(y * 16 + x), 0x07);
        }
    }

    sprintf(line, "Folder: %.70s", dos_program_dir());
    video_text(4, 21, line, 0x0E);
    video_text(4, 22, last_key, 0x0A);
    video_fill(0, 24, VIDEO_COLS, 1, ' ', 0x70);
    video_text(2, 24, "Esc quits", 0x70);
}

/* The BIOS tick count at 0040:006C, read twice because the timer can tick between the two halves. */
static unsigned long bios_ticks(void)
{
    volatile unsigned long __far *ticks = (volatile unsigned long __far *)MK_FP(0x40, 0x6C);
    unsigned long a;
    unsigned long b;

    do {
        a = *ticks;
        b = *ticks;
    } while (a != b);
    return a;
}

static int run_bench(void)
{
    char result[120];
    unsigned long start;
    unsigned long first;
    unsigned long end;
    unsigned long elapsed;
    unsigned long ms;
    unsigned i;
    FILE *out;

    video_init();
    first = bios_ticks();
    while ((start = bios_ticks()) == first) {
    }
    for (i = 0; i < BENCH_FRAMES; i++) {
        draw_screen(i, "Benchmark");
        video_flush();
    }
    end = bios_ticks();
    elapsed = end >= start ? end - start : end + TICKS_PER_DAY - start;
    video_restore();

    ms = elapsed * 54925UL / 1000UL;
    sprintf(result, "RBSTUDIO %s bench: %u full redraws in %lu ticks = %lu ms, %lu us per redraw",
            REBEEP_VERSION, BENCH_FRAMES, elapsed, ms, ms * 1000UL / BENCH_FRAMES);
    printf("%s\n", result);

    out = fopen(BENCH_FILE, "w");
    if (out == NULL || fprintf(out, "%s\n", result) < 0 || fclose(out) != 0) {
        printf("Cannot write %s\n", BENCH_FILE);
        return EXIT_IO;
    }
    return EXIT_OK;
}

static int run_studio(void)
{
    char last_key[VIDEO_COLS + 1];
    unsigned event;
    int quit = 0;

    video_init();
    kbd_init();
    strcpy(last_key, "Last key: none yet");
    draw_screen(0, last_key);
    video_flush();

    while (!quit) {
        int changed = 0;

        while (kbd_next(&event)) {
            sprintf(last_key, "Last key: %-5s %s%02Xh", (event & KBD_BREAK) ? "break" : "make",
                    (event & KBD_EXT) ? "E0 " : "", event & KBD_CODE);
            changed = 1;
            if (event == SCAN_ESC) quit = 1;
        }
        /* The BIOS still gets every key; empty its buffer so a full one never beeps. */
        while (kbhit()) getch();
        if (changed) {
            draw_screen(0, last_key);
            video_flush();
        }
    }

    dos_restore();
    video_restore();
    return EXIT_OK;
}

int main(int argc, char **argv)
{
    int bench = 0;
    int i;

    for (i = 1; i < argc; i++) {
        if (stricmp(argv[i], "/?") == 0) {
            usage();
            return EXIT_OK;
        } else if (stricmp(argv[i], "/BENCH") == 0) {
            bench = 1;
        } else {
            printf("Unknown option: %s\n", argv[i]);
            usage();
            return EXIT_USAGE;
        }
    }

    dos_init(argv[0]);
    return bench ? run_bench() : run_studio();
}
