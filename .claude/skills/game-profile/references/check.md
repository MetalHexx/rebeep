# 5. Check: does each rule and effect fire?

## Check that it loads

Before the user plays, have ReBeep read the profile, unattended: `mirror-freedos` boots its dev
entry by itself and can power itself off. No game runs.

1. Write `BENCH.BAT`, CRLF, in a folder of its own outside the repo:

   ```bat
   @ECHO OFF
   REM Load check: what ReBeep says about a profile, then power off.
   IF NOT "%RBDEV%"=="1" GOTO OFF
   D:\REBEEP\REBEEP /G:<SHORT> > D:\REBEEP\GLOAD.TXT
   :OFF
   C:\FREEDOS\BIN\FDAPM.COM POWEROFF
   ```

2. With every VM closed: `rebeep disk deploy mirror-freedos`, then
   `rebeep disk add mirror-freedos <folder>/BENCH.BAT --to ENV`, then
   `rebeep vm run mirror-freedos --json`. Wait for its `pid` to end: about a minute.
3. `rebeep disk fetch mirror-freedos REBEEP\GLOAD.TXT`. `Profile <SHORT> picks the patch` means
   it loaded. Any other line about the profile or a patch is a
   [message](../../../../docs/guide/troubleshooting.md#a-profile-was-not-used) with its reason.
4. `rebeep disk deploy mirror-freedos` again: it removes the bench, which would otherwise power
   the VM off at every boot.

## A listening session

1. A bench (rebeep-dev's [bench.md](../../rebeep-dev/references/bench.md)) on the game's VM,
   whose load line is `LH D:\REBEEP\REBEEPD /G:<SHORT> /R:0`, then the game, then
   `D:\REBEEP\REBEEPD /D`.
2. Give the user an order to play the parts in, and what each should sound like: each placeholder
   differs, and the fallback means a miss.
3. Fetch the log, then `trace.mjs hits <log> --rbg <SHORT.RBG>`: each rule and effect that fired,
   in order, and those that never did. Hold it against the order the user played.
4. Tell the user what fired where. Fix, and check again.

## When it's wrong

| `hits` shows | Likely | Look with |
|---|---|---|
| No record at all | It didn't load, or no rule's first step ever came | `GLOAD.TXT`; `trace.mjs parts` |
| A rule never fires | A step waits for the wrong kind (a `NOTE` that came as a `CHANGE`), a count outside `t`, or a `WHILE=` rule that never matched | `near` on its count: how it came, what held then |
| A rule fires in the wrong part | Its signature isn't unique | `near`; then a step before it, a `WHILE=`, a narrower `t` |
| The fallback, where a rule should fire | That rule missed, and the catch-all took the start | The rule's steps against `parts` |
| An effect in the wrong part | Its `WHILE=` rule still holds there, or it has none | `near` on its range |
| An effect never plays | Its range, its `WHILE=` rule, or the faithful voice | `near` on its range |
| Fires right, sounds wrong | The patch | [sounds.md](sounds.md) |

## Pitfalls

- `hits` names records from the `.RBG` you give it. When the log's patch differs from the file's,
  it says so: the file changed after the run, so the names may be wrong.
- An effect whose patch failed to load is dropped, and the effects after it move up a number.
- A rule that fires once too often can end a `WHILE=` window early: list every rule in `hits`.
