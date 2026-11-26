/* ReBeep Studio: the folder-based patch library. The program folder holds FACTORY\; the patches folder (PATCHES=
   in RBSTUDIO.CFG, else <program folder>\PATCHES) holds USER\ and the banks, one level deep. The library is read once
   per run (lib_open counts, lib_load reads) and kept up to date by lib_put and lib_drop after a save.
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_LIBRARY_H
#define RBSTUDIO_LIBRARY_H

#include "patch.h"

#define LIB_MAX 2048        /* patches listed at most; the rest are logged and left out */
#define LIB_MAX_BANKS 64    /* bank folders read besides FACTORY and USER; the rest are logged and left out */
#define LIB_DIR_LEN 160

typedef struct {
    char folder[9];
    char name[9];
    unsigned char has4, octave, overrides;   /* overrides: a USER patch whose name exists in FACTORY */
} Entry;

typedef struct {
    Entry __far *entries;   /* far: `cap` entries, sized to the files counted; lib_free releases it */
    int count, cap;
    int factory, user, banks;   /* patches in FACTORY, patches in USER, other bank folders read */
    int files;                  /* the .RBP files lib_open counted */
    int patches_missing;        /* a well-formed PATCHES= folder that does not exist */
    char progdir[80];
    char patchdir[LIB_DIR_LEN];   /* the patches folder in use, without a trailing backslash */
} Library;

/* Settles the folders and counts the .RBP files with a valid name, reading none: fast, for the checks screen.
   `progdir` is the program folder with its trailing backslash ("" when unknown). `patchdir` is the raw PATCHES= value,
   or NULL or "" for the default; a value that is not a plain DOS path (see path_valid) is logged and ignored. Afterwards
   `factory`, `user` and `banks` are the counted files and the folders holding any, and `files` their sum. A Library is
   zeroed before its first open; opening again releases the old entries. Returns 0, or -1 when memory runs out. */
int lib_open(Library *lib, const char *progdir, const char *patchdir);

/* Reads every counted file, calling progress(done, total, arg) after each (and once more at the end if fewer files
   were found than counted), so it reaches the total; progress may be NULL. Order: FACTORY, USER, then banks by name;
   names sorted within a folder. An unreadable or invalid file is left out and logged with its reason, so lib_count can
   be below `files`. `factory`, `user` and `banks` become what was listed. Returns 0, or -1 when the library was not
   opened. */
int lib_load(Library *lib, void (*progress)(int done, int total, void *arg), void *arg);

/* After a save: lists `p` as FOLDER\<p->name> in its place (banks in list order, names sorted), replacing the entry of
   that name, starting a new bank in its sorted place, keeping the overrides marks right. Returns its index, or -1
   when the list holds LIB_MAX or memory runs out. */
int lib_put(Library *lib, const char *folder, const Patch *p);

/* After an override is removed: takes FOLDER\NAME out of the list. Returns 0, or -1 when it is not listed. */
int lib_drop(Library *lib, const char *folder, const char *name);

/* The bank of entry i: its first entry and its patch count (a bank's entries are contiguous). 0 and 0 out of range. */
void lib_bank(const Library *lib, int i, int *first, int *count);

/* Do entries a and b share a bank? The one rule of a bank: folder names equal without regard to case. */
int lib_same_bank(const Library *lib, int a, int b);

/* The index after the last entry of the bank that starts at `first`, found by halving. */
int lib_bank_end(const Library *lib, int first);

/* Releases the entries. */
void lib_free(Library *lib);

int lib_count(const Library *lib);

/* The i-th entry in list order, or NULL out of range. */
const Entry __far *lib_entry(const Library *lib, int i);

/* "FOLDER\NAME" matches exactly; "NAME" is USER then FACTORY, never another bank. Any case. Returns the index, or -1. */
int lib_find(const Library *lib, const char *spec);

/* The file path of entry i. Returns 0, or -1 when i is out of range or `len` is too small. */
int lib_path(const Library *lib, int i, char *path, unsigned len);

/* The path of FOLDER\NAME.RBP in the patches folder, whether or not it exists: USER or any bank but FACTORY, which is
   refused. Returns 0, or -1 for FACTORY or when `len` is too small. */
int lib_bank_path(const Library *lib, const char *folder, const char *name, char *path, unsigned len);

/* A patch or bank name: A-Z 0-9 _ -, 1 to 8 chars, at least one non-digit. */
int name_valid(const char *name);

/* A bank folder name: the same rule as name_valid. */
int folder_valid(const char *folder);

/* A PATCHES= value: an optional drive and colon, then \-separated components that are each a plain 8.3 name, no *,
   ? or .., at most 64 characters. */
int path_valid(const char *path);

#endif
