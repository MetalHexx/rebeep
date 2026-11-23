/* The patch file: the shipped factory patches, round trips, and every shape the parser must accept or refuse.
   The case list is shared with the game's NASM parser test. */
#include <stdio.h>
#include <string.h>

#include "testlib.h"
#include "../../src/studio/dos.h"
#include "../../src/studio/patch.h"

#define OPA "15 0 15 12 39 0 2 0 0 0 1 0"
#define HEAD "[PATCH]\r\nFORMAT=1\r\nOCTAVE=4\r\n"
#define TWO "[2OP]\r\nCONNECTION=FM\r\nFEEDBACK=3\r\nOP1=" OPA "\r\nOP2=" OPA "\r\n"
#define FOUR "[4OP]\r\nCONNECTION=AM-FM\r\nFEEDBACK=1\r\nOP1=" OPA "\r\nOP2=" OPA "\r\nOP3=" OPA "\r\nOP4=" OPA "\r\n"

static Patch patch;
static Patch again;
static char err[80];
static char buf[PATCH_FILE_MAX + 1];
static char big[3001];

static int parse_text(const char *text)
{
    err[0] = '\0';
    return patch_parse(text, (unsigned)strlen(text), &patch, err, sizeof err);
}

static void expect_ok(const char *what, const char *text)
{
    t_checkl(parse_text(text), 0, what);
}

static void expect_bad(const char *what, const char *text)
{
    t_checkl(parse_text(text), -1, what);
    t_check(err[0] != '\0', "a refused file gives a reason");
}

static void write_text(const char *path, const char *text)
{
    FILE *f = fopen(path, "wb");

    if (f != NULL) {
        fwrite(text, 1, strlen(text), f);
        fclose(f);
    }
}

static void check_factory(const char *file, const char *name, int conn, int fb, int sl1, int ar1, int ol2)
{
    char path[40];

    sprintf(path, "FACTORY\\%s", file);
    t_case(file);
    t_checkl(patch_read(path, &patch, err, sizeof err), 0, "the shipped file parses");
    t_check(strcmp(patch.name, name) == 0, "named after the file");
    t_checkl(patch.octave, 4, "octave");
    t_checkl(patch.has4, 0, "two-operator only");
    t_checkl(patch.v2.conn, conn, "connection");
    t_checkl(patch.v2.fb, fb, "feedback");
    t_checkl(patch.v2.op[0].v[P_SL], sl1, "operator 1 sustain level");
    t_checkl(patch.v2.op[0].v[P_AR], ar1, "operator 1 attack");
    t_checkl(patch.v2.op[1].v[P_OL], ol2, "operator 2 output level");
    t_checkl(patch_format(&patch, buf, sizeof buf) > 0, 1, "formats");
    t_checkl(patch_parse(buf, (unsigned)strlen(buf), &again, err, sizeof err), 0, "the formatted text reparses");
    t_check(patch_equal(&patch, &again), "and is equal");
}

