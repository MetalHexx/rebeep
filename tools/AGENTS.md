# tools

> The `rebeep` CLI: one Node entry point that drives the whole dev environment.

## What's here

| Path | Role |
|---|---|
| `rebeep.mjs` | Entry point. Parses `rebeep <noun> <verb>`, dispatches, renders help |
| `commands/<noun>.mjs` | One file per noun: `env`, `tool`, `media`, `vm`, `disk`, `build`, `test`, `repo` |
| `lib/cli.mjs` · `paths.mjs` · `log.mjs` | Spec, parsing, help, envelope · home and repo layout · output |
| `lib/manifest.mjs` · `download.mjs` · `zip.mjs` | Pinned tools: platform pick, `resolveTool`, verified downloads, safe zip read/extract |
| `lib/fat.mjs` | FAT16 disk images: `buildImage`, `readImage`, `checkImage`. Replaces mtools |
| `lib/profiles.mjs` · `vmcfg.mjs` · `proc.mjs` | VM profiles, 86Box cfg rendering, detached launch and running-VM detection |
| `lib/delivery.mjs` · `freedos.mjs` | What goes on D:, and the scripted FreeDOS C: |
| `lib/nasm.mjs` · `guard.mjs` | Assembling, process helpers · the payload guard behind `repo check` |
| `lib/fsx.mjs` | Atomic writes and copies, directory swaps, sizes. Use it for anything that replaces user files |
| `test/` | `node --test` suites, `*.test.mjs`. `helpers.mjs`, `zipfixture.mjs`, `vmenv.mjs`, `fake86box.mjs` are shared fixtures |

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
- Global options go anywhere. A verb's own options go **after the verb**.
- Verbs that can destroy user state (`env reset`, `env clean`, `media remove`, `vm create`
  (with `--force`), `vm snapshot`, `vm reset`) are marked `destructive`. They support `--preview`,
  which changes nothing, and need `--yes` or an interactive confirm before replacing anything.
  `build clean` is not: `build/` is regenerated.
- `env clean` deletes only the layout it owns (`86box`, `cache`, `tools`, `vms`; plus `baselines`
  and `media` with `--all`) and refuses a home that is a root, the user's home, or holds the repo.
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
- On Windows, Node can't spawn a `.cmd` without a shell. Tests fake a tool by running
  `process.execPath` with a script through the `*_PREFIX_ARGS` overrides below.
- Never let a test call `test run --suite tools` (it recurses). The command refuses inside
  `node --test`.

**Environment overrides** (for tests and power users): `REBEEP_HOME`, `REBEEP_MANIFEST`,
`REBEEP_REPO_ROOT`, `REBEEP_NASM` / `REBEEP_NASM_PREFIX_ARGS`, `REBEEP_DOSBOX` /
`REBEEP_DOSBOX_PREFIX_ARGS`, `REBEEP_86BOX` / `REBEEP_86BOX_PREFIX_ARGS`, `REBEEP_FREEDOS_BUILDER`.
Executable overrides take absolute paths; `*_PREFIX_ARGS` take a JSON array of strings.

## Run / test

```sh
node tools/rebeep.mjs --help
node tools/rebeep.mjs test run --suite tools
```

## Related

- [env/AGENTS.md](../env/AGENTS.md): what the CLI builds
- [.claude/skills/rebeep-dev/references/cli.md](../.claude/skills/rebeep-dev/references/cli.md)
