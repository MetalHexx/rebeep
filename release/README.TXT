ReBeep @VERSION@
Speaker beeps, played on your Sound Blaster's FM chip.
================================================================

Contents
--------
  1  Requirements
  2  Getting Jemm
  3  Quick setup
  4  Options and hotkeys
  5  Testing with RBTEST
  6  Troubleshooting
  7  License and contact


1 Requirements
--------------
  - A 386 or better.
  - MS-DOS 5 or later, or FreeDOS.
  - Jemm 5.84 or later, with its QPIEMU module (section 2).
  - An OPL2 or OPL3 FM chip at port 388h. Sound Blaster cards and most
    clones have one.


2 Getting Jemm
--------------
Jemm is a free memory manager. ReBeep needs its QPIEMU module:

  https://github.com/Baron-von-Riedesel/Jemm/releases

Use 5.84 or later. Version 5.84 is the first with QPIEMU. Version 5.87
is the one this kit is tested with.

  1. Copy JEMMEX.EXE, JLOAD.EXE and QPIEMU.DLL to C:\JEMM.

  2. Add these two lines to CONFIG.SYS:

       DEVICE=C:\JEMM\JEMMEX.EXE NOEMS X=TEST NOVME NOINVLPG
       DOS=HIGH,UMB

  3. Add this line to AUTOEXEC.BAT, before ReBeep is loaded:

       C:\JEMM\JLOAD.EXE C:\JEMM\QPIEMU.DLL

FreeDOS caveat: FreeDOS ships an older Jemm, and its live image has no
JLOAD. Use C:\JEMM with full paths, as above, and keep C:\JEMM first on
PATH so that the newer copy is found.


3 Quick setup
-------------
  1. Run INSTALL from the folder that holds REBEEP.COM. It copies the
     files to C:\REBEEP, or to the folder you name:

       INSTALL [dir]

  2. Then pick one way to start ReBeep:

     - Add the lines that INSTALL prints to CONFIG.SYS and AUTOEXEC.BAT.

     - Start from a sample in SAMPLES\MSDOS or SAMPLES\FREEDOS. Each one
       has a boot menu entry for ReBeep. Save your own file before you
       copy a sample over it.

     - Leave your configs alone and use RBPLAY. It loads ReBeep for one
       game and unloads it after the game exits:

       RBPLAY GAME.EXE [args]

  RBPLAY needs JEMMEX in CONFIG.SYS (section 2). If Jemm is not in
  C:\JEMM, set RBJEMM to its folder first:

       SET RBJEMM=D:\JEMM


4 Options and hotkeys
---------------------
  REBEEP [/F | /P:n] [/V:n] [/K:xy] [/ON | /OFF] [/S] [/U] [/?]

  /F      faithful square-wave voice (default)
  /P:n    built-in patch n, 1 to 4: 1 Organ, 2 Flute, 3 Brass, 4 Bell
  /V:n    volume, 0 to 15 (default 12)
  /K:xy   Ctrl+Alt+x toggles, Ctrl+Alt+y cycles the voice (default BN)
  /ON     trap the speaker again
  /OFF    stop trapping and release the OPL to the game
  /S      status
  /U      unload
  /?      this help

/S, /U, /ON and /OFF act only on a loaded copy. On a loaded copy, any
other option changes only what it names.

Hotkeys, with the defaults:

  Ctrl+Alt+B   turn translation on or off
  Ctrl+Alt+N   cycle the voice

Exit codes, also in ERRORLEVEL:

   0  ok                        5  speaker ports already trapped
   1  bad option                6  a different version is loaded
   2  CPU below 386             7  not loaded
   3  no QPIEMU (Jemm)          8  unload refused
   4  no OPL at 388h            9  other failure


5 Testing with RBTEST
---------------------
RBTEST.COM plays speaker test cases. Run it with no options for a menu:
keys 1 to 9 play a case, and Esc quits. Its options are:

  RBTEST           menu: 1-9 plays a case, Esc quits
  RBTEST /C:n      play case n (1 to 9) once
  RBTEST /A        unattended behaviour checks (PASS and FAIL lines)
  RBTEST /A /R     also require ReBeep and check its state
  RBTEST /M:SAVE   save the largest free block to RBMEM.DAT
  RBTEST /M:SAME x compare it with the saved value, as test x
  RBTEST /B        time OUT 61h against OUT 80h
  RBTEST /?        this help

RBTEST exits with 0 when every check passed, and 1 otherwise.


6 Troubleshooting
-----------------
Messages, and what to do about each:

  "Bad option. Run REBEEP /? for the options."
      A switch is misspelled or out of range. Check it with REBEEP /?.

  "ReBeep needs a 386 or better."
      The CPU is below a 386, so ReBeep cannot run on it.

  "QPIEMU is not loaded. Run JLOAD QPIEMU.DLL first (see README.TXT)."
      Run JLOAD C:\JEMM\QPIEMU.DLL, as in section 2.

  "No OPL2/OPL3 found at port 388h."
      No FM chip answers at 388h. ReBeep needs a Sound Blaster, or a
      card with an OPL2 or OPL3 at that port.

  "No free AMIS multiplex number."
      Every AMIS slot is in use by other resident programs. Unload one
      of them and try again.

  "Another program already traps the speaker ports (for example
   SBEMU's PC-speaker feature)."
      Turn off that program's PC-speaker feature. Only one program can
      trap the speaker ports.

  "... is loaded. Use that version's REBEEP to change or unload it."
      A different ReBeep version is resident. Run REBEEP from that
      version's folder to change or unload it.

  "ReBeep is not loaded."
      /S, /U, /ON and /OFF need a loaded copy. Load it with REBEEP,
      then run the command again.

  "Can't unload: another program hooked in after ReBeep. Unload it
   first."
      Unload the program that loaded after ReBeep, then run REBEEP /U.

  "DOS would not free ReBeep's memory."
      Reboot to clear the resident copy.

Other problems:

  Games with their own FM music
      A game that drives the OPL itself can clash with ReBeep. Run
      REBEEP /OFF first, which releases the OPL to the game, or REBEEP
      /U to unload. The hotkey is not enough: on an OPL3, ReBeep keeps
      the chip in OPL3 mode while it is trapping.

  A hotkey that does not fire
      Some games take over the keyboard interrupt, so Ctrl+Alt keys do
      nothing in them. Set the state before you start the game, with
      REBEEP /ON or REBEEP /OFF.

  Games that toggle the speaker heavily
      A game that toggles the speaker very often can run slowly while
      ReBeep translates. Run REBEEP /OFF before starting it.


7 License and contact
---------------------
ReBeep is released under the MIT License. See LICENSE in the source
repository. Source and issues:

  https://github.com/MetalHexx/rebeep
