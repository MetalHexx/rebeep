import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CliError } from '../lib/cli.mjs';
import { sha256File } from '../lib/download.mjs';
import { copyAtomic, emptyDir, formatBytes, replaceDir, writeAtomic } from '../lib/fsx.mjs';
import { manifestFor, resolveTool } from '../lib/manifest.mjs';
import { listProfiles, loadProfile, templatePath } from '../lib/profiles.mjs';
import { assertNotRunning, isRunning, launchDetached } from '../lib/proc.mjs';
import { globalCfgText, renderVmCfg } from '../lib/vmcfg.mjs';
import { listFiles } from '../lib/zip.mjs';
import { deliveryFor, deployDisk } from './disk.mjs';

const SECTOR = 512;
const vmArg = { name: 'vm', required: true, description: 'VM name' };

const sameGeometry = (a, b) =>
  a?.cylinders === b.cylinders && a?.heads === b.heads && a?.sectorsPerTrack === b.sectorsPerTrack;
const geometryText = (g) => `${g?.cylinders}/${g?.heads}/${g?.sectorsPerTrack}`;
const sizeOf = (file) => (fs.existsSync(file) ? fs.statSync(file).size : null);

function readMeta(baseline) {
  try {
    return JSON.parse(fs.readFileSync(baseline.meta, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new CliError(`cannot read ${baseline.meta}: ${err.message}`);
  }
}

/** What is wrong with a baseline's `meta.json`, or `null` when it is usable. */
function metaProblem(meta) {
  if (meta === null || typeof meta !== 'object') return 'not an object';
  if (typeof meta.sha256 !== 'string' || !meta.sha256) return "no 'sha256'";
  if (!meta.geometry || typeof meta.geometry !== 'object') return "no 'geometry'";
  if (typeof meta.createdAt !== 'string' || Number.isNaN(Date.parse(meta.createdAt))) return "no valid 'createdAt'";
  return null;
}

/** Puts a baseline back if a snapshot died between moving the old one aside and the new one in. */
function recoverBaseline(baseline) {
  const old = `${baseline.dir}.old`;
  if (!fs.existsSync(baseline.dir) && fs.existsSync(old)) fs.renameSync(old, baseline.dir);
}

/** The baseline's meta, `null` when there is none. Throws when it is unreadable or incomplete. */
function loadBaseline(paths, name) {
  const baseline = paths.baseline(name);
  const meta = readMeta(baseline);
  if (meta === null) return null;
  const problem = metaProblem(meta);
  if (problem) {
    throw new CliError(`the ${name} baseline's meta.json is unusable (${problem})`, {
      hint: `Take a new baseline with \`rebeep vm snapshot ${name}\`.`,
    });
  }
  return meta;
}

/** The baseline as `list` and `status` show it: its meta, `null`, or `{ invalid: true }`. Never throws. */
function baselineState(baseline) {
  try {
    const meta = readMeta(baseline);
    const problem = meta === null ? null : metaProblem(meta);
    return problem ? { invalid: true, problem } : meta;
  } catch (err) {
    return { invalid: true, problem: err.message };
  }
}

/** `2026-11-18`, `—` for none, `invalid` for a damaged meta.json. */
export function baselineLabel(baseline) {
  if (!baseline) return '—';
  return baseline.invalid ? 'invalid' : baseline.createdAt.slice(0, 10);
}

/** Deploys D: for one VM. Composition warnings are logged here unless the caller passed a shared composition (and logs them once). */
function deployAndWarn(ctx, name, composition) {
  const result = deployDisk(ctx, name, composition);
  if (!composition) for (const warning of result.warnings) ctx.log.warn(warning);
  return result;
}

/** State of one VM for `list`, `show` and `env status`. Changes nothing. */
export function describeVm(ctx, name) {
  const profile = loadProfile(ctx.repo, name);
  const vm = ctx.paths.vm(name);
  return {
    name,
    description: profile.description,
    dos: profile.dos,
    created: fs.existsSync(vm.dir),
    c: { present: fs.existsSync(vm.cImg), bytes: sizeOf(vm.cImg) },
    d: { present: fs.existsSync(vm.dImg), bytes: sizeOf(vm.dImg) },
    baseline: baselineState(ctx.paths.baseline(name)),
    running: isRunning(vm.pid, { readonly: true }),
  };
}

/** Throws a `CliError` naming every ROM the profile needs that the fetched ROM set lacks. */
function requireRoms(ctx, profile) {
  const dir = resolveTool(ctx, '86box-roms').dir;
  const romsDir = path.join(dir, 'roms');
  const missing = profile.roms.filter((rom) => !fs.existsSync(path.join(romsDir, ...rom.split('/'))));
  if (missing.length) {
    throw new CliError(`missing ROM${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`, {
      hint: 'A missing ROM makes 86Box silently switch machines. Run `rebeep tool fetch 86box-roms --force`.',
    });
  }
  return romsDir;
}

const BUILDER_MESSAGE = 'The FreeDOS C: builder could not be loaded';

/**
 * Loads `buildFreedosC`. Only a missing builder module counts as "not there" (`data.builderMissing`);
 * a syntax error, a failing import inside the builder or a missing export is a real fault and
 * is reported as it is.
 */
async function loadFreedosBuilder(ctx) {
  const override = ctx.env?.REBEEP_FREEDOS_BUILDER;
  const target = override ? path.resolve(override) : fileURLToPath(new URL('../lib/freedos.mjs', import.meta.url));
  let mod;
  try {
    mod = await import(pathToFileURL(target).href);
  } catch (err) {
    const missing = err.code === 'ERR_MODULE_NOT_FOUND' ? /Cannot find module '([^']+)'/.exec(err.message)?.[1] : null;
    const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
    if (missing && same(missing, target)) {
      throw new CliError(BUILDER_MESSAGE, { hint: `no module at ${target}`, data: { builderMissing: true } });
    }
    throw err;
  }
  if (typeof mod.buildFreedosC !== 'function') throw new CliError(BUILDER_MESSAGE, { hint: 'the module does not export buildFreedosC' });
  return mod.buildFreedosC;
}

