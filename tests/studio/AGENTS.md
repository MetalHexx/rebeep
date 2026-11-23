# studio tests

> C test programs for `RBSTUDIO.EXE`'s modules, compiled with Open Watcom and run headless in DOSBox-X.

## What's here

| Path | Role |
|---|---|
| `T_*.C` | One test program each (8.3 name). Compiled with `testlib.c` and every `src/studio/*.c` except `main.c` |
| `testlib.h` · `testlib.c` | The C mirror of `interpreter/testlib.inc`: `t_case`, `t_check`, `t_checkl`, `t_done` |
| `T_SMOKE.C` | Checks the generated version macros and a far-pointer round trip |

## Rules

- `rebeep test run --suite studio` compiles each `T_*.C` into `build/studio-tests/<NAME>.EXE` with the same `compileExe`
  wrapper and flags as `build run`, with `tests/studio` on the include path, and runs it in DOSBox-X. The results use the
  `RESULT.TXT` protocol in [../AGENTS.md](../AGENTS.md); a program returns `t_done()` from `main`.
- `t_case("name")` opens a case and closes the previous one; `t_check(ok, "what")` and `t_checkl(got, want, "what")`
  record the first failure of the case (`FAIL <case>: <what>: got N, want M`); `t_done()` prints `DONE <n>`.
- A first line of `/* SUITE: OPL2 */` runs the program a second time as an OPL2 card with the argument `/OPL2`; the
  first run uses DOSBox-X's default OPL3. The program reads `argv` for `/OPL2`.
- The shipped `REBEEP/FACTORY` data files are staged as `FACTORY\` beside the program, so a test reads the real patches.
- Every module but `main.c` is linked into every program: no module may use a symbol defined in `main.c`.
- Reference screens (from P03) are kept here too.

## Pitfalls

- Keep C89 and the studio's medium model; a program has the same 64 KB data group and 2 KB default stack as `RBSTUDIO`.
- A program that does not print `DONE` last, hits the 60 s DOSBox-X limit or writes no `RESULT.TXT` fails.

## Run / test

```sh
rebeep tool fetch open-watcom
rebeep test run --suite studio
```

## Related

- [../AGENTS.md](../AGENTS.md) · [src/studio/AGENTS.md](../../src/studio/AGENTS.md)
