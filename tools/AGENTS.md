# tools

> The `rebeep` CLI: one Node entry point that drives the whole dev environment.

## What's here

| Path | Role |
|---|---|
| `rebeep.mjs` | Entry point. Parses `rebeep <noun> <verb>`, dispatches, renders help |
| `commands/<noun>.mjs` | One file per noun: `env`, `tool`, `media`, `vm`, `disk`, `build`, `test`, `repo` |
| `lib/` | Shared code: `cli` (spec, parsing, help, envelope), `paths` (home layout), `manifest`, `download`, `zip`, `fat` (FAT16 images), `vmcfg`, `proc`, `guard`, `log` |
| `test/` | `node --test` suites, `*.test.mjs` |

## Rules

**Grammar:** `rebeep <noun> <verb> [args] [options]`.

- Nouns are singular things. Verbs come from this fixed vocabulary only:
  `list` `show` `status` `check` `setup` `create` `add` `remove` `fetch` `verify` `run` `snapshot`
  `reset` `deploy` `clean`. Need a new verb? Add it here first, in the same change.
- Every noun and verb is a **spec object** (name, summary, args, options, run). Help is rendered
  from the spec, never hand-written, so it can't drift.
- Help works at every level: `rebeep`, `rebeep <noun>`, `rebeep <noun> <verb> --help`.
- Global options: `--json`, `--home <path>`, `--verbose`, `-h/--help`.
- `--json` prints exactly one envelope, `{ ok, data, error }`, on stdout.
- Exit codes: `0` success, `1` failure, `2` bad usage (unknown noun, verb or option).
- Destructive verbs (`reset`, `clean`, `remove`) need `--yes` or an interactive confirm, and
  support `--preview`, which changes nothing.
- Node ≥ 22 built-ins only. **No npm dependencies**, ever.
- Paths through `path.join` / `lib/paths.mjs` only. No shell-specific commands.

**Adding a command:** add the verb's spec to its noun file, then a test in `test/` that checks its
help and its behaviour. Update the skill's `cli.md` reference if the activity is new.

## Pitfalls

- `node --test` treats its arguments as globs on Node 22+. Quote them:
  `node --test "tools/test/**/*.test.mjs"`.
- Tests must use a temp `REBEEP_HOME`, never the real `~/.rebeep`.
- Game zips are untrusted. They are read in memory and written into images; never extract them.
- 86Box holds its disk images open while running. Anything that writes an image must check the VM
  isn't running first (`lib/proc.mjs`).

## Run / test

```sh
node tools/rebeep.mjs --help
node tools/rebeep.mjs test run --suite tools
```

## Related

- [env/AGENTS.md](../env/AGENTS.md): what the CLI builds
- [.claude/skills/rebeep-dev/references/cli.md](../.claude/skills/rebeep-dev/references/cli.md)
