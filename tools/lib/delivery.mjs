import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './cli.mjs';
import { buildImage, to83, toCrlf } from './fat.mjs';
import { RECORD_FILE, resolveTool } from './manifest.mjs';
import { checkEntryName, readZipFile, stripCommonRoot } from './zip.mjs';

const TEXT_FILE = /\.(bat|sys|txt)$/i;
const BASE_DIRS = ['ENV', 'JEMM', 'GAMES', 'REBEEP'];
const DIR_ENTRY_BYTES = 32;
/** `BOOT.BAT` loads a deployed target only when this file sits next to it. */
const AUTOLOAD_FLAG = 'AUTOLOAD.FLG';
const AUTOLOAD_BYTES = Buffer.from('autoload\r\n');
/** Where the lab's patch set lands: banks in the studio's default patches folder. */
const PATCHES_DIR = 'REBEEP/PATCHES';
const LAB_BANK = `${PATCHES_DIR}/LAB`;
/** Where the lab's game profiles land: one folder per profile. */
const PROFILES_DIR = 'REBEEP/PROFILES';

const fileNames = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();

const subfolderNames = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

/** The files of `dir` whose names match `pattern`, as CRLF D: files under `dest`, names upper case. */
function labFolderFiles(dir, dest, pattern) {
  return fileNames(dir)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const bytes = toCrlf(fs.readFileSync(path.join(dir, name)));
      return { path: `${dest}/${name.toUpperCase()}`, bytes, size: bytes.length };
    });
}

/** The first segment that is not a valid 8.3 name, as a message; `null` when the path is fine. */
function nameProblem(relPath) {
  for (const segment of relPath.split('/')) {
    try {
      to83(segment);
    } catch (err) {
      return err.message;
    }
  }
  return null;
}

/**
 * Clusters a set of files and folders takes on a FAT volume: each file's data, and each folder's
 * entries (its children plus `.` and `..`), at least one cluster per folder. Paths are `/`-separated.
 */
export function clustersNeeded(files, dirs, clusterSize) {
  const children = new Map();
  const known = new Set();
  const fileKeys = new Set();
  const touch = (rel, isFile) => {
    const parts = rel.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const key = parts.slice(0, i).join('/').toUpperCase();
      if (known.has(key)) continue;
      known.add(key);
      const parent = parts.slice(0, i - 1).join('/').toUpperCase();
      children.set(parent, (children.get(parent) ?? 0) + 1);
      if (isFile && i === parts.length) fileKeys.add(key);
    }
  };
  let clusters = 0;
  for (const file of files) {
    touch(file.path, true);
    clusters += Math.ceil(file.size / clusterSize);
  }
  for (const dir of dirs) touch(dir, false);
  for (const key of known) {
    if (fileKeys.has(key)) continue;
    clusters += Math.max(1, Math.ceil(((children.get(key) ?? 0) + 2) * DIR_ENTRY_BYTES / clusterSize));
  }
  return clusters;
}

/** How many data clusters a D: of this geometry and cluster size holds. */
function capacityOf(d) {
  return buildImage({ geometry: d.geometry, clusterSize: d.clusterSize }).stats.clusterCount;
}

/** A repo file's bytes as a D: file; DOS text files are converted to CRLF. */
function textFile(file, target) {
  const bytes = fs.readFileSync(file);
  const data = TEXT_FILE.test(target) ? toCrlf(bytes) : bytes;
  return { path: target, bytes: data, size: data.length };
}

function envFiles(repo) {
  const common = path.join(repo.dos, 'common');
  const files = [textFile(path.join(common, 'README.TXT'), 'README.TXT'), textFile(path.join(common, 'BOOT.BAT'), 'ENV/BOOT.BAT')];
  for (const dos of ['msdos622', 'freedos']) {
    const dir = path.join(repo.dos, dos);
    for (const name of fileNames(dir)) files.push(textFile(path.join(dir, name), `ENV/${dos.toUpperCase()}/${name}`));
  }
  return files;
}

/**
 * The lab's patch set (`repo.labPatches`, the rebeep-dev skill's `patches/`), as banks the studio lists on
 * every VM, CRLF: every `.RBP` at its top goes to `REBEEP/PATCHES/LAB/`, and each folder in it is a bank of
 * its own name (`KQ4/` goes to `REBEEP/PATCHES/KQ4/`). A dev aid only: `release create` never reads it. No
 * folder, no files and no warning.
 */
function labPatchFiles(repo) {
  if (!repo.labPatches || !fs.existsSync(repo.labPatches)) return [];
  return [
    ...labFolderFiles(repo.labPatches, LAB_BANK, /\.rbp$/i),
    ...subfolderNames(repo.labPatches).flatMap((name) =>
      labFolderFiles(path.join(repo.labPatches, name), `${PATCHES_DIR}/${name.toUpperCase()}`, /\.rbp$/i),
    ),
  ];
}

