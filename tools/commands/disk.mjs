import fs from 'node:fs';
import { CliError } from '../lib/cli.mjs';
import { composeDelivery } from '../lib/delivery.mjs';
import { buildImage, checkImage } from '../lib/fat.mjs';
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
  summary: 'Write the D: delivery disks',
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
  ],
};
