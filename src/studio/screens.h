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
    int factory, user, packs;
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
   and a log line. */
void splash_draw(const char *version);

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

/* The synth screen for the variant `e->n` of the patch in the editor, in the role table's colours. */
void synth_draw(const Editor *e);

/* Sample state for the reference screens: the fixed data (version 0.1.0, the sample detection, a log path of
   C:\REBEEP\RBSTUDIO.LOG, the sample patch list, patch 12 of 40 BRASS) that makes a dump comparable. sample_known says
   whether `screen` is one of the reference names this program can draw; sample_draw draws it into the back buffer. */
const char *sample_version(void);
void sample_detect(Detect *d);
int sample_known(const char *screen);
void sample_draw(const char *screen);

#endif
