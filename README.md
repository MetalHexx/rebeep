<div align="center">

# ReBeep

**Hear your beeper-only DOS games through a real sound card.**

A tiny DOS TSR that catches PC-speaker tones and plays them on a Sound Blaster's OPL2/OPL3 FM chip,
plus a ready-made 86Box lab to build and test it.

[Getting started](docs/getting-started.md) · [The 86Box lab](docs/86box-environment.md) ·
[Contributing](docs/contributing.md) · [Docs](docs/README.md)

</div>

---

Many 1980s DOS games can only beep through the PC speaker. ReBeep traps the speaker ports
(`42h`, `43h`, `61h`) through Jemm's QPIEMU module, turns what the game sends into tones, and plays
them on the OPL synth. Anything it can't translate still reaches the real speaker.

```
game ──OUT 42h/43h/61h──▶ Jemm + QPIEMU ──▶ ReBeep ──▶ OPL2/OPL3 at 388h
                                               └──────▶ PC speaker (fallback)
```

> **Status:** the dev environment works. `REBEEP.COM` loads, unloads, answers its hotkeys and plays
> the speaker's tones on the OPL, with anything it can't translate falling back to the real speaker.

## What you need

| | Free path | Full path |
|---|---|---|
| Host | Windows, Linux or macOS | same |
| Node.js | 22 or newer | same |
| DOS | FreeDOS 1.4, fetched for you | your own MS-DOS 6.22 floppy images |
| Games | ReBeep's own test programs (coming with the TSR) | your own copy of a speaker-only game |
| Cost | nothing | what you already own |

86Box, its ROMs, Jemm and FreeDOS are downloaded at pinned versions and checked by SHA-256, into
`~/.rebeep`. So are NASM and DOSBox-X on Windows. On Linux and macOS, NASM comes from your package
manager, and so does DOSBox-X on Linux.

## Quick start

```sh
git clone https://github.com/MetalHexx/rebeep.git && cd rebeep
node tools/rebeep.mjs env setup        # fetch tools, build the FreeDOS VM, write D:
node tools/rebeep.mjs vm run mirror-freedos
```

First boot shows a BIOS "CMOS checksum error". Press **F1** once; the VM remembers it.

## The lab

| VM | What it is |
|---|---|
| `mirror-freedos` | Pentium MMX 233, 16 MB, Sound Blaster Vibra 16S, FreeDOS 1.4 built by script |
| `mirror-msdos` | The same machine with your MS-DOS 6.22 |
| `slow-386sx` | A 386SX/16 with 4 MB, for measuring overhead near the bottom of the range |

Each VM has its own **C:** and a **D:** "delivery disk" the host rewrites on every deploy, with
Jemm, your games and the latest ReBeep build. The edit loop is:

```sh
node tools/rebeep.mjs build run --deploy   # assemble, then write every VM's D:
node tools/rebeep.mjs vm run mirror-freedos
```

Broke something? `rebeep vm reset <vm>` puts a VM back to its saved baseline.

## The `rebeep` CLI

One command, `rebeep <noun> <verb>`, with `--help` at every level and `--json` for scripts.

| Noun | Verbs |
|---|---|
| `env` | `setup` `status` `check` `reset` `clean` |
| `tool` | `list` `fetch` `verify` |
| `media` | `list` `add` `remove` |
| `vm` | `list` `show` `create` `run` `snapshot` `reset` |
| `disk` | `list` `deploy` |
| `build` | `run` `clean` |
| `test` | `list` `run` |
| `repo` | `check` |

Run it as `node tools/rebeep.mjs …`, or `npm link` once and type `rebeep …`.

## Full path: MS-DOS 6.22 and your own game

```sh
rebeep media add msdos622 path/to/folder-with-3-floppy-images
rebeep media add game path/to/game.zip --name GPC
rebeep vm create mirror-msdos              # skip if env setup already made it
rebeep vm run mirror-msdos --install       # run DOS Setup, swap floppies from the Media menu
```

Step by step in [getting started](docs/getting-started.md).

## Contributing

Issues and pull requests are welcome; start with [contributing](docs/contributing.md). AI agents
start at [AGENTS.md](AGENTS.md). Never commit DOS images, ROMs or game files:
`rebeep repo check` and CI guard against it.

## License

[MIT](LICENSE)
