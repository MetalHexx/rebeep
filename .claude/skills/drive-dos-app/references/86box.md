# Driving a lab VM in 86Box

For a look at the real machine (a VM's OPL3, its keyboard controller, its ET4000 VGA) rather than DOSBox-X, or for
screenshots good enough to publish. The VM runs in a visible 86Box window; keys go in as real scan codes and pictures
come out of 86Box's own screenshot. Windows only, and the desktop must be **unlocked**: a locked session drops
injected keys.

## Start and find the window

```sh
node tools/rebeep.mjs vm run mirror-msdos
```

The process id is in `~/.rebeep/vms/<vm>/rebeep.pid` (JSON, `pid`). `scripts/window-shot.ps1 -ProcId <pid> -Out
<png>` saves a picture of the window to see where things stand (not for publishing: it is the host's scaled view).

## Type keys

```sh
powershell -NoProfile -File .claude/skills/drive-dos-app/scripts/vm-keys.ps1 -ProcId <pid> \
  'type D:' 'tap Enter' 'wait 400' 'type CD \REBEEP' 'tap Enter' 'type RBSTUDIO' 'tap Enter'
```

Each argument is one step: `type <text>`, `tap <key>`, `down <key>`, `up <key>` (hold and release, e.g. F12 held
while a shot is taken), `chord <a>+<b>` (`Alt+4`, `Ctrl+Z`), `wait <ms>`. It brings the window to the front first and
exits 2 if it can't. In Git Bash set `MSYS_NO_PATHCONV=1`, or `\REBEEP` arguments may be rewritten.

## Screenshots

- **Tools > Take raw screenshot** saves the card's output pixel for pixel (720x400 in text mode) to
  `~/.rebeep/vms/<vm>/screenshots/`. Check: exactly 720x400, and a plain DOS prompt has two colours.
- Ctrl+F11 ("Take screenshot") saves what the window shows: scaled by Windows' display scaling and blended even at
  1x. Never publish it.
- The raw shot has no key binding, so click it: the window's **Tools** menu, then the item. After the menu opens, the
  process's main window is the menu itself, so a click script measuring "the window" then measures the menu.
- **Paused** (the toolbar's pause button), a shot request waits and is written on the first frame after resuming:
  the way to catch a screen that stays only a moment, such as RBSTUDIO's checks.
- The raw shots so far were taken with the View menu set to HiDPI scaling off, 1x and Nearest; set the same if a
  raw shot ever comes out larger or blended. The VM's `86box.cfg` is rewritten on every `vm run`, so menu changes
  don't last.

## Pitfalls

- 86Box keeps Ctrl+F12 (Ctrl+Alt+Del to the guest), Ctrl+Alt+F12 (hard reset), Ctrl+F10 and Ctrl+F11 for itself.
- A key held while focus moves to a menu may be released by 86Box; take held-key shots quickly.
- Leave the VM running and its window uncovered while the keys run; anything typed while another window has the
  focus goes there instead.
