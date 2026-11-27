# The lab's game profiles

Profiles being worked out for games in the lab. Each lives in [`../profiles/`](../profiles/) as a
folder named for it, holding `NAME.RBG` and the `.RBP` patches its rules name. Every deploy
(`build run --deploy`, `disk deploy`, a `vm` probe) puts each folder on D: as
`D:\REBEEP\PROFILES\NAME\`, so `REBEEP /G:NAME` (or `REBEEPD /G:NAME`) loads it. A dev aid: they
never ship, and `release create` does not read this folder. The format is in
[writing a game profile](../../../../docs/guide/profiles.md); the limits are in
`src/include/profile.inc`.

| Profile | Game | Covers |
|---|---|---|
| `GPC/` | Grand Prix Circuit | The intro (a bass guitar), the menus (a distorted guitar) and the race (a rough engine), each recognized by `43h=B6` then its first note; the start lights, and the gear chirp and tire squeal, are effects in patches of their own (`LIGHTS`, `SQUEAL`), each in its window (`GRID`, `RACE`); anything else that starts that way falls back to the bell |

**Making or changing one with the user** is the [game-profile skill](../../game-profile/SKILL.md):
planning the parts, logging the game, finding the events, checking each rule fires, shaping the
patches. In a REBEEPD log, each rule that completes is a `rule` record and a catch-all a `fallbk`,
with `before>after` = the rule's number > its slot (from 0, slots in the order the file first
names each patch, `DEFAULT=` included). That skill's `trace.mjs hits` names them.

**Rules:**

- 8.3 names, upper case; the folder and its `.RBG` share the name. Only `.RBG` and `.RBP` files
  are deployed, as CRLF text; a name that is not 8.3 is skipped with a warning.
- Lines of 78 columns or fewer, comments included: a DOS editor shows 80 and must not scroll.
- Never put one in `src/targets.json`: everything there is packaged.
- A path naming the game in full is refused by `rebeep repo check`; use its short name.
