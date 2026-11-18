import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._+-]*$/;
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A VM, baseline, tool or version name that is not safe to use as a folder name. */
export class NameError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NameError';
  }
}

/**
 * Rejects names that could escape the folder they are joined onto, or that Windows treats
 * specially (trailing dot, device names).
 */
function segment(kind, value) {
  const shown = JSON.stringify(value);
  if (typeof value !== 'string' || !SEGMENT.test(value) || value.endsWith('.')) {
    throw new NameError(
      `invalid ${kind} name ${shown}: use letters, digits, '.', '_', '-' and '+', and do not end with '.'`,
    );
  }
  if (WINDOWS_DEVICE.test(value)) {
    throw new NameError(`invalid ${kind} name ${shown}: it is a reserved Windows device name`);
  }
  return value;
}

/**
 * Resolves the rebeep home folder: `--home`, then `REBEEP_HOME`, then `~/.rebeep`, each
 * against `cwd`. Always absolute.
 */
export function resolveHome({ home, env = process.env, cwd = process.cwd() } = {}) {
  if (home) return path.resolve(cwd, home);
  if (env.REBEEP_HOME) return path.resolve(cwd, env.REBEEP_HOME);
  return path.resolve(cwd, os.homedir(), '.rebeep');
}

/** Absolute paths of everything under a home folder. Creates nothing. */
export function layout(home) {
  const root = path.resolve(home);
  const media = path.join(root, 'media');
  const vms = path.join(root, 'vms');
  const baselines = path.join(root, 'baselines');
  const box86 = path.join(root, '86box');
  const tools = path.join(root, 'tools');
  return {
    home: root,
    tools,
    cache: path.join(root, 'cache'),
    box86,
    globalCfg: path.join(box86, '86box_global.cfg'),
    media,
    mediaMsdos: path.join(media, 'msdos622'),
    mediaGames: path.join(media, 'games'),
    vms,
    baselines,
    tool: (name, version) => path.join(tools, segment('tool', name), segment('version', version)),
    vm: (name) => {
      const dir = path.join(vms, segment('vm', name));
      return {
        dir,
        cfg: path.join(dir, '86box.cfg'),
        cImg: path.join(dir, 'c.img'),
        dImg: path.join(dir, 'd.img'),
        nvr: path.join(dir, 'nvr'),
        floppy: path.join(dir, 'floppy'),
        pid: path.join(dir, 'rebeep.pid'),
      };
    },
    baseline: (name) => {
      const dir = path.join(baselines, segment('baseline', name));
      return {
        dir,
        cImg: path.join(dir, 'c.img'),
        nvr: path.join(dir, 'nvr'),
        meta: path.join(dir, 'meta.json'),
      };
    },
  };
}

/** The repo root, two levels above `tools/lib/`. */
export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/** Absolute paths of the repo's own folders and files. */
export function repoLayout(root = repoRoot()) {
  const env = path.join(root, 'env', '86box');
  return {
    root,
    src: path.join(root, 'src'),
    targets: path.join(root, 'src', 'targets.json'),
    build: path.join(root, 'build'),
    tests: path.join(root, 'tests'),
    env,
    manifest: path.join(env, 'manifest.json'),
    profiles: path.join(env, 'profiles'),
    dos: path.join(env, 'dos'),
    toolsTest: path.join(root, 'tools', 'test'),
  };
}
