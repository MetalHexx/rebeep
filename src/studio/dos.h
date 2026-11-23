/* ReBeep Studio: DOS plumbing. Every vector the program hooks goes through dos_hook(), and one
   dos_restore() puts them all back. SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_DOS_H
#define RBSTUDIO_DOS_H

typedef void (__interrupt __far *isr_t)();

/* Remembers argv[0]'s folder, hooks INT 1Bh and 23h (Ctrl+Break and Ctrl+C do nothing) and INT 24h
   (a critical error fails the call), and arranges for dos_restore() to run at exit. */
void dos_init(const char *argv0);

/* Installs `handler` on `intno`. The old vector is stored in *old before the new one goes live,
   so the handler may chain to it at once. */
void dos_hook(unsigned intno, isr_t handler, isr_t *old);

/* Puts back every hooked vector, newest first. Safe to call again. Called on every exit path. */
void dos_restore(void);

/* The folder the program was started from, with its trailing backslash; "" when DOS gave no path. */
const char *dos_program_dir(void);

#endif
