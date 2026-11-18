import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'rebeep.mjs');

/** Creates an empty temp folder and returns its absolute path. */
export function makeTempDir(prefix = 'rebeep-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Runs the real `tools/rebeep.mjs` in a child process. `REBEEP_HOME` is a throwaway temp folder
 * unless `env` overrides it, and colour is off.
 */
export function runRebeep(args, { env = {}, cwd, input } = {}) {
  const ownHome = env.REBEEP_HOME === undefined ? makeTempDir('rebeep-home-') : undefined;
  try {
    const result = spawnSync(process.execPath, [entry, ...args], {
      cwd,
      input,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, REBEEP_HOME: ownHome, NO_COLOR: '1', ...env },
    });
    if (result.error) throw result.error;
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    if (ownHome) removeDir(ownHome);
  }
}

/**
 * Fake `{ stdout, stderr, stdin }` for in-process `runCli` tests. Set `stdin.isTTY` to simulate
 * an interactive terminal and write to `stdin` to answer prompts.
 */
export function captureStreams() {
  const chunks = { out: [], err: [] };
  const sink = (list) =>
    new Writable({
      write(chunk, _encoding, done) {
        list.push(chunk.toString());
        done();
      },
    });
  const stdout = sink(chunks.out);
  const stderr = sink(chunks.err);
  const stdin = new PassThrough();
  stdout.isTTY = false;
  stderr.isTTY = false;
  stdin.isTTY = false;
  return {
    stdout,
    stderr,
    stdin,
    out: () => chunks.out.join(''),
    err: () => chunks.err.join(''),
  };
}