/** A baseline's c.img must still match its meta.json. */
async function checkBaselineImage(baseline, meta, name) {
  if ((await sha256File(baseline.cImg)) !== meta.sha256) {
    throw new CliError(`the ${name} baseline c.img does not match its meta.json`, {
      hint: `Take a new baseline with \`rebeep vm snapshot ${name}\`.`,
    });
  }
}

/** Checks a clone source: its baseline must exist, match this profile's C: geometry and be intact. */
async function cloneSource(ctx, profile) {
  const source = ctx.paths.baseline(profile.c.from);
  const meta = loadBaseline(ctx.paths, profile.c.from);
  if (!meta || !fs.existsSync(source.cImg)) {
    throw new CliError(`${profile.name} is a clone of ${profile.c.from}, which has no baseline`, {
      hint: `rebeep vm snapshot ${profile.c.from}`,
    });
  }
  if (!sameGeometry(meta.geometry, profile.c.geometry)) {
    throw new CliError(
      `the ${profile.c.from} baseline has geometry ${geometryText(meta.geometry)}, but ${profile.name} needs ${geometryText(profile.c.geometry)}`,
      { hint: `rebeep vm snapshot ${profile.c.from} --yes, after fixing the profile` },
    );
  }
  await checkBaselineImage(source, meta, profile.c.from);
  return source.cImg;
}

function writeBlank(file, geometry) {
  writeAtomic(file, (tmp) => {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.ftruncateSync(fd, geometry.cylinders * geometry.heads * geometry.sectorsPerTrack * SECTOR);
    } finally {
      fs.closeSync(fd);
    }
  });
}

/**
 * Creates a VM and its C: disk, then deploys D:. Everything that can fail (tools, ROMs, the
 * clone source, the FreeDOS builder, composing D:) is settled before any folder is made. An
 * existing `c.img` is kept unless `force`; the caller confirms a forced replacement. A D: that
 * cannot be built is a warning, not a failure, once C: exists. Returns `{ vm, c, warnings, deploy }`
 * where `c` is `created` or `kept` and `deploy` is `null` when D: could not be deployed.
 */
