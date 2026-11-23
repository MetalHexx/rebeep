/* ReBeep Studio. SPDX-License-Identifier: MIT */
#include <conio.h>
#include <dos.h>
#include <i86.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "version.h"
#include "dos.h"
#include "jingle.h"
#include "kbd.h"
#include "keys.h"
#include "library.h"
#include "log.h"
#include "mouse.h"
#include "opl.h"
#include "rebeep.h"
#include "roles.h"
#include "screens.h"
#include "settings.h"
#include "video.h"

#define BENCH_FRAMES 200
#define BENCH_FILE "BENCH.TXT"
#define TICKS_PER_DAY 0x1800B0UL
#define DETECT_PAUSE_TICKS 18UL   /* about a second at 18.2 Hz */

#define EXIT_OK 0
#define EXIT_USAGE 1
#define EXIT_IO 2
#define EXIT_SCREEN 2   /* /DUMP of a screen this program does not know */
#define EXIT_DUMP 3

static void usage(void)
{
    printf("ReBeep Studio %s\n", REBEEP_VERSION);
    printf("Usage: RBSTUDIO [/VIEW:MONO] [/BENCH] [/DUMP:<screen> /O:<file>]\n");
    printf("  /VIEW:MONO  draw for a monochrome display\n");
    printf("  /BENCH      redraw the whole screen %d times, print the time and write %s\n", BENCH_FRAMES, BENCH_FILE);
    printf("  /DUMP:name  draw a reference screen with its sample data; /O:file is the text screen written\n");
    printf("  /?          show this help\n");
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

/* The hardware the studio took: the chip, the mouse cursor and a resident ReBeep's traps. Runs once, at exit. */
static void release_hardware(void)
{
    static int released;

    if (released) return;
    released = 1;
    jingle_stop();
    if (opl_chip() != 0) opl_shutdown();
    mouse_done();
    rebeep_resume();
}

/* Does the studio have a key press (a make) waiting? Empties the key queue and the BIOS buffer either way. */
static int key_pressed(void)
{
    unsigned event;
    int any = 0;

    while (kbd_next(&event)) {
        if (!(event & KBD_BREAK)) any = 1;
    }
    while (kbhit()) getch();
    return any;
}

static void wait_ticks(unsigned long ticks)
{
    unsigned long start = bios_ticks();

    while (bios_ticks() - start < ticks) {
    }
}

static void folder_without_slash(char *out, unsigned len)
{
    const char *dir = dos_program_dir();
    unsigned n = (unsigned)strlen(dir);

    if (n >= len) n = len - 1;
    memcpy(out, dir, n);
    out[n] = '\0';
    if (n > 3 && out[n - 1] == '\\') out[n - 1] = '\0';
    if (out[0] == '\0') strcpy(out, ".");
}

/* The checks, each drawn and logged as it completes. */
static void run_detection(Detect *d)
{
    static Settings settings;
    static Library library;
    char path[100];

    memset(d, 0, sizeof *d);
    sprintf(d->log_path, "%.80sRBSTUDIO.LOG", dos_program_dir());
    d->log_ok = log_open(d->log_path) == 0;
    detlog_begin(REBEEP_VERSION);
    scr_flush();

    d->chip = opl_detect();
    if (d->chip != 0) opl_card(d->card, sizeof d->card);
    detlog_line(d, 0);
    scr_flush();

    d->mouse = mouse_init();
    detlog_line(d, 1);
    scr_flush();

    folder_without_slash(d->folder, sizeof d->folder);
    detlog_line(d, 2);
    scr_flush();

    sprintf(path, "%.80sRBSTUDIO.CFG", dos_program_dir());
    d->cfg_state = cfg_load(&settings, path) < 0 ? -1 : settings.present;
    detlog_line(d, 3);
    scr_flush();

    d->patches_ok = lib_scan(&library, dos_program_dir(), cfg_get(&settings, "PATCHES")) == 0;
    d->factory = library.factory;
    d->user = library.user;
    d->packs = library.packs;
    lib_free(&library);
    detlog_line(d, 4);
    scr_flush();

    detlog_line(d, 5);
    scr_flush();
}

/* Runs the splash: the art, the jingle, and any key to leave. */
static void run_splash(int chip)
{
    splash_draw(REBEEP_VERSION);
    scr_flush();
    if (chip != 0) {
        opl_init(chip);
        jingle_start();
    }
    key_pressed();
    while (!key_pressed()) jingle_poll();
    jingle_stop();
}

/* The page of a menu item that is not built yet; Esc goes back. */
static void run_soon(int item)
{
    int back = 0;

    soon_draw(item);
    scr_flush();
    while (!back) {
        unsigned event;

        while (kbd_next(&event)) {
            if (key_lookup(K_MENU, event, key_mods()) == KID_ESC) back = 1;
        }
        while (kbhit()) getch();
    }
}

/* Acts on the chosen item. Returns 1 when the program should end. */
static int menu_choose(int sel)
{
    if (sel == MENU_EXIT) return 1;
    if (sel == MENU_PROFILES || sel == MENU_SETTINGS) {
        run_soon(sel);
        menu_draw(sel);
        scr_flush();
    }
    return 0;
}

static void run_menu(void)
{
    int sel = 0;
    int quit = 0;
    int was_down = 0;

    menu_draw(sel);
    scr_flush();
    mouse_show();
    while (!quit) {
        unsigned event;
        int moved = 0;
        int mx;
        int my;
        int down;

        while (kbd_next(&event) && !quit) {
            switch (key_lookup(K_MENU, event, key_mods())) {
            case KID_UP:
                sel = (sel + MENU_ITEMS - 1) % MENU_ITEMS;
                moved = 1;
                break;
            case KID_DOWN:
                sel = (sel + 1) % MENU_ITEMS;
                moved = 1;
                break;
            case KID_ENTER:
                quit = menu_choose(sel);
                break;
            case KID_ESC:
                quit = 1;
                break;
            default:
                break;
            }
        }
        while (kbhit()) getch();

        down = mouse_read(&mx, &my) & 1;
        if (down && !was_down && !quit) {
            int hit = menu_item_at(mx, my);

            if (hit >= 0) {
                sel = hit;
                menu_select(sel);
                scr_flush();
                quit = menu_choose(sel);
            }
        }
        was_down = down;

        if (moved && !quit) {
            menu_select(sel);
            scr_flush();
        }
    }
}

static int run_studio(int mono)
{
    Detect detect;

    atexit(release_hardware);
    rebeep_suspend();
    video_init();
    kbd_init();
    role_set_mono(mono || scr_bw80());

    run_detection(&detect);
    wait_ticks(DETECT_PAUSE_TICKS);
    run_splash(detect.chip);
    run_menu();

    release_hardware();
    dos_restore();
    video_restore();
    return EXIT_OK;
}

/* Draws one reference screen with its sample data and writes the 4000-byte text screen to `out`. */
static int run_dump(const char *screen, const char *out, int mono)
{
    int rc;

    if (!sample_known(screen)) {
        printf("Unknown screen: %s\n", screen);
        return EXIT_SCREEN;
    }
    if (out == NULL) {
        printf("/DUMP needs /O:<file>\n");
        usage();
        return EXIT_USAGE;
    }
    video_init();
    role_set_mono(mono || scr_bw80());
    sample_draw(screen);
    scr_flush();
    rc = scr_dump(out);
    video_restore();
    if (rc != 0) {
        printf("Cannot write %s\n", out);
        return EXIT_DUMP;
    }
    return EXIT_OK;
}

/* The text after `prefix` (case-insensitive) when `arg` starts with it, else NULL. */
static const char *option_value(const char *arg, const char *prefix)
{
    size_t n = strlen(prefix);

    return strnicmp(arg, prefix, n) == 0 ? arg + n : NULL;
}

int main(int argc, char **argv)
{
    const char *dump = NULL;
    const char *out = NULL;
    const char *value;
    int bench = 0;
    int mono = 0;
    int i;

    for (i = 1; i < argc; i++) {
        if (stricmp(argv[i], "/?") == 0) {
            usage();
            return EXIT_OK;
        } else if (stricmp(argv[i], "/BENCH") == 0) {
            bench = 1;
        } else if ((value = option_value(argv[i], "/DUMP:")) != NULL && *value != '\0') {
            dump = value;
        } else if ((value = option_value(argv[i], "/O:")) != NULL && *value != '\0') {
            out = value;
        } else if (stricmp(argv[i], "/VIEW:MONO") == 0) {
            mono = 1;
        } else {
            printf("Unknown option: %s\n", argv[i]);
            usage();
            return EXIT_USAGE;
        }
    }

    dos_init(argv[0]);
    if (dump != NULL) return run_dump(dump, out, mono);
    return bench ? run_bench() : run_studio(mono);
}
