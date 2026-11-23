/* SPDX-License-Identifier: MIT */
#include <malloc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "dos.h"
#include "library.h"
#include "log.h"
#include "patch.h"

#define PATH_LIMIT 64
#define NAME_LIMIT 8
#define FACTORY_FOLDER "FACTORY"
#define USER_FOLDER "USER"
#define EXT_RBP ".RBP"

typedef struct {
    Library *lib;
    const char *dir;      /* the folder being read, no trailing backslash */
    const char *folder;   /* its name in the list */
    int full_logged;
} FolderScan;

static char pack_names[LIB_MAX_PACKS][13];
static int pack_count;
static int pack_overflow;

static int is_name_char(char c)
{
    return (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
}

int name_valid(const char *name)
{
    size_t i;
    int letter = 0;

    if (name[0] == '\0') return 0;
    for (i = 0; name[i] != '\0'; i++) {
        if (i == NAME_LIMIT || !is_name_char(name[i])) return 0;
        if (name[i] < '0' || name[i] > '9') letter = 1;
    }
    return letter;
}

int folder_valid(const char *folder)
{
    return name_valid(folder);
}

static int is_dos_char(char c)
{
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-' ||
           c == '$' || c == '~' || c == '!';
}

/* One path component: 1..8 name characters, then optionally a dot and 1..3 more. */
static int component_valid(const char *s, size_t len)
{
    size_t i = 0;
    size_t n = 0;

    while (i < len && s[i] != '.') {
        if (!is_dos_char(s[i])) return 0;
        i++;
        n++;
    }
    if (n < 1 || n > 8) return 0;
    if (i == len) return 1;
    i++;
    n = 0;
    for (; i < len; i++, n++) {
        if (!is_dos_char(s[i])) return 0;
    }
    return n >= 1 && n <= 3;
}

int path_valid(const char *path)
{
    size_t len = strlen(path);
    size_t pos = 0;
    int components = 0;

    if (len == 0 || len > PATH_LIMIT) return 0;
    if (len >= 2 && path[1] == ':') {
        if (!((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z'))) return 0;
        pos = 2;
    }
    if (path[pos] == '\\') pos++;
    while (pos < len) {
        size_t end = pos;

        while (end < len && path[end] != '\\') end++;
        if (!component_valid(path + pos, end - pos)) return 0;
        components++;
        pos = end < len ? end + 1 : end;
    }
    return components > 0;
}

/* Appends `s` upper-cased to `out`; returns 0 when it does not fit. */
static int append_upper(char *out, size_t size, const char *s)
{
    size_t at = strlen(out);

    for (; *s != '\0'; s++) {
        if (at + 1 >= size) return 0;
        out[at++] = (*s >= 'a' && *s <= 'z') ? (char)(*s - 'a' + 'A') : *s;
    }
    out[at] = '\0';
    return 1;
}

/* Settles the patches folder into lib->patchdir and logs what it did. */
static void resolve_patchdir(Library *lib, const char *value)
{
    int bad = value != NULL && value[0] != '\0' && !path_valid(value);
    int explicit_dir = value != NULL && value[0] != '\0' && !bad;
    size_t n;

    if (bad) log_line("PATCHES=%.64s ignored: not a plain DOS path; using the default folder", value);
    lib->patchdir[0] = '\0';
    if (explicit_dir) {
        int absolute = value[1] == ':' || value[0] == '\\';

        if (!absolute) append_upper(lib->patchdir, sizeof lib->patchdir, lib->progdir);
        append_upper(lib->patchdir, sizeof lib->patchdir, value);
    } else {
        append_upper(lib->patchdir, sizeof lib->patchdir, lib->progdir);
        append_upper(lib->patchdir, sizeof lib->patchdir, "PATCHES");
    }
    n = strlen(lib->patchdir);
    if (n > 0 && lib->patchdir[n - 1] == '\\') lib->patchdir[n - 1] = '\0';
    if (explicit_dir && !dos_is_dir(lib->patchdir)) {
        lib->patches_missing = 1;
        log_line("PATCHES folder %s does not exist", lib->patchdir);
    }
}

static void add_entry(FolderScan *scan, const Patch *p)
{
    Library *lib = scan->lib;
    Entry e;

    memset(&e, 0, sizeof e);
    strcpy(e.folder, scan->folder);
    strcpy(e.name, p->name);
    e.has4 = p->has4;
    e.octave = p->octave;
    lib->entries[lib->count++] = e;
}

/* One .RBP file of a folder: reads it and lists it, or logs why not. */
static void take_file(const char *file, void *arg)
{
    FolderScan *scan = (FolderScan *)arg;
    char name[13];
    static char path[LIB_DIR_LEN + 14];   /* static: the stack is 2 KB */
    char err[80];
    Patch p;
    const char *dot = strchr(file, '.');
    size_t base = dot != NULL ? (size_t)(dot - file) : strlen(file);

    if (dot == NULL || stricmp(dot, EXT_RBP) != 0 || base > NAME_LIMIT) return;
    memcpy(name, file, base);
    name[base] = '\0';
    if (!name_valid(name)) {
        log_line("%s\\%s skipped: not a valid patch name", scan->folder, file);
        return;
    }
    if (scan->lib->count == LIB_MAX) {
        if (!scan->full_logged) log_line("The patch list is full (%d); the rest are not listed", LIB_MAX);
        scan->full_logged = 1;
        return;
    }
    sprintf(path, "%s\\%s", scan->dir, file);
    if (patch_read(path, &p, err, sizeof err) < 0) {
        log_line("%s\\%s", scan->folder, err);
        return;
    }
    add_entry(scan, &p);
}

static void sort_range(Library *lib, int from)
{
    int i;
    int j;

    for (i = from + 1; i < lib->count; i++) {
        Entry held = lib->entries[i];

        for (j = i - 1; j >= from && _fstrcmp(lib->entries[j].name, held.name) > 0; j--) {
            lib->entries[j + 1] = lib->entries[j];
        }
        lib->entries[j + 1] = held;
    }
}

/* Reads every .RBP in `dir` as folder `folder`; returns the patches listed. */
static int scan_folder(Library *lib, const char *dir, const char *folder)
{
    FolderScan scan;
    static char spec[LIB_DIR_LEN + 8];
    int from = lib->count;

    scan.lib = lib;
    scan.dir = dir;
    scan.folder = folder;
    scan.full_logged = 0;
    sprintf(spec, "%s\\*" EXT_RBP, dir);
    dos_each(spec, 0, take_file, &scan);
    sort_range(lib, from);
    return lib->count - from;
}

static void take_pack(const char *name, void *arg)
{
    (void)arg;
    if (pack_count == LIB_MAX_PACKS) {
        pack_overflow = 1;
        return;
    }
    strncpy(pack_names[pack_count], name, sizeof pack_names[0] - 1);
    pack_names[pack_count][sizeof pack_names[0] - 1] = '\0';
    pack_count++;
}

static void sort_packs(void)
{
    char held[13];
    int i;
    int j;

    for (i = 1; i < pack_count; i++) {
        strcpy(held, pack_names[i]);
        for (j = i - 1; j >= 0 && strcmp(pack_names[j], held) > 0; j--) strcpy(pack_names[j + 1], pack_names[j]);
        strcpy(pack_names[j + 1], held);
    }
}

static void mark_overrides(Library *lib)
{
    int f;
    int u;

    for (u = lib->factory; u < lib->factory + lib->user; u++) {
        for (f = 0; f < lib->factory; f++) {
            if (_fstrcmp(lib->entries[u].name, lib->entries[f].name) == 0) lib->entries[u].overrides = 1;
        }
    }
}

int lib_scan(Library *lib, const char *progdir, const char *patchdir)
{
    static char dir[LIB_DIR_LEN + 14];
    static char spec[LIB_DIR_LEN + 8];
    int i;

    lib_free(lib);
    memset(lib, 0, sizeof *lib);
    lib->entries = (Entry __far *)_fmalloc(sizeof(Entry) * LIB_MAX);
    if (lib->entries == NULL) return -1;
    if (strlen(progdir) < sizeof lib->progdir) strcpy(lib->progdir, progdir);

    resolve_patchdir(lib, patchdir);

    sprintf(dir, "%sFACTORY", lib->progdir);
    lib->factory = scan_folder(lib, dir, FACTORY_FOLDER);
    sprintf(dir, "%s\\USER", lib->patchdir);
    lib->user = scan_folder(lib, dir, USER_FOLDER);
    mark_overrides(lib);

    pack_count = 0;
    pack_overflow = 0;
    sprintf(spec, "%s\\*.*", lib->patchdir);
    dos_each(spec, 1, take_pack, NULL);
    if (pack_overflow) log_line("More than %d pack folders; the rest are not read", LIB_MAX_PACKS);
    sort_packs();
    for (i = 0; i < pack_count; i++) {
        if (stricmp(pack_names[i], USER_FOLDER) == 0) {
            continue;   /* USER\ was read above */
        } else if (stricmp(pack_names[i], FACTORY_FOLDER) == 0) {
            log_line("Folder %s inside the patches folder skipped: the name is reserved", pack_names[i]);
        } else if (!folder_valid(pack_names[i])) {
            log_line("Folder %s skipped: not a valid pack name", pack_names[i]);
        } else {
            sprintf(dir, "%s\\%s", lib->patchdir, pack_names[i]);
            scan_folder(lib, dir, pack_names[i]);
            lib->packs++;
        }
    }
    return 0;
}

void lib_free(Library *lib)
{
    if (lib->entries != NULL) _ffree(lib->entries);
    lib->entries = NULL;
    lib->count = 0;
}

int lib_count(const Library *lib)
{
    return lib->count;
}

const Entry __far *lib_entry(const Library *lib, int i)
{
    return (i >= 0 && i < lib->count) ? &lib->entries[i] : NULL;
}

static int find_in(const Library *lib, const char *folder, const char *name)
{
    int i;

    for (i = 0; i < lib->count; i++) {
        if (_fstricmp(lib->entries[i].folder, folder) == 0 && _fstricmp(lib->entries[i].name, name) == 0) return i;
    }
    return -1;
}

int lib_find(const Library *lib, const char *spec)
{
    char folder[10];
    const char *slash = strchr(spec, '\\');
    int found;

    if (slash != NULL) {
        size_t n = (size_t)(slash - spec);

        if (n == 0 || n > NAME_LIMIT || strlen(slash + 1) > NAME_LIMIT) return -1;
        memcpy(folder, spec, n);
        folder[n] = '\0';
        return find_in(lib, folder, slash + 1);
    }
    if (strlen(spec) > NAME_LIMIT) return -1;
    found = find_in(lib, USER_FOLDER, spec);
    return found >= 0 ? found : find_in(lib, FACTORY_FOLDER, spec);
}

int lib_path(const Library *lib, int i, char *path, unsigned len)
{
    const Entry __far *e = lib_entry(lib, i);
    char folder[9];
    char name[9];
    int n;

    if (e == NULL) return -1;
    _fstrcpy(folder, e->folder);
    _fstrcpy(name, e->name);
    if (strcmp(folder, FACTORY_FOLDER) == 0) {
        n = snprintf(path, len, "%s%s\\%s" EXT_RBP, lib->progdir, folder, name);
    } else {
        n = snprintf(path, len, "%s\\%s\\%s" EXT_RBP, lib->patchdir, folder, name);
    }
    return (n < 0 || (unsigned)n >= len) ? -1 : 0;
}
