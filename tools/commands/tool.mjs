import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CliError, UsageError } from '../lib/cli.mjs';
import { assetFile, fetchAsset, isCached, sha256Buffer, sha256File } from '../lib/download.mjs';
import {
  RECORD_FILE,
  listTools,
  manifestFor,
  pickAsset,
  platformKey,
  probeSystemTool,
  readRecord,
  strategyOf,
} from '../lib/manifest.mjs';
import { assertLinksContained, checkEntryName, extractZip, hashTree, listFiles } from '../lib/zip.mjs';

/** The tools a verb applies to: the named one, else all (fetch skips on-demand tools). */
function selectTools(manifest, name, { includeOnDemand }) {
  if (name === undefined) return listTools(manifest, { includeOnDemand });
  const found = listTools(manifest, { includeOnDemand: true }).find((t) => t.name === name);
  if (!found) {
    throw new UsageError(`unknown tool '${name}'`, {
      hint: `Known tools: ${Object.keys(manifest.tools).join(', ')}`,
    });
  }
  return [found];
}

function extractAppImage(file, dir, log) {
  if (process.platform !== 'linux') throw new CliError('AppImage tools can only be fetched on Linux');
  const copy = path.join(dir, path.basename(file));
  fs.copyFileSync(file, copy);
  fs.chmodSync(copy, 0o755);
  try {
    log.step(`extracting ${path.basename(file)}`);
    const run = spawnSync(copy, ['--appimage-extract'], {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
      timeout: 5 * 60 * 1000,
    });
    if (run.error || run.status !== 0) {
      const why = run.error?.message ?? `exit ${run.status ?? run.signal}`;
      const detail = run.stderr?.trim().slice(-2000);
      throw new CliError(`extracting ${path.basename(file)} failed: ${why}${detail ? `\n${detail}` : ''}`);
    }
  } finally {
    fs.rmSync(copy, { force: true });
  }
  return hashTree(dir);
}

/**
 * The tar that reads xz: bsdtar by absolute path on Windows (the `tar` first on a Git Bash PATH is
 * GNU tar, which reads `C:\...` as a remote `host:file`), else `tar` from PATH.
 */
function tarCommand(env) {
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
  return process.platform === 'win32' ? path.join(systemRoot, 'System32', 'tar.exe') : 'tar';
}

function runTar(tar, args) {
  const run = spawnSync(tar, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 256 * 1024 ** 2,
    timeout: 15 * 60 * 1000,
  });
  if (run.error) throw new CliError(`could not run ${tar}: ${run.error.message}`);
  return run;
}

/**
 * Unpacks the listed top-level folders (default: everything) of a `.tar.xz` into `dir` with the
 * host's tar, after checking every entry name the way zip entry names are checked, and returns the
 * SHA-256 of every file written. Node has no xz decoder, hence the child process.
 */
function extractTarXz(file, dir, { extract, env, log }) {
  const tar = tarCommand(env);
  const name = path.basename(file);
  const banner = runTar(tar, ['--version']);
  const tarName = `${tar} (${(banner.stdout || banner.stderr).split(/\r?\n/)[0].trim() || 'unknown version'})`;

  log.step(`listing ${name}`);
  const listing = runTar(tar, ['-tf', file]);
  if (listing.status !== 0) {
    throw new CliError(`${tarName} cannot read ${name}: ${(listing.stderr || `exit ${listing.status}`).trim().slice(-1000)}`, {
      hint: 'The archive is xz-compressed: use a tar with xz support (bsdtar with liblzma, or GNU tar with xz installed).',
    });
  }
  // Entries may be listed as `./name`; `members` keeps the listed spelling so tar matches it.
  const members = new Map();
  for (const entry of listing.stdout.split(/\r?\n/).filter(Boolean)) {
    const rel = entry.startsWith('./') ? entry.slice(2) : entry;
    if (rel === '') continue;
    checkEntryName(rel);
    const top = rel.split('/')[0];
    if (!members.has(top)) members.set(top, entry.slice(0, entry.length - rel.length) + top);
  }
  const wanted = (extract ?? []).map((folder) => {
    checkEntryName(folder);
    if (!members.has(folder)) throw new CliError(`${name} has no '${folder}' folder`);
    return members.get(folder);
  });

  log.step(`extracting ${wanted.length ? wanted.join(', ') : name}`);
  const unpacked = runTar(tar, ['-xf', file, '--no-same-owner', '-C', dir, ...wanted]);
  if (unpacked.status !== 0) {
    throw new CliError(`${tarName} failed extracting ${name}: ${(unpacked.stderr || `exit ${unpacked.status}`).trim().slice(-1000)}`);
  }
  assertLinksContained(dir, fs.realpathSync(dir));
  return hashTree(dir);
}

