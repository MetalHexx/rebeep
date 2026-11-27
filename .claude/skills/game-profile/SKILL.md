---
name: game-profile
description: Make or change a ReBeep game profile (/G:) for any game, with the user, step by step. Plan which parts of the game get a sound of their own; log the game with REBEEPD and read its code to find the events ReBeep can match (control words, note starts, pitch changes, notes stopping); write the .RBG; check in a listening session that every rule and effect fires where it should; and shape the patches by ear. Use when someone wants a profile for a game, a rule or effect fires in the wrong place or never, a part needs a sound of its own, or a profile's patches need tuning. It grows with each game: it says where to write down what a game taught.
---

# game-profile

Walks the user through making or changing a **game profile**: a `.RBG` file and its patches that
give each part of a game (a screen, a song, an effect) its own FM voice. It is for any game.

**What we know so far, not a limit.** These pages hold what the games profiled until now taught.
The next game may drive the speaker in a way they don't cover. Then work it out with whatever
works: the log, the game's code, the [case studies](references/case-studies.md), what you know of
the PC's timer and speaker. Then write what you learned back here ([grow this skill](#grow-this-skill)).

**Read first:** [writing a game profile](../../../docs/guide/profiles.md). It owns the format, how
rules and effects match, and the limits. This skill links to it and never restates it. The lab is
[rebeep-dev](../rebeep-dev/SKILL.md)'s: VMs, deploys, [benches](../rebeep-dev/references/bench.md),
[REBEEPD](../rebeep-dev/references/trace.md) and [the lab's profiles](../rebeep-dev/references/profiles.md).

## Talking with the user

The user may never have made a patch or read a log. Keep the conversation at their level:

- Use the game's words: "the title song", "the explosion". Show a count or a step only when they
  ask, and then with its pitch in Hz.
- One stage at a time. Say what it is for, what they will do (press Enter, play, close the VM),
  and what to listen for.
- Ask what they hear and want in their own words ("brighter", "like a bass guitar"), and turn
  that into patches yourself.
- After each session, say in two or three lines what fired, what didn't, and what you'll change.
- Make the technical choices yourself, with the reason in a line. Ask only what is theirs: which
  parts, how each should sound, whether it sounds right.

## Where to start

| The user wants | Start at |
|---|---|
| A profile for a new game | 1. Plan |
| A new part or effect in a profile | 2. Listen, to that part |
| A rule or an effect fixed: wrong place, or never | 5. Check |
| A sound changed | 6. Shape the sounds |

## The stages

| Stage | Done when | Reference |
|---|---|---|
| 1. Plan | The game is in the lab, its parts are listed, the folder has placeholder patches | [plan.md](references/plan.md) |
| 2. Listen | A REBEEPD log holds each part, played by the user in a known order | [listen.md](references/listen.md) |
| 3. Find the events | Each part has a signature: events that start it and nothing else | [events.md](references/events.md) |
| 3b. Read the code | Only when a log can't settle a question | [code.md](references/code.md) |
| 4. Write | A rule or effect per part, and ReBeep loads it without a fault | [events.md](references/events.md#write-the-profile) |
| 5. Check | A listening session: each rule and effect fires where it should, and nowhere else | [check.md](references/check.md) |
| 6. Shape the sounds | The user likes each patch | [sounds.md](references/sounds.md) |
| 7. Keep it | It's in the lab's folder ([profiles.md](../rebeep-dev/references/profiles.md)), and what the game taught is written down | [below](#grow-this-skill) |

Loop through 3 to 5 until every part switches right. Only then spend the user's time on sounds.

## Scripts

Node built-ins only, run from the repo root. Add `--rbg <NAME.RBG>` to a `trace.mjs` command to
name the rules, effects and patches.

| Script | Does |
|---|---|
| `scripts/trace.mjs parts <log>` | Each control word in a log and the note after it; the commonest notes and jumps |
| `scripts/trace.mjs near <log> <count> [t]` | Every note start and jump near a count, and the rule matched then: is it unique? |
| `scripts/trace.mjs hits <log>` | The rules and effects that fired, in order, and those that never did |
| `scripts/code.mjs --game <NAME>` | A game's file read as data: its speaker code, a byte search, disassembly ([code.md](references/code.md)) |

## Always

- Never run a game's files on the host. Read them as data only ([code.md](references/code.md)).
- Every hand test is a bench: the user presses Enter, plays, and closes the VM. Never a command.
- The load line carries every option under test; `/R:0` keeps speaker clicks out of an ear test.
- Fetch a VM's logs before any deploy, which rewrites its D:. Logs and benches stay out of the repo.
- Go by the order of events, never by time: a rule can't wait or measure.
- ReBeep has no code for one game. A profile that needs ReBeep to change needs a general option,
  talked over first. Sharing a profile is in [help make profiles](../../../docs/guide/profiles.md#help-make-profiles).
- Offer commits; never make one unasked.

## Grow this skill

Each game teaches something. Before you finish, put it where the next agent will find it:

| Learned | Goes in |
|---|---|
| How this game drives the speaker, its signatures, what fooled us | Its case study, and a row in [case-studies.md](references/case-studies.md) |
| A technique that holds for any game | The stage's reference: a line, a table row |
| A pitfall that bit | The stage's reference, under Pitfalls |
| A check a script could have made | An option on a script here, or a new script and a row above |
| Something ReBeep can't express | Not here: a feature idea ([help make profiles](../../../docs/guide/profiles.md#help-make-profiles)) |

- Generic steps: a reference says what to do for any game and points to a case study for an
  example. A game's counts never go in a step.
- Correct what a game proved wrong, in place: a page says what is true now.
- Hold the budgets (SKILL.md 100 lines, a reference 60). Split a reference that outgrows them,
  with a row in the stages table. Run the `update-docs` skill before the commit.
