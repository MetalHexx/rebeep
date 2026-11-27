# 2. Listen: log the game

A REBEEPD session records what the game makes ReBeep do: each note, each pitch jump, the game's
last port writes, and which of a profile's rules and effects fired. How the logger works and what
each field means: rebeep-dev's [trace.md](../../rebeep-dev/references/trace.md).

## Set it up

1. Deploy with every VM closed: `rebeep build run --deploy`.
2. A bench (rebeep-dev's [bench.md](../../rebeep-dev/references/bench.md)) whose load line is
   `LH D:\REBEEP\REBEEPD`, without `/R:0`: `/R:0` mutes the sound ReBeep can't play as a note, and
   the log then shows none of it. Tell the user to expect clicks. Once the profile has rules, add
   `/G:<SHORT>`: the log then shows what fired too. Then whatever sets the game to the PC speaker
   ([plan.md](plan.md#the-game-in-the-lab)), the game's program, `D:\REBEEP\REBEEPD /D`, and the
   offer to play again.
3. Start the VM and wait for it to close, as bench.md says.

## What to ask the user to play

- **One part a run,** in an order you give, quitting to DOS after each when the game allows it.
  Each `/D` adds a dump, so each dump is one part.
- **Short visits:** the buffer holds 1024 records. A dump that kept fewer than it was offered
  lost its end.
- **A game that won't quit often:** play the parts in one run and write down the order. ReBeep's
  hotkeys don't reach a game that takes over the keyboard, so nothing marks a part in the log.
- **What to do in each:** "start a game and lose a life", "wait on the title until the song
  starts again".
- **Twice for a part's start:** a signature seen twice is one you can trust.

## After

1. `rebeep disk fetch <vm> REBEEP\RBTRACE.TXT`, then copy it out of `build/` to a folder outside
   the repo, such as the user's project folder: the next fetch replaces it.
2. `node .claude/skills/game-profile/scripts/trace.mjs parts <log>`: a first look at each dump.
3. Tell the user in a line or two what each part seems to start with. Then find the events
   ([events.md](events.md)).

## Pitfalls

- A log is only of the program and options it ran with: a different load line, a different log.
- The BIOS tick in the log stops when a game takes over the timer: its seconds stop with it. The
  order of records still holds.
- A dump with no records: the game played through a sound card instead, or the program ended
  before it made a sound, as a launcher does.
