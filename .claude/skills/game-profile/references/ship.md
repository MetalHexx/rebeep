# 8. Ship it

A profile in `src/factory/profiles/<SHORT>/` comes with ReBeep: `INSTALL` puts it in the player's
`FACTORY\PROFILES\<SHORT>\`, and merged means shipped. Only when the user wants it shipped.

## Steps

1. The user has heard it work: every rule and effect fires where it should ([check.md](check.md)),
   and they like each patch.
2. Move its folder from the lab's `.claude/skills/rebeep-dev/profiles/<SHORT>/` to
   `src/factory/profiles/<SHORT>/`: the `.RBG` and the patches it names, nothing else. Its top
   comment says what it covers, in a player's words.
3. List each file in `src/targets.json` `files`, deployed to `REBEEP/FACTORY/PROFILES/<SHORT>`.
4. In `release/INSTALL.BAT`, make, clear and copy the folder, as for `GPC`, with a label of its
   own (MS-DOS reads 8 characters of it).
5. `rebeep test run --suite tools`: `factory.test.mjs` names anything left out.
6. Docs: a `CHANGELOG.md` line, the game in [compatibility.md](../../../../docs/guide/compatibility.md),
   and the list in
   [profiles.md](../../../../docs/guide/profiles.md#change-one-that-comes-with-rebeep).
7. `rebeep build run --deploy`, then the [load check](check.md#check-that-it-loads) with no
   `PROFILES\<SHORT>` on D:.

## Changing a shipped profile

- A small fix: edit it in `src/factory/profiles/<SHORT>/`, then `rebeep build run --deploy`.
- To tune it over several sessions, copy the folder into the lab's `profiles/`. D: then has it in
  `PROFILES\`, where it wins over the factory one. Move the result back, and remove the lab copy.
