/* ReBeep Studio: the pop-up frame and the two-page help overlay. A port of the mockup's dimUnder, box and help().
   SPDX-License-Identifier: MIT */
#include <stdio.h>
#include <string.h>

#include "keys.h"
#include "roles.h"
#include "screens.h"
#include "video.h"

#define WIN_X0 2
#define WIN_Y0 1
#define WIN_X1 77
#define WIN_Y1 22
#define KEYS_X 4        /* a column's key text; the right column starts at RIGHT_X */
#define RIGHT_X 41
#define TEXT_DX 13      /* the key text is this wide before the description (Ctrl+PgUp Dn is 12) */
#define FIRST_ROW 3
#define RULE_ROW 20
#define DETECTED_ROW 21
#define DETECTED_W 34
#define LOG_W 22
#define H_LINE '\xC4'

static const struct {
    const char *label;
    const char *line1;
    const char *line2;
} HELP2[] = {
    {"Attack Rate", "Rise time: 1 is 2.8 s, 14 is 0.35 ms, 15 instant.", NULL},
    {"Decay Rate", "Fall to Sustain Level: 1 is 39 s, 15 is 2.4 ms.", NULL},
    {"Sustain Level", "Level held while the key is down; 3 dB a step.", NULL},
    {"Release Rate", "Fade after key up: 1 is 39 s, 15 is 2.4 ms.", NULL},
    {"Output Level", "Volume, 0.75 dB a step. On a modulator: more tone.", NULL},
    {"Key Scale Level", "High notes get quieter: 0, 1.5, 3 or 6 dB/octave.", NULL},
    {"Frequency Multiplier", "Pitch x\xAB" " to x15: x1 is the note, x2 an octave up.", NULL},
    {"Waveform", "The wave's shape: 4 on OPL2, 8 on OPL3.", NULL},
    {"Tremolo", "Volume wobbles, 1 or 4.8 dB (set for the chip).", NULL},
    {"Vibrato", "Pitch wobbles, 7 or 14 cents (set for the chip).", NULL},
    {"Sustained", "On: holds at Sustain Level until the key is up.", NULL},
    {"Key Scale Rate", "The envelope runs faster on higher notes.", NULL},
    {"Connection", "How operators feed each other: carriers are heard,", "modulators shape them. 2-OP has 2 choices, 4-OP 4."},
    {"Feedback", "Operator 1 feeds its own output back into itself.", "0 is a pure tone, 7 is buzzy and noisy."}
};

void dim_under(void)
{
    int ground = role(R_GROUND);
    int x;
    int y;

    for (y = 1; y < VIDEO_ROWS - 1; y++) {
        for (x = 0; x < VIDEO_COLS; x++) {
            unsigned cell = scr_cell(x, y);
            unsigned ch = cell & 0xFF;

            if (((cell >> 12) & 15) == ground) {
                scr_paint(x, y, 1, 1, role(R_SHADOW), SCR_KEEP);
            } else if (ch == 0xDF || ch == 0xDC || ch == 0xDB || ch == 0xDD || ch == 0xDE) {
                scr_fill(x, y, 1, 1, ' ', SCR_KEEP, role(R_SHADOW));
            } else {
                scr_paint(x, y, 1, 1, role(R_GROUND), role(R_SHADOW));
            }
        }
    }
}

void window_draw(int x0, int y0, int x1, int y1, const char *title, const char *right)
{
    int win = role(R_WINDOW);
    int accent = role(R_WINDOWACCENT);
    int shadow = role(R_WINDOWSHADOW);
    char text[48];

    scr_fill(x0 + 1, y0 + 1, x1 - x0 - 1, y1 - y0 - 1, ' ', role(R_WINDOWTEXT), win);
    scr_box(x0, y0, x1 - x0 + 1, y1 - y0 + 1, SCR_SINGLE, role(R_WINDOWFRAME), win);
    if (title != NULL) {
        sprintf(text, " %.40s ", title);
        scr_put(x0 + 2, y0, text, accent, win);
    }
    if (right != NULL) {
        sprintf(text, " %.40s ", right);
        scr_put(x1 - 2 - (int)strlen(right) - 1, y0, text, accent, win);
    }
    scr_fill(x1 + 1, y0 + 1, 1, y1 - y0 + 1, ' ', shadow, shadow);
    scr_fill(x0 + 1, y1 + 1, x1 - x0 + 1, 1, ' ', shadow, shadow);
}

