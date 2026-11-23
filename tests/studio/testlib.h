/* Result printing for the studio T_* test programs; the C mirror of tests/interpreter/testlib.inc. */
#ifndef TESTLIB_H
#define TESTLIB_H

/* Opens a case; the previous one is closed. */
void t_case(const char *name);

/* Records the first failure in the case. */
void t_check(int ok, const char *what);

/* As t_check for numbers: the failure reads "what: got N, want M". */
void t_checkl(long got, long want, const char *what);

/* Closes the last case, prints "DONE <n>" and returns the program's exit code (0 when every case passed). */
int t_done(void);

#endif
