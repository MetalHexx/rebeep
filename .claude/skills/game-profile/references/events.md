# 3. Find the events

A profile matches only what ReBeep sees: the kinds of step in
[the rule's table](../../../../docs/guide/profiles.md#rule). In a REBEEPD log:

| Step | In the log |
|---|---|
| `CTRL n` | `43=n` among a record's last writes: `trace.mjs parts` lists each one |
| `NOTE n t` | A `noteon` record: a note starts after quiet |
| `CHANGE n t` | A `change` record: a sounding note jumps. A move of an eighth or less isn't logged, but a step still sees it |
| `PITCH n t` | Either of the two |
| `OFF` | A `noteoff` record |
| Nothing | `step61` and `steppit`: sound played on the speaker, not as a note. No step matches it, and `/R:0` keeps it out of the log |

## A signature for each part

1. **How it starts.** `trace.mjs parts` on that part's dump. A control word makes a good first
   step when the game writes it only as a song or a sound begins: its tally of values shows how
   often. One written before every note tells nothing. Without one, a start is what comes before
   the part's first notes: an `OFF`, then the first two or three notes as steps of their own.
2. **Is it unique?** `trace.mjs near <log> <count> <t>` over every dump. The count should start
   that part and nothing else. If another part plays it too, add a step before it (the control
   word, an `OFF`, an earlier note), or narrow `t`.
3. **The same sound in two parts** is told apart only by what came before it. A rule with
   `WHILE=` counts only while the rule it names matched last: one rule marks the part, the next
   waits for its sign.
4. **An effect** is a pitch range within a part: an `[EFFECT]` with `WHILE=` that part's rule.
   `near` over the range must show nothing else while that rule holds. See how it arrives in
   `near`'s list: as a `NOTE`, a `CHANGE`, or both, which is a `PITCH` step.
5. **Everything else:** a catch-all rule last, whose last step takes any value (such as `CTRL n`,
   then `NOTE` with no number), plays the fallback for any start no rule knows. The log marks it
   `fallbk`.

**The tolerance `t`:** the spread the log shows for that count, a little more, and less than half
the gap to the nearest count of another part. `near` looks a 32nd either side unless told.

## Write the profile

- The format is [the file](../../../../docs/guide/profiles.md#the-file). For a worked example,
  open a profile from the [case studies](case-studies.md).
- The most specific rule first, the catch-all last: of two rules that finish on one event, the one
  higher in the file wins.
- A `NAME=` on each rule and effect, in the user's words, and an `ID=` on each rule a `WHILE=`
  names: `trace.mjs hits` prints both.
- Then check that ReBeep loads it ([check.md](check.md#check-that-it-loads)).

## Pitfalls

- Never by time: how long a note lasts can't be matched, and a rule can't wait.
- A beeper has one timbre. Two sounds at the same pitch differ only in what comes before them.
- A part's first note may arrive a few counts off (vibrato, the order a game sets its bits).
  Measure it in more than one dump.
- A record keeps only the game's last 8 writes: a control word with no record soon after it can
  be missing from the log. The game's code can confirm one ([code.md](code.md)).
- Songs range wide: check an effect's range against every song, not only its part's sounds.
- No effect plays in the faithful voice.
