# The lab's patch set

Patches made while testing the studio in a VM, kept so every VM has them. They live in
[`../patches/`](../patches/) as `NAME.RBP` files, and every deploy (`build run --deploy`,
`disk deploy`, a `vm` probe) puts them on D: as the pack `LAB`: `D:\REBEEP\PATCHES\LAB\`. The studio
lists them under `LAB`, and `REBEEP /P:LAB\NAME` plays one. They are a dev aid and never ship:
`release create` does not read this folder.

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
- An edited `LAB` patch saves to `USER` under its name, as for any pack. Collect it from `USER`.