/**
 * The lab's game profiles (`repo.labProfiles`, the rebeep-dev skill's `profiles/`), CRLF: each folder in it
 * whose name is a valid 8.3 base name is a profile, and its `.RBG` and `.RBP` files go to
 * `REBEEP/PROFILES/<FOLDER>/`. Files at the top of `profiles/`, other files and badly named folders are
 * skipped; names that are not 8.3 are skipped with a warning by `composeDelivery`. A dev aid only: `release
 * create` never reads it. No folder, no files and no warning.
 */
function labProfileFiles(repo) {
  if (!repo.labProfiles || !fs.existsSync(repo.labProfiles)) return [];
  return subfolderNames(repo.labProfiles)
    .filter((name) => !name.includes('.'))
    .flatMap((name) =>
      labFolderFiles(path.join(repo.labProfiles, name), `${PROFILES_DIR}/${name.toUpperCase()}`, /\.(rbg|rbp)$/i),
    );
}

function jemmFiles(ctx, warnings) {
  let dir;
  try {
    dir = resolveTool(ctx, 'jemm').dir;
  } catch (err) {
    if (!(err instanceof CliError)) throw err;
    warnings.push(`jemm is not fetched, so JEMM\\ is left out (${err.hint ?? err.message})`);
    return [];
  }
  return fileNames(dir)
    .filter((name) => name !== RECORD_FILE)
    .map((name) => {
      const file = path.join(dir, name);
      return { path: `JEMM/${name}`, read: () => fs.readFileSync(file), size: fs.statSync(file).size };
    });
}

/**
 * Reads one game zip into `GAMES/<game>/...` entries, in memory (nothing is extracted). Paths that
 * differ only by case are kept once; names that are not 8.3 are skipped. Every file is read once
 * here, so a corrupt zip fails now and not in the middle of building the disk. Throws on anything
 * wrong with the zip as a whole.
 */
function loadGame(ctx, game) {
  const { entries: all } = readZipFile(path.join(ctx.paths.mediaGames, `${game}.zip`));
  for (const entry of all) checkEntryName(entry.name);
  const base = `GAMES/${game}`;
  const files = [];
  const dirs = [base];
  const skipped = [];
  const duplicates = [];
  const claimed = new Map([[base.toUpperCase(), 'dir']]);

  const claim = (rel, kind) => {
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (claimed.get(`${base}/${parts.slice(0, i).join('/')}`.toUpperCase()) === 'file') return false;
    }
    const key = `${base}/${rel}`.toUpperCase();
    if (claimed.has(key)) return kind === 'dir' && claimed.get(key) === 'dir' ? null : false;
    claimed.set(key, kind);
    for (let i = 1; i < parts.length; i++) {
      const parent = `${base}/${parts.slice(0, i).join('/')}`.toUpperCase();
      if (!claimed.has(parent)) claimed.set(parent, 'dir');
    }
    return true;
  };

  for (const entry of stripCommonRoot(all)) {
    const rel = entry.isDir ? entry.name.replace(/\/$/, '') : entry.name;
    if (rel === '') continue;
    if (entry.isSymlink || nameProblem(rel)) {
      if (!entry.isDir) skipped.push(`${base}/${entry.name}`);
      continue;
    }
    const outcome = claim(rel, entry.isDir ? 'dir' : 'file');
    if (outcome === false) duplicates.push(entry.name);
    if (outcome !== true) continue;
    if (entry.isDir) {
      dirs.push(`${base}/${rel}`);
    } else {
      entry.read();
      files.push({ path: `${base}/${rel}`, read: () => entry.read(), size: entry.size });
    }
  }
  return { files, dirs, skipped, duplicates };
}

/**
 * Every game zip in the media folder. A game that cannot be read, or that would not fit in
 * `budget` clusters, is skipped with a warning; `budget` is spent as games are added.
 */
