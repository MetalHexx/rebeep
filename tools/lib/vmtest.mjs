// The vm test suite: a probe batch file replaces ENV\BOOT.BAT on D:, the VM boots, the probe writes
// D:\RESULT.TXT and powers the VM off, and the result is read back out of d.img. The probe format
// and rules are in tests/vm/AGENTS.md.
import fs from 'node:fs';
import path from 'node:path';
import { applyReset, launchVm, planReset } from '../commands/vm.mjs';
import { readPackageVersion } from '../commands/build.mjs';
import { deliveryFor, deployDisk } from '../commands/disk.mjs';
import { evaluateResults, vmProbes } from '../commands/test.mjs';
import { CliError } from './cli.mjs';
import { readImage, toCrlf } from './fat.mjs';
import { assertNotRunning, isLocked, isRunning } from './proc.mjs';

const VM_NAME = 'mirror-freedos';
const DEFAULT_TIMEOUT_S = 150;
const POLL_MS = 2000;
const RELEASE_WAIT_MS = 15000;
const RESULT_FILE = 'RESULT.TXT';
const BOOT_ENTRY = 'ENV/BOOT.BAT';
const DOS_TEXT = /\.(bat|txt)$/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads a probe's leading REM directives. Returns `{ vm, timeout, floppy, reset }`: `timeout` in
 * seconds, `floppy` a repo-relative path (with `{version}` filled in) or `null`. Throws a
 * `CliError` for a VM other than `mirror-freedos` (only FreeDOS can power itself off), a bad
 * timeout, or a floppy path that leaves the repo.
 */
export function parseProbeHeader(text, { version, name = 'probe' } = {}) {
  const header = { vm: VM_NAME, timeout: DEFAULT_TIMEOUT_S, floppy: null, reset: false };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const rem = /^REM(?:\s+(.*))?$/i.exec(line);
    if (!rem) break;
    const body = (rem[1] ?? '').trim();
    let match;
    if ((match = /^VM:\s*(\S+)\s*$/i.exec(body))) {
      if (match[1] !== VM_NAME) {
        throw new CliError(`${name}: VM '${match[1]}' is not supported; probes run only on ${VM_NAME}`, {
          hint: 'Only FreeDOS can power the VM off by itself (FDAPM POWEROFF), which an unattended run needs.',
        });
      }
    } else if ((match = /^VM-TIMEOUT:\s*(\S+)\s*$/i.exec(body))) {
      const seconds = Number(match[1]);
      if (!Number.isInteger(seconds) || seconds <= 0) throw new CliError(`${name}: VM-TIMEOUT must be a whole number of seconds, got '${match[1]}'`);
      header.timeout = seconds;
    } else if ((match = /^VM-FLOPPY:\s*(\S.*?)\s*$/i.exec(body))) {
      const rel = match[1].replaceAll('{version}', version ?? '');
      if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) {
        throw new CliError(`${name}: VM-FLOPPY must be a path inside the repo, got '${match[1]}'`);
      }
      header.floppy = rel;
    } else if (/^VM-RESET\s*$/i.test(body)) {
      header.reset = true;
    }
  }
  return header;
}

/**
 * The probe's D: composition: the normal delivery for `vm` with `ENV/BOOT.BAT` replaced by the
 * probe (CRLF) and every file of tests/vm added under `TESTS/` (CRLF for .BAT and .TXT).
 */
export function composeProbeDelivery(ctx, vm, probeBytes) {
  const base = deliveryFor(ctx, [vm]);
  const boot = toCrlf(probeBytes);
  const files = base.files.filter((f) => f.path !== BOOT_ENTRY);
  files.push({ path: BOOT_ENTRY, bytes: boot, size: boot.length });

  const dir = path.join(ctx.repo.tests, 'vm');
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const raw = fs.readFileSync(path.join(dir, entry.name));
    const bytes = DOS_TEXT.test(entry.name) ? toCrlf(raw) : raw;
    files.push({ path: `TESTS/${entry.name.toUpperCase()}`, bytes, size: bytes.length });
  }
  return { ...base, files, dirs: [...base.dirs, 'TESTS'] };
}

/** Whether `build/release/release.json` was made from the targets in the current `build/build.json`. */
function floppyIsStale(repo) {
  const read = (file) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  };
  const release = read(path.join(repo.build, 'release', 'release.json'));
  if (!Array.isArray(release?.targets)) return true;
  const built = read(path.join(repo.build, 'build.json'));
  if (!Array.isArray(built?.targets)) return false;
  const released = new Map(release.targets.map((t) => [t.name, t.sha256]));
  return built.targets.some((t) => released.get(t.name) !== t.sha256);
}

/** Runs `build run` through the registry, so probes never test stale binaries. */
async function buildFirst(ctx) {
  const { default: nouns } = await import('../commands/index.mjs');
  const build = nouns.find((n) => n.name === 'build')?.verbs.find((v) => v.name === 'run');
  if (!build) throw new CliError('build run is not registered');
  await build.run({ ...ctx, noun: 'build', verb: 'run', args: {}, opts: { deploy: false } });
}

