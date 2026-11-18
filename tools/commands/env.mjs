import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../lib/cli.mjs';
import { assetFile, isCached } from '../lib/download.mjs';
import { formatBytes, treeSize } from '../lib/fsx.mjs';
import {
  manifestFor,
  pickAsset,
  platformKey,
  probeSystemTool,
  readRecord,
  strategyOf,
} from '../lib/manifest.mjs';
import { listProfiles, loadProfile } from '../lib/profiles.mjs';
import { assertNotRunning, isRunning } from '../lib/proc.mjs';
import { deliveryFor, deployDisk } from './disk.mjs';
import { applyReset, baselineLabel, createVm, describeVm, planReset, verifyPlan } from './vm.mjs';

const MIN_NODE_MAJOR = 22;
const MIN_FREE_BYTES = 4 * 1024 ** 3;

const check = (name, status, detail) => ({ name, status, detail });

function homeWritable(home) {
  try {
    fs.mkdirSync(home, { recursive: true });
    const probe = path.join(home, `.rebeep-write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return check('home writable', 'ok', home);
  } catch (err) {
    return check('home writable', 'fail', `${home}: ${err.message}`);
  }
}

function freeSpace(home) {
  try {
    const stat = fs.statfsSync(home);
    const free = Number(stat.bavail) * Number(stat.bsize);
    const gb = (free / 1024 ** 3).toFixed(1);
    return free < MIN_FREE_BYTES
      ? check('free space', 'warn', `${gb} GB free; 4 GB or more is recommended`)
      : check('free space', 'ok', `${gb} GB free`);
  } catch (err) {
    return check('free space', 'info', `could not read free space: ${err.message}`);
  }
}

async function toolCheck(ctx, tool) {
  const label = `tool ${tool.name}`;
  const asset = pickAsset(tool);
  const strategy = strategyOf(asset);
  if (strategy === 'unsupported') return check(label, 'info', `no build for ${platformKey()}`);
  if (strategy === 'system') {
    const probe = probeSystemTool(asset.system, ctx.env);
    if (probe.ok) return check(label, 'ok', `system, found ${probe.version}`);
    const what = probe.found
      ? `version ${probe.version ?? 'unknown'} is older than ${asset.system.minVersion}`
      : 'not found on PATH';
    return check(label, 'warn', `${what}. ${asset.system.hint}`);
  }
  if (!readRecord(ctx.paths, tool.name, tool.version)) return check(label, 'info', 'not fetched');
  if (!fs.existsSync(path.join(ctx.paths.cache, assetFile(asset)))) {
    return check(label, 'info', 'cache cleared (use `tool verify` to check the extracted files)');
  }
  return (await isCached(ctx.paths, asset))
    ? check(label, 'ok', `fetched ${tool.version}, cached download matches the pin`)
    : check(label, 'fail', `cached download ${assetFile(asset)} does not match the pinned SHA-256`);
}

function renderChecks(data, log) {
  log.table(data.checks, [
    { key: 'status', label: 'STATUS' },
    { key: 'name', label: 'CHECK' },
    { key: 'detail', label: 'DETAIL' },
  ]);
}

async function runCheck(ctx) {
  const checks = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push(
    major >= MIN_NODE_MAJOR
      ? check('node', 'ok', process.versions.node)
      : check('node', 'fail', `${process.versions.node}; Node ${MIN_NODE_MAJOR} or newer is required`),
  );

  let manifest;
  try {
    manifest = manifestFor(ctx);
  } catch (err) {
    checks.push(check('manifest', 'fail', err.message));
  }
  if (manifest) {
    const box = manifest.tools['86box'];
    checks.push(
      box && pickAsset(box)
        ? check('86box platform', 'ok', platformKey())
        : check('86box platform', 'fail', `no 86Box build for ${platformKey()}`),
    );
  }
  checks.push(homeWritable(ctx.paths.home), freeSpace(ctx.paths.home));
  if (manifest) {
    for (const [name, tool] of Object.entries(manifest.tools)) checks.push(await toolCheck(ctx, { name, ...tool }));
  }

  const failed = checks.filter((c) => c.status === 'fail');
  if (failed.length) {
    if (!ctx.json) renderChecks({ checks }, ctx.log);
    throw new CliError(`${failed.length} check${failed.length === 1 ? '' : 's'} failed`, { data: { checks } });
  }
  return { checks };
}

/** A verb of another noun, looked up at call time (the registry imports this file). */
async function verbOf(noun, verb) {
  const { default: nouns } = await import('./index.mjs');
  return nouns.find((n) => n.name === noun).verbs.find((v) => v.name === verb);
}

const hasBaseline = (ctx, name) => fs.existsSync(ctx.paths.baseline(name).meta);

/** What the user should do next, from the current state of the VMs and media. */
function nextSteps(ctx, vms, media) {
  const steps = [];
  const add = (step) => {
    if (!steps.includes(step)) steps.push(step);
  };
  for (const vm of vms) {
    const profile = loadProfile(ctx.repo, vm.name);
    if (!vm.c.present) {
      if (profile.c.route === 'clone' && !hasBaseline(ctx, profile.c.from)) {
        add(`rebeep env setup (again, once ${profile.c.from} has a baseline)`);
      } else {
        add(`rebeep vm create ${vm.name}`);
      }
    } else if (!vm.baseline || vm.baseline.invalid) {
      if (profile.install?.media === 'msdos622' && !media.some((m) => m.kind === 'msdos622')) {
        add('rebeep media add msdos622 <folder with the 3 floppy images>');
      }
      add(profile.c.route === 'blank' ? `rebeep vm run ${vm.name} --install` : `rebeep vm run ${vm.name}`);
      add(`rebeep vm snapshot ${vm.name}`);
    }
  }
  if (!media.some((m) => m.kind === 'game')) add('rebeep media add game <zip> --name <NAME>');
  if (vms.length && vms.every((v) => v.baseline && !v.baseline.invalid)) add(`rebeep vm run ${vms[0].name}`);
  return steps;
}

async function runSetup(ctx) {
  const fetchVerb = await verbOf('tool', 'fetch');
  ctx.log.step('fetching tools');
  const fetched = await fetchVerb.run({ ...ctx, args: {}, opts: { force: false } });
  ctx.log.table(fetched.tools, [
    { key: 'name', label: 'NAME' },
    { key: 'version', label: 'VERSION' },
    { key: 'status', label: 'STATUS' },
    { key: 'message', label: 'DETAIL' },
  ]);

  const names = listProfiles(ctx.repo);
  const composition = deliveryFor(ctx, names);
  const vms = [];
  for (const name of names) {
    const profile = loadProfile(ctx.repo, name);
    const vm = ctx.paths.vm(name);
    const row = (status, detail) => vms.push({ vm: name, status, detail });
    try {
      if (fs.existsSync(vm.cImg)) {
        if (isRunning(vm.pid)) {
          row('present', 'running, so D: was not redeployed');
        } else {
          deployDisk(ctx, name, composition);
          row('present', 'D: redeployed');
        }
      } else if (profile.c.route === 'clone' && !hasBaseline(ctx, profile.c.from)) {
        row('skipped', `needs a ${profile.c.from} baseline`);
      } else {
        const created = await createVm(ctx, name, { composition });
        row('created', `C: ${profile.c.route}, ${created.deploy ? 'D: deployed' : 'D: not deployed (see warnings)'}`);
      }
    } catch (err) {
      if (!(err instanceof CliError)) throw err;
      if (err.data?.builderMissing) row('skipped', err.message);
      else row('failed', err.message);
    }
  }
  for (const warning of composition.warnings) ctx.log.warn(warning);

  const states = names.map((n) => describeVm(ctx, n));
  const media = (await (await verbOf('media', 'list')).run(ctx)).media;
  const data = { tools: fetched.tools, vms, warnings: composition.warnings, next: nextSteps(ctx, states, media) };
  const failed = vms.filter((v) => v.status === 'failed');
  if (failed.length) {
    if (!ctx.json) renderSetup(data, ctx.log);
    throw new CliError(`env setup: ${failed.length} VM${failed.length === 1 ? '' : 's'} failed (${failed.map((v) => v.vm).join(', ')})`, { data });
  }
  return data;
}

function renderNext(next, log) {
  if (next.length) log.info(`Next steps:\n${next.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`);
}

function renderSetup(data, log) {
  log.table(data.vms, [
    { key: 'vm', label: 'VM' },
    { key: 'status', label: 'STATUS' },
    { key: 'detail', label: 'DETAIL' },
  ]);
  renderNext(data.next, log);
}

async function runStatus(ctx) {
  const tools = (await (await verbOf('tool', 'list')).run(ctx)).tools;
  const media = (await (await verbOf('media', 'list')).run(ctx)).media;
  const vms = listProfiles(ctx.repo).map((n) => describeVm(ctx, n));
  return { home: ctx.paths.home, tools, media, vms, next: nextSteps(ctx, vms, media) };
}

function renderStatus(data, log) {
  log.info(`Home: ${data.home}\n`);
  log.table(
    data.tools.map((t) => ({ ...t, onDemand: t.onDemand ? 'on demand' : '' })),
    [
      { key: 'name', label: 'TOOL' },
      { key: 'version', label: 'VERSION' },
      { key: 'strategy', label: 'STRATEGY' },
      { key: 'state', label: 'STATE' },
      { key: 'onDemand', label: '' },
    ],
  );
  log.info('');
  if (data.media.length) {
    log.table(
      data.media.map((m) => ({ ...m, name: m.name || '-', size: formatBytes(m.size) })),
      [
        { key: 'kind', label: 'MEDIA' },
        { key: 'name', label: 'NAME' },
        { key: 'files', label: 'FILES' },
        { key: 'size', label: 'SIZE' },
      ],
    );
  } else {
    log.info('MEDIA: none imported');
  }
  log.info('');
  const disk = (d) => (d.present ? formatBytes(d.bytes) : 'missing');
  log.table(
    data.vms.map((v) => ({
      name: v.name,
      c: disk(v.c),
      d: disk(v.d),
      baseline: v.baseline ? baselineLabel(v.baseline) : '-',
      running: v.running ? 'yes' : 'no',
    })),
    [
      { key: 'name', label: 'VM' },
      { key: 'c', label: 'C:' },
      { key: 'd', label: 'D:' },
      { key: 'baseline', label: 'BASELINE' },
      { key: 'running', label: 'RUNNING' },
    ],
  );
  log.info('');
  renderNext(data.next, log);
}

async function runReset(ctx) {
  const plans = [];
  const skipped = [];
  for (const name of listProfiles(ctx.repo)) {
    if (hasBaseline(ctx, name)) plans.push(planReset(ctx, name));
    else skipped.push(name);
  }
  for (const plan of plans) await verifyPlan(ctx, plan);
  const names = plans.map((p) => p.vm);
  if (ctx.preview) {
    ctx.log.info(
      [
        ...plans.map((p) => `would reset ${p.vm}: ${p.description}`),
        ...skipped.map((n) => `would skip ${n}: no baseline`),
      ].join('\n'),
    );
    return { preview: true, targets: names, skipped };
  }
  if (!plans.length) {
    ctx.log.info('no VM has a baseline; nothing to reset');
    return { reset: [], skipped };
  }
  if (!(await ctx.confirm(`Reset ${names.join(', ')} to their baselines?`))) {
    return { reset: [], skipped, cancelled: true };
  }
  const composition = deliveryFor(ctx, names);
  for (const plan of plans) await applyReset(ctx, plan, { composition, verified: true });
  for (const warning of composition.warnings) ctx.log.warn(warning);
  for (const name of skipped) ctx.log.info(`skipped ${name}: no baseline`);
  return { reset: names, skipped };
}

/** What `env clean` deletes, in order. `baselines` and `media` only go with `--all`; `media` is always last. */
const CLEAN_ALWAYS = ['86box', 'cache', 'tools', 'vms'];
const CLEAN_WITH_ALL = ['baselines', 'media'];

const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const resolveReal = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};

/** Why `home` must never be cleaned (a filesystem root, the home or working folder, or something that contains the repo or the working folder), or `null`. */
function unsafeHome(ctx) {
  const home = resolveReal(ctx.paths.home);
  if (samePath(path.parse(home).root, home)) return 'it is a filesystem root';
  if (samePath(home, resolveReal(os.homedir()))) return 'it is your home folder';
  for (const [what, target] of [['the current folder', process.cwd()], ['the rebeep repo', ctx.repo.root]]) {
    const inside = path.relative(home, resolveReal(target));
    if (inside !== '..' && !inside.startsWith(`..${path.sep}`) && !path.isAbsolute(inside)) return `it is, or contains, ${what}`;
  }
  return null;
}

async function runClean(ctx) {
  const { home, vms } = ctx.paths;
  const unsafe = unsafeHome(ctx);
  if (unsafe) {
    throw new CliError(`refusing to clean ${home}: ${unsafe}`, {
      hint: 'env clean only runs on a rebeep home folder (the default is ~/.rebeep). Check --home and $REBEEP_HOME.',
    });
  }
  if (fs.existsSync(vms)) {
    for (const name of fs.readdirSync(vms)) {
      const dir = path.join(vms, name);
      assertNotRunning(
        { dir, pid: path.join(dir, 'rebeep.pid'), cImg: path.join(dir, 'c.img'), dImg: path.join(dir, 'd.img') },
        name,
        { readonly: ctx.preview },
      );
    }
  }

  const present = fs.existsSync(home) ? fs.readdirSync(home) : [];
  const doomed = [...CLEAN_ALWAYS, ...(ctx.opts.all ? CLEAN_WITH_ALL : [])].filter((n) => present.includes(n));
  const entries = present.sort().map((name) => {
    const known = [...CLEAN_ALWAYS, ...CLEAN_WITH_ALL].includes(name);
    const action = doomed.includes(name) ? 'delete' : known ? 'kept (use --all)' : 'not ours, left alone';
    return { name, path: path.join(home, name), action, bytes: known ? treeSize(path.join(home, name)) : null };
  });
  if (entries.length) {
    ctx.log.info(`${home}:`);
    ctx.log.table(
      entries.map((e) => ({ name: e.name, size: e.bytes === null ? '-' : formatBytes(e.bytes), action: e.action })),
      [
        { key: 'name', label: 'ENTRY' },
        { key: 'size', label: 'SIZE' },
        { key: 'action', label: 'ACTION' },
      ],
    );
  }
  if (!ctx.opts.all && present.includes('baselines')) {
    ctx.log.info('baselines/ is kept, so a clean never loses a hand-installed C:. Add --all to delete it too.');
  }
  if (!doomed.length) {
    ctx.log.info('nothing to delete');
    return { removed: [], entries };
  }
  if (ctx.preview) return { preview: true, entries };

  const question = `Delete ${doomed.join(', ')} from ${home}${ctx.opts.all ? ', including your media and baselines' : ''}?`;
  if (!(await ctx.confirm(question))) return { removed: [], cancelled: true, entries };
  for (const name of doomed) fs.rmSync(path.join(home, name), { recursive: true, force: true });
  ctx.log.ok(`deleted ${doomed.join(', ')} from ${home}`);
  return { removed: doomed, entries };
}

export default {
  name: 'env',
  summary: 'Set up, check, reset and clean the whole environment',
  verbs: [
    {
      name: 'setup',
      summary: 'Fetch tools, create every VM whose inputs exist, deploy D:',
      description:
        'Safe to re-run. VMs whose media you have not imported yet are skipped and reported.',
      args: [],
      options: [],
      destructive: false,
      examples: ['rebeep env setup'],
      run: runSetup,
      render: renderSetup,
    },
    {
      name: 'status',
      summary: 'Show tools, media, VMs, baselines and running VMs',
      args: [],
      options: [],
      destructive: false,
      examples: ['rebeep env status', 'rebeep env status --json'],
      run: runStatus,
      render: renderStatus,
    },
    {
      name: 'check',
      summary: "Check host prerequisites and fetched tools' checksums",
      args: [],
      options: [],
      destructive: false,
      examples: ['rebeep env check'],
      run: runCheck,
      render: renderChecks,
    },
    {
      name: 'reset',
      summary: 'Reset every VM to its baseline',
      args: [],
      options: [],
      destructive: true,
      examples: ['rebeep env reset --preview', 'rebeep env reset --yes'],
      run: runReset,
      render: () => {},
    },
    {
      name: 'clean',
      summary: 'Delete the 86Box config, cache, tools and VMs; keep media and baselines',
      description:
        'Removes the 86Box config, cache, tools and VMs. Your imported media and your baselines are kept; --all deletes those too. Anything else in the home folder is never touched.',
      args: [],
      options: [{ name: 'all', type: 'boolean', description: 'Also delete imported media and baselines' }],
      destructive: true,
      examples: ['rebeep env clean --preview', 'rebeep env clean --all --yes'],
      run: runClean,
      render: () => {},
    },
  ],
};
