ReBeep @VERSION@
Speaker beeps, played on your Sound Blaster's FM chip.
================================================================

Contents
--------
  1  Requirements
  2  Getting Jemm
  3  Setting up
  4  Options and hotkeys
  5  ReBeep Studio
  6  Testing with RBTEST
  7  Troubleshooting
  8  License and contact

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

  2. Run INSTALL from the folder that holds REBEEP.COM. Its menu installs
     ReBeep in C:\REBEEP, or updates a copy already there. It copies the
     files and edits nothing. To use another folder, name it:

       INSTALL D:\REBEEP

     INSTALL /I installs and INSTALL /U updates without the menu. The
     menu needs CHOICE, which MS-DOS 5 lacks, so use them there.

     If ReBeep is already loaded, reboot to load the new copy.

     If INSTALL fails, copy the files by hand:

       MD C:\REBEEP
       COPY A:\*.* C:\REBEEP
       MD C:\REBEEP\FACTORY
       MD C:\REBEEP\FACTORY\PATCHES
       COPY A:\FACTORY\PATCHES\*.* C:\REBEEP\FACTORY\PATCHES

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
  REBEEP [/F | /P:name | /G:name] [/V:n] [/L:n] [/R:n] [/K:xy]
         [/ON | /OFF] [/S] [/U] [/?]

  /F      faithful square-wave voice (default)
  /P:name a patch: FOLDER\NAME, or NAME from USER then FACTORY (the four that
          come with ReBeep are ORGAN, FLUTE, BRASS and BELL)
  /G:name a game profile, PROFILES\name: its rules pick the patch
  /V:n    volume, 0 to 15 (default 12)
  /L:n    notes below 20 Hz: 0 silent (default), 1 played
  /R:n    sounds it can't translate: 1 speaker (default), 0 muted
  /K:xy   Ctrl+Alt+x toggles, Ctrl+Alt+y switches the voice (default BN)
  /ON     trap the speaker again
  /OFF    stop trapping and release the OPL to the game
  /S      status
  /U      unload
  /?      this help

/S, /U, /ON and /OFF act only on a loaded copy. On a loaded copy, any
other option changes only what it names. With neither /F nor /P:, a PATCH=
line in RBSTUDIO.CFG (section 5) picks the patch at load. A patch ReBeep
can't use is a message, and the faithful voice plays. Give one of /F, /P:
and /G: at a time; on a loaded copy, /P: or /F ends a profile.

A game profile gives each part of a game its own patch, told apart by what
the game sends the speaker. None comes with ReBeep yet: you write your own.
REBEEP /G:MYGAME loads PROFILES\MYGAME\MYGAME.RBG and the patches beside
it. A profile is a text file such as this one:

  [PROFILE]
  FORMAT=1
  DEFAULT=MENU
  [RULE]
  ID=RACE
  STEP=CTRL B6h
  STEP=NOTE C22Eh 40
  PATCH=ENGINE
  [EFFECT]
  WHILE=RACE
  PITCH=0950h 50
  PATCH=SQUEAL

DEFAULT= names the patch that plays first, MENU.RBP in the profile's
folder; it wins over RBSTUDIO.CFG's PATCH= line. Each [RULE], up to 16, is
tried in order, and the first to match picks its PATCH=, which plays until
another rule picks a different one. A rule has up to 4 STEP= lines, each
matching the next event of its kind: NOTE n t, a note starts within t of
the count n; CHANGE n t, a sounding note changes to that count; PITCH n t,
either; OFF, a note stops; CTRL n, the game writes n to port 43h. Leave out
n to take any.

An [EFFECT], up to 8, gives a sound effect a patch of its own: while a note
is within t of the count n in PITCH=n t (n - t at least 193), it plays in
the effect's PATCH= on an FM channel of its own, then the rule's patch
takes it back. Effects don't play in the faithful voice. ID= names a rule
(1 to 8 letters, digits, _ or -, not only digits), and WHILE=ID makes a rule
or an effect count only while that rule is the last to have matched. NAME=
gives any section a name of 1 to 24 characters, for a menu later.

A profile has up to 8 patches and 2048 bytes. Numbers are decimal, or hex
with a trailing h, and lines starting with ; are comments. A rule's patch
plays in its own voice, even after Ctrl+Alt+N. A profile ReBeep can't use
is a message, and what was playing goes on.

