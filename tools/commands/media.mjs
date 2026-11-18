import fs from 'node:fs';
import path from 'node:path';
import { CliError, UsageError } from '../lib/cli.mjs';
import { sha256File } from '../lib/download.mjs';
import { formatBytes, writeAtomic } from '../lib/fsx.mjs';
import { checkEntryName, readZip, stripCommonRoot } from '../lib/zip.mjs';

const FLOPPY_BYTES = 1474560;
const DISK_COUNT = 3;
const GAME_NAME = /^[A-Z0-9_-]{1,8}$/;
const DOS_DEVICES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/;
const KINDS = ['msdos622', 'game'];

const kindArg = (kind) => {
  if (!KINDS.includes(kind)) {
    throw new UsageError(`unknown media kind '${kind}'`, { hint: `Kinds: ${KINDS.join(', ')}` });
  }
  return kind;
};

function gameName(raw) {
  if (raw === undefined || raw === '') {
    throw new UsageError('--name is required for games', { hint: 'For example: --name GPC' });
  }
  const name = raw.toUpperCase();
  if (!GAME_NAME.test(name) || DOS_DEVICES.test(name)) {
    throw new CliError(`invalid game name '${raw}'`, {
      hint: 'Use 1 to 8 characters from A-Z, 0-9, _ and -, and not a DOS device name like CON.',
    });
  }
  return name;
}

const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/** True for a regular file, or a symlink that resolves to one. */
function isRegularFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Moves `staging` into place as `target`. An existing `target` is renamed aside first and put
 * back if the move fails, so a failed swap never leaves the user without their media.
 */
function swapDir(staging, target) {
  const aside = `${target}.old`;
  fs.rmSync(aside, { recursive: true, force: true });
  const hadOld = fs.existsSync(target);
  if (hadOld) fs.renameSync(target, aside);
  try {
    fs.renameSync(staging, target);
  } catch (err) {
    if (hadOld) {
      try {
        fs.renameSync(aside, target);
      } catch (restoreErr) {
        throw new CliError(`could not replace ${target} (${err.message}) or restore it (${restoreErr.message})`, {
          hint: `Your previous copy is kept at ${aside}.`,
        });
      }
    }
    throw new CliError(`could not replace ${target}: ${err.message}`, {
      hint: 'Close anything using the folder (Explorer, antivirus) and try again. Your previous copy is untouched.',
    });
  }
  fs.rmSync(aside, { recursive: true, force: true });
}

