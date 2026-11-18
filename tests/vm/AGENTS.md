# vm

> Unattended probes: DOS batch files that run inside `mirror-freedos` and report through `RESULT.TXT`.

## What's here

| Path | Role |
|---|---|
| `P_*.BAT` | One probe each: CRLF, 8.3 name. `rebeep test run --suite vm` runs them in name order |

## Rules

- **A run.** Per probe the suite writes a probe D: (the normal D: with the probe as `ENV\BOOT.BAT` and
  every file here under `TESTS\`), boots `mirror-freedos` in 86Box (a window opens), waits for the
  probe to power the VM off, reads `D:\RESULT.TXT` out of `d.img`, and always redeploys the normal D:.
  A probe still running at its timeout is killed and fails. It builds first unless `--skip-build`,
  and is not part of `--suite all`.
- **Header.** Leading `REM` lines may hold directives:
  - `REM VM: mirror-freedos`: the default and the only value; only FreeDOS can power itself off.
  - `REM VM-TIMEOUT: <seconds>`: default 150.
  - `REM VM-FLOPPY: <repo-relative path>`: attached as A: from a copy, `{version}` is `package.json`'s
    version; the original is never written. The suite does not build the file; it must exist first.
  - `REM VM-RESET`: restore C: from the VM's baseline afterwards; needs a baseline.
- **Results.** The interpreter protocol in [../AGENTS.md](../AGENTS.md), relaxed once: the last line may
  be a bare `DONE`, since a batch file can't count (`DONE <n>` must still match). Any `FAIL` fails;
  no results fails. Other lines (benchmark numbers) are shown by `--verbose` and `--json`.
- Append results with `ECHO ...>> D:\RESULT.TXT`, end with `DONE`, then
  `C:\FREEDOS\BIN\FDAPM.COM POWEROFF`.
- Start with `D:` and `CD \`, so scratch files land on the disposable D:, never on C:.
- Call FreeDOS tools by full path; a probe can't rely on `PATH`.
- Use `IF ERRORLEVEL n` (at least n), never `%ERRORLEVEL%`. Pair it with `IF NOT ERRORLEVEL n+1` for an
  exact code.
- Call ReBeep's programs by full path: `D:\REBEEP\REBEEP.COM`, `LH D:\REBEEP\REBEEP.COM`,
  `D:\REBEEP\RBTEST.COM`, never bare names. They are not on `PATH`.
- Memory checks: delete `RBMEM.DAT` before each `RBTEST /M:SAVE`, and append SAVE's output to the
  results. Never `SET` a variable between a `SAVE` and its `SAME`: a larger environment copy shifts the number.
- Check that a program exists (`IF NOT EXIST`) before using its errorlevel: a missing program leaves
  the previous errorlevel standing.
- Run another batch file with `CALL`, or control never returns.

## Pitfalls

- The VM must never keep the probe D:. The suite redeploys in a `finally`; if a run is cut short,
  run `rebeep disk deploy mirror-freedos`.

## Run / test

```sh
rebeep test run --suite vm --probe P_SMOKE
rebeep test run --suite vm --skip-build
```

## Related

- [../AGENTS.md](../AGENTS.md): the interpreter protocol
- [../../tools/AGENTS.md](../../tools/AGENTS.md): the CLI that runs the suite
