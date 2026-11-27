/* SPDX-License-Identifier: MIT */
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include "dos.h"
#include "patch.h"

#define EOL "\r\n"
#define NUMBER_CAP 999   /* a longer or larger number is over every range anyway */

const unsigned char P_MAX[P_COUNT] = { 15, 15, 15, 15, 63, 3, 15, 7, 1, 1, 1, 1 };

static const char *const field_name[P_COUNT] = {
    "AR", "DR", "SL", "RR", "OL", "KSL", "MULT", "WAVE", "TREM", "VIB", "SUS", "KSR"
};
static const char *const conn_2op[] = { "FM", "AM" };
static const char *const conn_4op[] = { "FM-FM", "AM-FM", "FM-AM", "AM-AM" };
static const char *const section_word[] = { NULL, "PATCH", "2OP", "4OP" };
/* Indexed by the bit position of the voice-key flags below. */
static const char *const voice_key_name[] = { "CONNECTION", "FEEDBACK", "OP1", "OP2", "OP3", "OP4" };

enum { SEC_NONE, SEC_PATCH, SEC_2OP, SEC_4OP, SEC_OTHER };
enum { HAS_CONN = 1, HAS_FB = 2, HAS_OP1 = 4 };   /* HAS_OP1 << n is OP(n+1) */
enum { HAS_FORMAT = 1, HAS_OCTAVE = 2 };

static char io[PATCH_FILE_MAX + 1];

static int fail(char *err, unsigned errlen, int line, const char *fmt, ...)
{
    char msg[80];
    va_list args;
    int at = 0;

    if (err == NULL || errlen == 0) return -1;
    if (line > 0) at = sprintf(msg, "line %d: ", line);
    va_start(args, fmt);
    vsnprintf(msg + at, sizeof msg - at, fmt, args);
    va_end(args);
    strncpy(err, msg, errlen - 1);
    err[errlen - 1] = '\0';
    return -1;
}

static int is_blank(char c)
{
    return c == ' ' || c == '\t' || c == '\r';
}

static char upper(char c)
{
    return (c >= 'a' && c <= 'z') ? (char)(c - 'a' + 'A') : c;
}

/* Trims spaces, tabs and CRs from both ends of the span [*s, *e). */
static void trim(const char **s, const char **e)
{
    while (*s < *e && is_blank(**s)) (*s)++;
    while (*e > *s && is_blank((*e)[-1])) (*e)--;
}

static int span_is(const char *s, const char *e, const char *word)
{
    while (s < e && *word != '\0') {
        if (upper(*s) != *word) return 0;
        s++;
        word++;
    }
    return s == e && *word == '\0';
}

/* A decimal number: digits only, capped at NUMBER_CAP. Returns -1 for an empty span or any other character. */
static int number(const char *s, const char *e)
{
    int v = 0;

    if (s == e) return -1;
    for (; s < e; s++) {
        if (*s < '0' || *s > '9') return -1;
        v = v * 10 + (*s - '0');
        if (v > NUMBER_CAP) v = NUMBER_CAP;
    }
    return v;
}

/* A number from 0 to `max`; on failure returns -1 with the reason in `err`. */
static int bounded(const char *s, const char *e, const char *what, int max, int line, char *err, unsigned errlen)
{
    int v = number(s, e);

    if (v < 0) return fail(err, errlen, line, "%s is not a number", what);
    if (v > max) return fail(err, errlen, line, "%s %d is over %d", what, v, max);
    return v;
}

/* The 12 numbers of an OPn line. Returns 0 or -1. */
static int parse_op(const char *s, const char *e, const char *key, Op *op, int line, char *err, unsigned errlen)
{
    const char *tok[P_COUNT];
    const char *end[P_COUNT];
    int count = 0;
    int i;

    for (;;) {
        while (s < e && is_blank(*s)) s++;
        if (s == e) break;
        if (count < P_COUNT) tok[count] = s;
        while (s < e && !is_blank(*s)) s++;
        if (count < P_COUNT) end[count] = s;
        count++;
    }
    if (count != P_COUNT) return fail(err, errlen, line, "%s has %d numbers, needs %d", key, count, P_COUNT);
    for (i = 0; i < P_COUNT; i++) {
        int v = bounded(tok[i], end[i], field_name[i], P_MAX[i], line, err, errlen);

        if (v < 0) return -1;
        op->v[i] = (unsigned char)v;
    }
    return 0;
}

static int find_word(const char *s, const char *e, const char *const *words, int count)
{
    int i;

    for (i = 0; i < count; i++) {
        if (span_is(s, e, words[i])) return i;
    }
    return -1;
}

