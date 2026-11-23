/* The patch library: list order, counts, lookup, overrides, 4-OP marks, the reserved and invalid cases, the
   PATCHES= rules, and name and path validation. The tree is built on the DOSBox-X C: at run time. */
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
static Patch patch;
static char path[100];
static char text[1500];

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
    put_patch("PLTREE\\PROG\\PATCHES\\ZPACK\\Z1.RBP", 0, 0, 4);
    put_patch("PLTREE\\PROG\\PATCHES\\APACK\\A2.RBP", 0, 0, 4);
    put_patch("PLTREE\\PROG\\PATCHES\\APACK\\A1.RBP", 0, 0, 4);
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
    FILE *f;

    t_case("name_valid");
    t_check(!name_valid("2") && !name_valid("12"), "all-digit names are refused");
    t_check(name_valid("B2") && name_valid("_1") && name_valid("-") && name_valid("A-1"), "B2, _1 and friends are accepted");
    t_check(name_valid("ABCDEFGH") && !name_valid("ABCDEFGHI"), "1 to 8 characters");
    t_check(!name_valid("") && !name_valid("ab") && !name_valid("A B") && !name_valid("A.B") && !name_valid("A\\B"),
            "empty, lower case, space, dot and slash are refused");
    t_check(folder_valid("PACK1") && !folder_valid("12") && !folder_valid("A.B"), "folder_valid follows the same rule");

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

    t_case("scan: order and counts");
    t_checkl(lib_scan(&lib, PROG, NULL), 0, "scan");
    t_check(at(&lib, 0, "FACTORY", "BELL") && at(&lib, 1, "FACTORY", "ORGAN"), "FACTORY first, sorted");
    t_check(at(&lib, 2, "USER", "BELL") && at(&lib, 3, "USER", "MYFOUR"), "USER next, sorted");
    t_check(at(&lib, 4, "APACK", "A1") && at(&lib, 5, "APACK", "A2") && at(&lib, 6, "ZPACK", "Z1"), "then packs by name");
    t_checkl(lib_count(&lib), 7, "the reserved folder, the invalid file and the bad name are left out");
    t_checkl(lib.factory, 2, "factory patches");
    t_checkl(lib.user, 2, "user patches");
    t_checkl(lib.packs, 2, "pack folders");
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
    t_checkl(lib_find(&lib, "A1"), -1, "a bare name never finds a pack");
    t_checkl(lib_find(&lib, "APACK\\A1"), 4, "a pack is found by its folder");
    t_check(lib_find(&lib, "") == -1 && lib_find(&lib, "NOPE") == -1 && lib_find(&lib, "TOOLONGNAME") == -1 &&
            lib_find(&lib, "\\BELL") == -1 && lib_find(&lib, "USER\\") == -1, "nothing for nothing");
    t_check(lib_find(&lib, "HACK") == -1 && lib_find(&lib, "FACTORY\\HACK") == -1, "the reserved folder's file is not listed");

    t_case("paths");
    t_checkl(lib_path(&lib, 0, path, sizeof path), 0, "factory path");
    t_check(strcmp(path, "\\PLTREE\\PROG\\FACTORY\\BELL.RBP") == 0, path);
    t_checkl(lib_path(&lib, 2, path, sizeof path), 0, "user path");
    t_check(strcmp(path, "\\PLTREE\\PROG\\PATCHES\\USER\\BELL.RBP") == 0, path);
    t_checkl(lib_path(&lib, 6, path, sizeof path), 0, "pack path");
    t_check(strcmp(path, "\\PLTREE\\PROG\\PATCHES\\ZPACK\\Z1.RBP") == 0, path);
    t_checkl(lib_path(&lib, 6, path, 10), -1, "a short buffer is refused");
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
    t_checkl(lib_scan(&other, PROG, "\\PLTREE\\EMPTY"), 0, "scan a patches folder with nothing in it");
    t_checkl(other.patches_missing, 0, "it exists");
    t_checkl(lib_count(&other), 2, "just FACTORY");
    t_checkl(lib_find(&other, "BELL"), 0, "BELL is FACTORY\\BELL");
    lib_free(&other);

    t_case("PATCHES= rules");
    t_checkl(lib_scan(&other, PROG, "PATCHES"), 0, "a relative path");
    t_check(strcmp(other.patchdir, "\\PLTREE\\PROG\\PATCHES") == 0, other.patchdir);
    t_checkl(lib_count(&other), 7, "is under the program folder");
    t_checkl(lib_scan(&other, PROG, "\\PLTREE\\EMPTY\\"), 0, "a rooted path");
    t_check(strcmp(other.patchdir, "\\PLTREE\\EMPTY") == 0, other.patchdir);
    t_checkl(lib_scan(&other, PROG, "\\PLTREE\\NOPE"), 0, "a well-formed folder that does not exist");
    t_checkl(other.patches_missing, 1, "is marked");
    t_checkl(lib_scan(&other, PROG, "..\\OUT"), 0, "a path with ..");
    t_check(strcmp(other.patchdir, "\\PLTREE\\PROG\\PATCHES") == 0, "falls back to the default folder");
    t_checkl(other.patches_missing, 0, "without the missing mark");
    t_checkl(lib_scan(&other, PROG, "A*"), 0, "a wildcard");
    t_check(strcmp(other.patchdir, "\\PLTREE\\PROG\\PATCHES") == 0, "falls back too");
    t_checkl(lib_scan(&other, PROG, ""), 0, "an empty value");
    t_check(strcmp(other.patchdir, "\\PLTREE\\PROG\\PATCHES") == 0, "is the default");
    lib_free(&other);
    lib_free(&lib);

    return t_done();
}
