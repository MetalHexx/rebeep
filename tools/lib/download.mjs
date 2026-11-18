import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './cli.mjs';

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;
const IDLE_TIMEOUT_MS = 60_000;
const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** Hex SHA-256 of a buffer. */
export function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Hex SHA-256 of a file, streamed. */
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** The cache file name of an asset: its `file`, else the URL's decoded basename. */
export function assetFile(asset) {
  const name = asset.file ?? decodeURIComponent(path.posix.basename(new URL(asset.url).pathname));
  if (!name || name !== path.basename(name) || name === '.' || name === '..' || /[\\/:]/.test(name)) {
    throw new CliError(`unsafe cache file name '${name}' for ${asset.url}`);
  }
  return name;
}

/** Where an asset lives in the download cache. The file may not exist. */
export function cached(paths, asset) {
  return path.join(paths.cache, assetFile(asset));
}

/** True when the asset's cache file exists and its hash matches the pin. */
export async function isCached(paths, asset) {
  const file = cached(paths, asset);
  if (!fs.existsSync(file)) return false;
  return (await sha256File(file)) === asset.sha256.toLowerCase();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function attempt(url, part, { sha256, size, log, idleTimeoutMs }) {
  const controller = new AbortController();
  let timer;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new Error(`stalled: no data received for ${idleTimeoutMs} ms`)),
      idleTimeoutMs,
    );
  };
  touch();
  try {
    await transfer(url, part, { sha256, size, log, signal: controller.signal, touch });
  } finally {
    clearTimeout(timer);
  }
}

async function transfer(url, part, { sha256, size, log, signal, touch }) {
  const res = await fetch(url, { headers: { 'User-Agent': 'rebeep-cli' }, redirect: 'follow', signal });
  if (!res.ok) {
    await res.body?.cancel();
    throw new CliError(`download failed: HTTP ${res.status} ${res.statusText} for ${url}`.trim());
  }
  if (!res.body) throw new CliError(`download failed: empty response for ${url}`);

  const total = Number(res.headers.get('content-length')) || size || 0;
  const hash = createHash('sha256');
  let received = 0;
  let nextStep = 10;
  // Read the body in a tight loop and write each chunk synchronously. Piping it into a file
  // stream lets backpressure pause undici's parser, and Node 22's undici can then crash with
  // `assert(!this.paused)` when the connection closes while paused. Reading eagerly avoids that.
  const reader = res.body.getReader();
  const fd = fs.openSync(part, 'w');
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      touch();
      hash.update(value);
      fs.writeSync(fd, value);
      received += value.length;
      if (total > 0 && log) {
        const pct = Math.min(100, Math.floor((received / total) * 100));
        while (pct >= nextStep) {
          log.step(`downloading ${path.basename(part, '.part')}: ${nextStep}%`);
          nextStep += 10;
        }
      }
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw signal?.aborted && signal.reason ? signal.reason : err;
  } finally {
    fs.closeSync(fd);
  }

  const actual = hash.digest('hex');
  if (actual !== sha256.toLowerCase()) {
    throw new CliError(
      `SHA-256 mismatch for ${url}\n  expected ${sha256.toLowerCase()}\n  actual   ${actual}`,
      {
        hint: 'Do not use this file. If the publisher re-issued it, re-pin it in env/86box/manifest.json (see "Pinning a tool" in env/AGENTS.md).',
      },
    );
  }
}

/**
 * Downloads `url` to `dest`, streaming through `dest + '.part'` and checking the SHA-256. A
 * mismatch or HTTP error removes the part file and throws a `CliError`; network errors are
 * retried twice, as is a stream that delivers no data for `idleTimeoutMs` (default 60 s). Only a
 * verified file is renamed into place. `sha256` (64 hex characters) is required.
 */
export async function download(url, dest, { sha256, size, log, idleTimeoutMs = IDLE_TIMEOUT_MS } = {}) {
  if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
    throw new CliError(`refusing to download ${url} without a pinned SHA-256 (64 hex characters)`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let lastError;
  try {
    for (let i = 1; i <= ATTEMPTS; i++) {
      try {
        await attempt(url, part, { sha256, size, log, idleTimeoutMs });
        fs.renameSync(part, dest);
        return dest;
      } catch (err) {
        if (err instanceof CliError) throw err;
        lastError = err;
        log?.debug?.(`download attempt ${i} of ${ATTEMPTS} failed: ${err.cause?.message ?? err.message}`);
        if (i < ATTEMPTS) await sleep(RETRY_DELAY_MS * i);
      }
    }
    const reason = lastError.cause?.message ?? lastError.message;
    throw new CliError(`download failed for ${url}: ${reason}`, {
      hint: 'Check your network connection and try again.',
    });
  } finally {
    fs.rmSync(part, { force: true });
  }
}

/**
 * Makes sure the asset is in the cache and matches its pin, downloading it when it is missing,
 * stale, or `force` is set. Resolves to `{ file, reused }`.
 */
export async function fetchAsset(paths, asset, { force = false, log, idleTimeoutMs } = {}) {
  const file = cached(paths, asset);
  if (!force && (await isCached(paths, asset))) return { file, reused: true };
  await download(asset.url, file, { sha256: asset.sha256, size: asset.size, log, idleTimeoutMs });
  return { file, reused: false };
}
