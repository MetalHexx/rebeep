---
name: update-docs
description: Keep ReBeep's docs true before a commit or PR. Use when updating or reviewing docs; after any change to code, before a commit or PR; when an AGENTS.md or doc is stale, too long or drifting; or when adding a folder, a CLI command or option, or a user-visible feature.
---

# update-docs

The procedure only. **[AGENTS.md](../../../AGENTS.md) section 10, "Writing docs", is the source of
truth** for the doc map, the budgets and the style rules. Read it first. Do not restate its rules.

## 1. List what changed

```sh
git diff --name-status main                # committed and uncommitted changes against the base
git ls-files --others --exclude-standard   # untracked files
```

## 2. Map each change to the docs it touches

Find the owner of each fact in the doc map (AGENTS.md section 10), then:

| Change | Docs to update |
|---|---|
| Code in a folder | That folder's `AGENTS.md` |
| A CLI command or option | Its spec (help is generated from it), then the root `AGENTS.md` commands table, and the `docs/` page that owns the task |
| A user-visible change | A player-facing line under `## [Unreleased]` in `CHANGELOG.md` |
| A new top-level folder | A new `AGENTS.md` from the template, and a root map row |

## 3. Check each touched doc for drift

- Every command, option and path named in the doc exists. Run `--help` for commands; `ls` for paths.
- Every number matches the code: versions, sizes, geometry, counts.
- Nothing describes behaviour the code no longer has.
- Every link resolves to an existing path.

## 4. Rewrite in place

Fix or delete each stale line, as AGENTS.md section 10 directs.

## 5. Hold altitude and budget

Count lines with `wc -l <file>`, compare with the budget table in AGENTS.md section 10, and bring any
over-budget doc back inside it the way section 10 allows.

## 6. Final pass

- Check each touched doc against the rules in AGENTS.md section 10.
- Re-run the line counts and link checks on every file you touched.

## Report

List the docs you changed. For any drift or over-budget doc you could not fix, give its path and
the reason.