export async function createVm(ctx, name, { force = false, composition } = {}) {
  const profile = loadProfile(ctx.repo, name);
  const vm = ctx.paths.vm(name);
  for (const tool of profile.tools) resolveTool(ctx, tool);
  requireRoms(ctx, profile);
  assertNotRunning(vm, name);
  const ownComposition = composition === undefined;
  const delivery = composition ?? deliveryFor(ctx, [name]);

  const warnings = [];
  const writeC = force || !fs.existsSync(vm.cImg);
  let produce = null;
  if (writeC) {
    const { route } = profile.c;
    if (route === 'blank') {
      produce = () => writeBlank(vm.cImg, profile.c.geometry);
    } else if (route === 'clone') {
      const source = await cloneSource(ctx, profile);
      produce = () => copyAtomic(source, vm.cImg);
    } else {
      if (profile.c.builder !== 'freedos') throw new CliError(`unknown C: builder '${profile.c.builder}'`);
      const buildFreedosC = await loadFreedosBuilder(ctx);
      ctx.log.step(`building the FreeDOS C: for ${name}`);
      const built = await buildFreedosC(ctx, profile);
      warnings.push(...(built.warnings ?? []));
      produce = () => writeAtomic(vm.cImg, (tmp) => fs.writeFileSync(tmp, built.image));
    }
  }

  for (const dir of [vm.dir, vm.nvr, vm.floppy]) fs.mkdirSync(dir, { recursive: true });
  if (produce) {
    produce();
    ctx.log.ok(`created ${vm.cImg} (${formatBytes(fs.statSync(vm.cImg).size)})`);
  } else {
    ctx.log.info(`${name}: c.img already exists, kept (use --force to replace it)`);
  }
  for (const warning of warnings) ctx.log.warn(warning);

  let deploy = null;
  try {
    deploy = deployDisk(ctx, name, delivery);
    if (ownComposition) for (const warning of delivery.warnings) ctx.log.warn(warning);
    ctx.log.ok(`deployed D: (${deploy.files} files, ${formatBytes(deploy.bytesUsed)})`);
  } catch (err) {
    const message = `${name}: D: was not deployed (${err.message}). C: is in place; fix the cause and run \`rebeep disk deploy ${name}\`.`;
    warnings.push(message);
    ctx.log.warn(message);
  }
  return { vm: name, c: produce ? 'created' : 'kept', warnings, deploy };
}

/** `create` as a verb: a forced replacement of an existing C: is previewed and confirmed. */
async function createVerb(ctx) {
  const name = ctx.args.vm;
  const profile = loadProfile(ctx.repo, name);
  const vm = ctx.paths.vm(name);
  assertNotRunning(vm, name, { readonly: ctx.preview });
  const replacing = ctx.opts.force && fs.existsSync(vm.cImg);
  if (replacing && profile.c.route === 'blank' && !loadBaseline(ctx.paths, name)) {
    throw new CliError(`${name} has no baseline, and its C: is installed by hand, so --force would wipe it`, {
      hint: `Take one first with \`rebeep vm snapshot ${name}\`, or wipe on purpose with \`rebeep vm reset ${name} --rebuild\`.`,
    });
  }
  if (ctx.preview) {
    ctx.log.info(replacing ? `would replace ${vm.cImg} with a fresh ${profile.c.route} C:` : `would create ${name} (C: ${profile.c.route}, then D:)`);
    return { preview: true, vm: name, replaces: replacing ? [vm.cImg] : [] };
  }
  if (replacing && !(await ctx.confirm(`Replace the C: disk of ${name}?`))) return { vm: name, cancelled: true };
  return createVm(ctx, name, { force: ctx.opts.force });
}

/** The size of a 1.44 MB floppy image, which is what the cfg templates' `35_2hd` drive reads. */
const FLOPPY_BYTES = 1474560;
const IMAGE_FILE = /\.(img|ima)$/i;

/**
 * Floppies to attach in install mode, as `[{ name, source }]` in attach order. From imported
 * media (`install.media`) or from a fetched tool (`install.tool`, in `install.folder` when set,
 * as the explicit `install.floppies` list or else the images found there, sorted). Every image
 * must exist; one that is not floppy-sized is warned about.
 */