Some games use a pitch below 20 Hz as a rest, as Grand Prix Circuit's
engine does. /L:0 keeps those silent, close to what the real speaker
does with them. /L:1 plays them as a low FM note.

Clicks, noise and pitches above the FM chip's range can't become an FM
note, so they play on the real speaker (/R:1). /R:0 mutes them, and only
the FM chip sounds. The game then loses whatever it played that way, such
as the click Grand Prix Circuit makes as each song starts and stops.

Hotkeys, with the defaults:

  Ctrl+Alt+B   turn translation on or off
  Ctrl+Alt+N   switch between the faithful voice and the patch

Exit codes, also in ERRORLEVEL:

   0  ok                        5  speaker ports already trapped
   1  bad option                6  a different version is loaded
   2  CPU below 386             7  not loaded
   3  no QPIEMU (Jemm)          8  unload refused
   4  no OPL at 388h            9  other failure


5 ReBeep Studio
----------------
RBSTUDIO.EXE is a full-screen editor for FM patches: shape a voice, play it
on the keyboard, save it, then hear it in a game. It needs an OPL2 or OPL3
at 388h. If ReBeep is loaded, the studio switches it off while it runs and
on again when you quit.

  RBSTUDIO [/VIEW:MONO] [/TRACE] [/?]

  /VIEW:MONO  force the mono view (a monochrome display is noticed without it)
  /TRACE      log every FM chip write and key press to RBSTUDIO.LOG
  /?          help

Its keys are on screen under F1. The main ones: Up and Down move between
rows, Left and Right change a value, Z to M and Q to P play notes, F12
rolls a random sound and F11 nudges it, Ctrl+S opens the Save dialog and
Esc steps back.

Patches are .RBP text files in banks, which are folders:

  FACTORY   ORGAN, FLUTE, BRASS and BELL. INSTALL replaces it on an update.
  USER      your patches, and where the Save dialog starts. A USER patch
            named like a factory one overrides it for /P:name.
  banks     any other folder in the patches folder, such as HEXX. Use them
            as /P:HEXX\ORGAN. The Save dialog can save into one, or make a
            new one. AdLib .BNK files are not read.

USER and the other banks are in the PATCHES folder beside RBSTUDIO.EXE.
To hear a patch in a game, save it in the studio, then run REBEEP /P:name
before the game, and press Ctrl+Alt+N to switch between it and the
faithful voice.

RBSTUDIO.CFG, beside RBSTUDIO.EXE, is optional. INSTALL never creates it or
overwrites it. SAMPLES\RBSTUDIO.CFG is a commented example to copy:

  PATCHES=D:\MYSOUNDS   where USER and the banks are (default: PATCHES)
  PATCH=FLUTE          the patch REBEEP loads with neither /F nor /P:
  PROFILES=D:\MYGAMES  where the game profiles are (default: PROFILES)

RBSTUDIO.LOG, beside the program, records each run and every patch file it
left out, and why.


6 Testing with RBTEST
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


7 Troubleshooting
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

  "Patch NAME not used: ... Playing the faithful voice."
      ReBeep could not use the patch. The reason follows: "not found in USER
      or FACTORY" means no NAME.RBP in either folder (a patch in another
      bank needs its bank, /P:HEXX\ORGAN). "folder does not exist" means
      the PATCHES= folder is missing. Anything about the file itself names
      a line to fix in a text editor.

Other problems:

  Games with their own FM music
      A game that drives the OPL itself can clash with ReBeep. Run
      REBEEP /OFF first, which releases the OPL to the game, or REBEEP
      /U to unload. The hotkey is not enough: on an OPL3, ReBeep keeps
      the chip in OPL3 mode while it is trapping.

  A hotkey that does not fire
      Some games, such as Grand Prix Circuit, take over the keyboard
      interrupt, so Ctrl+Alt keys do nothing in them. They still work at
      the DOS prompt. Set the voice (REBEEP /F or REBEEP /P:name), or run
      REBEEP /OFF, before you start the game.

  Games that toggle the speaker heavily
      A game that toggles the speaker very often can run slowly while
      ReBeep translates. Run REBEEP /OFF before starting it.


8 License and contact
---------------------
ReBeep is released under the MIT License. See LICENSE in the source
repository. Source and issues:

  https://github.com/MetalHexx/rebeep