function gameFiles(ctx, warnings, skippedPaths, { budget, clusterSize }) {
  const files = [];
  const dirs = [];
  let names = [];
  try {
    names = fs.readdirSync(ctx.paths.mediaGames).filter((f) => /\.zip$/i.test(f)).sort();
  } catch {
    // no games imported
  }
  let remaining = budget;
  for (const zipName of names) {
    const game = zipName.slice(0, -4);
    if (nameProblem(game)) {
      warnings.push(`game ${game} skipped: its name is not a valid 8.3 name`);
      continue;
    }
    let loaded;
    try {
      loaded = loadGame(ctx, game);
    } catch (err) {
      warnings.push(`game ${game} skipped: ${err.message}`);
      continue;
    }
    const need = clustersNeeded(loaded.files, loaded.dirs, clusterSize);
    if (need > remaining) {
      warnings.push(`game ${game} skipped: it needs ${need} clusters but D: has ${Math.max(0, remaining)} left`);
      continue;
    }
    remaining -= need;
    files.push(...loaded.files);
    dirs.push(...loaded.dirs);
    skippedPaths.push(...loaded.skipped);
    if (loaded.skipped.length) {
      const shown = loaded.skipped.slice(0, 5).map((p) => p.slice(`GAMES/${game}/`.length)).join(', ');
      warnings.push(`game ${game}: skipped ${loaded.skipped.length} file(s) without 8.3 names: ${shown}${loaded.skipped.length > 5 ? ', ...' : ''}`);
    }
    if (loaded.duplicates.length) {
      warnings.push(`game ${game}: skipped ${loaded.duplicates.length} entries whose names collide when case is ignored: ${loaded.duplicates.slice(0, 5).join(', ')}`);
    }
  }
  return { files, dirs };
}

function buildFiles(ctx, warnings) {
  const file = path.join(ctx.repo.build, 'build.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    warnings.push(
      err.code === 'ENOENT'
        ? 'nothing built yet, so REBEEP\\ is empty'
        : `build/build.json is unreadable (${err.message}), so REBEEP\\ is empty`,
    );
    return [];
  }
  const files = [];
  for (const target of Array.isArray(manifest.targets) ? manifest.targets : []) {
    if (!target.deploy) continue;
    const source = path.join(ctx.repo.build, String(target.name));
    const where = `${target.deploy}/${target.name}`;
    if (/[\\/]/.test(String(target.name)) || nameProblem(where)) {
      warnings.push(`build target ${target.name} skipped: ${where} is not a valid 8.3 path`);
    } else if (!fs.existsSync(source)) {
      warnings.push(`build target ${target.name} is listed in build.json but missing from build/`);
    } else {
      files.push({ path: where, read: () => fs.readFileSync(source), size: fs.statSync(source).size });
      if (target.autoload === true) {
        files.push({ path: `${target.deploy}/${AUTOLOAD_FLAG}`, bytes: AUTOLOAD_BYTES, size: AUTOLOAD_BYTES.length });
      }
    }
  }
  // Data files from targets.json; the folders they sit in are created with them.
  for (const data of Array.isArray(manifest.files) ? manifest.files : []) {
    const where = `${data.deploy}/${data.name}`;
    const source = path.join(ctx.repo.build, 'files', ...String(data.deploy).split('/'), String(data.name));
    if (/[\\/]/.test(String(data.name)) || where.includes('\\') || nameProblem(where)) {
      warnings.push(`data file ${where} skipped: not a valid 8.3 path`);
    } else if (!fs.existsSync(source)) {
      warnings.push(`data file ${where} is listed in build.json but missing from build/files/`);
    } else {
      files.push({ path: where, read: () => fs.readFileSync(source), size: fs.statSync(source).size });
    }
  }
  return files;
}

/**
 * Composes the D: delivery disk from the repo's DOS boot files, the fetched JEMM tool, the
 * imported games, the latest build and the lab's patch set and game profiles. Returns `{ files, dirs, warnings, skipped }`; `files` and
 * `dirs` go straight to `buildImage`. Names that are not 8.3 are left out, listed in `skipped` and
 * reported in `warnings`. Pass the disk's profile section as `d` (`{ geometry, clusterSize }`) so
 * that games which would not fit are skipped, in name order, instead of failing the whole disk.
 */
export function composeDelivery(ctx, { d } = {}) {
  const warnings = [];
  const skipped = [];
  const base = [
    ...envFiles(ctx.repo),
    ...jemmFiles(ctx, warnings),
    ...buildFiles(ctx, warnings),
    ...labPatchFiles(ctx.repo),
    ...labProfileFiles(ctx.repo),
  ];
  const kept = [];
  for (const file of base) {
    const problem = nameProblem(file.path);
    if (problem) {
      skipped.push(file.path);
      warnings.push(`${file.path} skipped: ${problem}`);
    } else kept.push(file);
  }
  const clusterSize = d?.clusterSize ?? 2048;
  const budget = d ? capacityOf(d) - clustersNeeded(kept, BASE_DIRS, clusterSize) : Infinity;
  const games = gameFiles(ctx, warnings, skipped, { budget, clusterSize });
  return { files: [...kept, ...games.files], dirs: [...BASE_DIRS, ...games.dirs], warnings, skipped };
}
