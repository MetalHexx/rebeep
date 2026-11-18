ReBeep delivery disk (D:)
=========================

The host rewrites this disk on every "rebeep disk deploy". Anything you
save here is lost on the next deploy. Keep your own files on C:.

  ENV\BOOT.BAT          Run by AUTOEXEC on every boot. Loads QPIEMU on
                        the "ReBeep dev" menu entry.
  ENV\MSDOS622\         One-time C: setup for MS-DOS 6.22 (INSTALL.BAT)
  ENV\FREEDOS\          One-time C: setup for FreeDOS (INSTALL.BAT)
  JEMM\                 Jemm memory manager, JLOAD and QPIEMU
  GAMES\<NAME>\         Your games, from "rebeep media add game"
  REBEEP\               The latest ReBeep build
