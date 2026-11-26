/* ReBeep Studio: the patch model and its text file (RBP). The values are the editor's, never registers.
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_PATCH_H
#define RBSTUDIO_PATCH_H

/* The order of an operator's values, and of the 12 numbers on an OPn line. SL and OL are stored so that bigger
   means louder. */
enum { P_AR, P_DR, P_SL, P_RR, P_OL, P_KSL, P_MULT, P_WAVE, P_TREM, P_VIB, P_SUS, P_KSR, P_COUNT };

typedef struct { unsigned char v[P_COUNT]; } Op;

/* conn: 2-OP 0 = FM, 1 = AM; 4-OP 0 = FM-FM, 1 = AM-FM, 2 = FM-AM, 3 = AM-AM, so a 4-OP voice's CNT1 = conn & 1 and
   CNT2 = conn >> 1. A 2-OP voice uses op[0..1]. */
typedef struct { unsigned char conn, fb; Op op[4]; } Voice;

typedef struct {
    char name[9];          /* the file name without its extension, up to 8 chars */
    unsigned char octave;  /* 0..7, 4 = the game's pitch */
    Voice v2;              /* always present */
    unsigned char has4;    /* 1 when v4 is valid */
    Voice v4;
} Patch;

#define PATCH_FILE_MAX 2048   /* the largest patch file, in bytes */

/* The largest value of each Op field: 15,15,15,15,63,3,15,7,1,1,1,1. */
extern const unsigned char P_MAX[P_COUNT];

/* Parses a patch file's text. Returns 0, or -1 with a short reason in `err` ("line 7: OL 64 is over 63"). `out->name`
   is left empty. The rules are those of the NASM parser in the game; keep the two identical. */
int patch_parse(const char *text, unsigned len, Patch *out, char *err, unsigned errlen);

/* Writes the file text, CRLF line ends and comment lines included. Returns the bytes written, or -1 when `buflen`
   is too small (PATCH_FILE_MAX + 1 always fits). */
int patch_format(const Patch *p, char *buf, unsigned buflen);

/* Reads and parses `path`, naming the patch after the file. On failure `err` reads "BRASS.RBP line 7: OL 64 is
   over 63". Returns 0 or -1. */
int patch_read(const char *path, Patch *out, char *err, unsigned errlen);

/* Writes `p` to `path` with the safe save of dos_save_file, creating the folder first. Returns 0 or -1. */
int patch_write(const char *path, const Patch *p);

/* 1 when the two patches hold the same values; the name is ignored. */
int patch_equal(const Patch *a, const Patch *b);

/* The operators you hear in `v`'s connection, one bit an operator (bit k is operator k), for a voice of `n` operators
   (2 or 4). */
unsigned patch_carriers(const Voice *v, int n);

#endif
