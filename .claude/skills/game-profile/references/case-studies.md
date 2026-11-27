# Case studies

What each game taught, so the next one starts further on. A case study is an architecture page:
how the game drives the speaker, what ReBeep makes of it, and what still differs. Its lab
profile is the worked example. Read the one closest to your game before you plan; no game is
quite like another.

| Game | Case study | Lab profile | What it showed |
|---|---|---|---|
| Grand Prix Circuit (Accolade) | [GPC](../../../../docs/architecture/gpc-case-study.md) | [`GPC/`](../../rebeep-dev/profiles/GPC/) | Screens told apart by a control word and the first note after it. Effects mixed into a game's own sound, each counted only in a window that rules open and close (`WHILE=`). A sound that lands as a new note or a change, whichever slot it falls in (`PITCH`). A song that shares a pitch with an effect |

## Adding one

1. Write `docs/architecture/<short>-case-study.md` at the architecture level
   ([docs/AGENTS.md](../../../../docs/AGENTS.md)), with its row there and a line in the README's
   index. Name the file by the game's short name, as its lab profile is.
2. Add a row above: the game, its page, its lab profile, and what it showed that the others
   didn't.
3. Move what holds for every game into the stage's reference, as
   [grow this skill](../SKILL.md#grow-this-skill) says. The case study keeps the game's own detail.
