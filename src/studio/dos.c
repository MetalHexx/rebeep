/* SPDX-License-Identifier: MIT */
#include <direct.h>
#include <dos.h>
#include <i86.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "dos.h"

#define MAX_HOOKS 8

static struct {
    unsigned intno;
    isr_t old;
} hooks[MAX_HOOKS];
static int hook_count;
static isr_t old_break, old_ctrlc, old_critical;
static char program_dir[80];
static int write_why;

/* The handlers run on the interrupted program's stack (INT 24h on DOS's own), which the stack
   checker's limit does not describe: so no stack check. */
#pragma off (check_stack)
/* INT 1Bh (Ctrl+Break) and INT 23h (Ctrl+C): return to the caller and carry on. */
static void __interrupt __far ignore_break(void)
{
}

/* INT 24h: DOS 3+ takes AL = 3 as "fail the call", so a write to a read-only floppy comes back as
   an error instead of the "Abort, Retry, Fail" prompt. */
static void __interrupt __far fail_critical(union INTPACK r)
{
    r.h.al = 3;
}
#pragma on (check_stack)

void dos_hook(unsigned intno, isr_t handler, isr_t *old)
{
    if (hook_count == MAX_HOOKS) exit(3);
    _disable();
    *old = _dos_getvect(intno);
    hooks[hook_count].intno = intno;
    hooks[hook_count].old = *old;
    hook_count++;
    _dos_setvect(intno, handler);
    _enable();
}

void dos_restore(void)
{
    _disable();
    while (hook_count > 0) {
        hook_count--;
        _dos_setvect(hooks[hook_count].intno, hooks[hook_count].old);
    }
    _enable();
}

void dos_init(const char *argv0)
{
    size_t len = 0;
    size_t i;

    for (i = 0; argv0[i] != '\0'; i++) {
        if (argv0[i] == '\\' || argv0[i] == ':') len = i + 1;
    }
    if (len >= sizeof program_dir) len = 0;
    memcpy(program_dir, argv0, len);
    program_dir[len] = '\0';

    atexit(dos_restore);
    dos_hook(0x1B, ignore_break, &old_break);
    dos_hook(0x23, ignore_break, &old_ctrlc);
    dos_hook(0x24, (isr_t)fail_critical, &old_critical);
}

const char *dos_program_dir(void)
{
    return program_dir;
}

#define PATH_MAX_LEN 144

int dos_is_dir(const char *path)
{
    unsigned attr;

    return _dos_getfileattr(path, &attr) == 0 && (attr & _A_SUBDIR) != 0;
}

int dos_is_file(const char *path)
{
    unsigned attr;

    return _dos_getfileattr(path, &attr) == 0 && (attr & _A_SUBDIR) == 0;
}

int dos_write_why(void)
{
    return write_why;
}

/* Records why a DOS call just failed: DOS error 19 is a write-protected disk, 39 and 112 a full one. */
static void note_failure(void)
{
    write_why = _doserrno == 19 ? DOS_WHY_PROTECTED : (_doserrno == 39 || _doserrno == 112) ? DOS_WHY_FULL : DOS_WHY_OTHER;
}

int dos_remove(const char *path)
{
    write_why = DOS_WHY_OTHER;
    if (remove(path) == 0) return 0;
    note_failure();
    return -1;
}

int dos_make_dir(const char *path)
{
    char buf[PATH_MAX_LEN];
    size_t len = strlen(path);
    size_t i;

    write_why = DOS_WHY_OTHER;
    if (len == 0 || len >= sizeof buf) return -1;
    memcpy(buf, path, len + 1);
    if (buf[len - 1] == '\\' && len > 1 && buf[len - 2] != ':') buf[--len] = '\0';
    for (i = 1; i <= len; i++) {
        if (buf[i] != '\\' && buf[i] != '\0') continue;
        if (buf[i - 1] == ':' || buf[i - 1] == '\\') continue;
        buf[i] = '\0';
        if (!dos_is_dir(buf) && mkdir(buf) != 0) note_failure();
        if (i < len) buf[i] = '\\';
    }
    return dos_is_dir(buf) ? 0 : -1;
}

long dos_read_file(const char *path, void *buf, unsigned max)
{
    FILE *f = fopen(path, "rb");
    size_t got;
    int bad;

    if (f == NULL) return -1;
    got = fread(buf, 1, max, f);
    bad = ferror(f);
    fclose(f);
    return bad ? -1 : (long)got;
}

/* `path` with its extension (after the last dot of the file name) replaced by `ext`; 0 when it does not fit. */
static int with_extension(const char *path, const char *ext, char *out, size_t size)
{
    size_t len = strlen(path);
    size_t dot = len;
    size_t i;

    for (i = 0; i < len; i++) {
        if (path[i] == '\\' || path[i] == ':') dot = len;
        else if (path[i] == '.') dot = i;
    }
    if (dot + strlen(ext) + 1 > size) return 0;
    memcpy(out, path, dot);
    strcpy(out + dot, ext);
    return 1;
}

/* Writes `len` bytes to a fresh `path` and checks the flush, the close and the byte count DOS reports. */
static int write_checked(const char *path, const void *data, unsigned len)
{
    FILE *f = fopen(path, "wb");
    struct find_t found;
    int ok;

    if (f == NULL) {
        note_failure();
        return 0;
    }
    ok = fwrite(data, 1, len, f) == len;
    ok = fflush(f) == 0 && ok;
    ok = fclose(f) == 0 && ok;
    ok = ok && _dos_findfirst(path, _A_NORMAL, &found) == 0 && found.size == len;
    if (!ok) {
        write_why = DOS_WHY_FULL;   /* the file opened, so the data did not fit */
        remove(path);
    }
    return ok;
}

int dos_save_file(const char *path, const void *data, unsigned len)
{
    static char tmp[PATH_MAX_LEN];
    static char bak[PATH_MAX_LEN];
    int had_old;

    write_why = DOS_WHY_OTHER;
    if (!with_extension(path, ".$$$", tmp, sizeof tmp) || !with_extension(path, ".BAK", bak, sizeof bak)) return -1;
    if (!write_checked(tmp, data, len)) return -1;

    had_old = dos_is_file(path);
    if (had_old) {
        remove(bak);
        if (rename(path, bak) != 0) {
            note_failure();
            remove(tmp);
            return -1;
        }
    }
    if (rename(tmp, path) != 0) {
        note_failure();
        if (had_old) rename(bak, path);
        remove(tmp);
        return -1;
    }
    if (had_old) remove(bak);
    return 0;
}

int dos_each(const char *spec, int dirs, void (*fn)(const char *name, void *arg), void *arg)
{
    struct find_t found;
    int visited = 0;
    unsigned rc = _dos_findfirst(spec, dirs ? _A_SUBDIR : _A_NORMAL, &found);

    while (rc == 0) {
        int is_dir = (found.attrib & _A_SUBDIR) != 0;

        if (is_dir == (dirs != 0) && found.name[0] != '.' && (found.attrib & _A_VOLID) == 0) {
            fn(found.name, arg);
            visited++;
        }
        rc = _dos_findnext(&found);
    }
    return visited;
}