function installFloppies(ctx, profile) {
  const { install } = profile;
  if (!install) throw new CliError(`${profile.name} has no install media`, { hint: 'It is cloned from another VM; run that one with --install.' });
  let dir;
  let names;
  let hint;
  if (install.media) {
    dir = path.join(ctx.paths.media, install.media);
    names = install.floppies;
    hint = install.media === 'msdos622' ? 'rebeep media add msdos622 <folder>' : undefined;
  } else {
    const tool = resolveTool(ctx, install.tool).dir;
    dir = install.folder ? path.resolve(tool, ...install.folder.split('/')) : tool;
    const inside = path.relative(tool, dir);
    if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
      throw new CliError(`install folder '${install.folder}' is outside ${install.tool}`);
    }
    hint = `rebeep tool fetch ${install.tool} --force`;
    if (install.floppies) {
      names = install.floppies;
    } else if (install.folder) {
      names = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && IMAGE_FILE.test(e.name)).map((e) => e.name).sort() : [];
    } else {
      names = listFiles(dir).filter((rel) => IMAGE_FILE.test(rel));
    }
    if (!names.length) throw new CliError(`${install.tool} has no floppy images in ${dir}`, { hint });
  }

  const floppies = names.map((name) => ({ name: path.basename(name), source: path.join(dir, ...name.split('/')) }));
  const missing = floppies.filter((f) => !fs.existsSync(f.source));
  if (missing.length) throw new CliError(`missing install media: ${missing.map((f) => f.name).join(', ')}`, { hint });
  const seen = new Set();
  for (const f of floppies) {
    if (seen.has(f.name.toLowerCase())) throw new CliError(`two install floppies are both named ${f.name}`);
    seen.add(f.name.toLowerCase());
    const size = fs.statSync(f.source).size;
    if (size !== FLOPPY_BYTES) ctx.log.warn(`${f.name} is ${size} bytes, not the ${FLOPPY_BYTES} of a 1.44 MB floppy; the drive may not read it`);
  }
  return floppies;
}

const SOURCE_RECORD = 'source.json';

/**
 * Copies the install floppies into `floppy/` and records each source's SHA-256 in `source.json`.
 * A copy whose source is unchanged is kept, because the user may be mid-install. A copy whose
 * source changed (media re-imported) is replaced, and that is reported. A copy with no record is kept.
 */
