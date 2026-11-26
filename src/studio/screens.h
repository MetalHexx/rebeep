/* ReBeep Studio: the screens. Each draws into the back buffer (the caller flushes). The detection log, splash, menu and
   patch list come from .ans art and use the standard view's colour indexes: in the mono view they pass through
   scr_remap_mono() (the role table's mono column is for the mockup screens, the synth screen among them).
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_SCREENS_H
#define RBSTUDIO_SCREENS_H

#include "editor.h"
#include "library.h"

/* What the detection log reports. */
typedef struct {
    int chip;              /* 0 none, 2 OPL2, 3 OPL3 */
    char card[40];         /* the sound card named by BLASTER, or "" */
    int mouse;             /* a driver answered */
    char folder[80];       /* the program folder, without a trailing backslash */
    int cfg_state;         /* 1 RBSTUDIO.CFG loaded, 0 not found, -1 unreadable */
    int factory, user, banks;   /* the patches counted in FACTORY and USER, the other bank folders */
    int patches_ok;        /* the patch list could be read */
    int log_ok;
    char log_path[96];
} Detect;

#define DETLOG_LINES 6

/* The detection log: clears the screen and draws the header and rule; detlog_line then draws line `n` (0-5, in the
   order Sound chip, Mouse, Program folder, Settings, Patches, Log file) from `d` and writes it to the log. */
void detlog_begin(const char *version);
void detlog_line(const Detect *d, int n);

/* The splash: SPLASH.ANS beside the program, then the version stamped on row 16. A missing file gives a plain splash
   and a log line. splash_loading then shows "Loading patches NN%" (`percent` 0 to 100) in place of the "press any key"
   line; splash_ready draws the splash again, prompt included, without the log line. */
void splash_draw(const char *version);
void splash_loading(int percent);
void splash_ready(const char *version);

/* The menu. menu_draw draws the art (or a plain frame) and the selection `sel`; menu_select redraws only the item rows
   and the About box. menu_item_at gives the item whose row holds cell (x, y), or -1. */
#define MENU_ITEMS 4
#define MENU_PATCHES 0
#define MENU_PROFILES 1
#define MENU_SETTINGS 2
#define MENU_EXIT 3
void menu_draw(int sel);
void menu_select(int sel);
int menu_item_at(int x, int y);

/* The plain "coming soon" page of a menu item. */
void soon_draw(int item);

/* The patch list: the library grouped by folder, in the standard view's indexes (mono: through the shared remap).
   Its body shows LIST_ROWS lines (heading rules and entries) from line `top`. list_draw draws the list with entry `sel`
   selected and, under the frame's last row, the note of a selected override or `msg` (NULL or "" for none).
   list_scroll gives the `top` that keeps `sel` in view (its folder heading too, when it is the folder's first);
   list_item_at gives the entry whose row holds cell (x, y), or -1. */
#define LIST_ROWS 12
void list_draw(const Library *lib, int sel, int top, const char *msg);
int list_scroll(const Library *lib, int sel, int top);
int list_item_at(const Library *lib, int top, int x, int y);

/* The synth screen for the variant `e->n` of the patch in the editor, in the role table's colours. It is drawn in
   parts, each owning whole rows (the top bar, the voice block, the parameter grid, the band with the frame's bottom
   edge, the bottom bar) and repainting its own background and frame cells, so one part can be drawn alone over a screen
   that was right for the old state. synth_draw(e) is synth_redraw(e, SD_ALL). */
#define SD_TOP 0x01
#define SD_VOICE 0x02
#define SD_GRID 0x04
#define SD_BAND 0x08
#define SD_BOTTOM 0x10
#define SD_ALL 0x1F
void synth_draw(const Editor *e);
void synth_redraw(const Editor *e, unsigned parts);

/* The parts whose drawing reads a field that differs between the two states, by comparing the fields the drawing reads
   (not `mods`, `last_make` and the like): 0 means the screen is the same. SD_ALL when the variant, the help, the
   unsaved-changes prompt, the Save dialog or what either shows differs. */
unsigned synth_parts(const Editor *before, const Editor *after);

/* What the cell (x, y) of the synth screen is, for a click: the control (the top row's four arrows included), the
   operator, the row, the bar with its extent. It follows the layout synth_draw uses at the current variant. */
void synth_hit(const Editor *e, int x, int y, SynthHit *h);

/* A pill: an operator's number `label` on the colour `col` between half blocks, at (x, y). Returns the column after it. */
int pill_draw(int x, int y, const char *label, int col);

/* The pop-ups. dim_under greys the sound area (rows 1 to 23) so only the pop-up reads as live; window_draw draws a
   window over the columns x0..x1 and rows y0..y1 (the frame included) with its title on the top line, a page text at
   its right (NULL for none) and the shadow below and to the right. */
void dim_under(void);
void window_draw(int x0, int y0, int x1, int y1, const char *title, const char *right);

/* The help over the screen as it is: page 1 (the keys, from HELP_ROWS) or 2 (what the controls mean). `detected` is the
   Detected line (clipped to 34 cells) and `log_path` the log's full path (shortened from the left to 22 characters).
   help_hit says whether the cell (x, y) is inside the window. help_detected composes the Detected line from the chip
   (0, 2 or 3) and the card text opl_card gave: "OPL3 on a Sound Blaster 16 at 220h", "OPL3 at 388h" with no card, or
   "none" with no chip. */
void help_draw(int page, const char *detected, const char *log_path);
int help_hit(int x, int y);
void help_detected(char *out, unsigned len, int chip, const char *card);

/* The unsaved-changes prompt over the screen as it is: "NAME" is not saved, and the three buttons (Save, Discard, Cancel)
   with the focus on `e->btn`. save_hit gives the button (0 to 2) under the cell (x, y), 3 for the rest of the window, or
   -1 outside it. */
void save_draw(const Editor *e);
int save_hit(int x, int y);

/* The Save dialog over the screen as it is: the Name and Bank fields, the lines of `e->dlg` and the buttons (Save lit
   when Enter would save). dialog_hit gives the DH_* of the cell (x, y). */
void dialog_draw(const Editor *e);
int dialog_hit(int x, int y);

/* Sample state for the reference screens: the fixed sample version, the sample detection, a log path of
   C:\REBEEP\RBSTUDIO.LOG, the sample patch list, FACTORY\BRASS, 2 of 4 in its bank: the data that makes a dump
   comparable. sample_known says whether `screen` is one of the reference names this program can draw; sample_draw draws
   it into the back buffer. */
const char *sample_version(void);
void sample_detect(Detect *d);

/* The editor the synth-4op and synth-2op reference screens show (`variant` 4 or 2): FACTORY\BRASS, 2 of 4 in its
   bank, edited, an OPL3, C4 and G4 held. */
void sample_editor(Editor *e, int variant);
int sample_known(const char *screen);
void sample_draw(const char *screen);

#endif
