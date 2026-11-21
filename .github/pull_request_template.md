## What and why

<!-- What changed, and why. -->

## How it was tested

<!-- Commands run, VMs booted, what you heard. -->

## Checklist

- [ ] A new feature was talked over first, in a Feature idea issue, or this PR adds no feature
- [ ] No new library, tool or download, or "What and why" says why it's needed and the maintainer agreed
- [ ] No payloads: no DOS images, ROMs, game files, disk images or archives (`rebeep repo check` passes)
- [ ] No `Co-Authored-By` or other agent-harness attribution trailer in any commit or in this description
- [ ] Docs checked with the `update-docs` skill: `AGENTS.md`, docs and skill references match the change
- [ ] `CHANGELOG.md` has a line under `## [Unreleased]` in the shape AGENTS.md section 10 sets (with a doc link), or this change is not user-visible
- [ ] `rebeep test run --suite tools` passes
