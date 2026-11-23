/* SPDX-License-Identifier: MIT */
#include <string.h>

#include "screens.h"

#define SAMPLE_VERSION "0.1.0"

const char *sample_version(void)
{
    return SAMPLE_VERSION;
}

void sample_detect(Detect *d)
{
    memset(d, 0, sizeof *d);
    d->chip = 3;
    strcpy(d->card, "Sound Blaster 16");
    d->mouse = 1;
    strcpy(d->folder, "C:\\REBEEP");
    d->cfg_state = 0;
    d->factory = 4;
    d->user = 3;
    d->packs = 1;
    d->patches_ok = 1;
    d->log_ok = 1;
    strcpy(d->log_path, "C:\\REBEEP\\RBSTUDIO.LOG");
}

int sample_known(const char *screen)
{
    return stricmp(screen, "detectlog") == 0 || stricmp(screen, "splash") == 0 || stricmp(screen, "menu") == 0;
}

void sample_draw(const char *screen)
{
    if (stricmp(screen, "detectlog") == 0) {
        Detect d;
        int i;

        sample_detect(&d);
        detlog_begin(SAMPLE_VERSION);
        for (i = 0; i < DETLOG_LINES; i++) detlog_line(&d, i);
    } else if (stricmp(screen, "splash") == 0) {
        splash_draw(SAMPLE_VERSION);
    } else if (stricmp(screen, "menu") == 0) {
        menu_draw(MENU_PATCHES);
    }
}
