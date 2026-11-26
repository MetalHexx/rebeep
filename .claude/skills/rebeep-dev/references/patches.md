# The lab's patch set

Patches made while testing the studio in a VM, kept so every VM has them. They live in
[`../patches/`](../patches/) as `NAME.RBP` files, and every deploy (`build run --deploy`,
`disk deploy`, a `vm` probe) puts them on D: as the bank `LAB`: `D:\REBEEP\PATCHES\LAB\`. The studio
lists them under `LAB`, and `REBEEP /P:LAB\NAME` plays one. Each folder in `../patches/` is a bank of
its own name: `KQ4/` and `SQ1/` (instruments taken from those games' sound banks) land in
`D:\REBEEP\PATCHES\KQ4\` and `SQ1\`, played as `/P:KQ4\TKQ4-000`. `FROG/` (candidates for the splash jingle: CHIRP, FMBEEP, PCBEEP, RIBBIT-1 to RIBBIT-4) lands in `D:\REBEEP\PATCHES\FROG\`, played as `/P:FROG\RIBBIT-1`. `SHOTS/` holds the rolls the studio
screenshots and `synth.gif` were made from ([update-site](../../update-site/references/studio-shots.md)). They are a
dev aid and never ship: `release create` does not read this folder.

**Collect new ones.** A patch saved in the studio goes to `D:\REBEEP\PATCHES\USER\`, and the next
deploy wipes D:. So, before any deploy:

1. Ask the user to quit the studio and the VM (the `disk` verbs refuse while 86Box runs).
2. `rebeep disk show <vm> REBEEP\PATCHES\USER` to see what was saved.
3. `rebeep disk fetch <vm> REBEEP\PATCHES\USER` (lands in `build/disk/<vm>/`).
4. Copy the ones the user wants to keep into `../patches/`. A name already there is the user's call:
   ask before replacing it.
5. Deploy. The set is on every VM's D: again, the new ones included.

**Rules:**

- 8.3 names, upper case, `.RBP` only; anything else in the folder is ignored. A name that is not 8.3
  is skipped with a warning.
- The files are CRLF text (`.gitattributes`); the deploy converts LF to CRLF anyway.
- The Save dialog starts an edited `LAB` patch on `USER`. Collect it from there, or from the bank you chose.
