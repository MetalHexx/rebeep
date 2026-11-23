---
name: drive-dos-app
description: Drive a DOS program in a real DOSBox-X window with scripted keystrokes and screenshots of what it draws. Use to check a flow the headless screen check cannot reach (RBSTUDIO's menu to patch list to synth screen, Esc stepping back, scrolling, keyboard handling), or to look at a DOS program on screen.
---

# drive-dos-app

DOSBox-X's `AUTOTYPE` command types a timed list of keys into the program through the emulated keyboard, so the program's
own `INT 09h` handler sees real make and break codes. `scripts/drive.mjs` launches DOSBox-X with that script, saves a PNG
of the window at the times you give, and ends DOSBox-X by its process id. Read the PNGs with an image-capable tool.

**Windows only** (the capture is PowerShell and user32). It opens a real window on the desktop for the length of the run.
It needs no new dependency: Node built-ins, PowerShell, and the DOSBox-X that `rebeep env setup` fetched.

## When to use it

- The headless `/DUMP` screen check (`rebeep test run --suite studio`) is the check for a screen's cells. Use this for what it
  cannot reach: key handling, screen-to-screen flow, scrolling, state kept between screens, the mouse-free paths.
- Not a regression test: it is a look, run by hand, with timing that depends on the machine.

## Steps

1. Build: `rebeep build run`.
2. Stage a scratch folder (outside the repo) that is the program's folder: `build/RBSTUDIO.EXE`, the files in
   `build/files/REBEEP/` (the art, `FACTORY\`), and any data the flow needs, such as `PATCHES\USER\*.RBP` for the patch list.
3. Run:

   ```sh
   node .claude/skills/drive-dos-app/scripts/drive.mjs --dir <scratch> \
     --keys "space enter down down down down enter" --shots 24 --out <pngs>
   ```

   Options: `--program` (default `RBSTUDIO`), `--args` (such as `/VIEW:MONO`), `--wait` (5 s before the first key),
   `--pace` (2 s between keys), `--limit` (DOSBox-X's own time limit, 90 s), `--shots` (seconds after launch, one PNG each).
4. Read `shot-<seconds>.png`. To see the end state of a key list, end the list there and take the shot after the last key.

## Timing

- `--wait` starts when `AUTOTYPE` runs, about 3 to 4 s after DOSBox-X's launch. The program's own start (RBSTUDIO's
  detection pause, a splash waiting for a key) comes on top. Work out when a screen should be up and shoot a few seconds later.
- Key `n` (from 0) is typed at about `3.5 + wait + n * pace` s after launch.
- Each shot costs about a second (PowerShell and the capture), so shots requested less than a second apart are taken late. A faster `--pace` (0.3 to 0.5) suits long runs of one key, such as 18 `down`.
- Key names are AUTOTYPE's (`space enter esc up down left right tab`, letters and digits; `AUTOTYPE -list` in DOSBox-X lists them).
- Two screenshots of different times with the same picture mean the keys had not all been typed yet, or all had.

## Checks worth making this way

- Open a screen, step back with Esc, open it again: the selection is where it was left.
- A long list scrolls and keeps the selection (and its folder heading) in view.
- The first screen after a key is the one the key should reach: a missing binding looks like a dead key.

## Pitfalls

- The host mouse pointer over the window shows as a grey block on the text screen.
- A shot is the screen's pixels at that moment, so the window must stay uncovered. The shot raises the window and fails
  with a message when another window still covers it, instead of saving that window's contents.
- `drive.mjs` finds DOSBox-X itself (`REBEEP_DOSBOX`, else the newest folder under `~/.rebeep/tools/dosbox-x`), a deliberate
  standalone copy of the CLI's lookup. Set `REBEEP_DOSBOX` to an absolute path if it picks the wrong version.
- End DOSBox-X by its process id only (the script does). Never by name or pattern: that would end the user's own DOSBox-X.
- `-set "mixer nosound=true"` keeps the Sound Blaster and its OPL emulated but silent, as the test suites do.
- Screenshots go to `--out` (default: `rebeep-drive` in the system temp folder). Keep them out of the repo.

## Related

- [rebeep-dev](../rebeep-dev/SKILL.md): build, deploy and the test suites
- [tests/studio/AGENTS.md](../../../tests/studio/AGENTS.md): the screen check, the headless counterpart
