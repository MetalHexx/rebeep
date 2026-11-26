import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './cli.mjs';
import { repoLayout } from './paths.mjs';
import { listFiles } from './zip.mjs';

const RECORD_NAME = '.rebeep-tool.json';
const ARCHIVES = ['zip', 'appimage', 'tar.xz'];

const fail = (where, message) => new CliError(`manifest ${where}: ${message}`);

function validateAsset(where, asset) {
  if (asset === null || typeof asset !== 'object') throw fail(where, 'must be an object');
  if (asset.system !== undefined) {
    const s = asset.system;
    if (typeof s?.cmd !== 'string' || !s.cmd) throw fail(`${where}.system`, "missing 'cmd'");
    if (!Array.isArray(s.versionArgs)) throw fail(`${where}.system`, "missing 'versionArgs' array");
    if (typeof s.minVersion !== 'string' || !/^\d+(\.\d+)*$/.test(s.minVersion)) {
      throw fail(`${where}.system`, "missing or malformed 'minVersion'");
    }
    if (typeof s.hint !== 'string' || !s.hint) throw fail(`${where}.system`, "missing 'hint'");
    return;
  }
  if (typeof asset.url !== 'string' || !asset.url) throw fail(where, "missing 'url'");
  if (typeof asset.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(asset.sha256)) {
    throw fail(where, "'sha256' must be 64 hex characters");
  }
  if (!ARCHIVES.includes(asset.archive)) throw fail(where, `'archive' must be one of: ${ARCHIVES.join(', ')}`);
  if (asset.extract !== undefined) {
    const ok = Array.isArray(asset.extract) && asset.extract.length > 0 && asset.extract.every((f) => typeof f === 'string' && f);
    if (asset.archive !== 'tar.xz' || !ok) throw fail(where, "'extract' is a non-empty array of top-level folders, for a tar.xz archive");
  }
}

/** Reads and validates the manifest. Throws a `CliError` naming the missing or bad field. */
export function loadManifest(file = process.env.REBEEP_MANIFEST ?? repoLayout().manifest) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new CliError(`cannot read manifest ${file}: ${err.message}`);
  }
  if (manifest === null || typeof manifest !== 'object' || typeof manifest.tools !== 'object' || !manifest.tools) {
    throw fail(file, "missing 'tools'");
  }
  for (const [name, tool] of Object.entries(manifest.tools)) {
    const where = `tools.${name}`;
    if (typeof tool?.version !== 'string' || !tool.version) throw fail(where, "missing 'version'");
    if (typeof tool.description !== 'string') throw fail(where, "missing 'description'");
    if (tool.platforms === null || typeof tool.platforms !== 'object' || !Object.keys(tool.platforms).length) {
      throw fail(where, "missing 'platforms'");
    }
    for (const [key, asset] of Object.entries(tool.platforms)) validateAsset(`${where}.platforms.${key}`, asset);
  }
  return manifest;
}

/** Loads the manifest for a command: `REBEEP_MANIFEST` from the command's env, else the repo's. */
export function manifestFor(ctx) {
  return loadManifest(ctx.env?.REBEEP_MANIFEST ?? ctx.repo.manifest);
}

/** `${process.platform}-${process.arch}`, for example `win32-x64`. */
export function platformKey() {
  return `${process.platform}-${process.arch}`;
}

/** The asset for this host: the exact platform key, then `any`, else `null`. */
export function pickAsset(tool, key = platformKey()) {
  return tool.platforms[key] ?? tool.platforms.any ?? null;
}

export const strategyOf = (asset) => (!asset ? 'unsupported' : asset.system ? 'system' : 'download');

/** Tools as `{ name, ...tool, onDemand }`, skipping on-demand ones unless asked. */
export function listTools(manifest, { includeOnDemand = false } = {}) {
  return Object.entries(manifest.tools)
    .map(([name, tool]) => ({ name, ...tool, onDemand: Boolean(tool.onDemand) }))
    .filter((tool) => includeOnDemand || !tool.onDemand);
}

/** Where a fetched tool's record lives. */
export function toolRecordPath(paths, name, version) {
  return path.join(paths.tool(name, version), RECORD_NAME);
}

export const RECORD_FILE = RECORD_NAME;

/** The parsed record of a fetched tool, or `null` if it has none (or it is unreadable). */
export function readRecord(paths, name, version) {
  try {
    return JSON.parse(fs.readFileSync(toolRecordPath(paths, name, version), 'utf8'));
  } catch {
    return null;
  }
}

