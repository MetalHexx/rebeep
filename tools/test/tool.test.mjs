import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { sha256Buffer } from '../lib/download.mjs';
import { layout } from '../lib/paths.mjs';
import { makeTempDir, removeDir, runRebeep } from './helpers.mjs';
import { runRebeepAsync, serve, testManifest } from './serve.mjs';
import { makeZip } from './zipfixture.mjs';

const mainZip = makeZip([
  { name: 'pkg', dir: true },
  { name: 'pkg/tool.cmd', data: 'echo tool', method: 8 },
  { name: 'pkg/data/one.txt', data: 'one' },
  { name: 'pkg/data/two.txt', data: 'two', method: 8 },
]);
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
  server.hits.length = 0;
  tmp = makeTempDir('rebeep-tool-');
  home = path.join(tmp, 'home');
  useManifest(testManifest({ base: server.base, zip: mainZip, extraZip }));
});
afterEach(() => removeDir(tmp));

function useManifest(manifest) {
  const file = path.join(tmp, 'manifest.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  env = { REBEEP_HOME: home, REBEEP_MANIFEST: file };
}

const rebeep = (...args) => runRebeepAsync(args, { env });
const toolDir = (name, version) => layout(home).tool(name, version);
const envelope = (result) => JSON.parse(result.stdout.trim());

describe('tool fetch / list / verify', () => {
  test('fetch, list and verify work end to end', async () => {
    let list = envelope(await rebeep('tool', 'list', '--json'));
    const byName = (data) => Object.fromEntries(data.tools.map((t) => [t.name, t]));
    assert.equal(byName(list.data)['86box'].state, 'not fetched');
    assert.match(byName(list.data).sys.state, /^found v\d/);
    assert.equal(byName(list.data).extra.onDemand, true);

    const fetched = await rebeep('tool', 'fetch');
    assert.equal(fetched.code, 0, fetched.stderr);
    assert.match(fetched.stdout, /86box\s+1\.0\s+fetched/);
    assert.deepEqual(server.hits, ['/86box.zip'], 'on-demand tools are not fetched by default');

    const dir = toolDir('86box', '1.0');
    assert.equal(fs.readFileSync(path.join(dir, 'tool.cmd'), 'utf8'), 'echo tool');
    assert.equal(fs.readFileSync(path.join(dir, 'data', 'two.txt'), 'utf8'), 'two');
    const record = JSON.parse(fs.readFileSync(path.join(dir, '.rebeep-tool.json'), 'utf8'));
    assert.equal(record.name, '86box');
    assert.equal(record.url, `${server.base}/86box.zip`);
    assert.deepEqual(Object.keys(record.files).sort(), ['data/one.txt', 'data/two.txt', 'tool.cmd']);
    assert.ok(record.fetchedAt);

    list = envelope(await rebeep('tool', 'list', '--json'));
    assert.equal(byName(list.data)['86box'].state, 'fetched');
    assert.equal(byName(list.data).extra.state, 'not fetched');

    const verified = await rebeep('tool', 'verify');
    assert.equal(verified.code, 0, verified.stderr);
    assert.match(verified.stdout, /verified/);
    assert.match(verified.stdout, /not fetched/);
  });

  test('a second fetch is skipped; --force re-downloads and restores modified files', async () => {
    await rebeep('tool', 'fetch');
    const again = await rebeep('tool', 'fetch', '--json');
    assert.equal(envelope(again).data.tools.find((t) => t.name === '86box').status, 'already fetched');

    fs.writeFileSync(path.join(toolDir('86box', '1.0'), 'tool.cmd'), 'changed');
    const forced = await rebeep('tool', 'fetch', '86box', '--force');
    assert.equal(forced.code, 0, forced.stderr);
    assert.equal(server.hits.length, 2, '--force re-downloads');
    assert.equal(fs.readFileSync(path.join(toolDir('86box', '1.0'), 'tool.cmd'), 'utf8'), 'echo tool');
  });

  test('a cached download is reused when the tool folder is wiped', async () => {
    await rebeep('tool', 'fetch', '86box');
    fs.rmSync(toolDir('86box', '1.0'), { recursive: true });
    const again = await rebeep('tool', 'fetch', '86box');
    assert.equal(again.code, 0, again.stderr);
    assert.equal(server.hits.length, 1);
    assert.equal(fs.existsSync(path.join(toolDir('86box', '1.0'), 'tool.cmd')), true);
  });

  test('an on-demand tool can be fetched by name', async () => {
    const result = await rebeep('tool', 'fetch', 'extra');
    assert.equal(result.code, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(toolDir('extra', '2.0'), 'x.txt'), 'utf8'), 'extra');
  });

  test('verify fails on a modified, a missing and an extra file', async () => {
    await rebeep('tool', 'fetch', '86box');
    const dir = toolDir('86box', '1.0');
    fs.writeFileSync(path.join(dir, 'tool.cmd'), 'tampered');
    fs.rmSync(path.join(dir, 'data', 'one.txt'));
    fs.writeFileSync(path.join(dir, 'data', 'new.txt'), 'new');

    const result = await rebeep('tool', 'verify', '86box');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /modified: tool\.cmd/);
    assert.match(result.stderr, /missing: data\/one\.txt/);
    assert.match(result.stderr, /extra: data\/new\.txt/);

    const json = envelope(await rebeep('tool', 'verify', '86box', '--json'));
    assert.equal(json.ok, false);
    assert.equal(json.data.tools[0].problems.length, 3);

    assert.equal((await rebeep('tool', 'fetch', '86box', '--force')).code, 0);
    assert.equal((await rebeep('tool', 'verify')).code, 0);
  });

  test('verify fails when the cached download no longer matches the manifest', async () => {
    await rebeep('tool', 'fetch', '86box');
    fs.writeFileSync(path.join(layout(home).cache, '86box.zip'), 'rotten');
    const result = await rebeep('tool', 'verify', '86box');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /cached download 86box\.zip/);
  });

  test('--json prints exactly one envelope on stdout', async () => {
    const result = await rebeep('tool', 'fetch', '--json');
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim().split('\n').length, 1);
    const body = envelope(result);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data.tools.map((t) => t.status), ['fetched', 'found']);
  });

  test('a wrong pinned hash fails, names the URL and installs nothing', async () => {
    useManifest(testManifest({ base: server.base, zip: mainZip, extraZip, zipSha256: 'b'.repeat(64) }));
    const result = await rebeep('tool', 'fetch', '86box', '--json');
    assert.equal(result.code, 1);
    const body = envelope(result);
    assert.equal(body.ok, false);
    assert.match(body.error.message, /SHA-256 mismatch/);
    assert.ok(body.error.message.includes(`${server.base}/86box.zip`));
    assert.equal(fs.existsSync(toolDir('86box', '1.0')), false);
    assert.deepEqual(fs.readdirSync(layout(home).cache), []);
  });

  test('a missing or old system tool is a warning, not a failure', async () => {
    useManifest(testManifest({ base: server.base, zip: mainZip, extraZip, sysMinVersion: '999.0' }));
    const result = await rebeep('tool', 'fetch', 'sys', '--json');
    assert.equal(result.code, 0, result.stderr);
    const body = envelope(result);
    assert.equal(body.data.tools[0].status, 'warning');
    assert.match(body.data.tools[0].message, /install node/);
    assert.equal(body.data.warnings, 1);
  });

  test('a tool with no build for this host is skipped with a warning', async () => {
    const manifest = testManifest({ base: server.base, zip: mainZip, extraZip });
    manifest.tools['86box'].platforms = { 'nowhere-x1': manifest.tools['86box'].platforms.any };
    useManifest(manifest);
    const fetched = envelope(await rebeep('tool', 'fetch', '86box', '--json'));
    assert.equal(fetched.data.tools[0].status, 'unsupported');
    const list = envelope(await rebeep('tool', 'list', '--json'));
    assert.equal(list.data.tools.find((t) => t.name === '86box').strategy, 'unsupported');
  });

  test('an unknown tool name is a usage error', () => {
    const result = runRebeep(['tool', 'fetch', 'nope'], { env });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /unknown tool 'nope'/);
  });

  test('a failed --force re-fetch keeps the old install and does not skip the other tools', async () => {
    assert.equal((await rebeep('tool', 'fetch', '86box')).code, 0);
    const dir = toolDir('86box', '1.0');
    const hostile = makeZip([{ name: 'pkg/tool.cmd', data: 'new' }, { name: 'pkg/../../evil.txt', data: 'evil' }]);
    const evil = await serve({ '/86box.zip': hostile, '/extra.zip': extraZip });
    try {
      useManifest(testManifest({ base: evil.base, zip: hostile, extraZip }));
      const result = await rebeep('tool', 'fetch', '--force', '--json');
      assert.equal(result.code, 1);
      const body = envelope(result);
      assert.deepEqual(body.data.tools.map((t) => t.status), ['failed', 'found']);
      assert.equal(fs.readFileSync(path.join(dir, 'tool.cmd'), 'utf8'), 'echo tool');
      assert.equal(fs.existsSync(path.join(dir, '.rebeep-tool.json')), true);
      assert.deepEqual(fs.readdirSync(path.dirname(dir)), ['1.0'], 'no staging folder is left behind');
    } finally {
      await evil.close();
    }
  });

  describe('AppImage tools', { skip: process.platform !== 'linux' }, () => {
    const appImage = (body) => Buffer.from(`#!/bin/sh\n${body}\n`);
    const good = appImage(`if [ "$1" = "--appimage-extract" ]; then
  mkdir -p squashfs-root/usr/bin
  printf '#!/bin/sh\\necho hi\\n' > squashfs-root/usr/bin/app
  chmod 755 squashfs-root/usr/bin/app
  ln -s usr/bin/app squashfs-root/AppRun
  exit 0
fi
exit 3`);
    const broken = appImage('echo "squashfs is damaged" >&2\nexit 3');

    const manifestFor = (base, bytes) => ({
      schema: 1,
      tools: {
        box: {
          version: '1.0',
          description: 'appimage tool',
          platforms: {
            any: { url: `${base}/Box.AppImage`, sha256: sha256Buffer(bytes), archive: 'appimage', bin: 'squashfs-root/AppRun' },
          },
        },
      },
    });

    test('is copied, extracted in place, hashed, and verifies; a failing extractor reports stderr and keeps it', async () => {
      const ok = await serve({ '/Box.AppImage': good });
      const bad = await serve({ '/Box.AppImage': broken });
      try {
        useManifest(manifestFor(ok.base, good));
        const fetched = await rebeep('tool', 'fetch', 'box');
        assert.equal(fetched.code, 0, fetched.stderr);
        const dir = toolDir('box', '1.0');
        assert.deepEqual(fs.readdirSync(dir).sort(), ['.rebeep-tool.json', 'squashfs-root']);
        assert.equal(fs.lstatSync(path.join(dir, 'squashfs-root', 'AppRun')).isSymbolicLink(), true);
        const record = JSON.parse(fs.readFileSync(path.join(dir, '.rebeep-tool.json'), 'utf8'));
        assert.deepEqual(Object.keys(record.files).sort(), ['squashfs-root/AppRun', 'squashfs-root/usr/bin/app']);
        assert.equal((await rebeep('tool', 'verify')).code, 0);

        useManifest(manifestFor(bad.base, broken));
        const failed = await rebeep('tool', 'fetch', 'box', '--force');
        assert.equal(failed.code, 1);
        assert.match(failed.stderr, /squashfs is damaged/);
        assert.equal(fs.existsSync(path.join(dir, 'squashfs-root', 'usr', 'bin', 'app')), true);
      } finally {
        await ok.close();
        await bad.close();
      }
    });
  });

  test('a hostile archive is refused and leaves no extracted files outside the tool folder', async () => {
    const hostile = makeZip([{ name: 'pkg/ok.txt', data: 'ok' }, { name: 'pkg/../../../evil.txt', data: 'evil' }]);
    const evil = await serve({ '/86box.zip': hostile, '/extra.zip': extraZip });
    try {
      useManifest(testManifest({ base: evil.base, zip: hostile, extraZip }));
      const result = await rebeep('tool', 'fetch', '86box');
      assert.equal(result.code, 1);
      assert.match(result.stderr, /unsafe zip entry/);
      assert.equal(fs.existsSync(path.join(home, 'evil.txt')), false);
      assert.equal(fs.existsSync(path.join(toolDir('86box', '1.0'), '.rebeep-tool.json')), false);
    } finally {
      await evil.close();
    }
  });
});