async function fetchDownload(ctx, tool, asset, { force }) {
  const { paths, log } = ctx;
  const record = readRecord(paths, tool.name, tool.version);
  if (record && !force && record.sha256 === asset.sha256) {
    return { status: 'already fetched', message: 'already fetched' };
  }

  const { file, reused } = await fetchAsset(paths, asset, { force, log });
  if (reused) log.step(`using cached ${assetFile(asset)}`);

  const dir = paths.tool(tool.name, tool.version);
  const staging = `${dir}.tmp-${process.pid}`;
  const previous = `${dir}.old-${process.pid}`;
  let files;
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    if (asset.archive === 'appimage') files = extractAppImage(file, staging, log);
    else if (asset.archive === 'tar.xz') files = extractTarXz(file, staging, { extract: asset.extract, env: ctx.env, log });
    else files = extractZip(file, staging, { stripRoot: asset.stripRoot, into: asset.into, extractor: asset.extractor, log }).files;
    fs.writeFileSync(
      path.join(staging, RECORD_FILE),
      `${JSON.stringify(
        {
          name: tool.name,
          version: tool.version,
          url: asset.url,
          sha256: asset.sha256,
          sha256Source: asset.sha256Source,
          fetchedAt: new Date().toISOString(),
          files,
        },
        null,
        2,
      )}\n`,
    );

    // Swap in only now, so a failed (re-)fetch leaves the previous install untouched.
    fs.rmSync(previous, { recursive: true, force: true });
    if (fs.existsSync(dir)) fs.renameSync(dir, previous);
    try {
      fs.renameSync(staging, dir);
    } catch (err) {
      if (fs.existsSync(previous)) fs.renameSync(previous, dir);
      throw err;
    }
    fs.rmSync(previous, { recursive: true, force: true });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return { status: 'fetched', message: `fetched (${Object.keys(files).length} files)` };
}

function fetchSystem(ctx, tool, asset) {
  const { system } = asset;
  const probe = probeSystemTool(system, ctx.env);
  if (probe.ok) return { status: 'found', message: `found ${probe.version}` };
  const what = !probe.found ? 'not found on PATH' : `version ${probe.version ?? 'unknown'} is older than ${system.minVersion}`;
  const message = `${what}. ${system.hint}`;
  ctx.log.warn(`${tool.name}: ${message}`);
  return { status: 'warning', message };
}

async function fetchOne(ctx, tool, { force }) {
  const asset = pickAsset(tool);
  const base = { name: tool.name, version: tool.version, strategy: strategyOf(asset) };
  if (!asset) {
    const message = `no build for ${platformKey()}`;
    ctx.log.warn(`${tool.name}: ${message}, skipped`);
    return { ...base, status: 'unsupported', message };
  }
  if (asset.system) return { ...base, ...fetchSystem(ctx, tool, asset) };
  return { ...base, ...(await fetchDownload(ctx, tool, asset, { force })) };
}

async function verifyOne(ctx, tool) {
  const asset = pickAsset(tool);
  const base = { name: tool.name, version: tool.version, strategy: strategyOf(asset), problems: [] };
  if (!asset) return { ...base, state: 'unsupported' };
  if (asset.system) return { ...base, state: 'system' };
  const record = readRecord(ctx.paths, tool.name, tool.version);
  if (!record) return { ...base, state: 'not fetched' };

  const { problems } = base;
  if (record.sha256 !== asset.sha256) problems.push('record is for a different pin than the manifest (run fetch --force)');
  if (!(await isCachedOrAbsent(ctx.paths, asset))) problems.push(`cached download ${assetFile(asset)} does not match the pinned SHA-256`);

  const dir = ctx.paths.tool(tool.name, tool.version);
  const known = record.files ?? {};
  for (const [rel, sha] of Object.entries(known)) {
    const abs = path.join(dir, ...rel.split('/'));
    let stat;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      problems.push(`missing: ${rel}`);
      continue;
    }
    const actual = stat.isSymbolicLink()
      ? sha256Buffer(Buffer.from(fs.readlinkSync(abs)))
      : stat.isFile()
        ? await sha256File(abs)
        : null;
    if (actual !== sha) problems.push(`modified: ${rel}`);
  }
  for (const rel of listFiles(dir)) {
    if (rel !== RECORD_FILE && !(rel in known)) problems.push(`extra: ${rel}`);
  }
  return { ...base, state: problems.length ? 'FAILED' : 'verified' };
}

async function isCachedOrAbsent(paths, asset) {
  const file = path.join(paths.cache, assetFile(asset));
  return !fs.existsSync(file) || (await isCached(paths, asset));
}