/** First `\d+(\.\d+)+` in `text`, or `null`. */
export function parseVersion(text) {
  return /\d+(\.\d+)+/.exec(text)?.[0] ?? null;
}

/** Compares dotted versions numerically by part (missing parts are 0). Returns -1, 0 or 1. */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function isExecutable(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (process.platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const WIN_SCRIPT_EXTS = ['.cmd', '.bat'];

/**
 * Finds a command on `PATH`. A path with a separator is used as is. On Windows, `PATHEXT` is
 * applied (the bare name only when it already carries a `PATHEXT` extension), and `.cmd` / `.bat`
 * hits are skipped because they can't be run without a shell.
 */
export function findOnPath(cmd, env = process.env) {
  const win = process.platform === 'win32';
  const pathExt = win ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [];
  const hasExt = win && pathExt.some((e) => e.toLowerCase() === path.extname(cmd).toLowerCase());
  const exts = win ? [...(hasExt ? [''] : []), ...pathExt] : [''];
  const dirs = cmd.includes('/') || cmd.includes(path.sep) ? [''] : (env.PATH ?? env.Path ?? '').split(path.delimiter);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = dir === '' ? cmd + ext : path.join(dir, cmd + ext);
      if (win && WIN_SCRIPT_EXTS.includes(path.extname(candidate).toLowerCase())) continue;
      if (isExecutable(candidate)) return path.resolve(candidate);
    }
  }
  return null;
}

/**
 * Looks for a system tool and checks its version. Resolves to `{ found, path, version, ok }`;
 * `ok` means found and at least `minVersion`.
 */
export function probeSystemTool(system, env = process.env) {
  const bin = findOnPath(system.cmd, env);
  if (!bin) return { found: false, path: null, version: null, ok: false };
  const run = spawnSync(bin, system.versionArgs, { encoding: 'utf8', timeout: 15000, env });
  const version = parseVersion(`${run.stdout ?? ''}\n${run.stderr ?? ''}`);
  return { found: true, path: bin, version, ok: version !== null && compareVersions(version, system.minVersion) >= 0 };
}

/**
 * Finds a tool's executable: `dir/<bin>` if it exists, otherwise the first file (sorted) whose
 * relative path ends with `/<bin>`. Returns an absolute path, or `null` if there is none.
 */
export function resolveBin(dir, bin) {
  const direct = path.join(dir, ...bin.split('/'));
  if (fs.existsSync(direct)) return direct;
  const hit = listFiles(dir).find((rel) => rel.endsWith(`/${bin}`));
  return hit ? path.join(dir, ...hit.split('/')) : null;
}

/**
 * Locates a tool for later tasks: a fetched download tool (`bin` resolved inside its folder) or
 * a system tool found on `PATH`. Throws a `CliError` with a fix-it hint when it isn't there.
 */
export function resolveTool(ctx, name) {
  const manifest = manifestFor(ctx);
  const tool = manifest.tools[name];
  if (!tool) throw new CliError(`unknown tool '${name}'`, { hint: `Known tools: ${Object.keys(manifest.tools).join(', ')}` });
  const asset = pickAsset(tool);
  if (!asset) throw new CliError(`${name} has no build for ${platformKey()}`);

  if (asset.system) {
    const probe = probeSystemTool(asset.system, ctx.env);
    if (!probe.found) throw new CliError(`${name} was not found on PATH`, { hint: asset.system.hint });
    if (!probe.ok) {
      throw new CliError(`${name} ${probe.version ?? '(unknown version)'} is older than ${asset.system.minVersion}`, {
        hint: asset.system.hint,
      });
    }
    return { name, version: probe.version, strategy: 'system', bin: probe.path, dir: null };
  }

  const fetchHint = `rebeep tool fetch ${name}`;
  const dir = ctx.paths.tool(name, tool.version);
  if (!readRecord(ctx.paths, name, tool.version)) {
    throw new CliError(`${name} ${tool.version} is not fetched`, { hint: fetchHint });
  }
  let bin = null;
  if (asset.bin) {
    bin = resolveBin(dir, asset.bin);
    if (!bin) throw new CliError(`${name} is fetched but '${asset.bin}' is missing from ${dir}`, { hint: `${fetchHint} --force` });
  }
  return { name, version: tool.version, strategy: 'download', bin, dir };
}