/** Resolves `--probe` (with or without `.BAT`, any case) to a file name, or every probe. */
function selectProbes(repo, wanted) {
  const all = vmProbes(repo.root);
  if (wanted === undefined) return all;
  const stem = wanted.replace(/\.bat$/i, '').toUpperCase();
  const found = all.find((n) => n.replace(/\.bat$/i, '').toUpperCase() === stem);
  if (!found) {
    throw new CliError(`no probe named '${wanted}' in tests/vm`, {
      hint: all.length ? `Probes: ${all.map((n) => n.replace(/\.bat$/i, '')).join(', ')}` : 'tests/vm has no P_*.BAT probes yet.',
    });
  }
  return [found];
}

/** Kills the VM recorded in the pid file, but only while `isRunning` says that process is ours. */
function killOurVm(vmPaths) {
  if (!isRunning(vmPaths.pid)) return;
  try {
    process.kill(JSON.parse(fs.readFileSync(vmPaths.pid, 'utf8')).pid);
  } catch {
    // already gone, or the record was just removed
  }
}

/** Waits for the VM to exit, up to `timeoutMs`. Resolves to whether it did. */
async function waitForExit(vmPaths, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (isRunning(vmPaths.pid)) {
    const left = deadline - Date.now();
    if (left <= 0) return false;
    await sleep(Math.min(POLL_MS, left));
  }
  return true;
}

/** Waits (bounded) until the VM is gone and, on Windows, d.img is free to be rewritten. */
async function waitForRelease(vmPaths) {
  const deadline = Date.now() + RELEASE_WAIT_MS;
  while (isRunning(vmPaths.pid) || isLocked(vmPaths.dImg, { rename: true })) {
    if (Date.now() >= deadline) return;
    await sleep(200);
  }
}

/** RESULT.TXT's text from the VM's d.img, or `{ problem }` when it is not there. */
function readResultText(vmPaths) {
  try {
    const image = readImage(fs.readFileSync(vmPaths.dImg));
    if (!image.exists(RESULT_FILE)) return { problem: `no ${RESULT_FILE} written` };
    return { text: image.readFile(RESULT_FILE).toString('utf8') };
  } catch (err) {
    return { problem: `cannot read ${RESULT_FILE} from d.img: ${err.message}` };
  }
}

async function runProbe(ctx, repo, file) {
  const program = file.replace(/\.bat$/i, '').toUpperCase();
  const probeBytes = fs.readFileSync(path.join(repo.tests, 'vm', file));
  const header = parseProbeHeader(probeBytes.toString('utf8'), { version: readPackageVersion(repo), name: program });
  const name = header.vm;
  const vm = ctx.paths.vm(name);

  let floppy;
  if (header.floppy) {
    floppy = path.join(repo.root, ...header.floppy.split(/[\\/]/));
    if (!fs.existsSync(floppy)) throw new CliError(`${program}: the floppy ${header.floppy} does not exist`, { hint: 'rebeep release create' });
    if (floppyIsStale(repo)) ctx.log.warn('the floppy is older than the build: run rebeep release create');
  }
  let resetPlan = null;
  if (header.reset) {
    resetPlan = planReset(ctx, name);
    if (resetPlan.action !== 'restore') {
      throw new CliError(`${program} asks for VM-RESET, but ${name} has no baseline`, { hint: `rebeep vm snapshot ${name}` });
    }
  }

  assertNotRunning(vm, name);
  ctx.log.step(`Running ${program} on ${name} (86Box will open a window; it closes itself when the probe finishes)`);
  let problem = null;
  let resultText = null;
  try {
    deployDisk(ctx, name, composeProbeDelivery(ctx, name, probeBytes));
    await launchVm(ctx, name, { floppy });
    if (!(await waitForExit(vm, header.timeout * 1000))) {
      killOurVm(vm);
      problem = 'timed out';
    }
    await waitForRelease(vm);
    const read = readResultText(vm);
    resultText = read.text ?? null;
    problem ??= read.problem ?? null;
  } finally {
    if (resetPlan) await applyReset(ctx, resetPlan);
    else deployDisk(ctx, name);
  }

  const lines = resultText === null ? [] : resultText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const verdict = resultText === null ? { ok: false, problem, passed: [], failed: [] } : evaluateResults(resultText, { bareDone: true });
  const result = { program, ...verdict, problem: problem ?? verdict.problem, lines };
  result.ok = result.ok && problem === null;
  for (const failure of result.failed) ctx.log.error(`${program}: ${failure.name}: ${failure.detail}`);
  if (result.problem) ctx.log.error(`${program}: ${result.problem}`);
  for (const line of lines) ctx.log.debug(`${program}: ${line}`);
  return result;
}

/**
 * Runs the vm suite: builds (unless `skipBuild`), then each probe (or just `probe`) in name order.
 * Returns `{ suite: 'vm', ok, programs: [{ program, ok, problem, passed, failed, lines }] }`.
 */
export async function runVmSuite(ctx, repo, { probe, skipBuild = false } = {}) {
  const files = selectProbes(repo, probe);
  if (files.length === 0) {
    ctx.log.info('vm: no probes yet');
    return { suite: 'vm', ok: true, programs: [] };
  }
  if (!skipBuild) {
    ctx.log.step('Building first, so the probes test current binaries');
    await buildFirst(ctx);
  }
  const programs = [];
  for (const file of files) programs.push(await runProbe(ctx, repo, file));
  return { suite: 'vm', ok: programs.every((p) => p.ok), programs };
}
