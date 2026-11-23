/* The synth screen: one grid for both variants. Four 4-OP slots of 13 cells and a rule, from column 24; a 2-OP slot is
   two of them, so operator 1 starts at column 24 in both and the bars end one cell before each slot's rule.
   SPDX-License-Identifier: MIT */
#include <stdio.h>
#include <string.h>

#include "roles.h"
#include "screens.h"
#include "video.h"

#define L0 23        /* the column of the first operator rule */
#define ROW_HEAD 5   /* the operator headers' rule; parameter rows follow it */
#define ROW_BAND 18  /* the rule that closes the table, over the waveform and envelope band */
#define WAVE_W 20
#define ENV_W 55
#define BAND_ROWS 4
#define BAND_PIXELS (BAND_ROWS * 2)
#define KB_X 3
#define HELD_W 11    /* the cells that name held notes */

#define H_LINE "\xC4"

static const char *const PARAM_NAME[P_COUNT] = {
    "Attack Rate", "Decay Rate", "Sustain Level", "Release Rate", "Output Level", "Key Scale Level",
    "Frequency Multiplier", "Waveform", "Tremolo", "Vibrato", "Sustained", "Key Scale Rate"
};
static const char *const MODE_4[4] = {"FM-FM", "AM-FM", "FM-AM", "AM-AM"};
static const char *const MODE_2[2] = {"FM", "AM"};
static const char *const DESC_4[4] = {
    "One chain: 1 > 2 > 3 > 4", "1 alone, chain 2 > 3 > 4", "Two pairs: 1 > 2, 3 > 4", "1 alone, 2 > 3, 4 alone"
};
static const char *const DESC_2[2] = {"1 shapes the tone of 2", "1 and 2 side by side"};

/* The operators you hear for each connection, one bit an operator. */
static const unsigned char CARRIERS_4[4] = {0x08, 0x09, 0x0A, 0x0D};
static const unsigned char CARRIERS_2[2] = {0x02, 0x03};

static const char *const MULT_TEXT[16] = {
    "\xAB", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "10", "12", "12", "15", "15"
};
static const char *const WAVE_NAME[8] = {
    "Sine", "Half-sine", "Abs-sine", "Pulse-sine", "Even-sine", "Even-abs-sine", "Square", "Derived-square"
};
static const char *const KSL_TEXT[4] = {"0", "1.5", "3", "6"};
static const char *const NOTE_NAME[12] = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};