void help_detected(char *out, unsigned len, int chip, const char *card)
{
    char text[64];

    if (len == 0) return;
    if (chip == 0) strcpy(text, "none");
    else if (card != NULL && card[0] != '\0') sprintf(text, "OPL%d on a %.40s", chip, card);
    else sprintf(text, "OPL%d at 388h", chip);
    strncpy(out, text, len - 1);
    out[len - 1] = '\0';
}

/* Page 1: the key table, in two columns, and the Detected and Log line. */
static void keys_page(const char *detected, const char *log_path)
{
    int text = role(R_WINDOWTEXT);
    int next[2];
    char clip[DETECTED_W + 1];
    char tail[LOG_W + 1];
    int i;

    next[0] = next[1] = FIRST_ROW;
    for (i = 0; i < HELP_ROW_COUNT; i++) {
        const HelpRow *r = &HELP_ROWS[i];
        int x = r->col ? RIGHT_X : KEYS_X;
        int y = next[r->col ? 1 : 0]++;

        if (r->kind == HR_HEADING) {
            scr_put(x, y, r->keys, role(R_WINDOWACCENT), SCR_KEEP);
        } else {
            scr_put(x, y, r->keys, text, SCR_KEEP);
            scr_put(x + TEXT_DX, y, r->text, text, SCR_KEEP);
        }
    }
    scr_fill(WIN_X0 + 1, RULE_ROW, WIN_X1 - WIN_X0 - 1, 1, H_LINE, role(R_WINDOWFRAME), SCR_KEEP);

    sprintf(clip, "%.*s", DETECTED_W, detected);
    scr_put(KEYS_X, DETECTED_ROW, "Detected", text, SCR_KEEP);
    scr_put(13, DETECTED_ROW, clip, text, SCR_KEEP);
    if (strlen(log_path) > LOG_W) sprintf(tail, "...%s", log_path + strlen(log_path) - (LOG_W - 3));
    else strcpy(tail, log_path);
    scr_put(49, DETECTED_ROW, "Log", text, SCR_KEEP);
    scr_put(53, DETECTED_ROW, tail, text, SCR_KEEP);
}

/* Page 2: what each control means, then the pills' legend and the note on levels. */
static void meaning_page(void)
{
    int text = role(R_WINDOWTEXT);
    int y = FIRST_ROW;
    int x;
    int i;

    for (i = 0; i < (int)(sizeof HELP2 / sizeof HELP2[0]); i++) {
        scr_put(KEYS_X, y, HELP2[i].label, text, SCR_KEEP);
        scr_put(26, y++, HELP2[i].line1, text, SCR_KEEP);
        if (HELP2[i].line2 != NULL) scr_put(26, y++, HELP2[i].line2, text, SCR_KEEP);
    }
    x = pill_draw(KEYS_X, RULE_ROW, "2", role(R_CARRIER));
    scr_put(x + 1, RULE_ROW, "carrier: you hear it", text, SCR_KEEP);
    x += 1 + 20 + 4;
    x = pill_draw(x, RULE_ROW, "1", role(R_MODULATOR));
    scr_put(x + 1, RULE_ROW, "modulator: shapes a carrier's tone", text, SCR_KEEP);
    scr_put(KEYS_X, DETECTED_ROW, "Sustain Level and Output Level: bigger means louder.", text, SCR_KEEP);
}

void help_draw(int page, const char *detected, const char *log_path)
{
    dim_under();
    window_draw(WIN_X0, WIN_Y0, WIN_X1, WIN_Y1, page == 1 ? "Help \xFA" " Keys" : "Help \xFA" " What the controls mean",
                page == 1 ? "1 of 2" : "2 of 2");
    scr_put(30, WIN_Y1, " \x11 \x10 page   F1 or Esc closes ", role(R_WINDOWACCENT), role(R_WINDOW));
    if (page == 1) keys_page(detected, log_path);
    else meaning_page();
}

int help_hit(int x, int y)
{
    return x >= WIN_X0 && x <= WIN_X1 && y >= WIN_Y0 && y <= WIN_Y1;
}
