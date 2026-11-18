# tests

> DOS test programs, assembled from the same source as ReBeep. Empty until the TSR is written.

## What's here

| Path | Role |
|---|---|
| `interpreter/` | Feeds scripted port-write sequences to the interpreter and checks the events. Runs headless in DOSBox-X |
| `exerciser/` | Plays known speaker cases through the real ports, for listening checks in 86Box |

## Rules

- Interpreter test programs are `tests/interpreter/T_*.ASM`. `rebeep test run --suite interpreter`
  assembles each one and runs it headless in DOSBox-X.
- A DOS program's exit code never reaches the host, so each program writes `RESULT.TXT`:
  - `PASS <case>` for each passing case
  - `FAIL <case>: <detail>` for each failure (any line starting with `FAIL` counts)
  - `DONE <n>` as the **last** line, where n is the number of PASS and FAIL lines

  A missing or miscounted `DONE`, any `FAIL`, no results, or hitting the time limit fails the run.
- The CLI's own unit tests live in `tools/test/`, not here.

## Pitfalls

_None recorded yet._

## Run / test

```sh
rebeep test run --suite interpreter
```

## Related

- [src/AGENTS.md](../src/AGENTS.md)
