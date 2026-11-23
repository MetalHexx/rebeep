/* ReBeep Studio: RBSTUDIO.CFG, the settings file beside the program. Read only for now: the player edits it.
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_SETTINGS_H
#define RBSTUDIO_SETTINGS_H

#define CFG_MAX_KEYS 16
#define CFG_KEY_LEN 16
#define CFG_VALUE_LEN 80   /* a longer value is cut, which leaves it over every limit that matters */

typedef struct {
    int count;
    int present;   /* 1 when the file existed */
    char key[CFG_MAX_KEYS][CFG_KEY_LEN + 1];   /* upper case */
    char value[CFG_MAX_KEYS][CFG_VALUE_LEN];
} Settings;

/* Reads `path`. Lines are KEY=VALUE (key case-insensitive, spaces and tabs around key and value trimmed) or `;`
   comments; other lines are ignored, and the first occurrence of a key counts. A missing file is not an error: it
   leaves `s` empty and returns 0. Returns -1 only when the file exists but cannot be read. */
int cfg_load(Settings *s, const char *path);

/* The value of `key` (any case: "PATCHES", "PATCH"), or NULL when absent. */
const char *cfg_get(const Settings *s, const char *key);

#endif
