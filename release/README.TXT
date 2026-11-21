ReBeep @VERSION@
Speaker beeps, played on your Sound Blaster's FM chip.
================================================================

Contents
--------
  1  Requirements
  2  Getting Jemm
  3  Setting up
  4  Options and hotkeys
  5  Testing with RBTEST
  6  Troubleshooting
  7  License and contact

The same guide, with more detail, is online:

  https://github.com/MetalHexx/rebeep/tree/main/docs/guide


1 Requirements
--------------
  - A 386 or better.
  - MS-DOS 5 or later, or FreeDOS, booted to plain DOS: not a DOS window
    inside Windows.
  - Jemm 5.87 or later, with its QPIEMU module (section 2).
  - An OPL2 or OPL3 FM chip at port 388h. Sound Blaster cards and most
    clones have one.


2 Getting Jemm
--------------
Jemm is a free memory manager. It replaces HIMEM.SYS and EMM386.EXE, and
its QPIEMU module is what lets ReBeep catch the speaker:

  https://github.com/Baron-von-Riedesel/Jemm/releases

Use 5.87 or later. It is the version this kit is tested with. Copy three
files from its zip to C:\JEMM:

  JEMMEX.EXE   the memory manager
  JLOAD.EXE    loads Jemm modules
  QPIEMU.DLL   the module ReBeep needs

FreeDOS caveat: FreeDOS ships an older Jemm, and its live image has no
JLOAD. Use C:\JEMM with full paths, as below, and keep C:\JEMM first on
PATH so that the newer copy is found.


3 Setting up
------------
This adds a ReBeep entry to your boot menu, so your usual setup stays a
pick away. A boot menu needs MS-DOS 6 or later.

The menu is optional, but handy: pick your usual entry for games that
don't use the speaker, and ReBeep and Jemm stay out of their way. Without
one (MS-DOS 5, or by choice), replace HIMEM.SYS and EMM386.EXE in
CONFIG.SYS with the lines INSTALL prints, add its AUTOEXEC.BAT lines, and
ReBeep loads on every boot.

  1. Back up your boot files:

       COPY C:\CONFIG.SYS C:\CONFIG.BAK
       COPY C:\AUTOEXEC.BAT C:\AUTOEXEC.BAK

     If an edit stops the PC from booting, press F5 when "Starting
     MS-DOS..." appears (MS-DOS 6), or boot from a DOS floppy. Then copy
     the .BAK files back.

  2. Run INSTALL from the folder that holds REBEEP.COM. It copies the
     files to C:\REBEEP, or to the folder you name, and edits nothing:

       INSTALL [dir]

     If INSTALL fails, as it can on Windows 98's DOS with "Invalid drive
     or directory", copy the files by hand:

       MD C:\REBEEP
       COPY A:\*.* C:\REBEEP

  3. Add the ReBeep entry. With no boot menu yet, make CONFIG.SYS look
     like this. Move your own HIMEM.SYS and EMM386.EXE lines into
     [NORMAL], and the rest of what you load into [COMMON]:

       [MENU]
       MENUITEM=REBEEP, ReBeep (Jemm + QPIEMU)
       MENUITEM=NORMAL, My usual setup
       MENUDEFAULT=REBEEP,5

       [REBEEP]
       DEVICE=C:\JEMM\JEMMEX.EXE NOEMS X=TEST NOVME NOINVLPG
       DOS=HIGH,UMB

       [NORMAL]
       DEVICE=C:\DOS\HIMEM.SYS
       DEVICE=C:\DOS\EMM386.EXE
       DOS=HIGH,UMB

       [COMMON]
       FILES=40
       BUFFERS=20

     Then add these to the end of AUTOEXEC.BAT, and add ;C:\REBEEP to
     the end of your PATH line:

       IF "%CONFIG%"=="REBEEP" C:\JEMM\JLOAD.EXE C:\JEMM\QPIEMU.DLL
       IF "%CONFIG%"=="REBEEP" LH C:\REBEEP\REBEEP.COM

     SAMPLES\MSDOS holds a complete pair of files like these, and
     SAMPLES\FREEDOS the same entry for FreeDOS.

     Already have a boot menu, as many Windows 98 game PCs do? Add a
     MENUITEM=RB line, and an [RB] block with the JEMMEX.EXE line (and
     DOS=HIGH,UMB if [COMMON] lacks it). If AUTOEXEC.BAT uses GOTO
     %CONFIG%, add:

       :RB
       C:\JEMM\JLOAD.EXE C:\JEMM\QPIEMU.DLL
       LH C:\REBEEP\REBEEP.COM
       GOTO END

     Point the GOTO at the label your other entries finish on.

  4. Reboot and pick the ReBeep entry. You should see:

       ReBeep x.y.z loaded in upper memory, nnnn bytes resident.

     Then run RBTEST /C:1. The tones should come from the sound card,
     not the PC speaker.

