import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { layout } from '../lib/paths.mjs';
import { makeTempDir, removeDir } from './helpers.mjs';
import { runRebeepAsync, serve, testManifest } from './serve.mjs';
import { makeZip } from './zipfixture.mjs';

const mainZip = makeZip([{ name: 'pkg/tool.cmd', data: 'x' }]);
const extraZip = makeZip([{ name: 'x.txt', data: 'extra' }]);

let server;
let tmp;
let home;
let env;

before(async () => {
  server = await serve({ '/86box.zip': mainZip, '/extra.zip': extraZip });
});
after(() => server.close());
beforeEach(() => {
  tmp = makeTempDir('rebeep-envcheck-');
  home = path.join(tmp, 'fresh', 'home');
  env = { REBEEP_HOME: home };
});
afterEach(() => removeDir(tmp));

function useManifest(manifest) {
  const file = path.join(tmp, 'manifest.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  env = { REBEEP_HOME: home, REBEEP_MANIFEST: file };
}

const check = (...args) => runRebeepAsync(['env', 'check', ...args], { env });
const byName = (result) => Object.fromEntries(JSON.parse(result.stdout).data.checks.map((c) => [c.name, c]));

describe('env check', () => {
  test('a fresh home with the real manifest exits 0 and creates the home', async () => {
    env = { REBEEP_HOME: home, REBEEP_MANIFEST: undefined };
    const result = await check();
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /STATUS\s+CHECK\s+DETAIL/);
    assert.equal(fs.existsSync(home), true);
    assert.deepEqual(fs.readdirSync(home), [], 'the write probe is cleaned up');

    const checks = byName(await check('--json'));
    assert.equal(checks.node.status, 'ok');
    assert.equal(checks['86box platform'].status, 'ok');
    assert.equal(checks['home writable'].status, 'ok');
    assert.ok(['ok', 'warn'].includes(checks['free space'].status));
    assert.equal(checks['tool 86box'].status, 'info');
    assert.equal(checks['tool 86box'].detail, 'not fetched');
  });

  test('--json is one envelope with data.checks', async () => {
    useManifest(testManifest({ base: server.base, zip: mainZip, extraZip }));
    const result = await check('--json');
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim().split('\n').length, 1);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, true);
    assert.ok(body.data.checks.every((c) => ['ok', 'warn', 'fail', 'info'].includes(c.status)));
    const checks = byName(result);
    assert.match(checks['tool sys'].detail, /found/);
    assert.equal(checks['tool sys'].status, 'ok');
  });

  test('a fetched tool is re-hashed against the manifest', async () => {
    useManifest(testManifest({ base: server.base, zip: mainZip, extraZip }));
    assert.equal((await runRebeepAsync(['tool', 'fetch', '86box'], { env })).code, 0);
    assert.equal(byName(await check('--json'))['tool 86box'].status, 'ok');

    const cache = path.join(layout(home).cache, '86box.zip');
    fs.writeFileSync(cache, 'corrupt');
    const bad = await check('--json');
    assert.equal(bad.code, 1);
    const body = JSON.parse(bad.stdout);
    assert.equal(body.ok, false);
    assert.equal(byName(bad)['tool 86box'].status, 'fail');
    const human = await check();
    assert.equal(human.code, 1);
    assert.match(human.stdout, /fail\s+tool 86box/, 'the table is still printed on failure');

    fs.rmSync(cache);
    const cleared = await check('--json');
    assert.equal(cleared.code, 0, cleared.stderr);
    assert.match(byName(cleared)['tool 86box'].detail, /cache cleared/);
    assert.equal(byName(cleared)['tool 86box'].status, 'info');
  });

  test('an old system tool is a warning, not a failure', async () => {
    useManifest(testManifest({ base: server.base, zip: mainZip, extraZip, sysMinVersion: '999.0' }));
    const result = await check('--json');
    assert.equal(result.code, 0, result.stderr);
    assert.equal(byName(result)['tool sys'].status, 'warn');
  });

  test('no 86Box build for this host fails', async () => {
    const manifest = testManifest({ base: server.base, zip: mainZip, extraZip });
    manifest.tools['86box'].platforms = { 'nowhere-x1': manifest.tools['86box'].platforms.any };
    useManifest(manifest);
    const result = await check('--json');
    assert.equal(result.code, 1);
    assert.equal(byName(result)['86box platform'].status, 'fail');
  });

  test('an unwritable home fails', async () => {
    const blocker = path.join(tmp, 'file');
    fs.writeFileSync(blocker, 'x');
    env = { REBEEP_HOME: path.join(blocker, 'home'), REBEEP_MANIFEST: undefined };
    const result = await check('--json');
    assert.equal(result.code, 1);
    assert.equal(byName(result)['home writable'].status, 'fail');
  });
});
