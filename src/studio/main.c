/* ReBeep Studio. SPDX-License-Identifier: MIT */
#include <conio.h>
#include <dos.h>
#include <i86.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "version.h"
#include "dos.h"
#include "editor.h"
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
#define DOUBLE_CLICK_TICKS 8UL    /* two clicks on one row this close are a double click, about 0.4 s */

#define EXIT_OK 0
#define EXIT_USAGE 1
#define EXIT_IO 2
#define EXIT_DUMP 3
#define EXIT_SCREEN 4   /* /DUMP of a screen this program does not know; the screen check relies on it */

static Settings settings;     /* RBSTUDIO.CFG, read once by the detection log */
static Library patch_lib;     /* the patch list, scanned each time the Patch Editor opens */
static Detect detect;         /* what the detection log found: the help names the chip and the log */
static Editor editor;
static char last_patch[20];   /* FOLDER\NAME of the patch opened last: the list opens on it */
static char list_msg[80];     /* why the last patch would not open, shown under the list */

static void usage(void)
{
    printf("ReBeep Studio %s\n", REBEEP_VERSION);
    printf("Usage: RBSTUDIO [/VIEW:MONO] [/TRACE] [/BENCH] [/DUMP:<screen> /O:<file>]\n");
    printf("  /VIEW:MONO  draw for a monochrome display\n");
    printf("  /TRACE      log every OPL register write and key event to RBSTUDIO.LOG\n");
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

/* The list opens on the patch shown, `pos` of the library. */
static void remember_patch(const Library *lib, int pos)
{
    Entry en;

    if (lib_entry(lib, pos - 1) == NULL) return;
    en = *lib_entry(lib, pos - 1);
    sprintf(last_patch, "%s\\%s", en.folder, en.name);
}

/* What the editor asked of the main loop. Returns 1 when the synth screen is left for the list. */
static int synth_action(Editor *ed, Library *lib, int act)
{
    char err[80];
    int back;

    if (act == EA_NONE) return 0;
    back = editor_act(ed, lib, act, err, sizeof err);
    if (err[0] != '\0') {
        log_line("Cannot open that patch: %s", err);
        editor_msg(ed, "Cannot open that patch", R_WARNING);
    } else {
        remember_patch(lib, ed->pos);
    }
    return back;
}

/* The synth screen, with the help or the save prompt over it when one is open. */
static void synth_show(const Editor *ed)
{
    char what[48];

    synth_draw(ed);
    if (ed->help != 0) {
        help_detected(what, sizeof what, detect.chip, detect.card);
        help_draw(ed->help, what, detect.log_path);
    }
    if (ed->prompt) save_draw(ed);
}

/* A click while the help or the save prompt is open. Returns the action for editor_act. */
static int overlay_press(Editor *ed, int mx, int my)
{
    if (ed->prompt) {
        int hit = save_hit(mx, my);

        if (hit >= 0 && hit < 4) return EA_PICK + hit;
        return hit < 0 ? EA_PICK + 3 : EA_NONE;
    }
    editor_help(ed, help_hit(mx, my) ? 3 - ed->help : 0);
    return EA_NONE;
}

/* The synth screen of the patch in `ed`: the keys and the mouse edit and play it, PgUp and PgDn switch patch, Esc goes
   back to the list. */
static void run_synth(Editor *ed, Library *lib)
{
    int back = 0;
    int redraw = 1;
    int was_down;
    int dragging = 0;
    int drag_x = 0;
    int mouse_key = -1;
    SynthHit drag;
    int mx;
    int my;

    key_pressed();
    ed->mods = key_mods();
    was_down = mouse_read(&mx, &my) & 1;
    while (!back) {
        unsigned event;
        int down;

        while (kbd_next(&event) && !back) {
            back = synth_action(ed, lib, editor_event(ed, event));
            redraw = 1;
        }
        while (kbhit()) getch();

        down = mouse_read(&mx, &my) & 1;
        if (down && !was_down && !back && (ed->help != 0 || ed->prompt)) {
            back = synth_action(ed, lib, overlay_press(ed, mx, my));
            redraw = 1;
        } else if (down && !was_down && !back) {
            SynthHit hit;

            synth_hit(ed, mx, my, &hit);
            back = synth_action(ed, lib, editor_press(ed, &hit, mx));
            dragging = hit.kind == SH_BAR;
            drag = hit;
            drag_x = mx;
            mouse_key = hit.kind == SH_PIANO ? hit.key : -1;
            redraw = 1;
        } else if (down && dragging && mx != drag_x && !back) {
            editor_bar(ed, drag.k, drag.key, drag.bx, drag.bw, mx, 1);
            drag_x = mx;
            redraw = 1;
        } else if (!down && was_down) {
            if (mouse_key >= 0) editor_key_up(ed, mouse_key);
            mouse_key = -1;
            dragging = 0;
            redraw = 1;
        }
        was_down = down;

        if (redraw && !back) {
            synth_show(ed);
            scr_flush();
            redraw = 0;
        }
    }
    editor_release(ed);
}

/* The Patch Editor: the list of patches, then the synth screen of the one chosen. Esc steps back a level. */
static void run_patch_editor(void)
{
    int sel = 0;
    int top = 0;
    int back = 0;
    int redraw = 1;
    int was_down;
    int last_hit = -1;
    unsigned long last_click = 0;
    int mx;
    int my;
    int found;

    if (lib_scan(&patch_lib, dos_program_dir(), cfg_get(&settings, "PATCHES")) != 0) {
        log_line("Patch Editor: out of memory reading the patch list");
        return;
    }
    if (editor_init() != 0) {
        log_line("Patch Editor: out of memory for the undo history");
        lib_free(&patch_lib);
        return;
    }
    found = last_patch[0] != '\0' ? lib_find(&patch_lib, last_patch) : -1;
    if (found >= 0) sel = found;
    list_msg[0] = '\0';
    key_pressed();
    was_down = mouse_read(&mx, &my) & 1;

    while (!back) {
        unsigned event;
        int open = 0;
        int down;

        while (kbd_next(&event) && !open && !back) {
            switch (key_lookup(K_MENU, event, key_mods())) {
            case KID_UP:
                if (sel > 0) {
                    sel--;
                    redraw = 1;
                }
                break;
            case KID_DOWN:
                if (sel + 1 < lib_count(&patch_lib)) {
                    sel++;
                    redraw = 1;
                }
                break;
            case KID_ENTER:
                open = 1;
                break;
            case KID_ESC:
                back = 1;
                break;
            default:
                break;
            }
        }
        while (kbhit()) getch();

        down = mouse_read(&mx, &my) & 1;
        if (down && !was_down && !open && !back) {
            int hit = list_item_at(&patch_lib, top, mx, my);

            if (hit >= 0) {
                unsigned long now = bios_ticks();

                open = hit == last_hit && now - last_click <= DOUBLE_CLICK_TICKS;
                last_hit = open ? -1 : hit;
                last_click = now;
                if (hit != sel) {
                    sel = hit;
                    redraw = 1;
                }
            }
        }
        was_down = down;

        if (open && lib_count(&patch_lib) > 0) {
            Entry en = *lib_entry(&patch_lib, sel);

            if (editor_load(&editor, &patch_lib, sel, list_msg, sizeof list_msg) == 0) {
                sprintf(last_patch, "%s\\%s", en.folder, en.name);
                list_msg[0] = '\0';
                run_synth(&editor, &patch_lib);
                sel = editor.pos - 1;
                was_down = mouse_read(&mx, &my) & 1;
            } else {
                log_line("Cannot open %s\\%s: %s", en.folder, en.name, list_msg);
            }
            redraw = 1;
        }
        if (redraw && !back) {
            top = list_scroll(&patch_lib, sel, top);
            list_draw(&patch_lib, sel, top, list_msg);
            scr_flush();
            redraw = 0;
        }
    }
    editor_done();
    lib_free(&patch_lib);
}

/* Acts on the chosen item. Returns 1 when the program should end. */
static int menu_choose(int sel)
{
    if (sel == MENU_EXIT) return 1;
    if (sel == MENU_PATCHES) run_patch_editor();
    else run_soon(sel);
    menu_draw(sel);
    scr_flush();
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

static int run_studio(int mono, int trace)
{
    atexit(release_hardware);
    log_set_trace(trace);
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
    int trace = 0;
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
        } else if (stricmp(argv[i], "/TRACE") == 0) {
            trace = 1;
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
    return bench ? run_bench() : run_studio(mono, trace);
}
