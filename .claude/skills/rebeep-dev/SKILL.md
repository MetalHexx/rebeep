---
name: rebeep-dev
description: Work in the ReBeep repo's dev environment through the rebeep CLI (tools/rebeep.mjs). Use to set up, check, reset or clean the 86Box environment; add MS-DOS or game media; create, install, run, snapshot or reset the VMs (mirror-msdos, mirror-freedos, slow-386sx); build ReBeep and deploy it to the VMs' D: disk; see, fetch or add files on a VM's D: (logs, results); log what a game makes ReBeep do with the REBEEPD trace build; run the tests; or add a command to the CLI.
---

# rebeep-dev

A thin router. **[AGENTS.md](../../../AGENTS.md) is the source of truth** for the repo map,
commands and hard rules. Read it first, then the one reference that matches the task.

| Activity | Reference |
|---|---|
| Set up, check, reset or clean the environment; add or remove media | [references/environment.md](references/environment.md) |
| Create a VM, install DOS, run it, snapshot it | [references/vms.md](references/vms.md) |
| Build, deploy to D:, test | [references/build-and-test.md](references/build-and-test.md) |
| See, fetch or add files on a VM's D: (logs, results, small files) | [references/d-files.md](references/d-files.md) |
| Log what a game makes ReBeep do (REBEEPD, the trace build) and read the log | [references/trace.md](references/trace.md) |
| Preview the product page (`rebeep site run`), build or check it | [site/AGENTS.md](../../../site/AGENTS.md) |
| Cut a release, or build the release package: zip, floppy image, checksums, notes | The [release skill](../release/SKILL.md) |
| Add or change a CLI noun, verb or option | [references/cli.md](references/cli.md) |
| Update docs → `update-docs` skill | [update-docs](../update-docs/SKILL.md) |

**Always:**

- Start with `node tools/rebeep.mjs env status`, and read `--help` before guessing a flag.
- Use `--json` when you need to read a result, and read the `data` block.
- Use `--preview` before any `reset`, `clean` or `remove`, and confirm with the user before running
  it for real.
- Never run game files on the host, and never commit anything from `~/.rebeep`.

**Adding an activity:** write one new file in `references/` and add one row to the table above.