/* Applies one KEY=VALUE line of [2OP] or [4OP]; `seen` collects the keys given so far. Unknown keys are skipped. */
static int voice_key(Voice *v, int four, unsigned *seen, const char *k, const char *ke, const char *s, const char *e,
                     int line, char *err, unsigned errlen)
{
    int ops = four ? 4 : 2;
    int n;
    unsigned bit;

    if (span_is(k, ke, "CONNECTION")) {
        bit = HAS_CONN;
        if (*seen & bit) return fail(err, errlen, line, "CONNECTION is given twice");
        n = four ? find_word(s, e, conn_4op, 4) : find_word(s, e, conn_2op, 2);
        if (n < 0) {
            return fail(err, errlen, line, four ? "CONNECTION must be FM-FM, AM-FM, FM-AM or AM-AM"
                                                 : "CONNECTION must be FM or AM");
        }
        v->conn = (unsigned char)n;
    } else if (span_is(k, ke, "FEEDBACK")) {
        bit = HAS_FB;
        if (*seen & bit) return fail(err, errlen, line, "FEEDBACK is given twice");
        n = bounded(s, e, "FEEDBACK", 7, line, err, errlen);
        if (n < 0) return -1;
        v->fb = (unsigned char)n;
    } else if (ke - k == 3 && upper(k[0]) == 'O' && upper(k[1]) == 'P' && k[2] >= '1' && k[2] <= '0' + ops) {
        n = k[2] - '1';
        bit = (unsigned)HAS_OP1 << n;
        if (*seen & bit) return fail(err, errlen, line, "OP%d is given twice", n + 1);
        if (parse_op(s, e, voice_key_name[2 + n], &v->op[n], line, err, errlen) < 0) return -1;
    } else {
        return 0;
    }
    *seen |= bit;
    return 0;
}

static int voice_complete(unsigned seen, int ops, const char *where, char *err, unsigned errlen)
{
    int i;

    for (i = 0; i < 2 + ops; i++) {
        if (!(seen & (1u << i))) return fail(err, errlen, 0, "%s has no %s", where, voice_key_name[i]);
    }
    return 0;
}

int patch_parse(const char *text, unsigned len, Patch *out, char *err, unsigned errlen)
{
    Patch p;
    unsigned pos = 0;
    int line = 0;
    int sec = SEC_NONE;
    int section_seen[4] = { 0, 0, 0, 0 };
    unsigned seen2 = 0;
    unsigned seen4 = 0;
    unsigned seen_patch = 0;

    if (len > PATCH_FILE_MAX) return fail(err, errlen, 0, "file is over %d bytes", PATCH_FILE_MAX);
    memset(&p, 0, sizeof p);
    p.octave = 4;

    while (pos < len) {
        const char *s = text + pos;
        const char *e;
        const char *eq;
        const char *k;
        const char *ke;
        const char *vs;

        while (pos < len && text[pos] != '\n') pos++;
        e = text + pos;
        pos++;
        line++;
        trim(&s, &e);
        if (s == e || *s == ';') continue;

        if (*s == '[') {
            int which;

            if (e[-1] != ']') return fail(err, errlen, line, "bad section header");
            s++;
            e--;
            trim(&s, &e);
            sec = SEC_OTHER;
            for (which = SEC_PATCH; which <= SEC_4OP; which++) {
                if (span_is(s, e, section_word[which])) sec = which;
            }
            if (sec != SEC_OTHER) {
                if (section_seen[sec]) return fail(err, errlen, line, "[%s] is given twice", section_word[sec]);
                section_seen[sec] = 1;
            }
            continue;
        }

        for (eq = s; eq < e && *eq != '='; eq++) {}
        if (eq == e || sec == SEC_NONE || sec == SEC_OTHER) continue;
        k = s;
        ke = eq;
        vs = eq + 1;
        trim(&k, &ke);
        trim(&vs, &e);

        if (sec == SEC_PATCH) {
            int n;

            if (span_is(k, ke, "FORMAT")) {
                if (seen_patch & HAS_FORMAT) return fail(err, errlen, line, "FORMAT is given twice");
                n = number(vs, e);
                if (n != 1) {
                    return n < 0 ? fail(err, errlen, line, "FORMAT is not a number")
                                 : fail(err, errlen, line, "FORMAT %d is not supported", n);
                }
                seen_patch |= HAS_FORMAT;
            } else if (span_is(k, ke, "OCTAVE")) {
                if (seen_patch & HAS_OCTAVE) return fail(err, errlen, line, "OCTAVE is given twice");
                n = bounded(vs, e, "OCTAVE", 7, line, err, errlen);
                if (n < 0) return -1;
                p.octave = (unsigned char)n;
                seen_patch |= HAS_OCTAVE;
            }
        } else if (sec == SEC_2OP) {
            if (voice_key(&p.v2, 0, &seen2, k, ke, vs, e, line, err, errlen) < 0) return -1;
        } else if (voice_key(&p.v4, 1, &seen4, k, ke, vs, e, line, err, errlen) < 0) {
            return -1;
        }
    }

    if (!section_seen[SEC_PATCH]) return fail(err, errlen, 0, "no [PATCH] section");
    if (!(seen_patch & HAS_FORMAT)) return fail(err, errlen, 0, "[PATCH] has no FORMAT");
    if (!section_seen[SEC_2OP]) return fail(err, errlen, 0, "no [2OP] section");
    if (voice_complete(seen2, 2, "[2OP]", err, errlen) < 0) return -1;
    if (section_seen[SEC_4OP]) {
        if (voice_complete(seen4, 4, "[4OP]", err, errlen) < 0) return -1;
        p.has4 = 1;
    }
    *out = p;
    return 0;
}

