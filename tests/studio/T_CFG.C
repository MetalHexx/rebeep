/* The settings file, the log, and the safe save of a file that cannot be written. */
#include <dos.h>
#include <stdio.h>
#include <string.h>

#include "testlib.h"
#include "../../src/studio/dos.h"
#include "../../src/studio/library.h"
#include "../../src/studio/log.h"
#include "../../src/studio/settings.h"

static Settings cfg;
static Library lib;
static char buf[300];

static void put_text(const char *file, const char *body)
{
    FILE *f = fopen(file, "wb");

    if (f != NULL) {
        fputs(body, f);
        fclose(f);
    }
}

static long slurp(const char *file)
{
    FILE *f = fopen(file, "rb");
    long n;

    if (f == NULL) return -1;
    n = (long)fread(buf, 1, sizeof buf - 1, f);
    fclose(f);
    buf[n] = '\0';
    return n;
}

int main(void)
{
    int i;

    t_case("cfg_load: a missing file is not an error");
    t_checkl(cfg_load(&cfg, "NOSUCH.CFG"), 0, "returns 0");
    t_checkl(cfg.present, 0, "not present");
    t_check(cfg_get(&cfg, "PATCHES") == NULL, "no values");

    t_case("cfg_load: comments, unknown keys, duplicates, padding");
    put_text("A.CFG",
             "; a comment\r\n"
             "\r\n"
             "  patches\t=  MYPATCH  \r\n"
             "Colour=Blue\r\n"
             "; PATCH=commented\r\n"
             "PATCHES=SECOND\r\n"
             "no equals sign here\r\n"
             "=novalue\r\n"
             "PATCH = BELL");
    t_checkl(cfg_load(&cfg, "A.CFG"), 0, "loads");
    t_checkl(cfg.present, 1, "present");
    t_check(cfg_get(&cfg, "PATCHES") != NULL && strcmp(cfg_get(&cfg, "PATCHES"), "MYPATCH") == 0,
            "the first occurrence counts, padding trimmed, key in any case");
    t_check(cfg_get(&cfg, "patch") != NULL && strcmp(cfg_get(&cfg, "patch"), "BELL") == 0, "a last line without a line end");
    t_check(cfg_get(&cfg, "COLOUR") != NULL && strcmp(cfg_get(&cfg, "COLOUR"), "Blue") == 0, "unknown keys are kept, values as written");
    t_check(cfg_get(&cfg, "COMMENTED") == NULL && cfg_get(&cfg, "NO") == NULL, "comments and bare lines are not keys");

    t_case("cfg_load: LF line ends, long lines, many keys");
    put_text("B.CFG", "PATCHES=X\nPATCH=Y\n");
    cfg_load(&cfg, "B.CFG");
    t_check(strcmp(cfg_get(&cfg, "PATCHES"), "X") == 0 && strcmp(cfg_get(&cfg, "PATCH"), "Y") == 0, "LF works");
    {
        FILE *f = fopen("C.CFG", "wb");

        for (i = 0; i < 300; i++) fputc('A', f);
        fputs("=1\r\nPATCH=Z\r\n", f);
        for (i = 0; i < 40; i++) fprintf(f, "K%d=%d\r\n", i, i);
        fclose(f);
    }
    cfg_load(&cfg, "C.CFG");
    t_check(cfg_get(&cfg, "PATCH") != NULL && strcmp(cfg_get(&cfg, "PATCH"), "Z") == 0, "a long line is skipped, not misread");
    t_check(cfg.count <= CFG_MAX_KEYS, "the key table is bounded");

    t_case("PATCHES= from the file: relative, then bad");
    put_text("D.CFG", "PATCHES=MINE\r\n");
    cfg_load(&cfg, "D.CFG");
    t_checkl(lib_scan(&lib, "\\PROG\\", cfg_get(&cfg, "PATCHES")), 0, "scan");
    t_check(strcmp(lib.patchdir, "\\PROG\\MINE") == 0, lib.patchdir);
    t_checkl(lib.patches_missing, 1, "a well-formed folder that is not there");
    put_text("E.CFG", "PATCHES=..\\..\\WINDOWS\r\n");
    cfg_load(&cfg, "E.CFG");
    t_checkl(lib_scan(&lib, "\\PROG\\", cfg_get(&cfg, "PATCHES")), 0, "scan");
    t_check(strcmp(lib.patchdir, "\\PROG\\PATCHES") == 0, "a path that climbs is ignored for the default");
    t_checkl(lib.patches_missing, 0, "and does not mark the folder missing");
    lib_free(&lib);

    t_case("log: lines are on disk before the log is closed");
    t_checkl(log_open("L.LOG"), 0, "opens");
    t_checkl(log_ok(), 1, "ok");
    log_line("first %d", 1);
    log_trace("hidden");
    t_check(slurp("L.LOG") > 0 && strcmp(buf, "first 1\r\n") == 0, "the line is readable while the log is open");
    log_set_trace(1);
    log_trace("shown %s", "now");
    log_set_trace(0);
    log_trace("hidden again");
    log_close();
    slurp("L.LOG");
    t_check(strcmp(buf, "first 1\r\nshown now\r\n") == 0, buf);
    t_checkl(log_open("L.LOG"), 0, "a new run replaces the log");
    log_close();
    t_checkl(slurp("L.LOG"), 0, "and starts empty");

    t_case("log: an unopenable log makes every call a no-op");
    t_checkl(log_open("NOSUCH\\X.LOG"), -1, "cannot open");
    t_checkl(log_ok(), 0, "not ok");
    log_line("nothing");
    log_trace("nothing");
    log_close();

    t_case("safe save: new file, overwrite, no leftovers");
    dos_make_dir("SAVE");
    t_checkl(dos_save_file("SAVE\\A.RBP", "one", 3), 0, "a new file");
    t_checkl(slurp("SAVE\\A.RBP"), 3, "its size");
    t_checkl(dos_save_file("SAVE\\A.RBP", "second", 6), 0, "overwrite");
    slurp("SAVE\\A.RBP");
    t_check(strcmp(buf, "second") == 0, "new content");
    t_check(!dos_is_file("SAVE\\A.BAK") && !dos_is_file("SAVE\\A.$$$"), "no .BAK or .$$$");
    put_text("SAVE\\A.BAK", "stale");
    t_checkl(dos_save_file("SAVE\\A.RBP", "third", 5), 0, "a stale .BAK does not stop it");
    t_check(!dos_is_file("SAVE\\A.BAK"), "and is gone");
    t_checkl(dos_save_file("NOSUCH\\A.RBP", "x", 1), -1, "a missing folder fails");

    t_case("safe save: a write that fails leaves the old file");
    put_text("SAVE\\B.RBP", "keep me");
    put_text("SAVE\\B.$$$", "locked");
    t_checkl((long)_dos_setfileattr("SAVE\\B.$$$", _A_RDONLY), 0, "make the scratch file read-only");
    t_checkl(dos_save_file("SAVE\\B.RBP", "new", 3), -1, "the save fails");
    slurp("SAVE\\B.RBP");
    t_check(strcmp(buf, "keep me") == 0, "the old file is untouched");
    t_check(!dos_is_file("SAVE\\B.BAK"), "no .BAK");
    _dos_setfileattr("SAVE\\B.$$$", _A_NORMAL);

    return t_done();
}
