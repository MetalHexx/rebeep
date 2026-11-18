import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Buffer } from '../lib/download.mjs';

const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'rebeep.mjs');

/**
 * Serves `files` (`{ '/name.zip': Buffer }`) on 127.0.0.1. Resolves to `{ base, hits, close }`;
 * `hits` lists the request paths in order.
 */
export async function serve(files) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const body = files[req.url];
    if (!body) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Length': body.length });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    hits,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Like `runRebeep` from helpers.mjs but asynchronous, so a test can talk to a local `serve()`
 * server while the CLI runs. `env.REBEEP_HOME` is required.
 */
export function runRebeepAsync(args, { env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      env: { ...process.env, NO_COLOR: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** A manifest with one zip tool `86box`, a system tool `sys`, and an on-demand zip tool `extra`. */
export function testManifest({ base, zip, extraZip, sysMinVersion = '1.0', zipSha256 = sha256Buffer(zip) }) {
  return {
    schema: 1,
    tools: {
      '86box': {
        version: '1.0',
        description: 'test zip tool',
        platforms: {
          any: {
            url: `${base}/86box.zip`,
            sha256: zipSha256,
            sha256Source: 'pinned',
            archive: 'zip',
            stripRoot: 'pkg',
            bin: 'tool.cmd',
          },
        },
      },
      sys: {
        version: '1.0',
        description: 'test system tool',
        platforms: {
          any: { system: { cmd: process.execPath, versionArgs: ['-v'], minVersion: sysMinVersion, hint: 'install node' } },
        },
      },
      extra: {
        version: '2.0',
        description: 'test on-demand tool',
        onDemand: true,
        platforms: {
          any: { url: `${base}/extra.zip`, sha256: sha256Buffer(extraZip), sha256Source: 'pinned', archive: 'zip' },
        },
      },
    },
  };
}
