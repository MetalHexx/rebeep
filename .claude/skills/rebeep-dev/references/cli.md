# Changing the CLI

The grammar rules live in [tools/AGENTS.md](../../../../tools/AGENTS.md). Follow them exactly.

1. Pick the noun's file in `tools/commands/`. Use a verb from the fixed vocabulary.
2. Add the verb's spec object: name, summary, args, options, run.
3. Add a test in `tools/test/` that checks the help output and the behaviour.
4. Run `rebeep test run --suite tools`.
5. Update the docs and this skill if the activity is new.

A new test suite is a `runSuite` branch and a `--suite` choice in `commands/test.mjs`, discovery in `lib/suites.mjs`, and
a row in `test list`. The `studio` suite shows the shape: `compileExe` for the program, `runDosProgram` for DOSBox-X.
A `targets.json` data file needs no verb: add it under `files` (see [build-and-test.md](build-and-test.md)).
