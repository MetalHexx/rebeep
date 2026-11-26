/* ReBeep Studio: the resident ReBeep, reached through AMIS (INT 2Dh). While the studio owns the OPL, a loaded ReBeep
   must not trap the speaker and play on the same chip.
   SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_REBEEP_H
#define RBSTUDIO_REBEEP_H

/* Looks for a resident ReBeep (skipped when the INT 2Dh vector is null) and, when its traps are on, turns them off
   (AMIS 13h). Logs what it did. Returns 1 when it turned them off, else 0; nothing is written to the log when no copy
   is loaded. */
int rebeep_suspend(void);

/* Turns the traps back on (AMIS 12h), which re-initialises ReBeep's OPL voice, if rebeep_suspend turned them off.
   Logs it. Safe to call when nothing was suspended. */
void rebeep_resume(void);

#endif
