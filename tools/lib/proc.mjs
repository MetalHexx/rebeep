import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './cli.mjs';

const TOOL_TIMEOUT_MS = 10000;
const COMM_LIMIT = 15;
const LAUNCH_GRACE_MS = 10000;

const isWindows = () => process.platform === 'win32';
const normalize = (name) => path.basename(String(name)).toLowerCase().replace(/\.exe$/, '');

/**
 * True when `seen` (a process name read from the OS) is `expected`. Linux cuts `comm` to 15
 * characters, so a 15-character name matches any name that starts with it.
 */
export function nameMatches(seen, expected) {
  const a = normalize(seen);
  const b = normalize(expected);
  return a === b || (a.length === COMM_LIMIT && b.startsWith(a)) || (b.length === COMM_LIMIT && a.startsWith(b));
}

/** Names that count as "this is 86Box": the binary's name with and without extension, plus the AppImage and app names. */
function defaultNames(bin) {
  const base = path.basename(bin);
  return [...new Set([base, base.replace(/\.[^.]*$/, ''), 'AppRun', '86Box'])];
}

/** Whether a process with this pid exists. `EPERM` means it exists but is not ours. */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

function psName(pid) {
  const run = spawnSync('ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8', timeout: TOOL_TIMEOUT_MS });
  const name = run.stdout?.trim();
  return run.status === 0 && name ? path.basename(name) : null;
}

/** The process name for a pid, or `null` when it cannot be read (no such process, or no access). */
export function processName(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (isWindows()) {
    const run = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: TOOL_TIMEOUT_MS,
    });
    const first = run.stdout?.split(/\r?\n/).find((line) => line.startsWith('"'));
    return first ? (/^"([^"]*)"/.exec(first)?.[1] ?? null) : null;
  }
  if (process.platform === 'linux') {
    try {
      const name = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
      if (name) return name;
    } catch {
      // fall back to ps
    }
  }
  return psName(pid);
}

/**
 * Finds a process that was started outside the CLI with `-P <vmDir>` (Linux: `/proc`; macOS: `ps`).
 * Returns its pid or `null`. Not available on Windows, where file locks are checked instead.
 */
export function findExternalVm(vmDir) {
  const own = new Set([process.pid, process.ppid]);
  const wanted = path.resolve(vmDir);
  if (process.platform === 'linux') {
    let pids;
    try {
      pids = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n));
    } catch {
      return null;
    }
    for (const pid of pids) {
      if (own.has(Number(pid))) continue;
      let args;
      try {
        args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      } catch {
        continue;
      }
      const at = args.indexOf('-P');
      if (at >= 0 && args[at + 1] !== undefined && path.resolve(args[at + 1]) === wanted) return Number(pid);
    }
    return null;
  }
  if (process.platform === 'darwin') {
    const run = spawnSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8', timeout: TOOL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
    for (const line of run.stdout?.split('\n') ?? []) {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      // Match `-P <dir>` as a whole argument: `-P /x/vm` must not match `-P /x/vm2 …`.
      // ps joins argv with spaces, so the dir is followed by a space or the end of the line.
      if (!match || own.has(Number(match[1]))) continue;
      const args = match[2];
      const at = args.indexOf(`-P ${wanted}`);
      if (at >= 0 && (at + 3 + wanted.length === args.length || args[at + 3 + wanted.length] === ' ')) return Number(match[1]);
    }
  }
  return null;
}

/**
 * Starts `bin` detached from this process (it outlives the CLI) and records it in `pidFile` as
 * `{ pid, bin, names, started }`. The pid file is created exclusively before the spawn, so two
 * launches of one VM cannot both start. Resolves to `{ pid }`; rejects if the VM is already
 * running or the program cannot start (the pid file is then removed).
 */
export async function launchDetached(bin, args, { cwd, pidFile, names = defaultNames(bin) }) {
  let fd;
  for (let attempt = 0; fd === undefined; attempt++) {
    try {
      fd = fs.openSync(pidFile, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (attempt > 0 || isRunning(pidFile)) throw new CliError(`${path.basename(path.dirname(pidFile))} is running. Quit 86Box first.`);
    }
  }
  try {
    const child = spawn(bin, args, { cwd, detached: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', resolve);
    }).catch((err) => {
      throw new CliError(`cannot start ${bin}: ${err.message}`);
    });
    child.unref();
    fs.writeSync(fd, `${JSON.stringify({ pid: child.pid, bin, names, started: new Date().toISOString() })}\n`);
    fs.closeSync(fd);
    return { pid: child.pid };
  } catch (err) {
    fs.closeSync(fd);
    fs.rmSync(pidFile, { force: true });
    throw err;
  }
}

/**
 * True when `pidFile` exists and its process is alive and is ours. A process that is alive but
 * whose name cannot be read counts as running (the guard must not fail open). A stale file (dead
 * process, or a pid reused by something else) is deleted, unless `readonly`. `nameOf` reads a
 * process name and exists so tests can simulate an unreadable one.
 */
export function isRunning(pidFile, { readonly = false, nameOf = processName } = {}) {
  let text;
  try {
    text = fs.readFileSync(pidFile, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    return true;
  }
  const discard = () => {
    if (!readonly) fs.rmSync(pidFile, { force: true });
    return false;
  };
  let record = null;
  try {
    record = JSON.parse(text);
  } catch {
    // a launch in progress writes the record a moment after creating the file
    const young = Date.now() - fs.statSync(pidFile).mtimeMs < LAUNCH_GRACE_MS;
    return young ? true : discard();
  }
  if (!isAlive(record?.pid)) return discard();
  const name = nameOf(record.pid);
  if (name === null) return true;
  const names = Array.isArray(record.names) ? record.names : [];
  return names.some((n) => nameMatches(name, n)) ? true : discard();
}

/**
 * Windows only: a file 86Box holds open cannot be written or renamed. The open check changes
 * nothing. The rename check (`rename: true`) is the one that catches 86Box, which opens its disks
 * shared for writing but not for deletion; it moves the file aside and back, so non-preview paths
 * only. Elsewhere always `false`.
 */
export function isLocked(file, { rename = false } = {}) {
  if (!isWindows()) return false;
  try {
    if (!fs.statSync(file).isFile()) return false;
  } catch {
    return false;
  }
  try {
    fs.closeSync(fs.openSync(file, 'r+'));
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') return true;
    throw err;
  }
  if (!rename) return false;

  const probe = `${file}.rbcheck`;
  if (fs.existsSync(probe)) throw new CliError(`${probe} already exists; delete it after checking it is not a disk image`);
  try {
    fs.renameSync(file, probe);
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') return true;
    throw err;
  }
  try {
    fs.renameSync(probe, file);
  } catch (err) {
    throw new CliError(`could not restore ${file} after a lock check (${err.message}); it is saved as ${probe}`);
  }
  return false;
}

/**
 * Throws unless the VM's 86Box is stopped: the pid file, a lock on a disk image (Windows), and a
 * process started outside the CLI with this VM's folder (Linux, macOS). With `readonly` (previews,
 * listings) nothing is modified: no stale pid file is removed and no file is renamed.
 */
export function assertNotRunning(vmPaths, vmName, { readonly = false } = {}) {
  const running =
    isRunning(vmPaths.pid, { readonly }) ||
    isLocked(vmPaths.cImg, { rename: !readonly }) ||
    isLocked(vmPaths.dImg, { rename: !readonly }) ||
    (vmPaths.dir !== undefined && findExternalVm(vmPaths.dir) !== null);
  if (running) throw new CliError(`${vmName} is running. Quit 86Box first.`);
}
