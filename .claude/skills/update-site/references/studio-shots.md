# Retaking the ReBeep Studio screenshots

The pictures of the studio in the docs, the README and on the site all come from one set of captures of the real
studio in 86Box (never DOSBox: its video modes are not real VGA). Retake the whole set when a captured screen changes,
and at each release: the splash and the checks show the version.

| Output | Shown in |
|---|---|
| `docs/images/studio/<screen>.png` (960x720, every view, `save-dialog.png` included) | The guide's gallery; `splash.png` in the README |
| `docs/images/studio/synth.gif` (the patch editor through a few F12 rolls) | The guide's lead and the README |
| `site/img/studio/splash.webp`, `synth.webp` (the rolls stacked, 728 rows each) | The site's monitor |

## Capture (86Box, `mirror-msdos`)

1. `node tools/rebeep.mjs vm run mirror-msdos`. The studio is `D:\REBEEP\RBSTUDIO.EXE` after a deploy.
2. Drive it with `drive-dos-app`'s `scripts/vm-keys.ps1` (see [86box.md](../../drive-dos-app/references/86box.md)):
   `D:`, `CD \REBEEP`, `RBSTUDIO`.
3. Shoot each screen with **Tools > Take raw screenshot**: the card's own 720x400 pixels, in the VM's `screenshots\`
   folder. The normal screenshot (Ctrl+F11) is scaled and blended: never use it. The raw one has no key, so click
   the menu (86Box's window: Tools, then the item).
4. The order: checks (it stays a second: pause 86Box at once, shoot, resume; the file is written on resume), splash,
   main menu, patch list, a 2-OP patch, a 4-OP patch with a carrier focused (Alt+4: operator 4 is a carrier in every
   4-OP connection), help pages 1 and 2 (F1, Right), then the rolls, then Ctrl+S on a factory patch for the Save dialog,
   Esc, and Esc again for the save prompt, D to discard.
5. **Rolls:** about 30, each F12 held, the shot taken while held (the piano key is lit), then F12 released. Save each
   into a new bank `SHOTS` with the Save dialog (`R01` to `R30`) after its shot, so the picked ones can be fetched.

## Pick the rolls

Make a contact sheet of the envelope band (rows 296-376) and the whole screens. Pick 4 or 5 where the **carrier's
envelope has a clear shape** (an attack ramp, a held sustain, a release tail: not a flat block, not a spike) and
that **differ**: connection, waveform, pad, pluck, organ. Order them so they read well as a flip-book, with no two
flat, held envelopes in a row. `disk fetch` the picked ones from the VM's `REBEEP\PATCHES\SHOTS` into
`.claude/skills/rebeep-dev/patches/SHOTS/` ([the lab's patch set](../../rebeep-dev/references/patches.md)): the GIF's rolls
are kept there, lab-only.

## Make the files

Write a map (paths relative to it) and run the script (Node and ffmpeg with libwebp):

```json
{ "stills": { "checks": "raw/checks.png", "splash": "raw/splash.png", "menu": "raw/menu.png",
              "patch-list": "raw/patch-list.png", "synth-2op": "raw/a.png", "synth-4op": "raw/b.png",
              "help-1": "raw/help-1.png", "help-2": "raw/help-2.png", "save-prompt": "raw/save.png",
              "save-dialog": "raw/save-dialog.png" },
  "synth": ["raw/roll-18.png", "raw/roll-04.png", "raw/roll-26.png", "raw/roll-06.png", "raw/roll-10.png"],
  "site": ["splash"] }
```

```sh
node .claude/skills/update-site/scripts/studio-shots.mjs --map <map.json>
```

It refuses a shot that is not 720x400. Every output is 4:3 (a CRT shows text mode at 4:3): 4x nearest neighbour,
then box-filtered to 960x720, so text stays sharp and files stay small. Keep the raw shots outside the repo.

If the number of rolls changes, update `data-frames` and the `<img>` height (728 x frames) in `site/index.html`.