async function copyInstallFloppies(ctx, floppies, folder) {
  const recordFile = path.join(folder, SOURCE_RECORD);
  let record = {};
  try {
    record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  } catch {
    // no record yet, or an unreadable one: nothing is known about the copies
  }
  const replaced = [];
  for (const floppy of floppies) {
    const target = path.join(folder, floppy.name);
    const sha = await sha256File(floppy.source);
    if (!fs.existsSync(target)) {
      fs.copyFileSync(floppy.source, target);
    } else if (record[floppy.name] && record[floppy.name] !== sha) {
      fs.copyFileSync(floppy.source, target);
      replaced.push(floppy.name);
    } else {
      continue;
    }
    record[floppy.name] = sha;
  }
  writeAtomic(recordFile, (tmp) => fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`));
  if (replaced.length) ctx.log.info(`the install media changed, so these floppy copies were replaced: ${replaced.join(', ')}`);
  return replaced;
}

function launchSettings(ctx) {
  const override = ctx.env?.REBEEP_86BOX;
  const bin = override ? path.resolve(override) : resolveTool(ctx, '86box').bin;
  let prefix = [];
  if (ctx.env?.REBEEP_86BOX_PREFIX_ARGS) {
    try {
      prefix = JSON.parse(ctx.env.REBEEP_86BOX_PREFIX_ARGS);
    } catch {
      prefix = null;
    }
    if (!Array.isArray(prefix) || !prefix.every((a) => typeof a === 'string')) {
      throw new CliError('REBEEP_86BOX_PREFIX_ARGS must be a JSON array of strings');
    }
  }
  return { bin, prefix };
}

/**
 * Starts a VM in 86Box, detached, and returns `{ vm, pid, cfg, install, floppies }`. `install`
 * attaches the install media and C: only. Otherwise C: and D: are attached (D: is deployed first
 * when missing) and, when `floppy` (the path of a floppy image) is given, a copy of it in the VM's
 * `floppy/` folder as A:. The source image is never written.
 */
export async function launchVm(ctx, name, { install = false, floppy } = {}) {
  const profile = loadProfile(ctx.repo, name);
  const vm = ctx.paths.vm(name);
  assertNotRunning(vm, name);
  if (!fs.existsSync(vm.cImg)) throw new CliError(`${name} has no C: disk`, { hint: `rebeep vm create ${name}` });
  const romsDir = requireRoms(ctx, profile);
  const { bin, prefix } = launchSettings(ctx);

  let floppies = [];
  if (install) {
    floppies = installFloppies(ctx, profile);
  } else {
    if (!fs.existsSync(vm.dImg)) deployAndWarn(ctx, name);
    if (floppy) floppies = [{ name: path.basename(floppy), source: floppy }];
  }

  fs.mkdirSync(ctx.paths.box86, { recursive: true });
  if (!fs.existsSync(ctx.paths.globalCfg)) fs.writeFileSync(ctx.paths.globalCfg, globalCfgText());
  fs.mkdirSync(vm.floppy, { recursive: true });
  if (install) {
    if (floppies.length) await copyInstallFloppies(ctx, floppies, vm.floppy);
  } else if (floppies.length) {
    fs.copyFileSync(floppies[0].source, path.join(vm.floppy, floppies[0].name));
  }
  const cfg = renderVmCfg(profile, fs.readFileSync(templatePath(ctx.repo, name), 'utf8'), {
    install,
    floppy: floppies[0]?.name,
  });
  fs.writeFileSync(vm.cfg, cfg);

  const args = [...prefix, '-P', vm.dir, '-R', romsDir, '-O', ctx.paths.globalCfg, '-N', '-V', name];
  const { pid } = await launchDetached(bin, args, { cwd: vm.dir, pidFile: vm.pid });
  ctx.log.ok(`started ${name} (pid ${pid}), config ${vm.cfg}`);
  const floppyPaths = floppies.map((f) => path.join(vm.floppy, f.name));
  if (install) {
    ctx.log.info('In the BIOS (Del), set the IDE controller to Auto if the disk is not seen.');
    ctx.log.info(`Swap floppies from the Media menu, in this order:\n${floppyPaths.map((f) => `  ${f}`).join('\n')}`);
  }
  return { vm: name, pid, cfg: vm.cfg, install, floppies: floppyPaths };
}

/**
 * Plans a reset: `restore` (from the baseline), `rebuild` (no baseline, build or clone route, or
 * a blank route with `rebuild`) or `refuse`. Reads and checks; in a preview it changes nothing.
 */
export function planReset(ctx, name, { rebuild = false } = {}) {
  const profile = loadProfile(ctx.repo, name);
  const vm = ctx.paths.vm(name);
  const baseline = ctx.paths.baseline(name);
  assertNotRunning(vm, name, { readonly: ctx.preview });
  if (!ctx.preview) recoverBaseline(baseline);
  const meta = loadBaseline(ctx.paths, name);
  if (meta) {
    if (!fs.existsSync(baseline.cImg)) throw new CliError(`the ${name} baseline has no c.img`, { hint: `rebeep vm snapshot ${name}` });
    if (!sameGeometry(meta.geometry, profile.c.geometry)) {
      throw new CliError(
        `the ${name} baseline has geometry ${geometryText(meta.geometry)}, but the profile says ${geometryText(profile.c.geometry)}`,
        { hint: 'The profile changed since the snapshot. Take a new baseline with `rebeep vm snapshot`.' },
      );
    }
    return {
      vm: name,
      action: 'restore',
      meta,
      replaces: [vm.cImg, vm.nvr, vm.floppy, vm.dImg],
      description: `restore c.img and nvr/ from the baseline of ${meta.createdAt}, empty floppy/, redeploy D:`,
    };
  }
  if (profile.c.route === 'blank' && !rebuild) {
    throw new CliError(`${name} has no baseline, and its C: is installed by hand, so a reset would wipe it`, {
      hint: `Take one first with \`rebeep vm snapshot ${name}\`, or wipe on purpose with \`rebeep vm reset ${name} --rebuild\`.`,
    });
  }
  return {
    vm: name,
    action: 'rebuild',
    replaces: [vm.cImg, vm.nvr, vm.floppy, vm.dImg],
    description: `no baseline, rebuilding: new ${profile.c.route} c.img, empty nvr/ and floppy/, redeploy D:`,
  };
}

/** Throws unless a `restore` plan's baseline c.img still matches its meta.json. Other plans pass. */
export async function verifyPlan(ctx, plan) {
  if (plan.action === 'restore') await checkBaselineImage(ctx.paths.baseline(plan.vm), plan.meta, plan.vm);
}

