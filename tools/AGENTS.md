# tools

> The `rebeep` CLI: one Node entry point that drives the whole dev environment.

## What's here

| Path | Role |
|---|---|
| `rebeep.mjs` · `commands/<noun>.mjs` | Entry point · one file per noun (`env tool media vm disk build test release version repo site`) |
| `lib/cli` · `paths` · `log` · `fsx` | Spec, parsing, help, envelope · home and repo layout · output · atomic writes and swaps (use `fsx` for anything that replaces user files) |
| `lib/manifest` · `download` · `zip` | Pinned tools (`resolveTool`), verified downloads, safe zip read/extract, `writeZip`. `tar.xz` tools unpack in `commands/tool` |
| `lib/fat` | FAT images: FAT16 disks `buildImage`, FAT12 floppies `buildFloppy`, and `readImage`, `checkImage` for both |
| `lib/release` · `lib/version` | Package tree, `CHANGES.TXT`, text checks · SemVer, changelog entries and rules, `checkVersions`, the bump's edit |
| `lib/profiles` · `vmcfg` · `proc` | VM profiles, 86Box cfg rendering, launch and running-VM detection |
| `lib/delivery` · `freedos` · `nasm` · `watcom` · `guard` | D: contents (targets, `targets.json` `files`, the lab patch set) · scripted FreeDOS C: · assembling · compiling C with Open Watcom (`format: "exe"` targets; the `studio` suite uses it too) · payload guard |
| `lib/suites` · `commands/vmtest` | RESULT.TXT judging and discovery for the `interpreter`, `studio` and `vm` suites · the `vm` suite: probe header, probe D:, boot-and-wait loop |
| `lib/screens` | The studio suite's screen check: `parseScr` (a `tests/screens/*.scr` file), `dumpToCells` (a 4000-byte text-screen dump), `compareScreens` (glyph, bg, and fg unless a space) |
| `lib/site` · `siteserve` · `sitedev` · `sitecheck` | The product page: build and release stamp · `/rebeep/` preview server · its live-reload script · `site check` |
| `test/` | `*.test.mjs`; shared fixtures in `helpers.mjs`, `fake86box.mjs` (a stand-in for 86Box) and `serve.mjs` (a local HTTP server for downloads) |

## Rules

- **Grammar:** `rebeep <noun> <verb> [args] [options]`. Nouns are singular things. Verbs come only from: `list show status
  check setup create add remove fetch verify run snapshot reset deploy clean bump`. A new verb is added here first, in the same change.
- Every noun and verb is a **spec object** (name, summary, args, options, run). Help is rendered
  from it at every level (`rebeep`, `rebeep <noun>`, `rebeep <noun> <verb> --help`), never by hand.
- Global options (`--json`, `--home <path>`, `--verbose`, `-h/--help`, `--version`) go anywhere;
  a verb's own options go **after the verb**.
- `--json` prints exactly one `{ ok, data, error }` on stdout. Exit codes: `0` ok, `1` failure,
  `2` bad usage.
- Verbs that can destroy user state (`env reset`, `env clean`, `media remove`, `vm create
  --force`, `vm snapshot`, `vm reset`, `version bump`) are `destructive`: `--preview` changes nothing, and
  replacing anything needs `--yes` or a confirm. `env clean` deletes only the layout it owns.
- Node ≥ 22 built-ins only. **No npm dependencies**, ever. Paths via `path.join`; no shell.
- **Adding a command:** add the verb's spec to its noun file and a test that checks its help and
  behaviour; update the skill's `cli.md` if the activity is new.

## Pitfalls

- `node --test` treats arguments as globs: quote them (`"tools/test/**/*.test.mjs"`).
- Tests use a temp `REBEEP_HOME`, never the real `~/.rebeep`.
- Game zips are untrusted: read in memory, written into images, never extracted.
- `tar.xz` tools unpack with the host `tar`; on Windows that is `%SystemRoot%\System32\tar.exe` by absolute path (Git Bash's GNU `tar` reads `C:\...` as `host:file`).
- 86Box holds its disk images open; check the VM isn't running (`lib/proc`) before writing one.
- Windows Node can't spawn a `.cmd` without a shell. Tests fake tools with `process.execPath` and
  the `*_PREFIX_ARGS` overrides. Never call `test run --suite tools` from a test.
- **Overrides:** `REBEEP_HOME`, `REBEEP_MANIFEST`, `REBEEP_REPO_ROOT`, `REBEEP_NASM`, `REBEEP_WATCOM`, `REBEEP_DOSBOX`, `REBEEP_86BOX`
  (absolute paths; each with a `*_PREFIX_ARGS` JSON array), `REBEEP_FREEDOS_BUILDER`, `REBEEP_GITHUB_API` (the release lookup's base URL).

## Run / test

```sh
node tools/rebeep.mjs --help
node tools/rebeep.mjs test run --suite tools
```

## Related

- [env/AGENTS.md](../env/AGENTS.md): what the CLI builds
- [.claude/skills/rebeep-dev/references/cli.md](../.claude/skills/rebeep-dev/references/cli.md)
