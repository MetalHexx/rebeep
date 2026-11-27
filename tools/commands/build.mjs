import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../lib/cli.mjs';
import { assemble, nasmVersion, resolveBinary } from '../lib/nasm.mjs';
import { compileExe, resolveWatcom, watcomVersion } from '../lib/watcom.mjs';

const NAME_83 = /^[A-Z0-9_]{1,8}\.[A-Z0-9_]{1,3}$/;
const DIR_83 = /^[A-Z0-9_]{1,8}$/;
const DEFINE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ROOTS = ['src', 'tests'];
const FORMATS = ['bin', 'exe'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function readPackageVersion(repo) {
  return JSON.parse(fs.readFileSync(path.join(repo.root, 'package.json'), 'utf8')).version;
}

/**
 * Validates `targets.json`'s `targets` and returns its targets with defaults filled in. `root` (`src`, the
 * default, or `tests`) is the repo folder the source is resolved under. `format` `bin` is one NASM
 * source file; `exe` is a folder of C files compiled and linked together. `autoload` (default
 * false) marks the target `BOOT.BAT` loads at boot; the delivery writes the flag file for it.
 */
function validateTargets(doc, file) {
  const fail = (message) => {
    throw new CliError(`${file}: ${message}`);
  };
  if (!Array.isArray(doc?.targets) || doc.targets.length === 0) {
    fail('"targets" must be a non-empty array');
  }
  const names = new Set();
  return doc.targets.map((t, i) => {
    const where = `targets[${i}]`;
    if (!isPlainObject(t)) fail(`${where} must be an object`);
    if (typeof t.name !== 'string' || !NAME_83.test(t.name)) {
      fail(`${where}.name '${t.name}' must be an 8.3 upper-case DOS name such as REBEEP.COM`);
    }
    if (names.has(t.name)) fail(`duplicate target name ${t.name}`);
    names.add(t.name);
    if (
      typeof t.source !== 'string' ||
      t.source === '' ||
      path.isAbsolute(t.source) ||
      t.source.split(/[\\/]/).includes('..')
    ) {
      fail(`${where}.source must be a path inside its root folder`);
    }
    if (t.root !== undefined && !ROOTS.includes(t.root)) {
      fail(`${where}.root must be one of ${ROOTS.map((r) => `"${r}"`).join(', ')}`);
    }
    if (!FORMATS.includes(t.format)) fail(`${where}.format must be "bin" or "exe"`);
    if (t.deploy !== undefined && (typeof t.deploy !== 'string' || !DIR_83.test(t.deploy))) {
      fail(`${where}.deploy must be an 8.3 upper-case DOS folder name`);
    }
    if (t.autoload !== undefined && typeof t.autoload !== 'boolean') {
      fail(`${where}.autoload must be true or false`);
    }
    const defines = t.defines ?? {};
    if (!isPlainObject(defines)) fail(`${where}.defines must be an object`);
    if (t.format === 'exe' && Object.keys(defines).length) fail(`${where}.defines is only for "bin" targets`);
    for (const [key, value] of Object.entries(defines)) {
      if (!DEFINE_NAME.test(key)) fail(`${where}.defines has an invalid name '${key}'`);
      if (typeof value !== 'string' && typeof value !== 'number') {
        fail(`${where}.defines.${key} must be a string or a number`);
      }
    }
    return {
      name: t.name,
      source: t.source,
      root: t.root ?? 'src',
      format: t.format,
      deploy: t.deploy ?? null,
      autoload: t.autoload ?? false,
      defines,
    };
  });
}

/**
 * Validates the optional top-level `files` list: plain data files under `src/` that ship with the
 * build. `source` is a path inside `src/` whose base name is an 8.3 upper-case DOS name; `deploy`
 * is one to four 8.3 upper-case folder names joined by `/`. Returns `{ source, deploy, name }`
 * entries, `source` with `/` separators.
 */
function validateFiles(doc, file) {
  const fail = (message) => {
    throw new CliError(`${file}: ${message}`);
  };
  if (doc?.files === undefined) return [];
  if (!Array.isArray(doc.files)) fail('"files" must be an array');
  const seen = new Set();
  return doc.files.map((f, i) => {
    const where = `files[${i}]`;
    if (!isPlainObject(f)) fail(`${where} must be an object`);
    if (
      typeof f.source !== 'string' ||
      f.source === '' ||
      path.isAbsolute(f.source) ||
      f.source.split(/[\\/]/).includes('..')
    ) {
      fail(`${where}.source must be a path inside src/`);
    }
    const source = f.source.replaceAll('\\', '/');
    const name = source.slice(source.lastIndexOf('/') + 1);
    if (!NAME_83.test(name)) {
      fail(`${where}.source '${f.source}' must end in an 8.3 upper-case DOS name such as ORGAN.RBP`);
    }
    const segments = typeof f.deploy === 'string' ? f.deploy.split('/') : [];
    if (segments.length > 4 || !segments.every((s) => DIR_83.test(s)) || segments.length === 0) {
      fail(`${where}.deploy must be one to four 8.3 upper-case DOS folder names joined by "/", such as REBEEP/FACTORY/PATCHES`);
    }
    const key = `${f.deploy}/${name}`;
    if (seen.has(key)) fail(`duplicate file ${key}`);
    seen.add(key);
    return { source, deploy: f.deploy, name };
  });
}

function readTargetsDoc(repo) {
  try {
    return JSON.parse(fs.readFileSync(repo.targets, 'utf8'));
  } catch (err) {
    throw new CliError(`cannot read ${repo.targets}: ${err.message}`);
  }
}

function loadTargets(repo) {
  return validateTargets(readTargetsDoc(repo), repo.targets);
}

/** `targets.json`'s data files, validated, each with its path under `src/` in `from`; a missing source is an error. */
export function loadDataFiles(repo) {
  return validateFiles(readTargetsDoc(repo), repo.targets).map((file) => {
    const from = path.join(repo.src, ...file.source.split('/'));
    if (!fs.statSync(from, { throwIfNoEntry: false })?.isFile()) {
      throw new CliError(`${repo.targets}: data file ${file.source} does not exist under src/`);
    }
    return { ...file, from };
  });
}

/** Copies each data file to `build/files/<deploy>/<NAME>` and returns the `build.json` records. */
function copyDataFiles(repo, dataFiles) {
  const root = path.join(repo.build, 'files');
  fs.rmSync(root, { recursive: true, force: true });
  return dataFiles.map(({ from, deploy, name }) => {
    const output = path.join(root, ...deploy.split('/'), name);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(from, output);
    return { name, deploy, size: fs.statSync(output).size, sha256: sha256(output) };
  });
}

/** A C target's `*.c` files, sorted. Throws if the source folder is missing or has none. */
function cSources(repo, target) {
  const dir = path.join(repo[target.root], target.source);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    throw new CliError(`${target.name}: source folder ${dir} does not exist`);
  }
  const names = entries.filter((e) => e.isFile() && /\.c$/i.test(e.name)).map((e) => e.name).sort();
  if (names.length === 0) throw new CliError(`${target.name}: ${dir} has no .c files`);
  return names.map((name) => path.join(dir, name));
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Runs the `disk deploy` verb through the registry, as `build run --deploy` does. */
async function deployAll(ctx) {
  const { default: nouns } = await import('./index.mjs');
  const deploy = nouns.find((n) => n.name === 'disk')?.verbs.find((v) => v.name === 'deploy');
  if (!deploy) throw new CliError('disk deploy is not registered');
  const deployed = await deploy.run({ ...ctx, noun: 'disk', verb: 'deploy', args: {} });
  if (!ctx.json && deploy.render) await deploy.render(deployed, ctx.log);
  return deployed;
}

async function buildRun(ctx) {
  const repo = ctx.repo;
  fs.rmSync(path.join(repo.build, 'build.json'), { force: true });
  const targets = loadTargets(repo);
  const dataFiles = loadDataFiles(repo);
  const version = readPackageVersion(repo);
  const nasm = await resolveBinary(ctx, 'nasm', 'REBEEP_NASM');
  const nasmVer = await nasmVersion(nasm);
  const cTargets = new Map(targets.filter((t) => t.format === 'exe').map((t) => [t.name, cSources(repo, t)]));
  const watcom = cTargets.size ? await resolveWatcom(ctx) : null;
  const compiler = watcom ? { bin: watcom.bin, version: await watcomVersion(watcom) } : undefined;
  fs.mkdirSync(repo.build, { recursive: true });

  const built = [];
  for (const target of targets) {
    const stem = target.name.slice(0, target.name.lastIndexOf('.'));
    const output = path.join(repo.build, target.name);
    let stderr;
    let tool;
    if (target.format === 'exe') {
      const sources = cTargets.get(target.name);
      ctx.log.step(`Compiling ${target.name}`);
      tool = 'wcl';
      // No include folder: quoted includes resolve beside the including file, and the source folder
      // holds a dos.h that would shadow <dos.h> on an include path.
      stderr = await compileExe(watcom, {
        version,
        sources,
        includes: [],
        output,
        objDir: path.join(repo.build, 'obj', stem),
        mapFile: path.join(repo.build, `${stem}.MAP`),
      });
    } else {
      const source = path.join(repo[target.root], target.source);
      const includes = [...new Set([path.dirname(source), repo.src, path.join(repo.src, 'include')])];
      ctx.log.step(`Assembling ${target.name}`);
      tool = 'nasm';
      stderr = await assemble(nasm, {
        version,
        includes,
        defines: target.defines,
        listing: path.join(repo.build, `${stem}.LST`),
        output,
        source,
      });
    }
    for (const line of stderr.split(/\r?\n/).filter((l) => l.trim())) {
      ctx.log.warn(`${tool} (${target.name}): ${line.trim()}`);
    }
    const size = fs.statSync(output).size;
    ctx.log.ok(`${target.name}: ${size} bytes`);
    built.push({
      name: target.name,
      size,
      sha256: sha256(output),
      deploy: target.deploy,
      autoload: target.autoload,
    });
  }

  const summary = {
    builtAt: new Date().toISOString(),
    nasm: { bin: nasm.bin, version: nasmVer },
    compiler,
    targets: built,
    files: copyDataFiles(repo, dataFiles),
  };
  fs.writeFileSync(path.join(repo.build, 'build.json'), `${JSON.stringify(summary, null, 2)}\n`);

  const deployed = ctx.opts.deploy ? await deployAll(ctx) : null;
  return { ...summary, deployed };
}

export default {
  name: 'build',
  summary: 'Assemble and compile ReBeep',
  verbs: [
    {
      name: 'run',
      summary: 'Build every target in src/targets.json',
      args: [],
      options: [{ name: 'deploy', type: 'boolean', description: 'Then run disk deploy' }],
      destructive: false,
      examples: ['rebeep build run', 'rebeep build run --deploy'],
      run: buildRun,
      // Progress is printed during the run, so the summary is not repeated here.
      render: () => {},
    },
    {
      name: 'clean',
      summary: 'Delete build/',
      args: [],
      options: [],
      destructive: false,
      examples: ['rebeep build clean'],
      run: async (ctx) => {
        fs.rmSync(ctx.repo.build, { recursive: true, force: true });
        return { build: ctx.repo.build };
      },
      render: (data, log) => log.ok(`removed ${data.build}`),
    },
  ],
};