/** Carries out a plan from `planReset`. The caller has already confirmed; `verified` skips the baseline hash check when it was done already. */
export async function applyReset(ctx, plan, { composition, verified = false } = {}) {
  const name = plan.vm;
  const vm = ctx.paths.vm(name);
  if (plan.action === 'restore') {
    const baseline = ctx.paths.baseline(name);
    if (!verified) await verifyPlan(ctx, plan);
    assertNotRunning(vm, name);
    fs.mkdirSync(vm.dir, { recursive: true });
    copyAtomic(baseline.cImg, vm.cImg);
    replaceDir(baseline.nvr, vm.nvr);
    emptyDir(vm.floppy);
    deployAndWarn(ctx, name, composition);
  } else {
    assertNotRunning(vm, name);
    await createVm(ctx, name, { force: true, composition });
    emptyDir(vm.nvr);
    emptyDir(vm.floppy);
  }
  ctx.log.ok(`${name} reset (${plan.action})`);
  return { vm: name, action: plan.action };
}

/**
 * Stages the new baseline in `<vm>.new` (c.img, nvr, meta), then swaps it in by renames, so the
 * old baseline stays whole and findable if anything fails part-way.
 */
async function snapshotVm(ctx, name) {
  const profile = loadProfile(ctx.repo, name);
  const vm = ctx.paths.vm(name);
  const baseline = ctx.paths.baseline(name);
  assertNotRunning(vm, name, { readonly: ctx.preview });
  if (!fs.existsSync(vm.cImg)) throw new CliError(`${name} has no C: disk`, { hint: `rebeep vm create ${name}` });
  if (!ctx.preview) recoverBaseline(baseline);
  const existing = baselineState(baseline);
  const size = fs.statSync(vm.cImg).size;
  const replaced = existing && !existing.invalid ? existing.createdAt : existing ? 'an unusable meta.json' : null;

  if (ctx.preview) {
    ctx.log.info(
      `would save ${vm.cImg} (${formatBytes(size)}) and ${vm.nvr} as the baseline in ${baseline.dir}` +
        (existing ? `\nwould replace the baseline of ${replaced}` : ''),
    );
    return { preview: true, vm: name, saved: false, replaces: replaced };
  }
  if (existing && !(await ctx.confirm(`Replace the existing baseline of ${name}?`))) {
    return { vm: name, saved: false, cancelled: true };
  }

  assertNotRunning(vm, name);
  const staging = `${baseline.dir}.new`;
  const old = `${baseline.dir}.old`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  let meta;
  try {
    const stagedImage = path.join(staging, 'c.img');
    copyAtomic(vm.cImg, stagedImage);
    replaceDir(vm.nvr, path.join(staging, 'nvr'));
    const manifest = manifestFor(ctx);
    meta = {
      vm: name,
      createdAt: new Date().toISOString(),
      geometry: profile.c.geometry,
      size,
      sha256: await sha256File(stagedImage),
      tools: Object.fromEntries(profile.tools.map((t) => [t, manifest.tools[t]?.version ?? 'unknown'])),
    };
    writeAtomic(path.join(staging, 'meta.json'), (tmp) => fs.writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`));

    assertNotRunning(vm, name);
    fs.rmSync(old, { recursive: true, force: true });
    const hadOld = fs.existsSync(baseline.dir);
    if (hadOld) fs.renameSync(baseline.dir, old);
    try {
      fs.renameSync(staging, baseline.dir);
    } catch (err) {
      if (hadOld) fs.renameSync(old, baseline.dir);
      throw err;
    }
    fs.rmSync(old, { recursive: true, force: true });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  ctx.log.ok(`saved the baseline of ${name} (${formatBytes(size)})`);
  return { vm: name, saved: true, meta };
}

async function resetVm(ctx, name, { rebuild }) {
  const plan = planReset(ctx, name, { rebuild });
  if (ctx.preview) {
    ctx.log.info(`${plan.description}\nwould replace:\n${plan.replaces.map((p) => `  ${p}`).join('\n')}`);
    return { preview: true, vm: name, action: plan.action, replaces: plan.replaces };
  }
  if (plan.action === 'rebuild') ctx.log.info(`${name}: no baseline, rebuilding`);
  await verifyPlan(ctx, plan);
  if (!(await ctx.confirm(`Reset ${name} to ${plan.action === 'restore' ? 'its baseline' : 'a fresh C:'}? Its c.img, nvr/ and floppy/ are replaced.`))) {
    return { vm: name, action: plan.action, cancelled: true };
  }
  return applyReset(ctx, plan, { verified: true });
}

/** For verbs that report as they go: nothing is left to print from their data. */
const reported = () => {};

const diskText = (d) => (d.present ? formatBytes(d.bytes) : 'missing');

export default {
  name: 'vm',
  summary: 'Create, run, snapshot and reset the 86Box VMs',
  verbs: [
    {
      name: 'list',
      summary: 'List VMs and their state',
      args: [],
      options: [],
      destructive: false,
      examples: ['rebeep vm list'],
      run: async (ctx) => ({ vms: listProfiles(ctx.repo).map((n) => describeVm(ctx, n)) }),
      render: (data, log) =>
        log.table(
          data.vms.map((v) => ({
            name: v.name,
            description: v.description,
            dos: v.dos,
            c: diskText(v.c),
            d: diskText(v.d),
            baseline: baselineLabel(v.baseline),
            running: v.running ? 'yes' : 'no',
          })),
          [
            { key: 'name', label: 'NAME' },
            { key: 'description', label: 'DESCRIPTION' },
            { key: 'dos', label: 'DOS' },
            { key: 'c', label: 'C:' },
            { key: 'd', label: 'D:' },
            { key: 'baseline', label: 'BASELINE' },
            { key: 'running', label: 'RUNNING' },
          ],
        ),
    },
    {
      name: 'show',
      summary: "Show a VM's profile, disks and baseline",
      args: [vmArg],
      options: [],
      destructive: false,
      examples: ['rebeep vm show mirror-msdos'],
      run: async (ctx) => {
        const name = ctx.args.vm;
        const profile = loadProfile(ctx.repo, name);
        const vm = ctx.paths.vm(name);
        const baseline = ctx.paths.baseline(name);
        const state = describeVm(ctx, name);
        return {
          profile,
          paths: { ...vm, baseline: baseline.dir, globalCfg: ctx.paths.globalCfg },
          baseline: state.baseline ?? 'none',
          disks: { c: state.c, d: state.d },
          running: state.running,
        };
      },
    },
    {
      name: 'create',
      summary: 'Create a VM and its C: disk',
      description:
        "Builds C: by the profile's route (blank, build or clone), then deploys D:. An existing c.img is kept. --force replaces it, which needs --yes or a confirm, and on the blank route only when a baseline exists.",
      args: [vmArg],
      options: [{ name: 'force', type: 'boolean', description: 'Replace an existing c.img' }],
      destructive: true,
      examples: ['rebeep vm create mirror-msdos', 'rebeep vm create mirror-freedos --force --preview'],
      run: createVerb,
      render: reported,
    },
    {
      name: 'run',
      summary: 'Start a VM in 86Box',
      args: [vmArg],
      options: [
        {
          name: 'install',
          type: 'boolean',
          description: 'Attach install media and C: only, no D:',
        },
      ],
      destructive: false,
      examples: ['rebeep vm run mirror-msdos', 'rebeep vm run mirror-msdos --install'],
      run: (ctx) => launchVm(ctx, ctx.args.vm, { install: ctx.opts.install }),
      render: reported,
    },
    {
      name: 'snapshot',
      summary: "Save C: and CMOS as the VM's baseline",
      description: 'Replaces any existing baseline for this VM. The old baseline is kept until the new one is complete.',
      args: [vmArg],
      options: [],
      destructive: true,
      examples: ['rebeep vm snapshot mirror-msdos --yes'],
      run: (ctx) => snapshotVm(ctx, ctx.args.vm),
      render: reported,
    },
    {
      name: 'reset',
      summary: 'Restore a VM to its baseline',
      args: [vmArg],
      options: [
        {
          name: 'rebuild',
          type: 'boolean',
          description: 'Rebuild C: when there is no baseline',
        },
      ],
      destructive: true,
      examples: ['rebeep vm reset mirror-msdos --preview', 'rebeep vm reset mirror-msdos --yes'],
      run: (ctx) => resetVm(ctx, ctx.args.vm, { rebuild: ctx.opts.rebuild }),
      render: reported,
    },
  ],
};
