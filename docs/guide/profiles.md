# Writing a game profile

A game profile gives each part of a game its own patch: an FM voice kept in a small file, `.RBP`.
This page is for writing and changing one. To load one, see [playing](playing.md#game-profiles).

## The folder

A profile is a folder in `PROFILES`, in ReBeep's folder. It holds a text file named for the folder,
ending `.RBG`, and the patches that file names:

```
C:\REBEEP\PROFILES\MYGAME\
    MYGAME.RBG      the profile
    MENU.RBP        its patches
    ENGINE.RBP
    SQUEAL.RBP
```

Names of profiles and patches are up to 8 letters, digits, `-` and `_`, and not only digits. To
keep profiles elsewhere, set `PROFILES=` in [the settings file](studio.md#the-settings-file).

## Change one that comes with ReBeep

ReBeep's own profiles are in `FACTORY\PROFILES`, in ReBeep's folder: so far `GPC`, for Grand Prix
Circuit. `INSTALL` replaces them on every update, so change a copy of the whole folder, in your
`PROFILES`. Skip an `MD` for a folder you have:

```
MD C:\REBEEP\PROFILES
MD C:\REBEEP\PROFILES\GPC
COPY C:\REBEEP\FACTORY\PROFILES\GPC\*.* C:\REBEEP\PROFILES\GPC
```

From then on `REBEEP /G:GPC` loads your copy. Edit its `GPC.RBG` in a text editor, or copy a voice
of your own over one of its patches.

- ReBeep uses your folder when it holds `GPC.RBG`, and then takes every patch from it. A file your
  copy lacks isn't taken from `FACTORY`.
- To go back, delete your copy: `DEL C:\REBEEP\PROFILES\GPC\*.*`, answer `Y`, then
  `RD C:\REBEEP\PROFILES\GPC`.

## How a profile follows a game

A game plays a note by loading a number, the **count**, into the PC's timer and switching the
speaker on. The count sets the pitch: it is 1,193,182 divided by the pitch in hertz, so a higher
pitch has a lower count. 500 Hz is a count of 2386, or `0952h` in hex. A profile can't match
sounds a game makes another way.

A profile has two parts that react to what the game does:

| Part | Does |
|---|---|
| A **rule** | Waits for a few events in order, then picks the patch that plays from then on |
| An **effect** | Gives one pitch a patch of its own, only while it sounds |

ReBeep doesn't come with a tool that shows the counts a game uses.

## Make one

Start with ReBeep's own voices under your profile's names. Skip an `MD` for a folder you have:

```
C:
MD \REBEEP\PROFILES
MD \REBEEP\PROFILES\MYGAME
CD \REBEEP\PROFILES\MYGAME
COPY \REBEEP\FACTORY\PATCHES\ORGAN.RBP MENU.RBP
COPY \REBEEP\FACTORY\PATCHES\BRASS.RBP ENGINE.RBP
COPY \REBEEP\FACTORY\PATCHES\BELL.RBP SQUEAL.RBP
EDIT MYGAME.RBG
```

In the editor, type this, save and exit:

```
[PROFILE]
FORMAT=1
DEFAULT=MENU

[RULE]
NAME=Menus
STEP=CTRL B6h
STEP=NOTE 1521h 40
PATCH=MENU

[RULE]
ID=RACE
NAME=Race
STEP=CTRL B6h
STEP=NOTE C22Eh 40
PATCH=ENGINE

[EFFECT]
NAME=Tire squeal
WHILE=RACE
PITCH=094Ch 40
PATCH=SQUEAL
```

| Part | Means |
|---|---|
| `DEFAULT=MENU` | `MENU` plays first |
| The Menus rule | The game writes `B6h` to the timer, and the next note to start is within 40 of the count `1521h` (about 221 Hz): play `MENU` |
| The Race rule | The same, for a note near `C22Eh` (about 24 Hz): play `ENGINE` |
| The effect | While the Race rule is the last to have matched, a pitch near `094Ch` (about 501 Hz) plays in `SQUEAL` |

The counts above are examples: use your game's. Then load the profile:

```
REBEEP /G:MYGAME
```

You should see `Profile MYGAME picks the patch from what the game plays. /P: or /F ends it.` To use
a voice of your own, make it in [ReBeep Studio](studio.md), then copy it into the profile's folder:

```
COPY C:\REBEEP\PATCHES\USER\ENGINE.RBP C:\REBEEP\PROFILES\MYGAME
```

## The file

- Sections are in `[brackets]`: one `[PROFILE]`, then your `[RULE]` and `[EFFECT]` sections.
- Each line is `KEY=VALUE`, in capitals or not. A comment starts with `;`, on a line of its own.
- A key or section ReBeep doesn't know is ignored, so check the spelling. A key given twice in a
  section is refused, except `STEP=`.
- Numbers are decimal, or hex with a trailing `h`.

`NAME=` is allowed in every section: a longer name of 1 to 24 characters, which ReBeep checks but
doesn't show. It is always optional.

### `[PROFILE]`

| Line | Means |
|---|---|
| `FORMAT=1` | Required |
| `DEFAULT=MENU` | The patch that plays until a rule picks one. Without it, the patch you had plays on |

### `[RULE]`

| Line | Means |
|---|---|
| `STEP=` | Required, 1 to 4 of them, in order |
| `PATCH=ENGINE` | Required: the patch to play once every step has matched, `ENGINE.RBP` |
| `ID=RACE` | A short name for `WHILE=`: 1 to 8 letters, digits, `-` or `_`, not only digits. No two rules share one |
| `WHILE=RACE` | The rule counts only while the rule `RACE` is the last to have matched |

Each step waits for one kind of event. In `n t`, `n` is a count and `t` how far off it may be:

| Step | Waits for |
|---|---|
| `NOTE n t` | A note to start, after quiet |
| `CHANGE n t` | A note already sounding to move to that count |
| `PITCH n t` | Either one |
| `OFF` | A note to stop. It takes no number |
| `CTRL n` | The game to write the byte `n` to the timer's control port, `43h`. It takes no `t` |

Leave out `t` to match the count exactly, or both numbers to match any.

### `[EFFECT]`

| Line | Means |
|---|---|
| `PITCH=n t` | Required: the counts that are this effect, `n` give or take `t`. `n - t` is at least 193 |
| `PATCH=SQUEAL` | Required: the patch it plays in |
| `WHILE=RACE` | The effect counts only while the rule `RACE` is the last to have matched |

## How rules match

- Every rule watches at once, and keeps its own place in its steps.
- A rule ignores events of other kinds than the one its next step waits for.
- An event of that kind with the wrong number sends the rule back to its first step. The same event
  may start it again.
- When a rule matches its last step, its patch plays and every rule starts over. If two finish on
  the same event, the one higher in the file wins.
- The patch holds until another rule picks a different one. A switch plays the new patch even if
  you picked the [faithful voice](playing.md#pick-a-voice), the plain square wave, with Ctrl+Alt+N.
- Only the order of events counts, never time: a rule can't wait a number of seconds.

**`WHILE=` tells parts of a game apart.** Use it when two parts use the same pitch. A rule with a
`WHILE=` can't match until the rule it names has. Picking the patch that already plays still makes
a rule the last to have matched.

## How effects play

While a note is within an effect's counts, it plays in the effect's patch on an FM channel of its
own. When the pitch leaves them, the rule's patch takes the note back. If two effects fit, the one
higher in the file wins. Effects don't play in the faithful voice.

## Limits

| In one profile | At most |
|---|---|
| Rules | 16 |
| Steps in a rule | 4 |
| Effects | 8 |
| Different patches, named by `DEFAULT=`, rules and effects | 8 |
| File size | 2,048 bytes |

## If it doesn't work

ReBeep says why it [didn't use a profile](troubleshooting.md#a-profile-was-not-used). When one
patch can't be used, its rules play the faithful voice, and its effects are left out. A rule that
never matches gives no message: check its numbers and the order of its steps.

Want to know how it works inside? See [how it works](../architecture/how-it-works.md#game-profiles).

## Help make profiles

We're looking for contributors to help create profiles for other games. A profile that's merged
comes with ReBeep, as `GPC` does. If you've made one, or want to, share it in either way:

- Open a pull request, as [contributing](../lab/contributing.md) describes.
- Tell us on [Discord](https://discord.gg/4wkPZnCfz), or open a
  [game report](https://github.com/MetalHexx/rebeep/issues/new?template=game-report.yml) and attach
  your profile's folder as a `.zip`.

Send only the profile and its patches, never the game's files.

**If your profile needs a change to ReBeep itself,** please talk it over with the maintainer first,
in a [feature idea](https://github.com/MetalHexx/rebeep/issues/new?template=feature-idea.yml) or on
Discord, or justify the change in your pull request's description. A change must work for any game:
ReBeep has no code for one game in particular.
