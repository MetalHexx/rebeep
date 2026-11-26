/* The patch library: counting, reading once with progress, list order, counts, lookup, overrides, 4-OP marks, the
   reserved and invalid cases, the PATCHES= rules, putting and dropping one entry, bank ranges and paths, the full list,
   and name and path validation. The tree is built on the DOSBox-X C: at run time. */
#include <stdio.h>
#include <string.h>

#include "testlib.h"
#include "../../src/studio/dos.h"
#include "../../src/studio/library.h"
#include "../../src/studio/log.h"
#include "../../src/studio/patch.h"

#define PROG "\\PLTREE\\PROG\\"
#define LOG_PATH "PLTREE.LOG"
#define P63 "AAAAAAAA\\AAAAAAAA\\AAAAAAAA\\AAAAAAAA\\AAAAAAAA\\AAAAAAAA\\AAAAAAAA\\"

static Library lib;
static Library other;
static Library full;
static Patch patch;
static char path[100];
static char text[1500];
static int seen_done;
static int seen_total;
static int seen_calls;
static int seen_backwards;

/* Counts and reads a library in one go. */
static int scan(Library *l, const char *progdir, const char *patchdir)
{
    int rc = lib_open(l, progdir, patchdir);

    return rc != 0 ? rc : lib_load(l, NULL, NULL);
}

static void watch(int done, int total, void *arg)
{
    (void)arg;
    if (done < seen_done) seen_backwards = 1;
    seen_done = done;
    seen_total = total;
    seen_calls++;
}

/* A patch named `name` for lib_put. */
static const Patch *named(const char *name, int has4, int octave)
{
    memset(&patch, 0, sizeof patch);
    strcpy(patch.name, name);
    patch.has4 = (unsigned char)has4;
    patch.octave = (unsigned char)octave;
    return &patch;
}

static void put_patch(const char *file, int conn, int has4, int octave)
{
    memset(&patch, 0, sizeof patch);
    patch.octave = (unsigned char)octave;
    patch.v2.conn = (unsigned char)conn;
    patch.v2.op[0].v[P_AR] = 15;
    patch.v2.op[1].v[P_OL] = 63;
    patch.has4 = (unsigned char)has4;
    patch.v4.conn = 2;
    patch_write(file, &patch);
}

static void put_text(const char *file, const char *body)
{
    FILE *f = fopen(file, "wb");

    if (f != NULL) {
        fputs(body, f);
        fclose(f);
    }
}

static void build_tree(void)
{
    put_patch("PLTREE\\PROG\\FACTORY\\ORGAN.RBP", 1, 0, 4);
    put_patch("PLTREE\\PROG\\FACTORY\\BELL.RBP", 0, 0, 4);
    put_patch("PLTREE\\PROG\\PATCHES\\USER\\BELL.RBP", 1, 0, 5);
    put_patch("PLTREE\\PROG\\PATCHES\\USER\\MYFOUR.RBP", 0, 1, 3);
    put_text("PLTREE\\PROG\\PATCHES\\USER\\BAD.RBP", "[PATCH]\r\nFORMAT=1\r\n[2OP]\r\nCONNECTION=FM\r\n");
    put_text("PLTREE\\PROG\\PATCHES\\USER\\12.RBP", "not even read");
    put_text("PLTREE\\PROG\\PATCHES\\USER\\NOTES.TXT", "not a patch");
    put_patch("PLTREE\\PROG\\PATCHES\\BANKZ\\Z1.RBP", 0, 0, 4);
    put_patch("PLTREE\\PROG\\PATCHES\\BANKA\\A2.RBP", 0, 0, 4);
    put_patch("PLTREE\\PROG\\PATCHES\\BANKA\\A1.RBP", 0, 0, 4);
    put_patch("PLTREE\\PROG\\PATCHES\\FACTORY\\HACK.RBP", 0, 0, 4);
    dos_make_dir("PLTREE\\EMPTY");
}

static int at(const Library *l, int i, const char *folder, const char *name)
{
    const Entry __far *e = lib_entry(l, i);

    return e != NULL && _fstrcmp(e->folder, folder) == 0 && _fstrcmp(e->name, name) == 0;
}

