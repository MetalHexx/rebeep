/* ReBeep Studio. SPDX-License-Identifier: MIT */
#include <conio.h>
#include <dos.h>
#include <i86.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "version.h"
#include "dice.h"
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

#define BENCH_FILE "BENCH.TXT"
#define BENCH_TICKS 92UL          /* each figure runs at least this many BIOS ticks: just over 5 s */
#define BENCH_FIGURES 5
#define BENCH_LINE 96
#define BENCH_PIANO 0x2C          /* the Z key: piano key 0, not held in the sample editor */
#define TICKS_PER_DAY 0x1800B0UL
#define TICK_US 54925UL           /* one BIOS tick (18.2 Hz) in microseconds */
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
    printf("  /BENCH      time the synth screen, print the figures and write %s\n", BENCH_FILE);
    printf("  /DUMP:name  draw a reference screen with its sample data; /O:file is the text screen written\n");
    printf("  /?          show this help\n");
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

/* What the editor asked of the main loop. Returns 1 when the synth screen is left for the list. `*full` is set when
   the action can switch patch, so the whole screen is drawn again. */
static int synth_action(Editor *ed, Library *lib, int act, int *full)
{
    char err[80];
    int back;

    if (act == EA_NONE) return 0;
    if (act == EA_PREV || act == EA_NEXT || act >= EA_PICK) *full = 1;
    back = editor_act(ed, lib, act, err, sizeof err);
    if (err[0] != '\0') {
        log_line("Cannot open that patch: %s", err);
        editor_msg(ed, "Cannot open that patch", R_WARNING);
    } else {
        remember_patch(lib, ed->pos);
    }
    return back;
}

/* The `parts` of the synth screen, with the help or the save prompt over it when one is open. An overlay is drawn
   over the whole screen, so `parts` is SD_ALL then. */
static void synth_show(const Editor *ed, unsigned parts)
{
    char what[48];

    synth_redraw(ed, parts);
    if (ed->help != 0) {
        help_detected(what, sizeof what, detect.chip, detect.card);
        help_draw(ed->help, what, detect.log_path);
    }
    if (ed->prompt) save_draw(ed);
}

static Editor drawn;   /* the Editor as the synth screen last showed it */

/* Draws what the synth screen shows differently from `drawn` (all of it when `full`), flushes, and takes the copy.
   Draws nothing when nothing shown has changed. */
