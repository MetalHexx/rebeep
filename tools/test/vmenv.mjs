import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout } from '../lib/paths.mjs';
import { isRunning } from '../lib/proc.mjs';
import { hashTree } from '../lib/zip.mjs';
import { makeTempDir, runRebeep } from './helpers.mjs';

export const FAKE_86BOX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake86box.mjs');

export const ROMS = [
  'machines/ficpa2012/113jb16.awd',
  'video/et4000/ET4000.BIN',
  'video/ega/ibm_6277356_ega_card_u44_27128.bin',
  'video/mda/mda.rom',
  'machines/awardsx/Unknown 386SX OPTi291 - Award (original).BIN',
];
const JEMM_FILES = ['JEMMEX.EXE', 'JEMM386.EXE', 'JLOAD.EXE', 'QPIEMU.DLL'];
const SHA = 'a'.repeat(64);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `fn` until it returns something truthy; throws after `timeout` ms. */
export async function waitFor(fn, { timeout = 15000, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

function writeFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function tool(version, bin) {
  return {
    version,
    description: 'test tool',
    platforms: { any: { url: 'http://127.0.0.1:9/never-downloaded.zip', sha256: SHA, sha256Source: 'pinned', archive: 'zip', ...(bin ? { bin } : {}) } },
  };
}

/**
 * A throwaway home seeded with placeholder tools (no network, no real binaries), a matching
 * manifest, and the environment variables that point the CLI at a fake 86Box. `kill()` stops any
 * fake still running; `cleanup()` kills it and deletes everything.
 */
export function seedEnv(prefix = 'rebeep-vm-') {
  const tmp = makeTempDir(prefix);
  const home = path.join(tmp, 'home');
  const paths = layout(home);
  const out = path.join(tmp, 'fake-out.json');
  const manifestFile = path.join(tmp, 'manifest.json');

  const manifest = {
    schema: 1,
    tools: {
      '86box': tool('6.0', '86Box.exe'),
      '86box-roms': tool('6.0'),
      jemm: tool('5.87'),
      freedos: tool('1.4'),
    },
  };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  for (const [name, def] of Object.entries(manifest.tools)) {
    const dir = paths.tool(name, def.version);
    writeFile(path.join(dir, '.rebeep-tool.json'), JSON.stringify({ name, version: def.version, sha256: SHA, files: {} }));
  }
  writeFile(path.join(paths.tool('86box', '6.0'), '86Box.exe'), 'placeholder');
  for (const rom of ROMS) writeFile(path.join(paths.tool('86box-roms', '6.0'), 'roms', ...rom.split('/')), 'rom');
  for (const name of JEMM_FILES) writeFile(path.join(paths.tool('jemm', '5.87'), name), `placeholder ${name}`);

  const env = {
    REBEEP_HOME: home,
    REBEEP_MANIFEST: manifestFile,
    REBEEP_86BOX: process.execPath,
    REBEEP_86BOX_PREFIX_ARGS: JSON.stringify([FAKE_86BOX]),
    REBEEP_FREEDOS_BUILDER: path.join(tmp, 'no-such-builder.mjs'),
    FAKE86BOX_OUT: out,
  };

  const kill = async () => {
    for (const pidFile of vmPidFiles(paths)) {
      let pid;
      try {
        if (!isRunning(pidFile, { readonly: true })) continue;
        pid = JSON.parse(fs.readFileSync(pidFile, 'utf8')).pid;
        process.kill(pid);
      } catch {
        continue;
      }
      await waitFor(() => !alive(pid), { what: `pid ${pid} to exit` }).catch(() => {});
    }
  };

  return {
    tmp,
    home,
    paths,
    env,
    manifestFile,
    kill,
    /** Runs the CLI against this home. */
    rebeep: (...args) => runRebeep(args, { env }),
    /** Runs the CLI with `--json` and parses the envelope. */
    json(...args) {
      const result = runRebeep([...args, '--json'], { env });
      return { ...result, envelope: result.stdout ? JSON.parse(result.stdout) : null };
    },
    /** Waits for the fake 86Box to record itself, and returns what it recorded. */
    async fakeRecord() {
      return waitFor(() => (fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null), { what: 'the fake 86Box to start' });
    },
    clearFakeRecord: () => fs.rmSync(out, { force: true }),
    async cleanup() {
      await kill();
      await removeWhenFree(tmp);
    },
  };
}

/** Deletes a folder, waiting for Windows to release files that a just-killed process had open. */
export async function removeWhenFree(dir, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (Date.now() > end) throw err;
      await sleep(100);
    }
  }
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function vmPidFiles(paths) {
  if (!fs.existsSync(paths.vms)) return [];
  return fs.readdirSync(paths.vms).map((n) => path.join(paths.vms, n, 'rebeep.pid')).filter((f) => fs.existsSync(f));
}

/** Imports three fake MS-DOS floppies and returns their folder. */
export function seedMsdosMedia(paths) {
  ['DISK1.IMA', 'DISK2.IMA', 'DISK3.IMA'].forEach((name, i) =>
    writeFile(path.join(paths.mediaMsdos, name), Buffer.alloc(2048, i + 1)),
  );
  writeFile(path.join(paths.mediaMsdos, 'media.json'), JSON.stringify({ kind: 'msdos622', files: [] }));
  return paths.mediaMsdos;
}

export { writeFile };

/** Every file's hash and every folder (empty ones too) under `dir`: a preview must leave this unchanged. */
export function snapshotTree(dir) {
  const dirs = [];
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const next = rel ? `${rel}/${e.name}` : e.name;
      dirs.push(next);
      walk(path.join(abs, e.name), next);
    }
  };
  walk(dir, '');
  return { files: hashTree(dir), dirs };
}
