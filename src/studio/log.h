/* ReBeep Studio: RBSTUDIO.LOG, replaced each run and committed line by line so a crash leaves the trail.
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_LOG_H
#define RBSTUDIO_LOG_H

/* Creates (replaces) the log at `path`. Returns 0, or -1 when it cannot be opened: every later call is then a
   no-op and log_ok() returns 0. */
int log_open(const char *path);

/* Turns log_trace on or off (the /TRACE switch). Off by default. */
void log_set_trace(int on);

/* printf-style: writes the line plus CRLF and commits it to disk at once (DOS 68h). Lines over 160 chars are cut.
   A failed write closes the log and log_ok() then returns 0. */
void log_line(const char *fmt, ...);

/* As log_line, only while tracing is on. */
void log_trace(const char *fmt, ...);

/* 1 while the log is open and writable. */
int log_ok(void);

/* Closes the log. Safe to call when it is not open. */
void log_close(void);

#endif
