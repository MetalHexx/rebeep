import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { CliError } from '../lib/cli.mjs';
import { assetFile, cached, download, fetchAsset, isCached, sha256Buffer, sha256File } from '../lib/download.mjs';
import { makeTempDir, removeDir } from './helpers.mjs';

const payload = Buffer.alloc(300_000, 'rebeep');
const payloadHash = sha256Buffer(payload);

let server;
let base;
let hits;
let tmp;

before(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url} ${req.headers['user-agent']}`);
    if (req.url === '/good.zip') {
      res.writeHead(200, { 'Content-Length': payload.length });
      res.end(payload);
    } else if (req.url === '/stall') {
      res.writeHead(200, { 'Content-Length': payload.length });
      res.write(payload.subarray(0, 100));
    } else if (req.url === '/short') {
      res.writeHead(200, { 'Content-Length': payload.length });
      res.write(payload.subarray(0, 100), () => req.socket.destroy());
    } else {
      res.writeHead(404);
      res.end('nope');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  hits = [];
  tmp = makeTempDir('rebeep-dl-');
});
afterEach(() => removeDir(tmp));

describe('download', () => {
  test('a good download lands, matches, and identifies itself', async () => {
    const dest = path.join(tmp, 'sub', 'good.zip');
    const steps = [];
    await download(`${base}/good.zip`, dest, { sha256: payloadHash, size: payload.length, log: { step: (m) => steps.push(m) } });
    assert.equal(await sha256File(dest), payloadHash);
    assert.equal(fs.existsSync(`${dest}.part`), false);
    assert.match(hits[0], /rebeep-cli$/);
    assert.ok(steps.length >= 5, 'reports coarse progress');
  });

  test('a wrong hash throws, names both hashes, and leaves nothing behind', async () => {
    const dest = path.join(tmp, 'good.zip');
    const wrong = 'a'.repeat(64);
    await assert.rejects(download(`${base}/good.zip`, dest, { sha256: wrong }), (err) => {
      assert.ok(err instanceof CliError);
      assert.ok(err.message.includes(`${base}/good.zip`));
      assert.ok(err.message.includes(wrong));
      assert.ok(err.message.includes(payloadHash));
      assert.match(err.hint, /env\/AGENTS\.md/);
      return true;
    });
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(`${dest}.part`), false);
  });

  test('a 404 throws with the status', async () => {
    const dest = path.join(tmp, 'missing.zip');
    await assert.rejects(download(`${base}/missing.zip`, dest, { sha256: payloadHash }), /HTTP 404/);
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(`${dest}.part`), false);
    assert.equal(hits.length, 1, 'HTTP errors are not retried');
  });

  test('a missing or malformed pin is refused before any request', async () => {
    for (const sha256 of [undefined, '', 'abc', 'z'.repeat(64)]) {
      await assert.rejects(download(`${base}/good.zip`, path.join(tmp, 'x.zip'), { sha256 }), /without a pinned SHA-256/);
    }
    assert.equal(hits.length, 0);
  });

  test('a stalled stream times out, is retried, and leaves no part file', async () => {
    const dest = path.join(tmp, 'stall.zip');
    await assert.rejects(
      download(`${base}/stall`, dest, { sha256: payloadHash, idleTimeoutMs: 200 }),
      /download failed for .*stalled/,
    );
    assert.equal(hits.length, 3, 'three attempts');
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(`${dest}.part`), false);
  });

  test('a truncated stream leaves no part file', async () => {
    const dest = path.join(tmp, 'short.zip');
    await assert.rejects(download(`${base}/short`, dest, { sha256: payloadHash, idleTimeoutMs: 2000 }), /download failed/);
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(`${dest}.part`), false);
  });

  test('network errors are retried, then reported', async () => {
    const dead = http.createServer();
    await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
    const { port } = dead.address();
    await new Promise((resolve) => dead.close(resolve));
    await assert.rejects(
      download(`http://127.0.0.1:${port}/x`, path.join(tmp, 'x'), { sha256: payloadHash }),
      /download failed for/,
    );
  });
});

describe('cache', () => {
  const asset = () => ({ url: `${base}/good.zip`, sha256: payloadHash, file: 'cached-good.zip' });
  const paths = () => ({ cache: path.join(tmp, 'cache') });

  test('assetFile defaults to the decoded URL basename and refuses unsafe names', () => {
    assert.equal(assetFile({ url: 'https://h/x/86Box%2Bmac.zip' }), '86Box+mac.zip');
    assert.equal(assetFile({ url: 'https://h/x.zip', file: 'y.zip' }), 'y.zip');
    assert.throws(() => assetFile({ url: 'https://h/x.zip', file: '../y.zip' }), /unsafe cache file name/);
  });

  test('a matching cached file is reused without a request', async () => {
    const a = asset();
    const first = await fetchAsset(paths(), a);
    assert.equal(first.reused, false);
    assert.equal(first.file, cached(paths(), a));
    hits.length = 0;
    const second = await fetchAsset(paths(), a);
    assert.equal(second.reused, true);
    assert.equal(hits.length, 0);
  });

  test('a corrupt cached file is replaced, and force re-downloads', async () => {
    const a = asset();
    fs.mkdirSync(paths().cache, { recursive: true });
    fs.writeFileSync(cached(paths(), a), 'garbage');
    assert.equal(await isCached(paths(), a), false);
    assert.equal((await fetchAsset(paths(), a)).reused, false);
    assert.equal(await isCached(paths(), a), true);
    hits.length = 0;
    assert.equal((await fetchAsset(paths(), a, { force: true })).reused, false);
    assert.equal(hits.length, 1);
  });
});
