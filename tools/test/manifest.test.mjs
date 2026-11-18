import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { CliError } from '../lib/cli.mjs';
import {
  compareVersions,
  findOnPath,
  listTools,
  loadManifest,
  parseVersion,
  pickAsset,
  platformKey,
  probeSystemTool,
  resolveBin,
  resolveTool,
  toolRecordPath,
} from '../lib/manifest.mjs';
import { layout, repoLayout } from '../lib/paths.mjs';
import { makeTempDir, removeDir } from './helpers.mjs';

const real = JSON.parse(fs.readFileSync(repoLayout().manifest, 'utf8'));

let tmp;
beforeEach(() => {
  tmp = makeTempDir('rebeep-manifest-');
});
afterEach(() => removeDir(tmp));

const write = (manifest) => {
  const file = path.join(tmp, 'manifest.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  return file;
};

describe('the real manifest', () => {
  test('loads, and every download asset is pinned over https', () => {
    const manifest = loadManifest(repoLayout().manifest);
    let downloads = 0;
    for (const [name, tool] of Object.entries(manifest.tools)) {
      for (const [key, asset] of Object.entries(tool.platforms)) {
        if (asset.system) continue;
        downloads++;
        assert.match(asset.sha256, /^[0-9a-f]{64}$/, `${name} ${key}`);
        assert.match(asset.url, /^https:\/\//, `${name} ${key}`);
        assert.ok(asset.archive, `${name} ${key}`);
      }
    }
    assert.ok(downloads > 5);
  });

  test('every tool has a supported build on the common hosts', () => {
    for (const key of ['win32-x64', 'linux-x64', 'darwin-arm64']) {
      for (const [name, tool] of Object.entries(real.tools)) assert.ok(pickAsset(tool, key), `${name} ${key}`);
    }
  });
});

describe('pickAsset', () => {
  const tool = { platforms: { 'win32-x64': { id: 'win' }, 'linux-x64': { id: 'linux' }, any: { id: 'any' } } };
  test('prefers the exact platform key, then any', () => {
    assert.equal(pickAsset(tool, 'win32-x64').id, 'win');
    assert.equal(pickAsset(tool, 'linux-x64').id, 'linux');
    assert.equal(pickAsset(tool, 'darwin-arm64').id, 'any');
  });
  test('returns null when unsupported', () => {
    assert.equal(pickAsset({ platforms: { 'win32-x64': {} } }, 'linux-arm64'), null);
  });
  test('platformKey is platform-arch', () => {
    assert.equal(platformKey(), `${process.platform}-${process.arch}`);
  });
});

describe('loadManifest validation', () => {
  const good = () => ({
    tools: {
      t: { version: '1', description: 'd', platforms: { any: { url: 'https://h/a.zip', sha256: 'a'.repeat(64), archive: 'zip' } } },
    },
  });
  test('accepts a minimal manifest', () => assert.ok(loadManifest(write(good())).tools.t));
  test('names the missing field', () => {
    const noHash = good();
    delete noHash.tools.t.platforms.any.sha256;
    assert.throws(() => loadManifest(write(noHash)), /tools\.t\.platforms\.any.*sha256/);
    const noVersion = good();
    delete noVersion.tools.t.version;
    assert.throws(() => loadManifest(write(noVersion)), /tools\.t.*version/);
    const noHint = good();
    noHint.tools.t.platforms.any = { system: { cmd: 'x', versionArgs: [], minVersion: '1.0' } };
    assert.throws(() => loadManifest(write(noHint)), /hint/);
  });
  test('reports a missing file as a CliError', () => {
    assert.throws(() => loadManifest(path.join(tmp, 'nope.json')), CliError);
  });
  test('listTools hides on-demand tools unless asked', () => {
    const m = good();
    m.tools.o = { ...m.tools.t, onDemand: true };
    assert.deepEqual(listTools(m).map((t) => t.name), ['t']);
    assert.deepEqual(listTools(m, { includeOnDemand: true }).map((t) => t.name), ['t', 'o']);
  });
});

describe('versions', () => {
  test('parseVersion takes the first dotted number', () => {
    assert.equal(parseVersion('NASM version 3.02 compiled on Jan 1 2025'), '3.02');
    assert.equal(parseVersion('v24.11.0\n'), '24.11.0');
    assert.equal(parseVersion('no digits 7 here'), null);
  });
  test('compareVersions is numeric by part', () => {
    assert.equal(compareVersions('2.16', '2.16'), 0);
    assert.equal(compareVersions('2.9', '2.16'), -1);
    assert.equal(compareVersions('3.02', '2.16'), 1);
    assert.equal(compareVersions('2.16.1', '2.16'), 1);
    assert.equal(compareVersions('2024', '2024.0'), 0);
  });
  test('probeSystemTool finds an executable by absolute path and compares versions', () => {
    const base = { cmd: process.execPath, versionArgs: ['-v'], hint: 'h' };
    const ok = probeSystemTool({ ...base, minVersion: '1.0' });
    assert.equal(ok.ok, true);
    assert.equal(ok.version, process.versions.node);
    assert.equal(probeSystemTool({ ...base, minVersion: '999.0' }).ok, false);
    const missing = probeSystemTool({ ...base, cmd: 'rebeep-no-such-command', minVersion: '1.0' });
    assert.equal(missing.found, false);
  });
  test('on Windows, extension-less files and .cmd/.bat shims are not commands', { skip: process.platform !== 'win32' }, () => {
    fs.writeFileSync(path.join(tmp, 'plain'), 'not a program');
    fs.writeFileSync(path.join(tmp, 'shim.cmd'), '@echo shim 3.1\r\n');
    fs.writeFileSync(path.join(tmp, 'real.exe'), 'MZ');
    const env = { PATH: tmp, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    assert.equal(findOnPath('plain', env), null);
    assert.equal(findOnPath('shim', env), null);
    assert.equal(findOnPath('shim.cmd', env), null);
    assert.equal(findOnPath('real', env).toLowerCase(), path.join(tmp, 'real.exe').toLowerCase());
    assert.equal(findOnPath('real.exe', env).toLowerCase(), path.join(tmp, 'real.exe').toLowerCase());
    assert.deepEqual(probeSystemTool({ cmd: 'shim', versionArgs: [], minVersion: '1.0', hint: 'h' }, env).found, false);
  });

  test('findOnPath searches PATH', () => {
    const dir = path.dirname(process.execPath);
    const name = path.basename(process.execPath, path.extname(process.execPath));
    assert.ok(findOnPath(name, { PATH: dir, PATHEXT: '.EXE' }));
    assert.equal(findOnPath(name, { PATH: tmp, PATHEXT: '.EXE' }), null);
  });
});

describe('resolveBin and resolveTool', () => {
  test('resolveBin prefers the exact path, then the first sorted suffix match', () => {
    const dir = path.join(tmp, 'tool');
    fs.mkdirSync(path.join(dir, 'z', 'bin'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'a', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'z', 'bin', 'x.exe'), '');
    fs.writeFileSync(path.join(dir, 'a', 'bin', 'x.exe'), '');
    assert.equal(resolveBin(dir, 'bin/x.exe'), path.join(dir, 'a', 'bin', 'x.exe'));
    assert.equal(resolveBin(dir, 'x.exe'), path.join(dir, 'a', 'bin', 'x.exe'));
    fs.writeFileSync(path.join(dir, 'x.exe'), '');
    assert.equal(resolveBin(dir, 'x.exe'), path.join(dir, 'x.exe'));
    assert.equal(resolveBin(dir, 'missing.exe'), null);
  });

  const ctxFor = (manifest) => ({
    paths: layout(path.join(tmp, 'home')),
    repo: repoLayout(),
    env: { REBEEP_MANIFEST: write(manifest) },
  });
  const dl = { url: 'https://h/a.zip', sha256: 'a'.repeat(64), archive: 'zip', bin: 'bin/x.exe' };

  test('a download tool needs a fetch record, and its bin is resolved', () => {
    const ctx = ctxFor({ tools: { t: { version: '1.0', description: 'd', platforms: { any: dl } } } });
    assert.throws(() => resolveTool(ctx, 't'), (err) => err.hint === 'rebeep tool fetch t');
    const dir = ctx.paths.tool('t', '1.0');
    fs.mkdirSync(path.join(dir, 'pkg', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pkg', 'bin', 'x.exe'), '');
    fs.writeFileSync(toolRecordPath(ctx.paths, 't', '1.0'), '{}');
    const found = resolveTool(ctx, 't');
    assert.equal(found.strategy, 'download');
    assert.equal(found.dir, dir);
    assert.equal(found.bin, path.join(dir, 'pkg', 'bin', 'x.exe'));
  });

  test('a download tool without bin resolves with bin null', () => {
    const ctx = ctxFor({ tools: { t: { version: '1.0', description: 'd', platforms: { any: { ...dl, bin: undefined } } } } });
    fs.mkdirSync(ctx.paths.tool('t', '1.0'), { recursive: true });
    fs.writeFileSync(toolRecordPath(ctx.paths, 't', '1.0'), '{}');
    assert.equal(resolveTool(ctx, 't').bin, null);
  });

  test('a system tool resolves, or fails with its hint', () => {
    const system = { cmd: process.execPath, versionArgs: ['-v'], minVersion: '1.0', hint: 'install node' };
    const ok = ctxFor({ tools: { s: { version: '1', description: 'd', platforms: { any: { system } } } } });
    assert.equal(resolveTool(ok, 's').strategy, 'system');
    const old = ctxFor({ tools: { s: { version: '1', description: 'd', platforms: { any: { system: { ...system, minVersion: '999' } } } } } });
    assert.throws(() => resolveTool(old, 's'), (err) => err.hint === 'install node');
  });

  test('unknown and unsupported tools throw', () => {
    const ctx = ctxFor({ tools: { u: { version: '1', description: 'd', platforms: { 'nowhere-x1': dl } } } });
    assert.throws(() => resolveTool(ctx, 'nope'), /unknown tool/);
    assert.throws(() => resolveTool(ctx, 'u'), /no build for/);
  });
});
