/* ReBeep Studio: DOS plumbing. Every vector the program hooks goes through dos_hook(), and one
   dos_restore() puts them all back. SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_DOS_H
#define RBSTUDIO_DOS_H

typedef void (__interrupt __far *isr_t)();

/* Remembers argv[0]'s folder, hooks INT 1Bh and 23h (Ctrl+Break and Ctrl+C do nothing) and INT 24h
   (a critical error fails the call), and arranges for dos_restore() to run at exit. */
void dos_init(const char *argv0);

/* Installs `handler` on `intno`. The old vector is stored in *old before the new one goes live,
   so the handler may chain to it at once. */
void dos_hook(unsigned intno, isr_t handler, isr_t *old);

/* Puts back every hooked vector, newest first. Safe to call again. Called on every exit path. */
void dos_restore(void);

/* The folder the program was started from, with its trailing backslash; "" when DOS gave no path. */
const char *dos_program_dir(void);

/* 1 when `path` names a folder, 0 when it names a file or nothing. */
int dos_is_dir(const char *path);

/* 1 when `path` names a file (not a folder), else 0. */
int dos_is_file(const char *path);

/* Creates `path` and every missing folder above it. 0 when the folder exists afterwards, -1 otherwise. */
int dos_make_dir(const char *path);

/* Reads up to `max` bytes of `path` into `buf`. Returns the byte count, or -1 when it cannot be opened or read. */
long dos_read_file(const char *path, void *buf, unsigned max);

/* Safe save of `len` bytes to `path` (NAME.EXT): writes NAME.$$$ and checks the byte count, renames the old file to
   NAME.BAK, renames NAME.$$$ over it, deletes NAME.BAK. A failed second rename puts NAME.BAK back. Returns 0, or -1
   with the old file untouched (a full or read-only disk, a locked file). The folder must exist. */
int dos_save_file(const char *path, const void *data, unsigned len);

/* Calls fn(name, arg) for each entry matching `spec` (a path with a wildcard, e.g. "C:\X\*.RBP"): the files, or with
   `dirs` set the folders (never "." or ".."). `name` is the bare 8.3 name. Returns the number visited. */
int dos_each(const char *spec, int dirs, void (*fn)(const char *name, void *arg), void *arg);

#endif
