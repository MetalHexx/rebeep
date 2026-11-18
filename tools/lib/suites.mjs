// Test-suite discovery and the RESULT.TXT protocol, shared by commands/test.mjs and commands/vmtest.mjs.
// RESULT.TXT protocol: a DOS test program writes one line per case, then a final sentinel.
//   PASS <case>            the case passed
//   FAIL <case>: <detail>  the case failed (any line starting with FAIL counts; the name may be empty)
//   DONE <n>               the last line; n is the number of PASS and FAIL lines
// A program fails when DONE is missing, is not last, or disagrees with the count, when no results
// were written, when a FAIL line is present, when RESULT.TXT is missing, or when it ran to the
// DOSBox time limit. The protocol is copied into tests/AGENTS.md. A VM probe (a batch file, which
// cannot count) may end with a bare `DONE`; see `evaluateResults`.
import fs from 'node:fs';
import path from 'node:path';

export const RESULT_FILE = 'RESULT.TXT';
const INTERPRETER_PROGRAM = /^t_.+\.asm$/i;
const VM_PROBE = /^p_.+\.bat$/i;

/**
 * Parses RESULT.TXT. `done` is the count when `DONE <n>` is the last line, `'bare'` when the last
 * line is just `DONE`, else null.
 */
export function parseResults(text) {
  const passed = [];
  const failed = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const pass = /^PASS\s+(.+)$/.exec(line);
    if (pass) {
      passed.push(pass[1].trim());
    } else if (/^FAIL/i.test(line)) {
      const rest = line.replace(/^FAIL/i, '').trim();
      const colon = rest.indexOf(':');
      const name = (colon < 0 ? rest : rest.slice(0, colon)).trim();
      const detail = colon < 0 ? '' : rest.slice(colon + 1).trim();
      failed.push({ name: name || '(unnamed)', detail });
    }
  }
  const last = /^DONE(?:\s+(\d+))?$/.exec(lines[lines.length - 1] ?? '');
  const done = last ? (last[1] === undefined ? 'bare' : Number(last[1])) : null;
  return { passed, failed, done };
}

/**
 * Judges a RESULT.TXT and returns `{ ok, problem, passed, failed }`. The final DONE must carry the
 * count of PASS and FAIL lines; with `bareDone` a final `DONE` without a count is accepted too.
 */
export function evaluateResults(text, { bareDone = false } = {}) {
  const { passed, failed, done } = parseResults(text);
  const count = passed.length + failed.length;
  let problem = null;
  if (done === null || (done === 'bare' && !bareDone)) problem = `${RESULT_FILE} has no final DONE line`;
  else if (done !== 'bare' && done !== count) problem = `DONE ${done} but ${count} result lines`;
  else if (count === 0) problem = `${RESULT_FILE} has no results`;
  return { ok: problem === null && failed.length === 0, problem, passed, failed };
}

function listFiles(dir, match, recursive) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return recursive ? listFiles(full, match, recursive) : [];
    return entry.isFile() && match(entry.name) ? [full] : [];
  });
}

/** The tools suite's test files: every `*.test.mjs` under tools/test. */
export function toolTestFiles(root) {
  return listFiles(path.join(root, 'tools', 'test'), (n) => n.endsWith('.test.mjs'), true);
}

/** The interpreter suite's programs: `T_*.asm` directly under tests/interpreter. */
export function interpreterPrograms(root) {
  return listFiles(path.join(root, 'tests', 'interpreter'), (n) => INTERPRETER_PROGRAM.test(n), false)
    .map((full) => path.basename(full))
    .sort();
}

/** The VM suite's probes: `P_*.BAT` directly under tests/vm, in name order. */
export function vmProbes(root) {
  return listFiles(path.join(root, 'tests', 'vm'), (n) => VM_PROBE.test(n), false)
    .map((full) => path.basename(full))
    .sort((a, b) => a.toUpperCase().localeCompare(b.toUpperCase()));
}
