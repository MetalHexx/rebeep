/* Result printing for the studio T_* test programs. SPDX-License-Identifier: MIT */
#include <stdio.h>
#include <string.h>

#include "testlib.h"

#define NAME_LEN 60
#define DETAIL_LEN 160

static char case_name[NAME_LEN + 1];
static char detail[DETAIL_LEN + 1];
static int case_open;
static int case_failed;
static int total;
static int failures;

static void close_case(void)
{
    if (!case_open) return;
    if (case_failed) {
        printf("FAIL %s: %s\n", case_name, detail);
        failures++;
    } else {
        printf("PASS %s\n", case_name);
    }
    fflush(stdout);
    total++;
    case_open = 0;
}

void t_case(const char *name)
{
    close_case();
    strncpy(case_name, name, NAME_LEN);
    case_name[NAME_LEN] = '\0';
    detail[0] = '\0';
    case_open = 1;
    case_failed = 0;
}

static void fail(const char *text)
{
    if (!case_open) t_case("(no case)");
    if (case_failed) return;
    strncpy(detail, text, DETAIL_LEN);
    detail[DETAIL_LEN] = '\0';
    case_failed = 1;
}

void t_check(int ok, const char *what)
{
    if (!ok) fail(what);
}

void t_checkl(long got, long want, const char *what)
{
    char text[DETAIL_LEN + 1];

    if (got != want) {
        sprintf(text, "%.80s: got %ld, want %ld", what, got, want);
        fail(text);
    }
}

int t_done(void)
{
    close_case();
    printf("DONE %d\n", total);
    fflush(stdout);
    return failures ? 1 : 0;
}