int main(void)
{
    const Entry __far *e;
    long n;
    int first;
    int count;
    int k;
    FILE *f;

    t_case("name_valid");
    t_check(!name_valid("2") && !name_valid("12"), "all-digit names are refused");
    t_check(name_valid("B2") && name_valid("_1") && name_valid("-") && name_valid("A-1"), "B2, _1 and friends are accepted");
    t_check(name_valid("ABCDEFGH") && !name_valid("ABCDEFGHI"), "1 to 8 characters");
    t_check(!name_valid("") && !name_valid("ab") && !name_valid("A B") && !name_valid("A.B") && !name_valid("A\\B"),
            "empty, lower case, space, dot and slash are refused");
    t_check(folder_valid("BANK1") && !folder_valid("12") && !folder_valid("A.B"), "folder_valid follows the same rule");

    t_case("path_valid");
    t_check(path_valid("PATCHES") && path_valid("MY\\PATCHES") && path_valid("\\X") && path_valid("D:\\MY\\X\\") &&
            path_valid("d:x") && path_valid("A.TXT"), "plain paths are accepted");
    t_check(!path_valid("") && !path_valid("C:") && !path_valid("\\") && !path_valid("C:\\"), "no components is refused");
    t_check(!path_valid("..\\X") && !path_valid("X\\..\\Y") && !path_valid(".") && !path_valid("X\\.."), "dot-dot is refused");
    t_check(!path_valid("A*") && !path_valid("A?B") && !path_valid("X\\*.RBP"), "wildcards are refused");
    t_check(!path_valid("A\\\\B") && !path_valid("\\\\X") && !path_valid("1:\\X") && !path_valid("A B"), "empty components, bad drive, space");
    t_check(!path_valid("TOOLONGNAME") && !path_valid("A.TEXT") && !path_valid("A.B.C") && !path_valid("A."), "the 8.3 rule");
    t_check(path_valid(P63 "A") && !path_valid(P63 "AA"), "64 characters at most");

    build_tree();
    log_open(LOG_PATH);

    t_case("open: counts the files and reads none");
    t_checkl(lib_open(&lib, PROG, NULL), 0, "open");
    t_checkl(lib.factory, 2, "FACTORY files");
    t_checkl(lib.user, 3, "USER files with a valid name, a bad one among them");
    t_checkl(lib.banks, 2, "other bank folders holding any");
    t_checkl(lib.files, 8, "the sum; the reserved folder, 12.RBP and NOTES.TXT are not counted");
    t_checkl(lib_count(&lib), 0, "nothing is listed yet");
    t_check(lib.cap >= lib.files && lib.cap <= LIB_MAX, "the block holds every file counted");
    t_checkl(lib_load(&other, NULL, NULL), -1, "a library that was not opened cannot load");

    t_case("load: reads every counted file and reports the progress");
    seen_done = seen_total = seen_calls = seen_backwards = 0;
    t_checkl(lib_load(&lib, watch, NULL), 0, "load");
    t_checkl(seen_done, 8, "progress reaches the total");
    t_checkl(seen_total, 8, "of the files counted");
    t_checkl(seen_calls, 8, "one call a file, the unreadable one too");
    t_checkl(seen_backwards, 0, "never backwards");

    t_case("scan: order and counts");
    t_check(at(&lib, 0, "FACTORY", "BELL") && at(&lib, 1, "FACTORY", "ORGAN"), "FACTORY first, sorted");
    t_check(at(&lib, 2, "USER", "BELL") && at(&lib, 3, "USER", "MYFOUR"), "USER next, sorted");
    t_check(at(&lib, 4, "BANKA", "A1") && at(&lib, 5, "BANKA", "A2") && at(&lib, 6, "BANKZ", "Z1"), "then banks by name");
    t_checkl(lib_count(&lib), 7, "the reserved folder, the invalid file and the bad name are left out");
    t_checkl(lib.user, 2, "USER lists what it read");
    t_checkl(lib.factory, 2, "factory patches");
    t_checkl(lib.user, 2, "user patches");
    t_checkl(lib.banks, 2, "bank folders");
    t_checkl(lib.patches_missing, 0, "the default folder exists");
    t_check(lib_entry(&lib, 7) == NULL && lib_entry(&lib, -1) == NULL, "out of range is NULL");

    t_case("scan: override and 4-OP marks, octave");
    e = lib_entry(&lib, 2);
    t_checkl(e->overrides, 1, "USER\\BELL overrides FACTORY\\BELL");
    t_checkl(lib_entry(&lib, 3)->overrides, 0, "MYFOUR overrides nothing");
    t_checkl(lib_entry(&lib, 0)->overrides, 0, "a FACTORY entry never does");
    t_checkl(lib_entry(&lib, 3)->has4, 1, "MYFOUR is 4-OP");
    t_checkl(lib_entry(&lib, 2)->has4, 0, "BELL is 2-OP");
    t_checkl(lib_entry(&lib, 2)->octave, 5, "octave comes from the file");

    t_case("lookup");
    t_checkl(lib_find(&lib, "BELL"), 2, "a bare name finds USER first");
    t_checkl(lib_find(&lib, "bell"), 2, "in any case");
    t_checkl(lib_find(&lib, "ORGAN"), 1, "then FACTORY");
    t_checkl(lib_find(&lib, "FACTORY\\BELL"), 0, "FOLDER\\NAME is exact");
    t_checkl(lib_find(&lib, "USER\\ORGAN"), -1, "no USER\\ORGAN");
    t_checkl(lib_find(&lib, "A1"), -1, "a bare name never finds another bank");
    t_checkl(lib_find(&lib, "BANKA\\A1"), 4, "a bank is found by its folder");
    t_check(lib_find(&lib, "") == -1 && lib_find(&lib, "NOPE") == -1 && lib_find(&lib, "TOOLONGNAME") == -1 &&
            lib_find(&lib, "\\BELL") == -1 && lib_find(&lib, "USER\\") == -1, "nothing for nothing");
    t_check(lib_find(&lib, "HACK") == -1 && lib_find(&lib, "FACTORY\\HACK") == -1, "the reserved folder's file is not listed");

    t_case("lib_bank: the first, a middle and the last bank");
    lib_bank(&lib, 1, &first, &count);
    t_check(first == 0 && count == 2, "FACTORY holds entries 0 and 1");
    lib_bank(&lib, 2, &first, &count);
    t_check(first == 2 && count == 2, "USER from its first entry");
    lib_bank(&lib, 3, &first, &count);
    t_check(first == 2 && count == 2, "and from its last");
    lib_bank(&lib, 5, &first, &count);
    t_check(first == 4 && count == 2, "BANKA in the middle");
    lib_bank(&lib, 6, &first, &count);
    t_check(first == 6 && count == 1, "BANKZ, the last, holds one");
    lib_bank(&lib, 7, &first, &count);
    t_check(first == 0 && count == 0, "out of range holds nothing");

    t_case("paths");
    t_checkl(lib_path(&lib, 0, path, sizeof path), 0, "factory path");
    t_check(strcmp(path, "\\PLTREE\\PROG\\FACTORY\\BELL.RBP") == 0, path);
    t_checkl(lib_path(&lib, 2, path, sizeof path), 0, "user path");
    t_check(strcmp(path, "\\PLTREE\\PROG\\PATCHES\\USER\\BELL.RBP") == 0, path);
    t_checkl(lib_path(&lib, 6, path, sizeof path), 0, "bank path");
    t_check(strcmp(path, "\\PLTREE\\PROG\\PATCHES\\BANKZ\\Z1.RBP") == 0, path);
    t_checkl(lib_path(&lib, 6, path, 10), -1, "a short buffer is refused");
    t_checkl(lib_bank_path(&lib, "USER", "NEW", path, sizeof path), 0, "a USER path, listed or not");
    t_check(strcmp(path, "\\PLTREE\\PROG\\PATCHES\\USER\\NEW.RBP") == 0, path);
    t_checkl(lib_bank_path(&lib, "BANKA", "A9", path, sizeof path), 0, "another bank's path");
    t_check(strcmp(path, "\\PLTREE\\PROG\\PATCHES\\BANKA\\A9.RBP") == 0, path);
    t_checkl(lib_bank_path(&lib, "FACTORY", "BELL", path, sizeof path), -1, "FACTORY is refused");
    t_checkl(lib_bank_path(&lib, "USER", "NEW", path, 10), -1, "a short buffer is refused");
    t_checkl(lib_path(&lib, 99, path, sizeof path), -1, "out of range is refused");
    lib_path(&lib, 6, path, sizeof path);
    t_checkl(patch_read(path, &patch, text, sizeof text), 0, "a listed path reads");

    log_close();

    t_case("the log tells why a file was left out");
    f = fopen(LOG_PATH, "rb");
    n = f != NULL ? (long)fread(text, 1, sizeof text - 1, f) : 0;
    if (f != NULL) fclose(f);
    text[n] = '\0';
    t_check(strstr(text, "USER\\BAD.RBP: [2OP] has no FEEDBACK") != NULL, "the invalid file and its reason");
    t_check(strstr(text, "12.RBP") != NULL, "the bad name");
    t_check(strstr(text, "Folder FACTORY") != NULL && strstr(text, "reserved") != NULL, "the reserved folder");
    t_check(strstr(text, "Folder USER") == NULL, "USER itself is not a complaint");

    t_case("lookup without a USER copy");
    t_checkl(scan(&other, PROG, "\\PLTREE\\EMPTY"), 0, "scan a patches folder with nothing in it");
    t_checkl(other.patches_missing, 0, "it exists");
    t_checkl(lib_count(&other), 2, "just FACTORY");
    t_checkl(lib_find(&other, "BELL"), 0, "BELL is FACTORY\\BELL");
    lib_free(&other);

    t_case("PATCHES= rules");
    t_checkl(scan(&other, PROG, "PATCHES"), 0, "a relative path");
    t_check(strcmp(other.patchdir, "\\PLTREE\\PROG\\PATCHES") == 0, other.patchdir);
    t_checkl(lib_count(&other), 7, "is under the program folder");
    t_checkl(scan(&other, PROG, "\\PLTREE\\EMPTY\\"), 0, "a rooted path");
    t_check(strcmp(other.patchdir, "\\PLTREE\\EMPTY") == 0, other.patchdir);
    t_checkl(scan(&other, PROG, "\\PLTREE\\NOPE"), 0, "a well-formed folder that does not exist");
    t_checkl(other.patches_missing, 1, "is marked");
    t_checkl(scan(&other, PROG, "..\\OUT"), 0, "a path with ..");
    t_check(strcmp(other.patchdir, "\\PLTREE\\PROG\\PATCHES") == 0, "falls back to the default folder");
    t_checkl(other.patches_missing, 0, "without the missing mark");
    t_checkl(scan(&other, PROG, "A*"), 0, "a wildcard");
    t_check(strcmp(other.patchdir, "\\PLTREE\\PROG\\PATCHES") == 0, "falls back too");
    t_checkl(scan(&other, PROG, ""), 0, "an empty value");
    t_check(strcmp(other.patchdir, "\\PLTREE\\PROG\\PATCHES") == 0, "is the default");
    lib_free(&other);

    t_case("lib_put: inserts in its place and keeps the overrides");
    t_checkl(lib_put(&lib, "USER", named("ORGAN", 0, 4)), 4, "USER\\ORGAN sorts after MYFOUR");
    t_check(at(&lib, 4, "USER", "ORGAN") && at(&lib, 5, "BANKA", "A1"), "the banks after it moved down");
    t_checkl(lib_entry(&lib, 4)->overrides, 1, "it overrides FACTORY\\ORGAN");
    t_check(lib.user == 3 && lib_count(&lib) == 8, "counts follow");
    t_checkl(lib_put(&lib, "USER", named("AARDVARK", 1, 3)), 2, "a name before the first goes first in USER");
    t_checkl(lib_entry(&lib, 2)->overrides, 0, "no factory patch of that name, no mark");
    t_checkl(lib_entry(&lib, 2)->has4, 1, "its 4-OP mark and octave");
    t_checkl(lib_entry(&lib, 2)->octave, 3, "are the patch's");
    t_check(at(&lib, 3, "USER", "BELL") && lib_entry(&lib, 3)->overrides == 1, "the override that moved keeps its mark");

    t_case("lib_put: replaces the entry of that name");
    t_checkl(lib_put(&lib, "USER", named("BELL", 1, 2)), 3, "USER\\BELL is found in place");
    t_check(lib_count(&lib) == 9 && lib.user == 4, "nothing added");
    t_check(lib_entry(&lib, 3)->has4 == 1 && lib_entry(&lib, 3)->octave == 2, "its values are the new ones");
    t_checkl(lib_entry(&lib, 3)->overrides, 1, "and it still overrides");

    t_case("lib_put: starts a new bank in its sorted place");
    t_checkl(lib_put(&lib, "BANKM", named("M1", 0, 4)), 8, "BANKM goes between BANKA and BANKZ");
    t_check(at(&lib, 7, "BANKA", "A2") && at(&lib, 9, "BANKZ", "Z1"), "its neighbours");
    t_checkl(lib.banks, 3, "banks follow");
    t_checkl(lib_put(&lib, "ABANK", named("X1", 0, 4)), 6, "a bank before the first other bank");
    t_check(at(&lib, 5, "USER", "ORGAN") && at(&lib, 7, "BANKA", "A1"), "starts after USER");
    t_checkl(lib_find(&lib, "BANKM\\M1"), 9, "and every entry is found");
    t_checkl(lib_put(&lib, "BANKM", named("M0", 0, 4)), 9, "a name before the bank's first goes first");
    t_checkl(lib.banks, 4, "banks");
    lib_bank(&lib, 10, &first, &count);
    t_check(first == 9 && count == 2, "the new bank is contiguous");

    t_case("lib_put: FACTORY marks the USER patch of that name; lib_drop clears it");
    t_checkl(lib_put(&lib, "FACTORY", named("MYFOUR", 0, 4)), 1, "FACTORY\\MYFOUR sorts between BELL and ORGAN");
    t_check(lib.factory == 3 && lib.user == 4, "counts follow");
    t_checkl(lib_find(&lib, "USER\\MYFOUR"), 5, "USER moved down by one");
    t_checkl(lib_entry(&lib, 5)->overrides, 1, "and now overrides");
    t_checkl(lib_drop(&lib, "FACTORY", "MYFOUR"), 0, "drop it");
    t_check(lib_entry(&lib, 4)->overrides == 0 && lib.factory == 2, "the mark goes");

    t_case("lib_drop: removes the entry and the marks follow");
    t_checkl(lib_drop(&lib, "USER", "NOPE"), -1, "a name that is not listed");
    t_checkl(lib_drop(&lib, "NOBANK", "ORGAN"), -1, "a folder that is not listed");
    t_checkl(lib_drop(&lib, "USER", "ORGAN"), 0, "USER\\ORGAN");
    t_checkl(lib_find(&lib, "USER\\ORGAN"), -1, "is gone");
    t_checkl(lib_find(&lib, "ORGAN"), 1, "a bare name finds the FACTORY patch again");
    t_check(lib.user == 3 && lib_count(&lib) == 11, "counts follow");
    t_checkl(lib_find(&lib, "USER\\BELL"), 3, "the entries after it moved up");
    t_check(lib_entry(&lib, 3)->overrides == 1, "and keep their marks");
    t_checkl(lib_drop(&lib, "ABANK", "X1"), 0, "the only entry of a bank");
    t_checkl(lib.banks, 3, "takes the bank with it");
    t_checkl(lib_drop(&lib, "BANKM", "M0"), 0, "one of two");
    t_checkl(lib.banks, 3, "leaves the bank");

    t_case("lib_put on a full list");
    t_checkl(scan(&full, PROG, "\\PLTREE\\EMPTY"), 0, "a library of just FACTORY");
    for (k = 0; lib_count(&full) < LIB_MAX; k++) {
        char name[9];

        sprintf(name, "N%04d", k);
        if (lib_put(&full, "FILL", named(name, 0, 4)) < 0) break;
    }
    t_checkl(lib_count(&full), LIB_MAX, "the list fills to LIB_MAX");
    t_check(full.cap == LIB_MAX, "by growing the block");
    t_checkl(lib_put(&full, "FILL", named("ONEMORE", 0, 4)), -1, "one more is refused");
    t_checkl(lib_put(&full, "OTHER", named("ONE", 0, 4)), -1, "so is a new bank");
    t_check(lib_put(&full, "FILL", named("N0001", 1, 4)) >= 0, "a name already listed is still replaced");
    t_checkl(lib_count(&full), LIB_MAX, "the count is unchanged");
    lib_free(&full);
    lib_free(&lib);

    return t_done();
}