/* Appends to buf. Once something does not fit, `*pos` is pinned at `buflen` and every later call is a no-op. */
static void put(char *buf, unsigned buflen, unsigned *pos, const char *s)
{
    unsigned n = (unsigned)strlen(s);

    if (*pos + n >= buflen) {
        *pos = buflen;
        return;
    }
    memcpy(buf + *pos, s, n + 1);
    *pos += n;
}

static void put_voice(char *buf, unsigned buflen, unsigned *pos, const Voice *v, int four)
{
    char line[64];
    int ops = four ? 4 : 2;
    int i;
    int j;

    put(buf, buflen, pos, four ? "; CONNECTION: FM-FM, AM-FM, FM-AM or AM-AM. FEEDBACK 0..7." EOL
                               : "; CONNECTION: FM or AM. FEEDBACK 0..7." EOL);
    sprintf(line, "CONNECTION=%s" EOL "FEEDBACK=%d" EOL, four ? conn_4op[v->conn & 3] : conn_2op[v->conn & 1], v->fb);
    put(buf, buflen, pos, line);
    for (i = 0; i < ops; i++) {
        int at = sprintf(line, "OP%d=", i + 1);

        for (j = 0; j < P_COUNT; j++) at += sprintf(line + at, j == 0 ? "%d" : " %d", v->op[i].v[j]);
        strcpy(line + at, EOL);
        put(buf, buflen, pos, line);
    }
}

int patch_format(const Patch *p, char *buf, unsigned buflen)
{
    char line[48];
    unsigned pos = 0;

    if (buflen == 0) return -1;
    buf[0] = '\0';
    put(buf, buflen, &pos, "; ReBeep patch. Edit it in ReBeep Studio or by hand." EOL
                           "; OPn= AR DR SL RR OL KSL MULT WAVE TREM VIB SUS KSR, decimal, 1 space apart." EOL
                           "; SL and OL: bigger is louder. OCTAVE 4 is the game's pitch." EOL
                           "[PATCH]" EOL "FORMAT=1" EOL);
    sprintf(line, "OCTAVE=%d" EOL EOL "[2OP]" EOL, p->octave);
    put(buf, buflen, &pos, line);
    put_voice(buf, buflen, &pos, &p->v2, 0);
    if (p->has4) {
        put(buf, buflen, &pos, EOL "[4OP]" EOL);
        put_voice(buf, buflen, &pos, &p->v4, 1);
    }
    return pos >= buflen ? -1 : (int)pos;
}

int patch_read(const char *path, Patch *out, char *err, unsigned errlen)
{
    Patch p;
    char reason[80];
    const char *base = path;
    const char *c;
    long n;
    int i;

    for (c = path; *c != '\0'; c++) {
        if (*c == '\\' || *c == ':') base = c + 1;
    }
    n = dos_read_file(path, io, sizeof io);
    if (n < 0) return fail(err, errlen, 0, "%.12s cannot be read", base);
    if (patch_parse(io, (unsigned)n, &p, reason, sizeof reason) < 0) {
        if (err != NULL && errlen > 0) {
            snprintf(err, errlen, strncmp(reason, "line ", 5) == 0 ? "%.12s %s" : "%.12s: %s", base, reason);
        }
        return -1;
    }
    for (i = 0; i < 8 && base[i] != '\0' && base[i] != '.'; i++) p.name[i] = upper(base[i]);
    p.name[i] = '\0';
    *out = p;
    return 0;
}

int patch_write(const char *path, const Patch *p)
{
    char dir[80];
    size_t cut = 0;
    size_t i;
    int n;

    for (i = 0; path[i] != '\0'; i++) {
        if (path[i] == '\\') cut = i;
    }
    if (cut > 0 && cut < sizeof dir && path[cut - 1] != ':') {
        memcpy(dir, path, cut);
        dir[cut] = '\0';
        if (dos_make_dir(dir) < 0) return -1;
    }
    n = patch_format(p, io, sizeof io);
    return n < 0 ? -1 : dos_save_file(path, io, (unsigned)n);
}

int patch_equal(const Patch *a, const Patch *b)
{
    if (a->octave != b->octave || a->has4 != b->has4) return 0;
    if (memcmp(&a->v2, &b->v2, sizeof a->v2) != 0) return 0;
    return !a->has4 || memcmp(&a->v4, &b->v4, sizeof a->v4) == 0;
}

unsigned patch_carriers(const Voice *v, int n)
{
    static const unsigned char carriers_4[4] = { 0x08, 0x09, 0x0A, 0x0D };
    static const unsigned char carriers_2[2] = { 0x02, 0x03 };

    return n == 4 ? carriers_4[v->conn & 3] : carriers_2[v->conn & 1];
}
