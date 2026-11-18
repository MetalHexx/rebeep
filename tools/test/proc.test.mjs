import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { CliError } from '../lib/cli.mjs';
import { assertNotRunning, findExternalVm, isLocked, isRunning, launchDetached, nameMatches, processName } from '../lib/proc.mjs';
import { makeTempDir } from './helpers.mjs';
import { FAKE_86BOX, alive, removeWhenFree, waitFor } from './vmenv.mjs';

let tmp;
let pidFile;
const started = [];
beforeEach(() => {
  tmp = makeTempDir('rebeep-proc-');
  pidFile = path.join(tmp, 'rebeep.pid');
});
afterEach(async () => {
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
    await waitFor(() => !alive(pid), { what: 'the process to exit' }).catch(() => {});
  }
  await removeWhenFree(tmp);
});

async function launchFake(args = [], file = pidFile) {
  const { pid } = await launchDetached(process.execPath, [FAKE_86BOX, ...args], { cwd: tmp, pidFile: file });
  started.push(pid);
  return pid;
}

const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

describe('launchDetached and isRunning', () => {
  test('a launched process is running, is recorded, and is not once killed', async () => {
    const pid = await launchFake();
    const record = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
    assert.equal(record.pid, pid);
    assert.equal(record.bin, process.execPath);
    assert.ok(record.names.includes('86Box'));
    assert.ok(record.names.includes(path.basename(process.execPath)));
    assert.ok(record.started);
    assert.equal(isRunning(pidFile), true);

    process.kill(pid);
    await waitFor(() => !alive(pid), { what: 'the fake to exit' });
    assert.equal(isRunning(pidFile), false);
    assert.equal(fs.existsSync(pidFile), false, 'the stale pid file is deleted');
  });

  test('a second launch for the same pid file is refused while the first runs, and allowed once it is gone', async () => {
    const pid = await launchFake();
    await assert.rejects(launchFake(), (err) => err instanceof CliError && /is running\. Quit 86Box first/.test(err.message));
    assert.equal(JSON.parse(fs.readFileSync(pidFile, 'utf8')).pid, pid, 'the first launch is still the recorded one');

    process.kill(pid);
    await waitFor(() => !alive(pid), { what: 'the fake to exit' });
    assert.ok(await launchFake(), 'a stale pid file does not block a new launch');
  });

  test('a program that cannot start is a CliError and leaves no pid file', async () => {
    await assert.rejects(
      launchDetached(path.join(tmp, 'no-such-program'), [], { cwd: tmp, pidFile }),
      (err) => err instanceof CliError && /cannot start/.test(err.message),
    );
    assert.equal(fs.existsSync(pidFile), false);
  });

  test('a live pid whose name is not ours reads as not running, and the file is removed', () => {
    fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, names: ['86Box'] }));
    assert.equal(isRunning(pidFile), false);
    assert.equal(fs.existsSync(pidFile), false);
  });

  test('a live pid whose name cannot be read counts as running, and the file is kept', () => {
    fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, names: ['86Box'] }));
    assert.equal(isRunning(pidFile, { nameOf: () => null }), true);
    assert.ok(fs.existsSync(pidFile));
  });

  test('a dead pid and an old garbled file read as not running', () => {
    assert.equal(isRunning(pidFile), false);
    fs.writeFileSync(pidFile, JSON.stringify({ pid: deadPid(), names: [path.basename(process.execPath)] }));
    assert.equal(isRunning(pidFile), false);
    assert.equal(fs.existsSync(pidFile), false);

    fs.writeFileSync(pidFile, 'not json');
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(pidFile, old, old);
    assert.equal(isRunning(pidFile), false);
    assert.equal(fs.existsSync(pidFile), false);
  });

  test('a half-written pid file (a launch in progress) counts as running', () => {
    fs.writeFileSync(pidFile, '');
    assert.equal(isRunning(pidFile), true);
    assert.ok(fs.existsSync(pidFile));
  });

  test('readonly never deletes a stale pid file', () => {
    fs.writeFileSync(pidFile, JSON.stringify({ pid: deadPid(), names: ['86Box'] }));
    assert.equal(isRunning(pidFile, { readonly: true }), false);
    assert.ok(fs.existsSync(pidFile));
    fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, names: ['86Box'] }));
    assert.equal(isRunning(pidFile, { readonly: true }), false);
    assert.ok(fs.existsSync(pidFile));
  });
});

