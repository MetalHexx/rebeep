/* SPDX-License-Identifier: MIT */
#include <ctype.h>
#include <stdio.h>
#include <string.h>

#include "settings.h"

#define LINE_BUF 160

static int is_blank(char c)
{
    return c == ' ' || c == '\t' || c == '\r' || c == '\n';
}

/* Stores one line, if it is a KEY=VALUE whose key is new. */
static void take_line(Settings *s, char *line)
{
    char *eq = strchr(line, '=');
    char *key = line;
    char *key_end;
    char *value;
    char *value_end;
    int i;

    if (eq == NULL) return;
    while (is_blank(*key)) key++;
    if (*key == ';') return;
    key_end = eq;
    while (key_end > key && is_blank(key_end[-1])) key_end--;
    value = eq + 1;
    while (is_blank(*value)) value++;
    value_end = value + strlen(value);
    while (value_end > value && is_blank(value_end[-1])) value_end--;
    if (key_end == key || key_end - key > CFG_KEY_LEN || s->count == CFG_MAX_KEYS) return;

    *key_end = '\0';
    *value_end = '\0';
    for (i = 0; key[i] != '\0'; i++) key[i] = (char)toupper((unsigned char)key[i]);
    for (i = 0; i < s->count; i++) {
        if (strcmp(s->key[i], key) == 0) return;
    }
    strcpy(s->key[s->count], key);
    strncpy(s->value[s->count], value, CFG_VALUE_LEN - 1);
    s->value[s->count][CFG_VALUE_LEN - 1] = '\0';
    s->count++;
}

int cfg_load(Settings *s, const char *path)
{
    char line[LINE_BUF];
    FILE *f;
    int too_long = 0;

    memset(s, 0, sizeof *s);
    f = fopen(path, "rb");
    if (f == NULL) return 0;
    s->present = 1;
    while (fgets(line, sizeof line, f) != NULL) {
        size_t n = strlen(line);
        int ends = n > 0 && line[n - 1] == '\n';

        if (!too_long) take_line(s, line);
        too_long = !ends && n == sizeof line - 1;
    }
    if (ferror(f)) {
        fclose(f);
        return -1;
    }
    fclose(f);
    return 0;
}

const char *cfg_get(const Settings *s, const char *key)
{
    int i;

    for (i = 0; i < s->count; i++) {
        if (stricmp(s->key[i], key) == 0) return s->value[i];
    }
    return NULL;
}
