import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../lib/cli.mjs';
import { composeDelivery } from '../lib/delivery.mjs';
import { buildImage, checkImage, readImage, to83 } from '../lib/fat.mjs';
import { formatBytes, writeAtomic } from '../lib/fsx.mjs';
import { listProfiles, loadProfile } from '../lib/profiles.mjs';
import { assertNotRunning } from '../lib/proc.mjs';

const vmArg = { name: 'vm', required: false, description: 'VM name (default: every VM)' };

/** Composes the delivery for these VMs, sized to the smallest D: among them. */
export function deliveryFor(ctx, names) {
  const smallest = names
    .map((n) => loadProfile(ctx.repo, n).d)
    .sort((a, b) => a.geometry.cylinders * a.geometry.heads * a.geometry.sectorsPerTrack - b.geometry.cylinders * b.geometry.heads * b.geometry.sectorsPerTrack)[0];
  return composeDelivery(ctx, { d: smallest });
}

/**
 * Builds a VM's D: image from `composition` and swaps it in. Refuses while the VM runs. Returns
 * `{ vm, path, files, bytesUsed, skipped, warnings }`.
 */
export function deployDisk(ctx, name, composition = deliveryFor(ctx, [name])) {
  const profile = loadProfile(ctx.repo, name);
  const vm = ctx.paths.vm(name);
  assertNotRunning(vm, name);

  let built;
  try {
    built = buildImage({
      geometry: profile.d.geometry,
      clusterSize: profile.d.clusterSize,
      label: profile.d.label,
      files: composition.files,
      dirs: composition.dirs,
      onInvalid: 'skip',
    });
  } catch (err) {
    throw new CliError(`cannot build D: for ${name}: ${err.message}`, {
      hint: 'D: is full or holds a colliding name. Remove a game with `rebeep media remove game --name <NAME>`.',
    });
  }
  const check = checkImage(built.image);
  if (!check.ok) throw new Error(`internal error: the D: image for ${name} failed its check:\n${check.errors.join('\n')}`);

  writeAtomic(vm.dImg, (tmp) => fs.writeFileSync(tmp, built.image));
  const skipped = [...composition.skipped, ...built.skipped];
  return {
    vm: name,
    path: vm.dImg,
    files: composition.files.length - built.skipped.length,
    bytesUsed: built.stats.usedClusters * profile.d.clusterSize,
    skipped,
    warnings: composition.warnings,
  };
}

/** Names of the VMs whose folder exists, or just `name` (which must exist). */
function createdVms(ctx, name) {
  if (name !== undefined) {
    loadProfile(ctx.repo, name);
    if (!fs.existsSync(ctx.paths.vm(name).dir)) {
      throw new CliError(`${name} is not created`, { hint: `rebeep vm create ${name}` });
    }
    return [name];
  }
  return listProfiles(ctx.repo).filter((n) => fs.existsSync(ctx.paths.vm(n).dir));
}

/** A D: path as given (`D:\REBEEP\X.TXT`, `rebeep/x.txt`) as `REBEEP/X.TXT`; `''` is the root. */
export function dPath(given) {
  const trimmed = String(given ?? '').trim().replace(/^[dD]:/, '');
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => p === '.' || p === '..')) throw new CliError(`${given}: . and .. are not allowed on D:`);
  return parts.map((p) => p.toUpperCase()).join('/');
}

/** The VM's D: image as it is now, read while 86Box is stopped. */
function openD(ctx, name) {
  loadProfile(ctx.repo, name);
  const vm = ctx.paths.vm(name);
  if (!fs.existsSync(vm.dImg)) {
    throw new CliError(`${name} has no D: yet`, { hint: `rebeep disk deploy ${name}` });
  }
  assertNotRunning(vm, name);
  return { vm, image: readImage(fs.readFileSync(vm.dImg)) };
}

const under = (entry, at) => !at || entry.path.toUpperCase() === at || entry.path.toUpperCase().startsWith(`${at}/`);

/** What D: holds now at or under `at` (a dPath), DOS's own writes included. */
export function showDisk(ctx, name, at = '') {
  const { image } = openD(ctx, name);
  const entries = image
    .list()
    .filter((e) => under(e, at))
    .map((e) => ({ path: e.path, isDir: e.isDir, size: e.isDir ? 0 : e.size }))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (at && !entries.length) throw new CliError(`${at} is not on ${name}'s D:`, { hint: `rebeep disk show ${name}` });
  return { vm: name, entries };
}