function readJsonQuiet(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function addMsdos(ctx, folder) {
  const dir = path.resolve(folder);
  let names;
  try {
    names = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() || (d.isSymbolicLink() && isRegularFile(path.join(dir, d.name))))
      .map((d) => d.name);
  } catch {
    throw new CliError(`cannot read folder ${dir}`);
  }
  const images = names.filter((n) => /\.(ima|img)$/i.test(n)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  if (images.length !== DISK_COUNT) {
    throw new CliError(
      `expected exactly ${DISK_COUNT} floppy images (.ima or .img) in ${dir}, found ${images.length}${images.length ? `: ${images.join(', ')}` : ''}`,
    );
  }
  for (const name of images) {
    const size = fs.statSync(path.join(dir, name)).size;
    if (size !== FLOPPY_BYTES) {
      throw new CliError(`${name} is ${size} bytes; a 1.44 MB floppy image is ${FLOPPY_BYTES} bytes`);
    }
  }

  const files = [];
  let replaced = false;
  const staging = `${ctx.paths.mediaMsdos}.tmp-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    for (const [i, source] of images.entries()) {
      const from = path.join(dir, source);
      const name = `DISK${i + 1}.IMA`;
      const stored = path.join(staging, name);
      fs.copyFileSync(from, stored);
      const size = fs.statSync(stored).size;
      if (size !== FLOPPY_BYTES) throw new CliError(`${source} changed while it was being copied`);
      files.push({ source: from, name, size, sha256: await sha256File(stored) });
    }
    writeJson(path.join(staging, 'media.json'), { kind: 'msdos622', addedAt: new Date().toISOString(), files });
    const previous = readJsonQuiet(path.join(ctx.paths.mediaMsdos, 'media.json'));
    replaced = fs.existsSync(ctx.paths.mediaMsdos);
    if (replaced) {
      ctx.log.info(`replacing the MS-DOS 6.22 disks already imported${previous?.addedAt ? ` (added ${previous.addedAt})` : ''}`);
    }
    swapDir(staging, ctx.paths.mediaMsdos);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  ctx.log.ok(`imported ${DISK_COUNT} MS-DOS 6.22 disks into ${ctx.paths.mediaMsdos}`);
  return { kind: 'msdos622', files, replaced };
}

async function addGame(ctx, zipArg, rawName) {
  const name = gameName(rawName);
  const source = path.resolve(zipArg);
  if (!isRegularFile(source)) throw new CliError(`no such file: ${source}`);

  // Validate the exact bytes that get stored, so the file can't change between check and copy.
  const bytes = fs.readFileSync(source);
  const { entries } = readZip(bytes);
  for (const entry of entries) checkEntryName(entry.name);
  const fileEntries = entries.filter((e) => !e.isDir);
  if (fileEntries.length === 0) throw new CliError(`${source} contains no files`);
  const stripped = stripCommonRoot(entries);
  const topFolderStripped = stripped.length !== entries.length || stripped.some((e, i) => e.name !== entries[i].name);

  fs.mkdirSync(ctx.paths.mediaGames, { recursive: true });
  const target = path.join(ctx.paths.mediaGames, `${name}.zip`);
  const previous = readJsonQuiet(path.join(ctx.paths.mediaGames, `${name}.json`));
  const replaced = fs.existsSync(target);
  if (replaced) {
    const what = previous ? ` (${formatBytes(previous.size)}, sha256 ${String(previous.sha256).slice(0, 12)})` : '';
    ctx.log.info(`replacing game ${name} already imported${what}`);
  }
  writeAtomic(target, (tmp) => fs.writeFileSync(tmp, bytes));
  const size = fs.statSync(target).size;
  const sha256 = await sha256File(target);
  const meta = {
    kind: 'game',
    name,
    addedAt: new Date().toISOString(),
    source,
    sha256,
    size,
    entries: fileEntries.length,
    topFolderStripped,
  };
  writeAtomic(path.join(ctx.paths.mediaGames, `${name}.json`), (tmp) => writeJson(tmp, meta));
  ctx.log.ok(`imported game ${name} (${fileEntries.length} files, not extracted)`);
  return { ...meta, replaced };
}

function readJson(file, log) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') log.warn(`ignoring unreadable ${file}: ${err.message}`);
    return null;
  }
}

function listMedia(paths, log) {
  const items = [];
  const msdos = readJson(path.join(paths.mediaMsdos, 'media.json'), log);
  if (msdos) {
    items.push({
      kind: 'msdos622',
      name: '',
      files: msdos.files.length,
      size: msdos.files.reduce((sum, f) => sum + f.size, 0),
      sha256: '',
    });
  }
  const names = fs.existsSync(paths.mediaGames)
    ? fs.readdirSync(paths.mediaGames).filter((f) => f.endsWith('.json')).sort()
    : [];
  for (const file of names) {
    const meta = readJson(path.join(paths.mediaGames, file), log);
    if (!meta) continue;
    items.push({ kind: 'game', name: meta.name, files: meta.entries, size: meta.size, sha256: String(meta.sha256).slice(0, 12) });
  }
  return items;
}

export default {
  name: 'media',
  summary: 'Bring your own MS-DOS disks and games',
  verbs: [
    {
      name: 'list',
      summary: 'List imported media',
      args: [],
      options: [],
      destructive: false,
      examples: ['rebeep media list'],
      run: async (ctx) => ({ media: listMedia(ctx.paths, ctx.log) }),
      render: (data, log) => {
        if (!data.media.length) return log.info('no media imported');
        log.table(
          data.media.map((m) => ({ ...m, name: m.name || '-', sha256: m.sha256 || '-' })),
          [
            { key: 'kind', label: 'KIND' },
            { key: 'name', label: 'NAME' },
            { key: 'files', label: 'FILES' },
            { key: 'size', label: 'SIZE' },
            { key: 'sha256', label: 'SHA256' },
          ],
        );
      },
    },
    {
      name: 'add',
      summary: 'Import media into home',
      description: 'Media stays in your home folder and is never executed on the host.',
      args: [
        { name: 'kind', required: true, description: 'msdos622 or game' },
        { name: 'path', required: true, description: 'Folder of MS-DOS 6.22 disks, or a game zip' },
      ],
      options: [
        { name: 'name', type: 'string', valueName: 'NAME', description: 'Game name, 8.3 (games only)' },
      ],
      destructive: false,
      examples: ['rebeep media add msdos622 ./dos622-disks', 'rebeep media add game ./gpc.zip --name GPC'],
      run: async (ctx) => {
        const kind = kindArg(ctx.args.kind);
        return kind === 'msdos622' ? addMsdos(ctx, ctx.args.path) : addGame(ctx, ctx.args.path, ctx.opts.name);
      },
    },
    {
      name: 'remove',
      summary: 'Delete imported media',
      args: [{ name: 'kind', required: true, description: 'msdos622 or game' }],
      options: [
        { name: 'name', type: 'string', valueName: 'NAME', description: 'Game name (games only)' },
      ],
      destructive: true,
      examples: ['rebeep media remove game --name GPC --preview', 'rebeep media remove msdos622 --yes'],
      run: async (ctx) => {
        const kind = kindArg(ctx.args.kind);
        let label;
        let targets;
        if (kind === 'msdos622') {
          label = 'the MS-DOS 6.22 disks';
          targets = [ctx.paths.mediaMsdos];
        } else {
          const name = gameName(ctx.opts.name);
          label = `game ${name}`;
          targets = [path.join(ctx.paths.mediaGames, `${name}.zip`), path.join(ctx.paths.mediaGames, `${name}.json`)];
        }
        const present = targets.filter((t) => fs.existsSync(t));
        if (present.length === 0) throw new CliError(`${label} is not imported`);
        if (ctx.preview) {
          ctx.log.info(`would delete:\n${present.map((t) => `  ${t}`).join('\n')}`);
          return { preview: true, removed: false, targets: present };
        }
        if (!(await ctx.confirm(`Delete ${label}?`))) return { removed: false, cancelled: true, targets: present };
        for (const target of present) fs.rmSync(target, { recursive: true, force: true });
        ctx.log.ok(`deleted ${label}`);
        return { removed: true, targets: present };
      },
    },
  ],
};