describe('nameMatches', () => {
  test('ignores case and .exe, and allows for the 15-character Linux truncation', () => {
    assert.ok(nameMatches('86Box.exe', '86box'));
    assert.ok(nameMatches('86BOX', '86Box.exe'));
    assert.ok(!nameMatches('node', '86Box'));
    assert.ok(nameMatches('some-long-binar', 'some-long-binary-name'), 'comm is cut to 15 characters');
    assert.ok(!nameMatches('short', 'shorter'), 'only a 15-character name is treated as cut');
  });
});

describe('processName', () => {
  test('names this process, and returns null for a pid that does not exist', () => {
    assert.match(processName(process.pid), /^node(\.exe)?$/i);
    assert.equal(processName(deadPid()), null);
  });
});

describe('assertNotRunning', () => {
  test('throws while the fake runs, and passes once it has stopped', async () => {
    const vm = { dir: tmp, pid: pidFile, cImg: path.join(tmp, 'c.img'), dImg: path.join(tmp, 'd.img') };
    assert.doesNotThrow(() => assertNotRunning(vm, 'demo'));
    const pid = await launchFake();
    assert.throws(
      () => assertNotRunning(vm, 'demo'),
      (err) => err instanceof CliError && err.message === 'demo is running. Quit 86Box first.',
    );
    assert.throws(() => assertNotRunning(vm, 'demo', { readonly: true }), /is running/);
    process.kill(pid);
    await waitFor(() => !alive(pid), { what: 'the fake to exit' });
    assert.doesNotThrow(() => assertNotRunning(vm, 'demo'));
  });

  test('on Linux and macOS a VM started outside the CLI (no pid file) is found by its -P folder', {
    skip: process.platform === 'win32' ? 'finds processes by command line; Windows checks file locks instead' : false,
  }, async () => {
    const vmDir = path.join(tmp, 'vm');
    fs.mkdirSync(vmDir);
    await launchFake(['-P', vmDir], path.join(tmp, 'other.pid'));
    const vm = { dir: vmDir, pid: pidFile, cImg: path.join(vmDir, 'c.img'), dImg: path.join(vmDir, 'd.img') };
    await waitFor(() => findExternalVm(vmDir) !== null, { what: 'the process to be listed' });
    assert.throws(() => assertNotRunning(vm, 'demo'), /demo is running/);
    assert.equal(findExternalVm(path.join(tmp, 'elsewhere')), null);
  });
});

describe('isLocked', () => {
  test('an ordinary file is not locked, and is left where it was', () => {
    const file = path.join(tmp, 'c.img');
    fs.writeFileSync(file, 'x');
    assert.equal(isLocked(file), false);
    assert.equal(isLocked(file, { rename: true }), false);
    assert.equal(isLocked(path.join(tmp, 'missing.img'), { rename: true }), false);
    assert.equal(fs.readFileSync(file, 'utf8'), 'x');
    assert.deepEqual(fs.readdirSync(tmp), ['c.img']);
  });

  test('a folder where the image should be is not a lock', () => {
    const dir = path.join(tmp, 'c.img');
    fs.mkdirSync(dir);
    assert.equal(isLocked(dir, { rename: true }), false);
  });

  test('refuses to run the rename check when a .rbcheck file is in the way', { skip: process.platform !== 'win32' }, () => {
    const file = path.join(tmp, 'c.img');
    fs.writeFileSync(file, 'x');
    fs.writeFileSync(`${file}.rbcheck`, 'older');
    assert.throws(() => isLocked(file, { rename: true }), /\.rbcheck already exists/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'x');
    assert.equal(fs.readFileSync(`${file}.rbcheck`, 'utf8'), 'older');
  });

  test('a file another process holds open the way 86Box does (shared, not deletable) is locked', { skip: process.platform !== 'win32' }, async () => {
    const file = path.join(tmp, 'c.img');
    fs.writeFileSync(file, 'x');
    const script = `$f = [System.IO.File]::Open('${file.replace(/'/g, "''")}', 'Open', 'ReadWrite', 'ReadWrite'); Start-Sleep -Seconds 60`;
    const holder = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
    started.push(holder.pid);
    await waitFor(() => isLocked(file, { rename: true }), { what: 'the holder to open the file', timeout: 60000 });

    const vm = { dir: tmp, pid: pidFile, cImg: file, dImg: path.join(tmp, 'd.img') };
    assert.throws(() => assertNotRunning(vm, 'demo'), /demo is running/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'x', 'the check put the name back');
    assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.endsWith('.rbcheck')), []);
    assert.doesNotThrow(() => assertNotRunning(vm, 'demo', { readonly: true }), 'a preview does not run the rename probe');
  });
});