int main(void)
{
    int i;
    int n;

    check_factory("ORGAN.RBP", "ORGAN", 1, 0, 15, 15, 55);
    check_factory("FLUTE.RBP", "FLUTE", 0, 0, 15, 11, 63);
    check_factory("BRASS.RBP", "BRASS", 0, 5, 15, 14, 63);
    check_factory("BELL.RBP", "BELL", 0, 0, 13, 15, 63);

    t_case("format: layout and round trip with a 4-OP voice");
    expect_ok("a full file parses", HEAD TWO FOUR);
    t_checkl(patch.has4, 1, "has4");
    t_checkl(patch.v4.conn, 1, "AM-FM is 1");
    n = patch_format(&patch, buf, sizeof buf);
    t_check(n > 0 && n <= PATCH_FILE_MAX, "fits in the file limit");
    t_check(strstr(buf, "\r\nOP4=") != NULL, "has an OP4 line");
    t_check(strstr(buf, "\n") != NULL && strstr(buf, "\r\n") != NULL, "written with CRLF");
    for (i = 0; i < n; i++) {
        if (buf[i] == '\n' && (i == 0 || buf[i - 1] != '\r')) break;
    }
    t_checkl(i, n, "every line end is CRLF");
    t_check(buf[0] == ';', "starts with a comment");
    t_checkl(patch_parse(buf, (unsigned)n, &again, err, sizeof err), 0, "reparses");
    t_check(patch_equal(&patch, &again), "equal after the round trip");
    t_checkl(patch_format(&patch, buf, 100), -1, "a short buffer is refused");

    t_case("four-operator connections");
    expect_ok("FM-AM", HEAD TWO "[4OP]\r\nCONNECTION=FM-AM\r\nFEEDBACK=0\r\nOP1=" OPA "\r\nOP2=" OPA "\r\nOP3=" OPA
                                "\r\nOP4=" OPA "\r\n");
    t_checkl(patch.v4.conn, 2, "FM-AM is 2");
    expect_ok("AM-AM", HEAD TWO "[4OP]\r\nCONNECTION=am-am\r\nFEEDBACK=0\r\nOP1=" OPA "\r\nOP2=" OPA "\r\nOP3=" OPA
                                "\r\nOP4=" OPA "\r\n");
    t_checkl(patch.v4.conn, 3, "AM-AM is 3");

    t_case("defaults and layout freedoms");
    expect_ok("octave defaults to 4", "[PATCH]\r\nFORMAT=1\r\n" TWO);
    t_checkl(patch.octave, 4, "default octave");
    expect_ok("LF line ends", "[PATCH]\nFORMAT=1\nOCTAVE=6\n[2OP]\nCONNECTION=AM\nFEEDBACK=7\nOP1=" OPA "\nOP2=" OPA "\n");
    t_checkl(patch.octave, 6, "octave");
    t_checkl(patch.v2.conn, 1, "AM");
    expect_ok("no final line end", "[PATCH]\nFORMAT=1\n[2OP]\nCONNECTION=AM\nFEEDBACK=7\nOP1=" OPA "\nOP2=" OPA);
    expect_ok("comments, blank lines, unknown keys and sections",
              "; top\r\n\r\n[patch]\r\n; note\r\nFORMAT=1\r\nAUTHOR=me\r\n[EXTRA]\r\nFORMAT=9\r\nOP1=junk\r\n" TWO
              "OP3=not read in a 2OP voice\r\n");
    t_checkl(patch.v2.fb, 3, "the real values are read");
    expect_ok("trailing spaces and tabs, padding around keys",
              "[PATCH] \r\n FORMAT = 1 \t\r\n[2OP]\r\n\tCONNECTION\t=\tFM \r\nFEEDBACK=0 \r\nOP1=" OPA " \t\r\nOP2 = " OPA "\r\n");
    expect_ok("runs of spaces and tabs between numbers",
              "[PATCH]\r\nFORMAT=1\r\n[2OP]\r\nconnection=fm\r\nfeedback=0\r\n"
              "op1=15   0\t15 12  39 0\t\t2 0 0 0 1   0\r\nOP2=" OPA "\r\n");
    t_checkl(patch.v2.op[0].v[P_MULT], 2, "numbers keep their place");
    t_checkl(patch.v2.conn, 0, "lower-case FM");

    t_case("refused files");
    expect_bad("no [2OP]", HEAD);
    expect_bad("no [PATCH]", TWO);
    expect_bad("no FORMAT", "[PATCH]\r\nOCTAVE=4\r\n" TWO);
    expect_bad("FORMAT=2", "[PATCH]\r\nFORMAT=2\r\n" TWO);
    expect_bad("FORMAT=x", "[PATCH]\r\nFORMAT=x\r\n" TWO);
    expect_bad("a short OPn", HEAD "[2OP]\r\nCONNECTION=FM\r\nFEEDBACK=0\r\nOP1=15 0 15 12 39 0 2 0 0 0 1\r\nOP2=" OPA "\r\n");
    expect_bad("a long OPn", HEAD "[2OP]\r\nCONNECTION=FM\r\nFEEDBACK=0\r\nOP1=" OPA " 0\r\nOP2=" OPA "\r\n");
    expect_bad("an out-of-range value", HEAD "[2OP]\r\nCONNECTION=FM\r\nFEEDBACK=0\r\nOP1=" OPA "\r\nOP2=15 0 15 12 64 0 1 0 0 0 1 0\r\n");
    expect_bad("a non-number", HEAD "[2OP]\r\nCONNECTION=FM\r\nFEEDBACK=0\r\nOP1=" OPA "\r\nOP2=15 0 15 12 x 0 1 0 0 0 1 0\r\n");
    expect_bad("a huge number", HEAD "[2OP]\r\nCONNECTION=FM\r\nFEEDBACK=0\r\nOP1=" OPA "\r\nOP2=15 0 15 12 99999999 0 1 0 0 0 1 0\r\n");
    expect_bad("FEEDBACK=8", "[PATCH]\r\nFORMAT=1\r\n[2OP]\r\nCONNECTION=FM\r\nFEEDBACK=8\r\nOP1=" OPA "\r\nOP2=" OPA "\r\n");
    expect_bad("OCTAVE=8", "[PATCH]\r\nFORMAT=1\r\nOCTAVE=8\r\n" TWO);
    expect_bad("CONNECTION=XX", "[PATCH]\r\nFORMAT=1\r\n[2OP]\r\nCONNECTION=XX\r\nFEEDBACK=0\r\nOP1=" OPA "\r\nOP2=" OPA "\r\n");
    expect_bad("a 4-OP connection in 2OP", "[PATCH]\r\nFORMAT=1\r\n[2OP]\r\nCONNECTION=FM-FM\r\nFEEDBACK=0\r\nOP1=" OPA "\r\nOP2=" OPA "\r\n");
    expect_bad("a missing OP2", "[PATCH]\r\nFORMAT=1\r\n[2OP]\r\nCONNECTION=FM\r\nFEEDBACK=0\r\nOP1=" OPA "\r\n");
    expect_bad("a half [4OP]", HEAD TWO "[4OP]\r\nCONNECTION=FM-FM\r\nFEEDBACK=0\r\nOP1=" OPA "\r\nOP2=" OPA "\r\n");
    expect_bad("a duplicate key", HEAD "[2OP]\r\nCONNECTION=FM\r\nFEEDBACK=0\r\nFEEDBACK=1\r\nOP1=" OPA "\r\nOP2=" OPA "\r\n");
    expect_bad("a duplicate OPn", HEAD TWO "OP1=" OPA "\r\n");
    expect_bad("a duplicate section header", HEAD TWO "[2OP]\r\nCONNECTION=FM\r\n");
    expect_bad("a duplicate [PATCH]", HEAD HEAD TWO);
    expect_bad("a broken section header", HEAD "[2OP\r\n");

    t_case("size limit");
    memset(big, ' ', sizeof big - 1);
    memcpy(big, HEAD TWO, strlen(HEAD TWO));
    t_checkl(patch_parse(big, 2048, &patch, err, sizeof err), 0, "2048 bytes is accepted");
    t_checkl(patch_parse(big, 2049, &patch, err, sizeof err), -1, "2049 bytes is refused");
    t_checkl(patch_parse(big, 3000, &patch, err, sizeof err), -1, "3000 bytes is refused");

    t_case("the reason names the file and the line");
    write_text("BRASS.RBP", HEAD "[2OP]\r\nCONNECTION=FM\r\nFEEDBACK=0\r\nOP1=15 0 15 12 64 0 1 0 0 0 1 0\r\nOP2=" OPA "\r\n");
    t_checkl(patch_read("BRASS.RBP", &patch, err, sizeof err), -1, "refused");
    t_check(strcmp(err, "BRASS.RBP line 7: OL 64 is over 63") == 0, err);
    write_text("NOTWO.RBP", HEAD);
    t_checkl(patch_read("NOTWO.RBP", &patch, err, sizeof err), -1, "refused");
    t_check(strcmp(err, "NOTWO.RBP: no [2OP] section") == 0, err);
    t_checkl(patch_read("NOFILE.RBP", &patch, err, sizeof err), -1, "a missing file is refused");

    t_case("patch_write: safe save, folder creation, overwrite");
    patch_read("FACTORY\\BELL.RBP", &patch, err, sizeof err);
    t_checkl(patch_write("PFTMP\\USER\\X.RBP", &patch), 0, "creates the folders and saves");
    t_checkl(patch_read("PFTMP\\USER\\X.RBP", &again, err, sizeof err), 0, "reads back");
    t_check(patch_equal(&patch, &again) && strcmp(again.name, "X") == 0, "equal, named X");
    patch.v2.fb = 6;
    t_checkl(patch_write("PFTMP\\USER\\X.RBP", &patch), 0, "overwrites");
    patch_read("PFTMP\\USER\\X.RBP", &again, err, sizeof err);
    t_checkl(again.v2.fb, 6, "the new value is there");
    t_check(!dos_is_file("PFTMP\\USER\\X.BAK") && !dos_is_file("PFTMP\\USER\\X.$$$"), "no .BAK or .$$$ left");

    t_case("patch_equal ignores the name");
    patch_read("FACTORY\\BELL.RBP", &patch, err, sizeof err);
    again = patch;
    strcpy(again.name, "OTHER");
    t_check(patch_equal(&patch, &again), "same values, other name");
    again.v2.op[1].v[P_RR] ^= 1;
    t_check(!patch_equal(&patch, &again), "a changed value differs");

    return t_done();
}
