/* SPDX-License-Identifier: MIT */
#include <dos.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include "log.h"

#define LINE_MAX_LEN 160

static int handle = -1;
static int trace_on;

int log_open(const char *path)
{
    log_close();
    if (_dos_creat(path, _A_NORMAL, &handle) != 0) {
        handle = -1;
        return -1;
    }
    return 0;
}

void log_set_trace(int on)
{
    trace_on = on;
}

static void write_line(const char *fmt, va_list args)
{
    static char buf[LINE_MAX_LEN + 3];
    unsigned len;
    unsigned wrote;

    if (handle < 0) return;
    vsnprintf(buf, LINE_MAX_LEN + 1, fmt, args);
    len = (unsigned)strlen(buf);
    strcpy(buf + len, "\r\n");
    len += 2;
    if (_dos_write(handle, buf, len, &wrote) != 0 || wrote != len || _dos_commit(handle) != 0) log_close();
}

void log_line(const char *fmt, ...)
{
    va_list args;

    va_start(args, fmt);
    write_line(fmt, args);
    va_end(args);
}

void log_trace(const char *fmt, ...)
{
    va_list args;

    if (!trace_on) return;
    va_start(args, fmt);
    write_line(fmt, args);
    va_end(args);
}

int log_ok(void)
{
    return handle >= 0;
}

void log_close(void)
{
    if (handle >= 0) _dos_close(handle);
    handle = -1;
}