/**
 * Copies a file, or every file under a folder, from the VM's D: to `out` on the host, keeping its
 * D: path below `out`. Game folders are refused: game files stay in the media folder.
 */
export function fetchFromDisk(ctx, name, given, out) {
  const from = dPath(given);
  if (!from) throw new CliError('name a file or folder on D:, not the whole disk', { hint: `rebeep disk show ${name}` });
  if (from === 'GAMES' || from.startsWith('GAMES/')) {
    throw new CliError('game files are not copied off D:', { hint: 'Your games stay in the media folder: rebeep media list' });
  }
  const { image } = openD(ctx, name);
  const files = image.list().filter((e) => !e.isDir && under(e, from));
  if (!files.length) throw new CliError(`${from} is not on ${name}'s D:`, { hint: `rebeep disk show ${name}` });
  const root = path.resolve(out ?? path.join(ctx.repo.build, 'disk', name));
  const copied = files.map((e) => {
    const to = path.join(root, ...e.path.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    writeAtomic(to, (tmp) => fs.writeFileSync(tmp, image.readFile(e.path)));
    return { path: e.path, size: e.size, to };
  });
  return { vm: name, out: root, files: copied };
}

/**
 * Copies a host file onto the VM's D: (into the folder `to`, default the root), keeping every file
 * already there, DOS's own writes included, and replacing one of the same name. The next deploy
 * rebuilds D: without it.
 */
export function addToDisk(ctx, name, source, to) {
  const file = path.resolve(source);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new CliError(`${source} is not a file`);
  let target;
  try {
    target = [dPath(to), to83(path.basename(file))].filter(Boolean).join('/');
    target.split('/').forEach((part) => to83(part));
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(`${err.message}. D: takes 8.3 names only`);
  }
  const profile = loadProfile(ctx.repo, name);
  const { vm, image } = openD(ctx, name);
  const entries = image.list();
  if (entries.some((e) => e.isDir && e.path.toUpperCase() === target)) throw new CliError(`${target} is a folder on D:`);
  const replaced = entries.some((e) => !e.isDir && e.path.toUpperCase() === target);
  const files = entries
    .filter((e) => !e.isDir && e.path.toUpperCase() !== target)
    .map((e) => ({ path: e.path, bytes: image.readFile(e.path) }));
  const bytes = fs.readFileSync(file);
  files.push({ path: target, bytes });

  let built;
  try {
    built = buildImage({
      geometry: profile.d.geometry,
      clusterSize: profile.d.clusterSize,
      label: profile.d.label,
      files,
      dirs: entries.filter((e) => e.isDir).map((e) => e.path),
    });
  } catch (err) {
    throw new CliError(`cannot add ${target} to ${name}'s D:: ${err.message}`);
  }
  const check = checkImage(built.image);
  if (!check.ok) throw new Error(`internal error: the D: image for ${name} failed its check:\n${check.errors.join('\n')}`);
  writeAtomic(vm.dImg, (tmp) => fs.writeFileSync(tmp, built.image));
  return { vm: name, path: target, size: bytes.length, replaced };
}

/** Deploys D: to every created VM (or `name`). Warnings are logged once. */
export function deployAll(ctx, name) {
  const targets = createdVms(ctx, name);
  if (!targets.length) return { deployed: [], warnings: [] };
  const composition = deliveryFor(ctx, targets);
  const deployed = targets.map((n) => deployDisk(ctx, n, composition));
  for (const warning of composition.warnings) ctx.log.warn(warning);
  return { deployed, warnings: composition.warnings };
}

export default {
  name: 'disk',
  summary: 'Write the D: delivery disks, and copy files on and off them',
  verbs: [
    {
      name: 'list',
      summary: 'Show what goes on D:',
      args: [vmArg],
      options: [],
      destructive: false,
      examples: ['rebeep disk list', 'rebeep disk list mirror-msdos'],
      run: async (ctx) => {
        if (ctx.args.vm !== undefined) loadProfile(ctx.repo, ctx.args.vm);
        const { files, dirs, warnings } = deliveryFor(ctx, ctx.args.vm !== undefined ? [ctx.args.vm] : listProfiles(ctx.repo));
        for (const warning of warnings) ctx.log.warn(warning);
        return {
          files: files.map(({ path, size }) => ({ path, size })).sort((a, b) => a.path.localeCompare(b.path)),
          dirs: [...dirs].sort(),
          warnings,
        };
      },
      render: (data, log) => {
        log.table(
          data.files.map((f) => ({ path: f.path, size: formatBytes(f.size) })),
          [
            { key: 'path', label: 'PATH' },
            { key: 'size', label: 'SIZE' },
          ],
        );
      },
    },
    {
      name: 'deploy',
      summary: 'Regenerate D: for every VM, or one',
      description: 'D: is disposable: it is rebuilt from the build output and your games on every deploy.',
      args: [vmArg],
      options: [],
      destructive: false,
      examples: ['rebeep disk deploy', 'rebeep disk deploy mirror-msdos'],
      run: async (ctx) => deployAll(ctx, ctx.args.vm),
      render: (data, log) => {
        if (!data.deployed.length) return log.info('no VMs are created yet; nothing to deploy');
        log.table(
          data.deployed.map((d) => ({ vm: d.vm, files: d.files, used: formatBytes(d.bytesUsed), skipped: d.skipped.length })),
          [
            { key: 'vm', label: 'VM' },
            { key: 'files', label: 'FILES' },
            { key: 'used', label: 'USED' },
            { key: 'skipped', label: 'SKIPPED' },
          ],
        );
      },
    },
    {
      name: 'show',
      summary: "Show what a VM's D: holds now, including files DOS wrote",
      args: [
        { name: 'vm', required: true, description: 'VM name' },
        { name: 'path', required: false, description: 'A folder or file on D: (default: all of it)' },
      ],
      options: [],
      destructive: false,
      examples: ['rebeep disk show mirror-msdos', 'rebeep disk show mirror-msdos REBEEP'],
      run: async (ctx) => showDisk(ctx, ctx.args.vm, dPath(ctx.args.path)),
      render: (data, log) => {
        log.table(
          data.entries.map((e) => ({ path: e.isDir ? `${e.path}/` : e.path, size: e.isDir ? '' : formatBytes(e.size) })),
          [
            { key: 'path', label: 'PATH' },
            { key: 'size', label: 'SIZE' },
          ],
        );
      },
    },
    {
      name: 'fetch',
      summary: "Copy a file or folder off a VM's D: to the host",
      description:
        'Reads d.img while 86Box is stopped, so quit the VM first. A deploy rebuilds D:, so fetch what DOS wrote before the next one. Game folders are refused.',
      args: [
        { name: 'vm', required: true, description: 'VM name' },
        { name: 'path', required: true, description: 'A file or folder on D:, such as REBEEP\\RBLOG.TXT' },
      ],
      options: [
        { name: 'out', type: 'string', valueName: 'DIR', description: 'Host folder to copy into (default: build/disk/<vm>)' },
      ],
      destructive: false,
      examples: ['rebeep disk fetch mirror-msdos RESULT.TXT', 'rebeep disk fetch mirror-msdos REBEEP --out ./from-d'],
      run: async (ctx) => fetchFromDisk(ctx, ctx.args.vm, ctx.args.path, ctx.opts.out),
      render: (data, log) => {
        log.table(
          data.files.map((f) => ({ path: f.path, size: formatBytes(f.size), to: f.to })),
          [
            { key: 'path', label: 'PATH' },
            { key: 'size', label: 'SIZE' },
            { key: 'to', label: 'COPIED TO' },
          ],
        );
      },
    },
    {
      name: 'add',
      summary: "Copy a host file onto a VM's D:",
      description:
        'Keeps everything already on D:, including what DOS wrote, and replaces a file of the same name. Names must be 8.3. The next deploy rebuilds D: without the file.',
      args: [
        { name: 'vm', required: true, description: 'VM name' },
        { name: 'file', required: true, description: 'The host file to copy' },
      ],
      options: [
        { name: 'to', type: 'string', valueName: 'DIR', description: 'Folder on D: to put it in (default: the root)' },
      ],
      destructive: false,
      examples: ['rebeep disk add mirror-msdos ./GO.BAT', 'rebeep disk add mirror-msdos ./TRACE.CFG --to REBEEP'],
      run: async (ctx) => addToDisk(ctx, ctx.args.vm, ctx.args.file, ctx.opts.to),
      render: (data, log) => {
        log.ok(`${data.replaced ? 'replaced' : 'added'} D:\\${data.path.replaceAll('/', '\\')} on ${data.vm} (${formatBytes(data.size)})`);
      },
    },
  ],
};
