/* ReBeep Studio: the folder-based patch library. The program folder holds FACTORY\; the patches folder (PATCHES=
   in RBSTUDIO.CFG, else <program folder>\PATCHES) holds USER\ and the packs, one level deep.
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_LIBRARY_H
#define RBSTUDIO_LIBRARY_H

#define LIB_MAX 512        /* patches listed; the rest are logged and left out */
#define LIB_MAX_PACKS 64   /* pack folders read; the rest are logged and left out */
#define LIB_DIR_LEN 160

typedef struct {
    char folder[9];
    char name[9];
    unsigned char has4, octave, overrides;   /* overrides: a USER patch whose name exists in FACTORY */
} Entry;

typedef struct {
    Entry __far *entries;   /* far memory, LIB_MAX entries; set by lib_scan, released by lib_free */
    int count;
    int factory, user, packs;   /* patches in FACTORY, patches in USER, pack folders */
    int patches_missing;        /* a well-formed PATCHES= folder that does not exist */
    char progdir[80];
    char patchdir[LIB_DIR_LEN];   /* the patches folder in use, without a trailing backslash */
} Library;

/* Reads every .RBP. `progdir` is the program folder with its trailing backslash ("" when unknown). `patchdir` is the
   raw PATCHES= value, or NULL or "" for the default; a value that is not a plain DOS path (see path_valid) is
   logged and ignored. Order: FACTORY, USER, then packs by name; names sorted within a folder. An unreadable or
   invalid file is left out and logged with its reason. Returns 0, or -1 when memory runs out. A Library is zeroed
   before its first scan; scanning again releases the old entries and rescans. */
int lib_scan(Library *lib, const char *progdir, const char *patchdir);

/* Scans again with the folders the last lib_scan settled (after a save or a removal changed them). Returns 0, or -1 when
   memory runs out. */
int lib_rescan(Library *lib);

/* Releases the entries. */
void lib_free(Library *lib);

int lib_count(const Library *lib);

/* The i-th entry in list order, or NULL out of range. */
const Entry __far *lib_entry(const Library *lib, int i);

/* "FOLDER\NAME" matches exactly; "NAME" is USER then FACTORY, never a pack. Any case. Returns the index, or -1. */
int lib_find(const Library *lib, const char *spec);

/* The file path of entry i. Returns 0, or -1 when i is out of range or `len` is too small. */
int lib_path(const Library *lib, int i, char *path, unsigned len);

/* The file path of the USER patch `name`, whether or not it exists. Returns 0, or -1 when `len` is too small. */
int lib_user_path(const Library *lib, const char *name, char *path, unsigned len);

/* A patch or pack name: A-Z 0-9 _ -, 1 to 8 chars, at least one non-digit. */
int name_valid(const char *name);

/* A pack folder name: the same rule as name_valid. */
int folder_valid(const char *folder);

/* A PATCHES= value: an optional drive and colon, then \-separated components that are each a plain 8.3 name, no *,
   ? or .., at most 64 characters. */
int path_valid(const char *path);

#endif