static void synth_refresh(const Editor *ed, int full)
{
    unsigned parts = full ? SD_ALL : synth_parts(&drawn, ed);

    if (parts == 0) return;
    if (ed->help != 0 || ed->prompt) parts = SD_ALL;
    synth_show(ed, parts);
    scr_flush();
    drawn = *ed;
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
   back to the list. Every queued key and mouse change is taken first, then only the parts of the screen that show
   something different are drawn. */
static void run_synth(Editor *ed, Library *lib)
{
    int back = 0;
    int full = 1;
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

        while (kbd_next(&event) && !back) back = synth_action(ed, lib, editor_event(ed, event), &full);
        while (kbhit()) getch();

        down = mouse_read(&mx, &my) & 1;
        if (down && !was_down && !back && (ed->help != 0 || ed->prompt)) {
            back = synth_action(ed, lib, overlay_press(ed, mx, my), &full);
        } else if (down && !was_down && !back) {
            SynthHit hit;

            synth_hit(ed, mx, my, &hit);
            back = synth_action(ed, lib, editor_press(ed, &hit, mx), &full);
            dragging = hit.kind == SH_BAR;
            drag = hit;
            drag_x = mx;
            mouse_key = hit.kind == SH_PIANO ? hit.key : -1;
        } else if (down && dragging && mx != drag_x && !back) {
            editor_bar(ed, drag.k, drag.key, drag.bx, drag.bw, mx, 1);
            drag_x = mx;
        } else if (!down && was_down) {
            if (mouse_key >= 0) editor_key_up(ed, mouse_key);
            mouse_key = -1;
            dragging = 0;
        }
        was_down = down;

        if (!back) {
            synth_refresh(ed, full);
            full = 0;
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
    dice_seed(bios_ticks());
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

/* BIOS ticks since `start`, across midnight. */
static unsigned long ticks_since(unsigned long start)
{
    unsigned long now = bios_ticks();

    return now >= start ? now - start : now + TICKS_PER_DAY - start;
}

static void bench_discard(unsigned reg, unsigned char val)
{
    (void)reg;
    (void)val;
}

/* One call of each figure, on the sample editor: a full redraw; a piano key pressed and released; a value changed (Right
   and Left alternately, so every call changes it); the help opened over the screen. The key figures are the key events
   through the editor and the redraws the loop makes after each. */
static void bench_redraw(void)
{
    synth_draw(&editor);
    scr_flush();
}

static void bench_key(void)
{
    editor_event(&editor, BENCH_PIANO);
    synth_refresh(&editor, 0);
    editor_event(&editor, BENCH_PIANO | KBD_BREAK);
    synth_refresh(&editor, 0);
}

static void bench_value(void)
{
    static int left;
    unsigned event = (left ? 0x4B : 0x4D) | KBD_EXT;

    left = !left;
    editor_event(&editor, event);
    synth_refresh(&editor, 0);
    editor_event(&editor, event | KBD_BREAK);
    synth_refresh(&editor, 0);
}

static void bench_help(void)
{
    editor_help(&editor, 1);
    synth_refresh(&editor, 1);
    editor_help(&editor, 0);
}

/* Runs `call` for at least BENCH_TICKS from a tick edge and writes a line with the time per call. */
static void bench_time(const char *name, void (*call)(void), char *line)
{
    unsigned long first = bios_ticks();
    unsigned long start;
    unsigned long elapsed;
    unsigned long calls = 0;
    unsigned long us;

    while ((start = bios_ticks()) == first) {
    }
    do {
        call();
        calls++;
        elapsed = ticks_since(start);
    } while (elapsed < BENCH_TICKS);
    us = elapsed * TICK_US / calls;
    sprintf(line, "%-20s %lu.%02lu ms per call (%lu calls in %lu ms)", name, us / 1000UL, us % 1000UL / 10UL, calls,
            elapsed * TICK_US / 1000UL);
}

/* Times the synth screen on the sample editor with the chip silenced: the figures in `lines`, one each. */
static void bench_run(char lines[BENCH_FIGURES][BENCH_LINE])
{
    static const struct {
        const char *name;
        int variant;
        void (*call)(void);
    } figure[BENCH_FIGURES] = {
        {"Redraw, 4-OP", 4, bench_redraw}, {"Redraw, 2-OP", 2, bench_redraw}, {"Piano key, 4-OP", 4, bench_key},
        {"Value change, 4-OP", 4, bench_value}, {"Help page 1, 4-OP", 4, bench_help}
    };
    int i;

    for (i = 0; i < BENCH_FIGURES; i++) {
        sample_editor(&editor, figure[i].variant);
        editor_apply(&editor);
        synth_refresh(&editor, 1);
        bench_time(figure[i].name, figure[i].call, lines[i]);
    }
}

/* /BENCH: the figures on screen, in the studio's own drawing path, then printed and written to BENCH.TXT. The OPL
   driver runs with a sink that discards its writes, so nothing sounds and the chip is not touched. */
static int run_bench(void)
{
    static char lines[BENCH_FIGURES][BENCH_LINE];
    char head[BENCH_LINE];
    FILE *out;
    int ok = 1;
    int i;

    if (editor_init() != 0) {
        printf("Out of memory for the undo history\n");
        return EXIT_IO;
    }
    opl_sink = bench_discard;
    opl_init(3);
    sample_detect(&detect);
    video_init();
    bench_run(lines);
    video_restore();
    opl_shutdown();
    editor_done();

    sprintf(head, "RBSTUDIO %s bench: the synth screen, each figure over at least 5 s", REBEEP_VERSION);
    out = fopen(BENCH_FILE, "w");
    printf("%s\n", head);
    if (out != NULL) ok = fprintf(out, "%s\n", head) >= 0;
    for (i = 0; i < BENCH_FIGURES; i++) {
        printf("%s\n", lines[i]);
        if (out != NULL && ok) ok = fprintf(out, "%s\n", lines[i]) >= 0;
    }
    if (out != NULL && fclose(out) != 0) ok = 0;
    if (out == NULL || !ok) {
        printf("Cannot write %s\n", BENCH_FILE);
        return EXIT_IO;
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