function printTable(log, rows, columns) {
  if (rows.length) log.table(rows, columns);
}

export default {
  name: 'tool',
  summary: 'Fetch and verify the pinned tools',
  verbs: [
    {
      name: 'list',
      summary: "List pinned tools and whether they're fetched",
      args: [],
      options: [],
      destructive: false,
      examples: ['rebeep tool list'],
      run: async (ctx) => {
        const manifest = manifestFor(ctx);
        const tools = listTools(manifest, { includeOnDemand: true }).map((tool) => {
          const asset = pickAsset(tool);
          const strategy = strategyOf(asset);
          let state = '-';
          let version = tool.version;
          if (strategy === 'download') {
            state = readRecord(ctx.paths, tool.name, tool.version) ? 'fetched' : 'not fetched';
          } else if (strategy === 'system') {
            const probe = probeSystemTool(asset.system, ctx.env);
            version = probe.version ?? tool.version;
            if (!probe.found) state = 'missing';
            else state = probe.ok ? `found v${probe.version}` : `too old (v${probe.version ?? '?'}, need ${asset.system.minVersion})`;
          }
          return { name: tool.name, version, strategy, state, onDemand: tool.onDemand };
        });
        return { platform: platformKey(), tools };
      },
      render: (data, log) =>
        printTable(
          log,
          data.tools.map((t) => ({ ...t, onDemand: t.onDemand ? 'yes' : '' })),
          [
            { key: 'name', label: 'NAME' },
            { key: 'version', label: 'VERSION' },
            { key: 'strategy', label: 'STRATEGY' },
            { key: 'state', label: 'STATE' },
            { key: 'onDemand', label: 'ON-DEMAND' },
          ],
        ),
    },
    {
      name: 'fetch',
      summary: 'Download, verify and extract tools',
      description: 'Fetches every pinned tool, or just the one named. Downloads are checked against their pinned SHA-256.',
      args: [{ name: 'name', required: false, description: 'Tool name (default: all)' }],
      options: [
        { name: 'force', type: 'boolean', description: 'Re-download even if cached' },
      ],
      destructive: false,
      examples: ['rebeep tool fetch', 'rebeep tool fetch nasm --force'],
      run: async (ctx) => {
        const manifest = manifestFor(ctx);
        const tools = selectTools(manifest, ctx.args.name, { includeOnDemand: false });
        const results = [];
        const failures = [];
        for (const tool of tools) {
          try {
            results.push(await fetchOne(ctx, tool, { force: ctx.opts.force }));
          } catch (err) {
            failures.push(`${tool.name}: ${err.message}`);
            results.push({ name: tool.name, version: tool.version, strategy: strategyOf(pickAsset(tool)), status: 'failed', message: err.message });
          }
        }
        if (failures.length) {
          throw new CliError(`tool fetch failed:\n  ${failures.join('\n  ')}`, {
            hint: 'Nothing unverified was installed. Fix the cause and re-run `rebeep tool fetch`.',
            data: { tools: results },
          });
        }
        return { tools: results, warnings: results.filter((r) => r.status === 'warning' || r.status === 'unsupported').length };
      },
      render: (data, log) =>
        printTable(log, data.tools, [
          { key: 'name', label: 'NAME' },
          { key: 'version', label: 'VERSION' },
          { key: 'status', label: 'STATUS' },
          { key: 'message', label: 'DETAIL' },
        ]),
    },
    {
      name: 'verify',
      summary: 'Re-hash fetched tools against the manifest',
      args: [{ name: 'name', required: false, description: 'Tool name (default: all)' }],
      options: [],
      destructive: false,
      examples: ['rebeep tool verify', 'rebeep tool verify nasm'],
      run: async (ctx) => {
        const manifest = manifestFor(ctx);
        const tools = selectTools(manifest, ctx.args.name, { includeOnDemand: true });
        const results = [];
        for (const tool of tools) results.push(await verifyOne(ctx, tool));
        const failed = results.filter((r) => r.problems.length);
        if (failed.length) {
          const lines = failed.flatMap((r) => [`${r.name}:`, ...r.problems.map((p) => `  ${p}`)]);
          throw new CliError(`tool verify failed:\n${lines.join('\n')}`, {
            hint: 'Re-fetch with `rebeep tool fetch <name> --force`.',
            data: { tools: results },
          });
        }
        return { tools: results };
      },
      render: (data, log) =>
        printTable(log, data.tools, [
          { key: 'name', label: 'NAME' },
          { key: 'version', label: 'VERSION' },
          { key: 'state', label: 'STATE' },
        ]),
    },
  ],
};