What the JEMMEX.EXE options do:

  NOEMS      no EMS page frame. Remove it for a game that needs EMS.
  X=TEST     use only upper memory that reads as empty.
  NOVME      leave off the Pentium's V86 mode extensions.
  NOINVLPG   skip the 486's INVLPG instruction (helps in emulators).

JEMMEX.EXE does the job of HIMEM.SYS and EMM386.EXE, so the ReBeep entry
loads neither. LH loads ReBeep into upper memory.

To undo: pick another entry at the boot menu, or copy the .BAK files
back.

To play one game without the boot entry's AUTOEXEC.BAT lines, use RBPLAY.
It loads ReBeep, runs the game, and unloads ReBeep after it. It needs
JEMMEX.EXE in CONFIG.SYS. If Jemm is not in C:\JEMM, set RBJEMM first:

       SET RBJEMM=D:\JEMM
       RBPLAY GAME.EXE [args]


4 Options and hotkeys
---------------------
  REBEEP [/F | /P:n] [/V:n] [/L:n] [/R:n] [/K:xy] [/ON | /OFF] [/S] [/U] [/?]

  /F      faithful square-wave voice (default)
  /P:n    built-in patch n, 1 to 4: 1 Organ, 2 Flute, 3 Brass, 4 Bell
  /V:n    volume, 0 to 15 (default 12)
  /L:n    notes below 20 Hz: 0 silent (default), 1 played
  /R:n    sounds it can't translate: 1 speaker (default), 0 muted
  /K:xy   Ctrl+Alt+x toggles, Ctrl+Alt+y cycles the voice (default BN)
  /ON     trap the speaker again
  /OFF    stop trapping and release the OPL to the game
  /S      status
  /U      unload
  /?      this help

/S, /U, /ON and /OFF act only on a loaded copy. On a loaded copy, any
other option changes only what it names.

Some games use a pitch below 20 Hz as a rest, as Grand Prix Circuit's
engine does. /L:0 keeps those silent, close to what the real speaker
does with them. /L:1 plays them as a low FM note.

Clicks, noise and pitches above the FM chip's range can't become an FM
note, so they play on the real speaker (/R:1). /R:0 mutes them, and only
the FM chip sounds. The game then loses whatever it played that way, such
as Grand Prix Circuit's percussion.

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
keys 0 to 9 play a case, and Esc quits. Its options are:

  RBTEST           menu: 0-9 plays a case, Esc quits
  RBTEST /C:n      play case n (0 to 9) once
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
      Only one program can trap the speaker ports. For SBEMU, start it
      with /PCS0 to turn its PC-speaker emulation off.

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
      Some games, such as Grand Prix Circuit, take over the keyboard
      interrupt, so Ctrl+Alt keys do nothing in them. They still work at
      the DOS prompt. Set the voice (REBEEP /F or REBEEP /P:n), or run
      REBEEP /OFF, before you start the game.

  Games that toggle the speaker heavily
      A game that toggles the speaker very often can run slowly while
      ReBeep translates. Run REBEEP /OFF before starting it.


7 License and contact
---------------------
ReBeep is released under the MIT License. See LICENSE in the source
repository. Source and issues:

  https://github.com/MetalHexx/rebeep
