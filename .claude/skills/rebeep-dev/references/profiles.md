# The lab's game profiles

Profiles being worked out for games in the lab. Each lives in [`../profiles/`](../profiles/) as a
folder named for it, holding `NAME.RBG` and the `.RBP` patches its rules name. Every deploy
(`build run --deploy`, `disk deploy`, a `vm` probe) puts each folder on D: as
`D:\REBEEP\PROFILES\NAME\`, so `REBEEP /G:NAME` (or `REBEEPD /G:NAME`) loads it. A dev aid: they
never ship, and `release create` does not read this folder. The format is in
[playing](../../../../docs/guide/playing.md#game-profiles); the limits are in
`src/include/profile.inc`.

| Profile | Game | Covers |
|---|---|---|
| `GPC/` | Grand Prix Circuit | The intro (organ) and the menus (brass), each recognized by `43h=B6` then its song's first note; anything else that starts that way, such as the race, falls back to the bell |

**Working one out with the user:**

1. Find what each part of the game sends: a REBEEPD session ([trace.md](trace.md)) and the game's
   code, never a guess. A rule goes by the order of events, never by time.
2. While testing, make the default and the catch-all a patch nobody would mistake, so a fallback is
   heard.
3. Deploy with every VM closed, then the user runs `REBEEP /U` and `D:\REBEEP\REBEEPD /G:NAME`,
   plays the parts, quits to DOS and runs `REBEEPD /D`. Each rule that completes is a `rule`
   record, a catch-all `fallbk`, with `before>after` = the rule's number > its slot (slots in the
   order the file first names each patch, `DEFAULT=` included).

**Rules:**

- 8.3 names, upper case; the folder and its `.RBG` share the name. Only `.RBG` and `.RBP` files
  are deployed, as CRLF text; a name that is not 8.3 is skipped with a warning.
- Lines of 78 columns or fewer, comments included: a DOS editor shows 80 and must not scroll.
- Never put one in `src/targets.json`: everything there is packaged.
- A path naming the game in full is refused by `rebeep repo check`; use its short name.
