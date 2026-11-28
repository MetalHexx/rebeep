# 1. Plan the profile

## The game in the lab

- **The lab first:** `rebeep env status` shows what is set up. A fresh lab starts at rebeep-dev's
  [environment.md](../../rebeep-dev/references/environment.md).
- **Add it:** `rebeep media add game <zip> --name <SHORT>`. `<SHORT>` is up to 8 letters, digits,
  `-` or `_`, not only digits, and is also the profile's name. Use it in every path you make:
  `rebeep repo check` refuses some full game names in a path.
- **Where it lands:** every deploy writes it to D: as `D:\GAMES\<SHORT>\`, with one wrapper folder
  stripped. `code.mjs --game <SHORT> --list` shows the folders and files.
- **What to start:** the game's own program, not a launcher or a setup menu: it gets the user in
  faster. Ask the user if it isn't clear from the names.
- **The PC speaker, not a sound card.** The VMs have a Sound Blaster, and a game that finds one
  may never touch the speaker. Find how it picks (a setup program, a command-line switch, a
  question at start) and have each bench choose the speaker before the game: a deploy rewrites
  D:, which loses a setup the game saved there.
- **Which VM:** `mirror-msdos`, whose SVGA card also runs CGA and EGA games. The others are in
  rebeep-dev's [vms.md](../../rebeep-dev/references/vms.md).

## The parts

Ask the user, in their words, and write the answers down:

1. What parts does the game have, and how do you get from one to the next? A title, menus,
   play, a game over, a high-score table.
2. Which of them make sound? A silent screen needs no rule.
3. Which sounds within a part deserve their own voice? A crash, a jump, a warning. Those become
   effects.
4. How should each sound? Plain words are enough, and "leave it as it is" is an answer too.

Set expectations in a line or two:

- Two parts that play the same sound the same way can't be told apart, and share a patch.
- Sound that ReBeep can't play as a note (clicks, noise, very high pitches) goes to the speaker,
  and no profile can match it.

## The folder

Make `.claude/skills/rebeep-dev/profiles/<SHORT>/` with `<SHORT>.RBG` and one patch per part:

- **Placeholders that differ,** copied from `src/factory/patches/` (`ORGAN`, `FLUTE`, `BRASS`)
  under the profile's names (`TITLE.RBP`, `PLAY.RBP`), so the user hears each switch.
- **A fallback nobody would mistake,** such as `BELL` as `FALLBK.RBP`, for `DEFAULT=` and the
  catch-all rule. When the user hears it, a rule missed.
- **The file starts small:** `[PROFILE]`, `FORMAT=1`, a `NAME=` and `DEFAULT=FALLBK`. The rules
  come in stage 3.
- **A `[SOUND]` for each patch,** so the studio can name and play it: `NAME=` up to 14 characters,
  `DESCRIPTION=` up to 53 saying when in the game it plays, in the player's words, and `PITCH=` the
  count the sound plays at (see [`[SOUND]`](../../../../docs/guide/profiles.md#sound)). A rule's
  count isn't always its sound's pitch: GPC's racing rule waits on the green light's count, but
  its engine sounds at the idle's. Write the real pitch once the log shows it ([events.md](events.md)).
- The lab's naming and line rules: rebeep-dev's [profiles.md](../../rebeep-dev/references/profiles.md).
- To change a profile ReBeep comes with, copy its folder
  ([ship.md](ship.md#changing-a-shipped-profile)).

## Pitfalls

- A game with several programs (one per graphics card, say) may make different sounds in each.
  Profile the one the user plays, and say which in the case study.
