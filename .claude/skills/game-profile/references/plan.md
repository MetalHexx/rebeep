# 1. Plan the profile

## The game in the lab

- **Add it:** `rebeep media add game <zip> --name <SHORT>`. `<SHORT>` is up to 8 letters, digits,
  `-` or `_`, and is also the profile's name. Use it in every path you make: `rebeep repo check`
  refuses some full game names in a path.
- **Where it lands:** every deploy writes it to D: as `D:\GAMES\<SHORT>\`, with one wrapper folder
  stripped. `code.mjs --game <SHORT> --list` shows the folders and files.
- **What to start:** the game's own program, not a launcher or a setup menu: it gets the user in
  faster. Ask the user if it isn't clear from the names.
- **Which VM:** `mirror-msdos`, unless the game needs a card it lacks (an EGA or Hercules game:
  the VMs are in rebeep-dev's [vms.md](../../rebeep-dev/references/vms.md)).

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

- **Placeholders that differ,** copied from `src/studio/data/FACTORY/` (`ORGAN`, `FLUTE`, `BRASS`)
  under the profile's names (`TITLE.RBP`, `PLAY.RBP`), so the user hears each switch.
- **A fallback nobody would mistake,** such as `BELL` as `FALLBK.RBP`, for `DEFAULT=` and the
  catch-all rule. When the user hears it, a rule missed.
- **The file starts small:** `[PROFILE]`, `FORMAT=1`, a `NAME=` and `DEFAULT=FALLBK`. The rules
  come in stage 3.
- The lab's naming and line rules: rebeep-dev's [profiles.md](../../rebeep-dev/references/profiles.md).

## Pitfalls

- A game with several programs (one per graphics card, say) may make different sounds in each.
  Profile the one the user plays, and say which in the case study.
