# tests

> DOS test programs, assembled from the same source as ReBeep. Empty until the TSR is written.

## What's here

| Path | Role |
|---|---|
| `interpreter/` | Feeds scripted port-write sequences to the interpreter and checks the events. Runs headless in DOSBox-X |
| `exerciser/` | Plays known speaker cases through the real ports, for listening checks in 86Box |

## Rules

- A DOS program's exit code never reaches the host. The interpreter tests write their results to
  `RESULT.TXT` on a mounted folder, and the host parses that file.
- The CLI's own unit tests live in `tools/test/`, not here.

## Pitfalls

_None recorded yet._

## Run / test

```sh
rebeep test run --suite interpreter
```

## Related

- [src/AGENTS.md](../src/AGENTS.md)
