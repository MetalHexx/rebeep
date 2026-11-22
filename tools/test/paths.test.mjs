import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { NameError, layout, repoLayout, repoRoot, resolveHome } from '../lib/paths.mjs';

const abs = (...parts) => path.resolve(path.sep, ...parts);

test('resolveHome: --home beats REBEEP_HOME beats ~/.rebeep', () => {
  const env = { REBEEP_HOME: abs('from-env') };
  assert.equal(resolveHome({ home: abs('from-flag'), env }), abs('from-flag'));
  assert.equal(resolveHome({ env }), abs('from-env'));
  assert.equal(resolveHome({ env: {} }), path.join(os.homedir(), '.rebeep'));
});

test('resolveHome resolves every source against cwd and returns an absolute path', () => {
  const cwd = abs('work');
  assert.equal(resolveHome({ home: 'rel/home', env: {}, cwd }), path.join(cwd, 'rel', 'home'));
  assert.equal(resolveHome({ env: { REBEEP_HOME: 'rel' }, cwd }), path.join(cwd, 'rel'));
  assert.equal(resolveHome({ env: {}, cwd }), path.join(os.homedir(), '.rebeep'));
  assert.ok(path.isAbsolute(resolveHome({ home: 'rel', env: {} })));
});

test('layout gives the documented home paths', () => {
  const home = abs('h');
  const l = layout(home);
  assert.equal(l.home, home);
  assert.equal(l.tools, path.join(home, 'tools'));
  assert.equal(l.cache, path.join(home, 'cache'));
  assert.equal(l.box86, path.join(home, '86box'));
  assert.equal(l.globalCfg, path.join(home, '86box', '86box_global.cfg'));
  assert.equal(l.media, path.join(home, 'media'));
  assert.equal(l.mediaMsdos, path.join(home, 'media', 'msdos622'));
  assert.equal(l.mediaGames, path.join(home, 'media', 'games'));
  assert.equal(l.vms, path.join(home, 'vms'));
  assert.equal(l.baselines, path.join(home, 'baselines'));
  assert.equal(l.tool('nasm', '3.02'), path.join(home, 'tools', 'nasm', '3.02'));

  const vmDir = path.join(home, 'vms', 'mirror-msdos');
  assert.deepEqual(l.vm('mirror-msdos'), {
    dir: vmDir,
    cfg: path.join(vmDir, '86box.cfg'),
    cImg: path.join(vmDir, 'c.img'),
    dImg: path.join(vmDir, 'd.img'),
    nvr: path.join(vmDir, 'nvr'),
    floppy: path.join(vmDir, 'floppy'),
    pid: path.join(vmDir, 'rebeep.pid'),
  });

  const baseDir = path.join(home, 'baselines', 'mirror-msdos');
  assert.deepEqual(l.baseline('mirror-msdos'), {
    dir: baseDir,
    cImg: path.join(baseDir, 'c.img'),
    nvr: path.join(baseDir, 'nvr'),
    meta: path.join(baseDir, 'meta.json'),
  });
});

test('layout rejects unsafe names with a NameError that says what and why', () => {
  const l = layout(abs('h'));
  const bad = [
    [() => l.vm('..'), /invalid vm name "\.\."/],
    [() => l.vm('a/b'), /invalid vm name "a\/b"/],
    [() => l.baseline('..\\x'), /invalid baseline name/],
    [() => l.tool('nasm', '../x'), /invalid version name/],
    [() => l.tool('', '1'), /invalid tool name/],
    [() => l.vm('trailing.'), /do not end with/],
    [() => l.vm('trailing '), /invalid vm name/],
    [() => l.vm('.hidden'), /invalid vm name/],
    [() => l.vm('CON'), /reserved Windows device name/],
    [() => l.vm('nul.txt'), /reserved Windows device name/],
    [() => l.baseline('com1'), /reserved Windows device name/],
    [() => l.tool('lpt9', '1'), /reserved Windows device name/],
  ];
  for (const [fn, message] of bad) {
    assert.throws(fn, (err) => err instanceof NameError && message.test(err.message), String(message));
  }
  assert.equal(l.vm('console').dir, path.join(abs('h'), 'vms', 'console'));
});

test('layout does not create folders', () => {
  const home = path.join(os.tmpdir(), `rebeep-never-created-${process.pid}`);
  layout(home).vm('x');
  assert.equal(fs.existsSync(home), false);
});

test('repoRoot contains tools/rebeep.mjs', () => {
  assert.ok(fs.existsSync(path.join(repoRoot(), 'tools', 'rebeep.mjs')));
});

test('repoLayout gives the documented repo paths', () => {
  const root = abs('r');
  assert.deepEqual(repoLayout(root), {
    root,
    src: path.join(root, 'src'),
    targets: path.join(root, 'src', 'targets.json'),
    build: path.join(root, 'build'),
    site: path.join(root, 'site'),
    siteBuild: path.join(root, 'build', 'site'),
    tests: path.join(root, 'tests'),
    env: path.join(root, 'env', '86box'),
    manifest: path.join(root, 'env', '86box', 'manifest.json'),
    profiles: path.join(root, 'env', '86box', 'profiles'),
    dos: path.join(root, 'env', '86box', 'dos'),
    toolsTest: path.join(root, 'tools', 'test'),
  });
  assert.equal(repoLayout().root, repoRoot());
});
