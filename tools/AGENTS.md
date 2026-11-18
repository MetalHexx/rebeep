# tools

> The `rebeep` CLI: one Node entry point that drives the whole dev environment.

## What's here

| Path | Role |
|---|---|
| `rebeep.mjs` · `commands/<noun>.mjs` | Entry point · one file per noun (`env tool media vm disk build test repo`) |
| `lib/cli` · `paths` · `log` | Spec, parsing, help, envelope · home and repo layout · output |
| `lib/manifest` · `download` · `zip` | Pinned tools (`resolveTool`), verified downloads, safe zip read/extract |
| `lib/fat` | FAT16 disk images: `buildImage`, `readImage`, `checkImage` |
| `lib/profiles` · `vmcfg` · `proc` | VM profiles, 86Box cfg rendering, launch and running-VM detection |
| `lib/delivery` · `freedos` · `nasm` · `guard` | D: contents · scripted FreeDOS C: · assembling · payload guard |
| `lib/suites` · `commands/vmtest` | RESULT.TXT judging and suite discovery · the `vm` suite: probe header, probe D:, boot-and-wait loop |
| `lib/fsx` | Atomic writes, copies and directory swaps. Use it for anything that replaces user files |
| `test/` | `*.test.mjs`; shared fixtures in `helpers.mjs`, `fake86box.mjs` (a stand-in for 86Box) and `serve.mjs` (a local HTTP server for downloads) |

## Rules

- **Grammar:** `rebeep <noun> <verb> [args] [options]`. Nouns are singular things. Verbs come only
  from: `list show status check setup create add remove fetch verify run snapshot reset deploy
  clean`. Need a new verb? Add it here first, in the same change.
- Every noun and verb is a **spec object** (name, summary, args, options, run). Help is rendered
  from it at every level (`rebeep`, `rebeep <noun>`, `rebeep <noun> <verb> --help`), never by hand.
- Global options (`--json`, `--home <path>`, `--verbose`, `-h/--help`, `--version`) go anywhere;
  a verb's own options go **after the verb**.
- `--json` prints exactly one `{ ok, data, error }` on stdout. Exit codes: `0` ok, `1` failure,
  `2` bad usage.
- Verbs that can destroy user state (`env reset`, `env clean`, `media remove`, `vm create
  --force`, `vm snapshot`, `vm reset`) are `destructive`: `--preview` changes nothing, and
  replacing anything needs `--yes` or a confirm. `env clean` deletes only the layout it owns.
- Node ≥ 22 built-ins only. **No npm dependencies**, ever. Paths via `path.join`; no shell.
- **Adding a command:** add the verb's spec to its noun file and a test that checks its help and
  behaviour; update the skill's `cli.md` if the activity is new.

## Pitfalls

- `node --test` treats arguments as globs: quote them (`"tools/test/**/*.test.mjs"`).
- Tests use a temp `REBEEP_HOME`, never the real `~/.rebeep`.
- Game zips are untrusted: read in memory, written into images, never extracted.
- 86Box holds its disk images open; check the VM isn't running (`lib/proc`) before writing one.
- Windows Node can't spawn a `.cmd` without a shell. Tests fake tools with `process.execPath` and
  the `*_PREFIX_ARGS` overrides. Never call `test run --suite tools` from a test.
- **Overrides:** `REBEEP_HOME`, `REBEEP_MANIFEST`, `REBEEP_REPO_ROOT`, `REBEEP_NASM`,
  `REBEEP_DOSBOX`, `REBEEP_86BOX` (absolute paths; each with a `*_PREFIX_ARGS` JSON array),
  `REBEEP_FREEDOS_BUILDER`.

## Run / test

```sh
node tools/rebeep.mjs --help
node tools/rebeep.mjs test run --suite tools
```

## Related

- [env/AGENTS.md](../env/AGENTS.md): what the CLI builds
- [.claude/skills/rebeep-dev/references/cli.md](../.claude/skills/rebeep-dev/references/cli.md)
