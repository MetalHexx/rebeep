# 3b. Read the game's code

For a question a log can't settle: is this control word written anywhere else? Which code plays
this sound, and what comes just before it? Where does a song's first note come from?

## Rules

- **Data only.** Never run a game's file on the host. `code.mjs` reads it in memory from the
  game's zip in the lab, and unpacks an EXEPACK program in memory.
- **Nothing of the game is kept.** Never copy a game's file, or anything unpacked from it, into
  the repo or the user's notes. `--dis` writes the image to a temporary folder for ndisasm and
  deletes it straight after. Write down what you learn (an offset, what the code does), never the
  game's bytes.
- Tell the user before you read their game's files, in a line.

## Steps

1. `node .claude/skills/game-profile/scripts/code.mjs --game <SHORT> --list`: the game's files.
   Most games have one main program. Some keep code in an overlay (`.OVL`) or a second program.
2. `--file <FILE>`: what the file is, then each place its code touches the speaker's ports: 42h
   (the pitch), 43h (the control word, with its value when a `MOV AL` sets it), 61h (the
   speaker's bits) and 40h (the game's own clock).
3. `--dis <offset> --lines 60`: the code around a site. Start a little before it: the
   instructions that load a count or a control word come first.
4. `--find "<bytes>"`: where a value is. A count from the log is two bytes, low first: `0952h` is
   `52 09`. `??` matches any byte.

## What to look for

| Question | Look for |
|---|---|
| Is a control word written only where a part starts? | Its sites under `OUT 43h`, and what calls each |
| Where does a song's note come from? | The two `OUT 42h` writes, and the table their count is read from |
| What makes an effect? | The code between the speaker's bit going on and off |
| Does the game run its own clock? | `OUT 40h`: then the BIOS tick in a log may stop |

## Limits

- LZEXE and PKLITE programs are named but not unpacked, so the scan sees packed bytes. A packer
  the script doesn't know looks like a program with no speaker code. Unpacking another packer in
  memory is a good addition to the script.
- The scan finds candidates: the same bytes can be data. Confirm each with `--dis`.
- A port set in `DX` shows as the `MOV DX`; its `OUT DX,AL` may come a few instructions later.
- Offsets are into the load image: past the MZ header, after unpacking, as ndisasm shows them.
- A game that loads code from a data file, or builds it at run time, hides it from the scan: the
  log is then the only witness.