/* Each waveform's one period at WAVE_W points, as the height in pixels above the middle (-3 to 3). */
static const signed char WAVE_PIXELS[8][WAVE_W] = {
    { 0, 1, 2, 3, 3, 3, 3, 2, 1, 0, 0,-1,-2,-3,-3,-3,-3,-2,-1, 0},
    { 0, 1, 2, 3, 3, 3, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
    { 0, 1, 2, 3, 3, 3, 3, 2, 1, 0, 0, 1, 2, 3, 3, 3, 3, 2, 1, 0},
    { 0, 1, 2, 3, 3, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 0, 0, 0, 0, 0},
    { 1, 2, 3, 2, 1,-1,-2,-3,-2,-1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
    { 1, 2, 3, 2, 1, 1, 2, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
    { 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,-3,-3,-3,-3,-3,-3,-3,-3,-3,-3},
    { 3, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,-1,-1,-1,-1,-2,-3}
};

static const Voice *voice_of(const Editor *e)
{
    return e->n == 4 ? &e->p.v4 : &e->p.v2;
}

static int is_carrier(const Editor *e, int k)
{
    int conn = voice_of(e)->conn;
    unsigned mask = e->n == 4 ? CARRIERS_4[conn & 3] : CARRIERS_2[conn & 1];

    return (mask >> k) & 1;
}

/* An operator's rim colour: the ones you hear stand out. */
static int rim_colour(const Editor *e, int k)
{
    return role(is_carrier(e, k) ? R_CARRIER : R_MODULATOR);
}

/* An operator's body colour (half steps, envelope fill). */
static int body_colour(const Editor *e, int k)
{
    return role(is_carrier(e, k) ? R_BODY : R_SHADOW);
}

/* A pill: an operator's number on a coloured ground between half blocks. Returns the column after it. */
static int pill(int x, int y, const char *label, int col)
{
    int len = (int)strlen(label);

    scr_put(x, y, "\xDE", col, SCR_KEEP);
    scr_put(x + 1, y, label, role(R_GROUND), col);
    scr_put(x + 1 + len, y, "\xDD", col, SCR_KEEP);
    return x + 2 + len;
}

/* A bar of `cells` cells in half steps: lower half blocks, the odd step in `half`, an underscore track. */
static void hbar(int x, int y, int halves, int cells, int col, int half)
{
    int i;

    for (i = 0; i < cells; i++) {
        int n = halves - 2 * i;

        if (n >= 2) scr_put(x + i, y, "\xDC", col, SCR_KEEP);
        else if (n == 1) scr_put(x + i, y, "\xDC", half, SCR_KEEP);
        else scr_put(x + i, y, "_", role(R_DIM), SCR_KEEP);
    }
}

static void pill_n(const Editor *e, int x, int y, int k)
{
    char label[2];

    label[0] = (char)('1' + k);
    label[1] = '\0';
    pill(x, y, label, rim_colour(e, k));
}

/* `n` line cells, then the glyph `end` when it is not 0. */
static void rule(int x, int y, int n, char end)
{
    int i;

    for (i = 0; i < n; i++) scr_put(x + i, y, H_LINE, role(R_TEXT), SCR_KEEP);
    if (end != 0) {
        char s[2];

        s[0] = end;
        s[1] = '\0';
        scr_put(x + n, y, s, role(R_TEXT), SCR_KEEP);
    }
}

static void conn_out(int x, int y)
{
    scr_put(x + 16, y, H_LINE, role(R_TEXT), SCR_KEEP);
    scr_put(x + 17, y, "\x10", role(R_VALUE), SCR_KEEP);
}

/* The routing graphic, up to three rows from (x, y): the current connection only. */
static void conn_draw(const Editor *e, int x, int y)
{
    int m = voice_of(e)->conn;

    if (e->n == 4) {
        if (m == 0) {
            pill_n(e, x, y + 1, 0); rule(x + 3, y + 1, 1, 0);
            pill_n(e, x + 4, y + 1, 1); rule(x + 7, y + 1, 1, 0);
            pill_n(e, x + 8, y + 1, 2); rule(x + 11, y + 1, 1, 0);
            pill_n(e, x + 12, y + 1, 3); rule(x + 15, y + 1, 1, 0);
            conn_out(x, y + 1);
        } else if (m == 1) {
            pill_n(e, x, y, 0); rule(x + 3, y, 12, '\xBF');
            pill_n(e, x, y + 1, 1); rule(x + 3, y + 1, 1, 0);
            pill_n(e, x + 4, y + 1, 2); rule(x + 7, y + 1, 1, 0);
            pill_n(e, x + 8, y + 1, 3); rule(x + 11, y + 1, 4, '\xC1');
            conn_out(x, y + 1);
        } else if (m == 2) {
            pill_n(e, x, y, 0); rule(x + 3, y, 1, 0);
            pill_n(e, x + 4, y, 1); rule(x + 7, y, 8, '\xBF');
            pill_n(e, x, y + 1, 2); rule(x + 3, y + 1, 1, 0);
            pill_n(e, x + 4, y + 1, 3); rule(x + 7, y + 1, 8, '\xC1');
            conn_out(x, y + 1);
        } else {
            pill_n(e, x, y, 0); rule(x + 3, y, 12, '\xBF');
            pill_n(e, x, y + 1, 1); rule(x + 3, y + 1, 1, 0);
            pill_n(e, x + 4, y + 1, 2); rule(x + 7, y + 1, 8, '\xC5');
            conn_out(x, y + 1);
            pill_n(e, x, y + 2, 3); rule(x + 3, y + 2, 12, '\xD9');
        }
    } else if (m == 0) {
        pill_n(e, x, y + 1, 0); rule(x + 3, y + 1, 1, 0);
        pill_n(e, x + 4, y + 1, 1); rule(x + 7, y + 1, 9, 0);
        conn_out(x, y + 1);
    } else {
        pill_n(e, x, y, 0); rule(x + 3, y, 12, '\xBF');
        pill_n(e, x, y + 1, 1); rule(x + 3, y + 1, 12, '\xC1');
        conn_out(x, y + 1);
    }
}

/* The feedback loop over operator 1. */
static void fb_draw(const Editor *e, int x, int y)
{
    scr_put(x, y, "\xDA\xC4\x11\xC4\xBF", role(R_TEXT), SCR_KEEP);
    scr_put(x, y + 1, "\xC0", role(R_TEXT), SCR_KEEP);
    pill_n(e, x + 1, y + 1, 0);
    scr_put(x + 4, y + 1, "\xD9", role(R_TEXT), SCR_KEEP);
}

/* A focusable value: right-aligned in three cells, on the focus bar when focused. `colour` is the role of the text
   when it is not focused, or -1 for the value role. */
static void value_text(int x, int y, const char *t, int focused, int colour)
{
    char buf[8];

    sprintf(buf, "%3s", t);
    scr_put(x, y, buf, focused ? role(R_FOCUSTEXT) : role(colour < 0 ? R_VALUE : (Role)colour),
            focused ? role(R_FOCUS) : SCR_KEEP);
    if (focused) scr_put(x + 3, y, " ", SCR_KEEP, role(R_FOCUS));
}

static void top_bar(const Editor *e)
{
    int name_focus = e->fk == F_NAME;
    int variant_focus = e->fk == F_VARIANT;
    int octave_focus = e->fk == F_OCTAVE;
    char name[25];
    char pos[24];
    char oct[4];
    int len = (int)strlen(e->p.name);
    int free_cells;
    int x;
    int total;

    memset(name, ' ', 24);
    name[24] = '\0';
    memcpy(name, e->p.name, len > 24 ? 24 : (unsigned)len);
    scr_put(1, 0, name, role(name_focus ? R_FOCUSTEXT : R_VALUE), role(name_focus ? R_FOCUS : R_DIM));
    if (name_focus && len < 24) scr_put(1 + len, 0, "_", role(R_FOCUSTEXT), SCR_KEEP);
    scr_put(25, 0, e->dirty ? "*" : " ", role(R_WARNING), SCR_KEEP);

    /* Previous and next patch, Variant and Octave share columns 27 to 78: the first at the left, the other two with
       the free cells split between the gaps before them. */
    sprintf(pos, "%d of %d", e->pos, e->total);
    sprintf(oct, "%d", e->p.octave);
    total = (16 + (int)strlen(pos)) + 12 + (7 + (int)strlen(oct));
    free_cells = 78 - 27 + 1 - total;

    x = 27;
    scr_put(x, 0, "\x11", role(R_ACCENT), SCR_KEEP);
    scr_put(x + 1, 0, " PgUp  ", role(R_TEXT), SCR_KEEP);
    scr_put(x + 8, 0, pos, role(R_TEXT), SCR_KEEP);
    x += 8 + (int)strlen(pos);
    scr_put(x, 0, "  PgDn ", role(R_TEXT), SCR_KEEP);
    scr_put(x + 7, 0, "\x10", role(R_ACCENT), SCR_KEEP);
    x += 8;

    x += (free_cells + 1) / 2;
    scr_put(x, 0, "Variant ", role(R_TEXT), SCR_KEEP);
    scr_put(x + 8, 0, e->n == 4 ? "4-OP" : "2-OP", role(variant_focus ? R_FOCUSTEXT : R_VALUE),
            variant_focus ? role(R_FOCUS) : SCR_KEEP);
    x += 12;

    x += free_cells / 2;
    scr_put(x, 0, "Octave ", role(R_TEXT), SCR_KEEP);
    scr_put(x + 7, 0, oct, role(octave_focus ? R_FOCUSTEXT : R_VALUE), octave_focus ? role(R_FOCUS) : SCR_KEEP);
}

static int is_held(const Editor *e, int key)
{
    int j;

    for (j = 0; j < e->nheld; j++) {
        if (e->held[j] == key) return 1;
    }
    return 0;
}

/* The held notes in HELD_W cells, whole names only; what does not fit is counted as +n. */
static void held_text(const Editor *e, char *out)
{
    int left = e->nheld;
    int j;

    out[0] = '\0';
    for (j = 0; j < e->nheld; j++) {
        char name[10];
        int more = left - 1 > 0 ? 2 : 0;

        sprintf(name, "%s%s%d", out[0] != '\0' ? " " : "", NOTE_NAME[e->held[j] % 12], e->kbOct + e->held[j] / 12);
        if ((int)(strlen(out) + strlen(name)) + more > HELD_W) break;
        strcat(out, name);
        left--;
    }
    if (left > 0) sprintf(out + strlen(out), "+%d", left);
}

static void bottom_bar(const Editor *e)
{
    int y = 24;
    int i;
    int warn = e->chip == 2 && e->n == 4;
    char held[24];
    char msg[27];

    scr_put(1, y, "\x0E", role(R_ACCENT), SCR_KEEP);
    for (i = 0; i < ED_KEYS; i++) {
        int pc = i % 12;
        int lit = is_held(e, i);

        if (pc == 1 || pc == 3 || pc == 6 || pc == 8 || pc == 10) {
            scr_put(KB_X + i, y, "\xDF", role(lit ? R_LIT : R_GROUND), role(R_KEYS));
        } else if ((pc == 4 || pc == 11) && i < ED_KEYS - 1) {
            scr_put(KB_X + i, y, "\xDD", role(lit ? R_LIT : R_KEYS), role(R_GROUND));
        } else {
            scr_put(KB_X + i, y, " ", role(R_KEYS), role(lit ? R_LIT : R_KEYS));
        }
    }
    held_text(e, held);
    scr_put(33, y, held, role(R_LIT), SCR_KEEP);

    strncpy(msg, warn ? "Cannot play 4-OP on OPL2" : e->msg, sizeof msg - 1);
    msg[sizeof msg - 1] = '\0';
    scr_put(45, y, msg, role(warn ? R_WARNING : (Role)e->msgRole), SCR_KEEP);
    scr_put(72, y, "F1", role(R_ACCENT), SCR_KEEP);
    scr_put(75, y, "Help", role(R_TEXT), SCR_KEEP);
}

/* Connection and Feedback, two titled panels on one rule. */
static void voice_block(const Editor *e)
{
    const Voice *v = voice_of(e);
    int conn_focus = e->fk == F_CONN;
    int fb_focus = e->fk == F_FB;
    const char *mode = e->n == 4 ? MODE_4[v->conn & 3] : MODE_2[v->conn & 1];
    char fb[4];

    scr_fill(0, 1, 80, 1, H_LINE[0], role(R_FRAME), SCR_KEEP);
    scr_put(1, 1, " Connection ", role(conn_focus ? R_ACCENT : R_TEXT), SCR_KEEP);
    conn_draw(e, 2, 2);
    scr_put(25, 2, mode, role(conn_focus ? R_FOCUSTEXT : R_VALUE), conn_focus ? role(R_FOCUS) : SCR_KEEP);
    if (conn_focus) scr_put(25 + (int)strlen(mode), 2, " ", SCR_KEEP, role(R_FOCUS));
    scr_put(25, 3, e->n == 4 ? DESC_4[v->conn & 3] : DESC_2[v->conn & 1], role(R_TEXT), SCR_KEEP);

    scr_put(52, 1, " Feedback ", role(fb_focus ? R_ACCENT : R_TEXT), SCR_KEEP);
    fb_draw(e, 53, 2);
    sprintf(fb, "%2d", v->fb);
    scr_put(60, 3, fb, role(fb_focus ? R_FOCUSTEXT : R_VALUE), fb_focus ? role(R_FOCUS) : SCR_KEEP);
    if (fb_focus) scr_put(62, 3, " ", SCR_KEEP, role(R_FOCUS));
    hbar(63, 3, v->fb * 2, 7, role(R_MODULATOR), role(R_SHADOW));
}

/* The waveform name, cut to `width`; only Derived-square is shortened to fit. */
static void wave_name(int v, int width, char *out)
{
    const char *n = WAVE_NAME[v & 7];

    if ((int)strlen(n) <= width) strcpy(out, n);
    else if (v == 7) strcpy(out, "Derived-sqr");
    else {
        memcpy(out, n, (unsigned)width);
        out[width] = '\0';
    }
}

/* One parameter of operator `k` in its slot. `z` is how many 4-OP slots the operator's slot spans (1 at 4-OP, 2 at
   2-OP): the cell is 13 or 27 wide and the bar 8 or 22 cells, ending one cell before the slot's rule; text stays put. */
static void cell(const Editor *e, int k, int key, int cx, int y, int z)
{
    const Op *op = &voice_of(e)->op[k];
    int v = op->v[key];
    int focused = e->fk == key && e->cur == k;
    int col = rim_colour(e, k);
    int half = body_colour(e, k);
    int width = 14 * z - 1;
    int bar_w = width - 5;
    char buf[32];
    int vmax = P_MAX[key];

    if (key == P_WAVE) {
        int bad = v > (e->chip == 3 ? 7 : 3);
        int len;

        wave_name(v, width, buf);
        len = (int)strlen(buf);
        scr_put(cx, y, buf, role(focused ? R_FOCUSTEXT : bad ? R_WARNING : R_VALUE), focused ? role(R_FOCUS) : SCR_KEEP);
        if (focused && len < width) scr_put(cx + len, y, " ", SCR_KEEP, role(R_FOCUS));
    } else if (key == P_TREM || key == P_VIB || key == P_SUS || key == P_KSR) {
        value_text(cx, y, v ? "On" : "Off", focused, v ? -1 : R_DIM);
        scr_put(cx + 4, y, v ? "\xFE" : "\xF9", v ? col : role(R_DIM), SCR_KEEP);
    } else {
        if (key == P_KSL) strcpy(buf, KSL_TEXT[v & 3]);
        else if (key == P_MULT) sprintf(buf, "x%s", MULT_TEXT[v & 15]);
        else sprintf(buf, "%d", v);
        value_text(cx, y, buf, focused, -1);
        hbar(cx + 4, y, (int)((4L * bar_w * v + vmax) / (2L * vmax)), bar_w, col, half);
    }
}

/* The waveform's outline, one period over WAVE_W cells and BAND_ROWS rows: two pixels a cell, the top as the
   foreground of a half block and the bottom as its background. */
static void draw_wave(int x, int y, int wave, int rim)
{
    static signed char g[BAND_PIXELS][WAVE_W];
    int ys[WAVE_W];
    int i;
    int r;

    memset(g, 0xFF, sizeof g);
    for (i = 0; i < WAVE_W; i++) ys[i] = BAND_PIXELS / 2 - WAVE_PIXELS[wave & 7][i];
    for (i = 0; i < WAVE_W; i++) {
        int yv = ys[i];

        g[yv][i] = (signed char)rim;
        if (i > 0) {
            int p = ys[i - 1];
            int lo = p < yv ? p : yv;
            int hi = p < yv ? yv : p;

            for (r = lo + 1; r < hi; r++) g[r][i] = (signed char)rim;
        }
    }
    for (r = 0; r < BAND_ROWS; r++) {
        for (i = 0; i < WAVE_W; i++) {
            int t = g[2 * r][i];
            int b = g[2 * r + 1][i];

            if (t < 0 && b < 0) scr_put(x + i, y + r, " ", role(R_TEXT), role(R_GROUND));
            else if (t == b) scr_put(x + i, y + r, " ", t, t);
            else if (t < 0) scr_put(x + i, y + r, "\xDC", b, role(R_GROUND));
            else scr_put(x + i, y + r, "\xDF", t, b < 0 ? role(R_GROUND) : b);
        }
    }
}

/* The envelope's height in half cells (0 to 7) at each of ENV_W points on a fixed time scale. The shape is the
   attack curve, then the decay to the sustain level, the hold (Sustained), then the release. Every quantity is a
   whole number over a small common denominator, so the rounding is exact:
     peak       = (OL + 1) / 64, at least 0.1;   sustain fraction = (SL + 1) / 16
     time       = 28 * (2 * point + 1) over 110 of a second step;   attack time = 99 * (15 - AR) over the same
     decay time = (16 - DR) * (15 - SL) / 16;    release time = 16 - RR (0 is never; DR 0 never decays)
   The heights are 7 * peak * level, rounded half up. */
static void env_levels(const Op *op, unsigned char *out)
{
    int ar = op->v[P_AR];
    int dr = op->v[P_DR];
    int sl = op->v[P_SL];
    int rr = op->v[P_RR];
    int ol = op->v[P_OL];
    int sus = op->v[P_SUS];
    unsigned long pn = ol + 1 <= 6 ? 7UL : 7UL * (unsigned)(ol + 1);
    unsigned long pd = ol + 1 <= 6 ? 10UL : 64UL;
    long df = dr == 0 ? 16L : 16L - dr;
    int i;

    for (i = 0; i < ENV_W; i++) {
        long t = 28L * (2 * i + 1);
        long a = 0;
        long b = 1;

        if (ar != 0) {
            long att = 99L * (15 - ar);

            if (t < att) {
                a = t * (2 * att - t);
                b = att * att;
            } else {
                long x = t - att;

                if (sl < 15 && (dr == 0 || 16 * x < 110 * df * (15 - sl))) {
                    if (dr == 0) {
                        a = 1;
                        b = 1;
                    } else {
                        b = 110 * df;
                        a = b - x;
                    }
                } else {
                    long past = 8 * x - 55 * df * (sl < 15 ? 15 - sl : 0) - 7040L * sus;

                    if (past < 0 || rr == 0) {
                        a = sl + 1;
                        b = 16;
                    } else {
                        b = 880L * (16 - rr);
                        a = 55L * (sl + 1) * (16 - rr) - past;
                        if (a < 0) a = 0;
                    }
                }
            }
        }
        out[i] = (unsigned char)((2 * pn * (unsigned long)a + pd * (unsigned long)b) / (2 * pd * (unsigned long)b));
    }
}

/* The envelope: a lit rim over a solid body, two pixels a cell (a half block with the rim as foreground and the body
   as background), one column a point. The top pixel row stays clear. */
static void draw_env(int x, int y, const Op *op, int rim, int body)
{
    unsigned char hs[ENV_W];
    int paint[3];
    int i;

    paint[0] = -1;
    paint[1] = body;
    paint[2] = rim;
    env_levels(op, hs);
    for (i = 0; i < ENV_W; i++) {
        int n = hs[i];
        int low = i > 0 ? hs[i - 1] : 0;
        int next = i < ENV_W - 1 ? hs[i + 1] : n;
        int cls[BAND_PIXELS];
        int p;
        int r;

        if (next < low) low = next;
        for (p = 0; p < BAND_PIXELS; p++) {
            int h = BAND_PIXELS - 1 - p;

            cls[p] = n == 0 ? 0 : h >= n ? 0 : (h == n - 1 || h > low) ? 2 : 1;
        }
        for (r = 0; r < BAND_ROWS; r++) {
            int ct = paint[cls[2 * r]];
            int cb = paint[cls[2 * r + 1]];

            if (ct < 0 && cb < 0) scr_put(x + i, y + r, r == BAND_ROWS - 1 && n == 0 ? "_" : " ", role(R_DIM), role(R_GROUND));
            else if (ct == cb) scr_put(x + i, y + r, " ", ct, ct);
            else if (ct < 0) scr_put(x + i, y + r, "\xDC", cb, role(R_GROUND));
            else scr_put(x + i, y + r, "\xDF", ct, cb < 0 ? role(R_GROUND) : cb);
        }
    }
}

void synth_draw(const Editor *e)
{
    int n = e->n;
    int z = 4 / n;
    int slot = 14 * z;
    int frame = role(R_FRAME);
    int j;
    int k;
    int key;
    int y;

    scr_fill(0, 0, VIDEO_COLS, VIDEO_ROWS, ' ', role(R_TEXT), role(R_GROUND));
    top_bar(e);
    bottom_bar(e);
    voice_block(e);

    scr_fill(0, ROW_HEAD, 80, 1, H_LINE[0], frame, SCR_KEEP);
    scr_fill(0, ROW_BAND, 80, 1, H_LINE[0], frame, SCR_KEEP);
    scr_fill(0, 23, 80, 1, H_LINE[0], frame, SCR_KEEP);
    scr_put(1, ROW_HEAD, " Parameters ", role(R_TEXT), SCR_KEEP);

    /* The closed frame: left and right edges, the Connection|Feedback divider (column 51), the Waveform|Envelope
       divider (column 23); neighbouring panels share a border cell. */
    scr_put(0, 1, "\xDA", frame, SCR_KEEP);
    scr_put(51, 1, "\xC2", frame, SCR_KEEP);
    scr_put(79, 1, "\xBF", frame, SCR_KEEP);
    for (y = 2; y <= 22; y++) {
        if (y != ROW_HEAD && y != ROW_BAND) {
            scr_put(0, y, "\xB3", frame, SCR_KEEP);
            scr_put(79, y, "\xB3", frame, SCR_KEEP);
        }
    }
    for (y = 2; y <= 4; y++) scr_put(51, y, "\xB3", frame, SCR_KEEP);
    for (y = 19; y <= 22; y++) scr_put(L0, y, "\xB3", frame, SCR_KEEP);
    scr_put(0, ROW_HEAD, "\xC3", frame, SCR_KEEP);
    scr_put(0, ROW_BAND, "\xC3", frame, SCR_KEEP);
    scr_put(0, 23, "\xC0", frame, SCR_KEEP);
    scr_put(L0, 23, "\xC1", frame, SCR_KEEP);
    scr_put(79, 23, "\xD9", frame, SCR_KEEP);
    scr_put(79, ROW_HEAD, "\xB4", frame, SCR_KEEP);
    scr_put(79, ROW_BAND, "\xB4", frame, SCR_KEEP);

    /* One rule per operator and the right edge; the selected operator's two are lit. */
    for (j = 0; j <= n; j++) {
        int x = L0 + j * slot;
        int lc = role(j == e->cur || j == e->cur + 1 ? R_LIT : R_FRAME);

        scr_put(x, ROW_HEAD, x == 79 ? "\xB4" : x == 51 ? "\xC5" : "\xC2", lc, SCR_KEEP);
        for (y = ROW_HEAD + 1; y < ROW_BAND; y++) scr_put(x, y, "\xB3", lc, SCR_KEEP);
        scr_put(x, ROW_BAND, x == 79 ? "\xB4" : x == L0 ? "\xC5" : "\xC1", lc, SCR_KEEP);
    }

    for (key = 0; key < P_COUNT; key++) {
        int row = ROW_HEAD + 1 + key;
        int focused = e->fk == key;

        if (focused) scr_put(1, row, "\x10", role(R_ACCENT), SCR_KEEP);
        scr_put(2, row, PARAM_NAME[key], role(focused ? R_VALUE : R_TEXT), SCR_KEEP);
    }
    for (k = 0; k < n; k++) {
        int cx = L0 + k * slot + 1;

        pill_n(e, cx, ROW_HEAD, k);
        scr_put(cx + 4, ROW_HEAD, is_carrier(e, k) ? "CARRIER" : "MODULATOR", role(k == e->cur ? R_VALUE : is_carrier(e, k) ? R_CARRIER : R_MODULATOR), SCR_KEEP);
        for (key = 0; key < P_COUNT; key++) cell(e, k, key, cx, ROW_HEAD + 1 + key, z);
    }

    /* The band: the selected operator's waveform (under the names) and envelope (under the operators). */
    scr_put(1, ROW_BAND, " Waveform ", role(R_TEXT), SCR_KEEP);
    scr_put(24, ROW_BAND, " Envelope ", role(R_TEXT), SCR_KEEP);
    draw_wave(2, ROW_BAND + 1, voice_of(e)->op[e->cur].v[P_WAVE], rim_colour(e, e->cur));
    draw_env(24, ROW_BAND + 1, &voice_of(e)->op[e->cur], rim_colour(e, e->cur), body_colour(e, e->cur));
}
