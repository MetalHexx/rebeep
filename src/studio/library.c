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
#define LIB_ROOM 32   /* entries kept free beyond the files counted: new saves, before the block grows */

typedef struct {
    Library *lib;
    const char *dir;      /* the folder being read, no trailing backslash */
    const char *folder;   /* its name in the list */
    int counting;         /* count the files, read none */
    int found;            /* the files counted */
    int full_logged;
} FolderScan;

/* The load in progress: lib_load's callback and how many files it has taken. */
static struct {
    void (*fn)(int done, int total, void *arg);
    void *arg;
    int done, total;
} progress;

static char bank_names[LIB_MAX_BANKS][13];
static int bank_count;
static int bank_overflow;

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

/* Reads one counted file and lists it, or logs why not. */
static void read_file(FolderScan *scan, const char *file)
{
    static char path[LIB_DIR_LEN + 14];   /* static: the stack is 2 KB */
    char err[80];
    Patch p;

    if (scan->lib->count >= scan->lib->cap) {
        if (!scan->full_logged) log_line("The patch list is full (%d); the rest are not listed", scan->lib->cap);
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

/* One .RBP file of a folder: counts it, or reads it and reports the progress. */
static void take_file(const char *file, void *arg)
{
    FolderScan *scan = (FolderScan *)arg;
    char name[13];
    const char *dot = strchr(file, '.');
    size_t base = dot != NULL ? (size_t)(dot - file) : strlen(file);

    if (dot == NULL || stricmp(dot, EXT_RBP) != 0 || base > NAME_LIMIT) return;
    memcpy(name, file, base);
    name[base] = '\0';
    if (!name_valid(name)) {
        if (!scan->counting) log_line("%s\\%s skipped: not a valid patch name", scan->folder, file);
        return;
    }
    if (scan->counting) {
        scan->found++;
        return;
    }
    read_file(scan, file);
    progress.done++;
    if (progress.fn != NULL) {
        progress.fn(progress.done < progress.total ? progress.done : progress.total, progress.total, progress.arg);
    }
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

/* Walks the .RBP files in `dir` as folder `folder`. Counting returns the files with a valid name; otherwise it reads
   them and returns the patches listed. */
static int scan_folder(Library *lib, const char *dir, const char *folder, int counting)
{
    FolderScan scan;
    static char spec[LIB_DIR_LEN + 8];
    int from = lib->count;

    scan.lib = lib;
    scan.dir = dir;
    scan.folder = folder;
    scan.counting = counting;
    scan.found = 0;
    scan.full_logged = 0;
    sprintf(spec, "%s\\*" EXT_RBP, dir);
    dos_each(spec, 0, take_file, &scan);
    if (counting) return scan.found;
    sort_range(lib, from);
    return lib->count - from;
}

static void take_bank(const char *name, void *arg)
{
    (void)arg;
    if (bank_count == LIB_MAX_BANKS) {
        bank_overflow = 1;
        return;
    }
    strncpy(bank_names[bank_count], name, sizeof bank_names[0] - 1);
    bank_names[bank_count][sizeof bank_names[0] - 1] = '\0';
    bank_count++;
}

static void sort_banks(void)
{
    char held[13];
    int i;
    int j;

    for (i = 1; i < bank_count; i++) {
        strcpy(held, bank_names[i]);
        for (j = i - 1; j >= 0 && strcmp(bank_names[j], held) > 0; j--) strcpy(bank_names[j + 1], bank_names[j]);
        strcpy(bank_names[j + 1], held);
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

/* Walks FACTORY, USER and the other banks of a library whose folders are settled. Counting sets factory, user, banks
   and files to the counts and logs nothing; otherwise it reads every file into lib, sets the counts to what was
   listed and logs what it leaves out. */
static void scan_all(Library *lib, int counting)
{
    static char dir[LIB_DIR_LEN + 14];
    static char spec[LIB_DIR_LEN + 8];
    int files;
    int i;

    sprintf(dir, "%sFACTORY", lib->progdir);
    lib->factory = scan_folder(lib, dir, FACTORY_FOLDER, counting);
    sprintf(dir, "%s\\USER", lib->patchdir);
    lib->user = scan_folder(lib, dir, USER_FOLDER, counting);
    if (!counting) mark_overrides(lib);
    files = lib->factory + lib->user;
    lib->banks = 0;

    bank_count = 0;
    bank_overflow = 0;
    sprintf(spec, "%s\\*.*", lib->patchdir);
    dos_each(spec, 1, take_bank, NULL);
    if (bank_overflow && !counting) log_line("More than %d bank folders; the rest are not read", LIB_MAX_BANKS);
    sort_banks();
    for (i = 0; i < bank_count; i++) {
        if (stricmp(bank_names[i], USER_FOLDER) == 0) {
            continue;   /* USER\ was read above */
        } else if (stricmp(bank_names[i], FACTORY_FOLDER) == 0) {
            if (!counting) log_line("Folder %s inside the patches folder skipped: the name is reserved", bank_names[i]);
        } else if (!folder_valid(bank_names[i])) {
            if (!counting) log_line("Folder %s skipped: not a valid bank name", bank_names[i]);
        } else {
            int n;

            sprintf(dir, "%s\\%s", lib->patchdir, bank_names[i]);
            n = scan_folder(lib, dir, bank_names[i], counting);
            if (n > 0) lib->banks++;
            files += n;
        }
    }
    if (counting) lib->files = files;
}

int lib_open(Library *lib, const char *progdir, const char *patchdir)
{
    int cap;

    lib_free(lib);
    memset(lib, 0, sizeof *lib);
    if (strlen(progdir) < sizeof lib->progdir) strcpy(lib->progdir, progdir);

    resolve_patchdir(lib, patchdir);
    scan_all(lib, 1);
    cap = lib->files + LIB_ROOM;
    if (cap > LIB_MAX) cap = LIB_MAX;
    lib->entries = (Entry __far *)_fmalloc(sizeof(Entry) * cap);
    if (lib->entries == NULL) return -1;
    lib->cap = cap;
    return 0;
}

int lib_load(Library *lib, void (*report)(int done, int total, void *arg), void *arg)
{
    if (lib->entries == NULL) return -1;
    lib->count = 0;
    progress.fn = report;
    progress.arg = arg;
    progress.done = 0;
    progress.total = lib->files;
    scan_all(lib, 0);
    if (report != NULL && progress.done < progress.total) report(progress.total, progress.total, arg);
    progress.fn = NULL;
    return 0;
}

void lib_free(Library *lib)
{
    if (lib->entries != NULL) _ffree(lib->entries);
    lib->entries = NULL;
    lib->count = 0;
    lib->cap = 0;
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

/* Folders are stored zero-padded, so equal words settle it at once: on a 386SX the compares are what a walk over the banks
   costs. */
int lib_same_bank(const Library *lib, int a, int b)
{
    const Entry __far *x = &lib->entries[a];
    const Entry __far *y = &lib->entries[b];
    const unsigned __far *p = (const unsigned __far *)x->folder;
    const unsigned __far *q = (const unsigned __far *)y->folder;
    int i;

    if (p[0] == q[0] && p[1] == q[1] && p[2] == q[2] && p[3] == q[3] && x->folder[8] == y->folder[8]) return 1;
    for (i = 0; i < (int)sizeof x->folder; i++) {
        char ca = x->folder[i];
        char cb = y->folder[i];

        if (ca >= 'a' && ca <= 'z') ca = (char)(ca - 32);
        if (cb >= 'a' && cb <= 'z') cb = (char)(cb - 32);
        if (ca != cb) return 0;
        if (ca == '\0') return 1;
    }
    return 1;
}

/* A bank is contiguous, so "is in the bank of entry i" is true for a run of indexes and false outside it: both ends are
   found by halving. */
static int bank_start(const Library *lib, int i)
{
    int lo = 0;
    int hi = i;

    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;

        if (lib_same_bank(lib, mid, i)) hi = mid;
        else lo = mid + 1;
    }
    return lo;
}

int lib_bank_end(const Library *lib, int first)
{
    int lo = first + 1;
    int hi = lib->count;

    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;

        if (lib_same_bank(lib, mid, first)) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

void lib_bank(const Library *lib, int i, int *first, int *count)
{
    if (i < 0 || i >= lib->count) {
        *first = 0;
        *count = 0;
        return;
    }
    *first = bank_start(lib, i);
    *count = lib_bank_end(lib, *first) - *first;
}

/* The place of a folder in the list: FACTORY, then USER, then the other banks by name. */
static int folder_rank(const char *folder)
{
    if (stricmp(folder, FACTORY_FOLDER) == 0) return 0;
    return stricmp(folder, USER_FOLDER) == 0 ? 1 : 2;
}

/* Does entry i's bank come before (-1), at (0) or after (1) `folder` in the list? */
static int bank_cmp(const Library *lib, int i, const char *folder)
{
    char have[9];
    int a;
    int b;

    _fstrcpy(have, lib->entries[i].folder);
    a = folder_rank(have);
    b = folder_rank(folder);
    if (a != b) return a < b ? -1 : 1;
    return a == 2 ? stricmp(have, folder) : 0;
}

static int in_factory(const Library *lib, const char *name)
{
    int f;

    for (f = 0; f < lib->factory; f++) {
        if (_fstrcmp(lib->entries[f].name, name) == 0) return 1;
    }
    return 0;
}

/* Sets the overrides mark of every USER entry named `name`. */
static void mark_user(Library *lib, const char *name, int mark)
{
    int u;

    for (u = lib->factory; u < lib->factory + lib->user; u++) {
        if (_fstrcmp(lib->entries[u].name, name) == 0) lib->entries[u].overrides = (unsigned char)mark;
    }
}

/* Makes room for LIB_ROOM more entries, never past LIB_MAX. Returns 0, or -1 when memory runs out. */
static int grow(Library *lib)
{
    int cap = lib->cap + LIB_ROOM;
    Entry __far *bigger;

    if (cap > LIB_MAX) cap = LIB_MAX;
    bigger = (Entry __far *)_frealloc(lib->entries, sizeof(Entry) * cap);
    if (bigger == NULL) return -1;
    lib->entries = bigger;
    lib->cap = cap;
    return 0;
}

int lib_put(Library *lib, const char *folder, const Patch *p)
{
    char up[NAME_LIMIT + 1];
    Entry e;
    int first = 0;
    int end = 0;
    int at;
    int i = 0;
    int found = 0;

    if (strlen(folder) > NAME_LIMIT || strlen(p->name) > NAME_LIMIT) return -1;
    strcpy(up, folder);
    strupr(up);
    while (i < lib->count) {
        int cmp = bank_cmp(lib, i, up);

        end = lib_bank_end(lib, i);
        if (cmp == 0) {
            found = 1;
            first = i;
            break;
        }
        if (cmp > 0) break;
        i = end;
    }

    memset(&e, 0, sizeof e);
    if (found) _fstrcpy(e.folder, lib->entries[first].folder);
    else strcpy(e.folder, up);
    strcpy(e.name, p->name);
    e.has4 = p->has4;
    e.octave = p->octave;
    if (strcmp(up, USER_FOLDER) == 0) e.overrides = (unsigned char)in_factory(lib, p->name);

    at = found ? end : i;
    while (found && at > first) {
        int c = _fstrcmp(lib->entries[at - 1].name, p->name);

        if (c == 0) {
            lib->entries[at - 1] = e;
            return at - 1;
        }
        if (c < 0) break;
        at--;
    }

    if (lib->count >= LIB_MAX) return -1;
    if (lib->count >= lib->cap && grow(lib) != 0) return -1;
    _fmemmove(&lib->entries[at + 1], &lib->entries[at], (size_t)(lib->count - at) * sizeof(Entry));
    lib->entries[at] = e;
    lib->count++;
    if (strcmp(up, FACTORY_FOLDER) == 0) {
        lib->factory++;
        mark_user(lib, p->name, 1);
    } else if (strcmp(up, USER_FOLDER) == 0) {
        lib->user++;
    } else if (!found) {
        lib->banks++;
    }
    return at;
}

int lib_drop(Library *lib, const char *folder, const char *name)
{
    int i = find_in(lib, folder, name);
    int first;
    int n;

    if (i < 0) return -1;
    lib_bank(lib, i, &first, &n);
    _fmemmove(&lib->entries[i], &lib->entries[i + 1], (size_t)(lib->count - i - 1) * sizeof(Entry));
    lib->count--;
    if (stricmp(folder, FACTORY_FOLDER) == 0) {
        lib->factory--;
        mark_user(lib, name, 0);
    } else if (stricmp(folder, USER_FOLDER) == 0) {
        lib->user--;
    } else if (n == 1) {
        lib->banks--;
    }
    return 0;
}

int lib_bank_path(const Library *lib, const char *folder, const char *name, char *path, unsigned len)
{
    int n;

    if (stricmp(folder, FACTORY_FOLDER) == 0) return -1;
    n = snprintf(path, len, "%s\\%s\\%s" EXT_RBP, lib->patchdir, folder, name);
    return (n < 0 || (unsigned)n >= len) ? -1 : 0;
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
