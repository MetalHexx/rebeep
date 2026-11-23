import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './cli.mjs';
import { resolveBinary, runTool, versionParts } from './nasm.mjs';

/**
 * How to run wcl: `REBEEP_WATCOM` (an absolute path, with optional `REBEEP_WATCOM_PREFIX_ARGS`)
 * wins over the fetched `open-watcom` tool. `root` is the folder that holds the `h/` and
 * `lib286/` trees, the parent of the bin folder.
 */
export async function resolveWatcom(ctx) {
  const { bin, prefix } = await resolveBinary(ctx, 'open-watcom', 'REBEEP_WATCOM');
  return { bin, prefix, root: path.dirname(path.dirname(bin)) };
}

/** `env` with `name` set, replacing any spelling of it (Windows is case-insensitive). */
function setEnv(env, name, value) {
  for (const key of Object.keys(env)) if (key.toUpperCase() === name) delete env[key];
  env[name] = value;
}

/** The child's environment: `WATCOM`, `INCLUDE` and the bin folder first on `PATH`. */
function watcomEnv({ bin, root }) {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  setEnv(env, 'PATH', [path.dirname(bin), env[pathKey]].filter(Boolean).join(path.delimiter));
  setEnv(env, 'WATCOM', root);
  setEnv(env, 'INCLUDE', path.join(root, 'h'));
  return env;
}

/** wcl's version line (for example `2.0 beta Nov  1 2026 07:09:50 (64-bit)`), or null. */
export async function watcomVersion(watcom) {
  // wcl prints its banner and usage, and exits non-zero, when run with no arguments.
  const result = await runTool(watcom, [], { env: watcomEnv(watcom) });
  return /^Version\s+(.+)$/m.exec(`${result.stdout}\n${result.stderr}`)?.[1].trim() ?? null;
}

/**
 * Compiles `sources` as 8086 medium-model DOS code and links them into `output`, with a map at
 * `mapFile` and objects in `objDir`. `version` reaches C through `gen/version.h`, a sibling of
 * `output`, defining `REBEEP_VERSION` (the string) and `REBEEP_VER_MAJOR`, `REBEEP_VER_MINOR` and
 * `REBEEP_VER_PATCH` (numbers). Returns wcl's stderr (warnings) on success; throws a CliError
 * carrying wcl's own message on failure.
 *
 * wcl runs in `output`'s folder and gets every path relative to it: it cannot read a quoted
 * argument (`"-fe=C:\my repo\x.exe"`), so an absolute path with a space in it would fail.
 */
export async function compileExe(watcom, { version, sources, includes, output, objDir, mapFile }) {
  const { major, minor, patch } = versionParts(version);
  const outDir = path.dirname(output);
  const genDir = path.join(outDir, 'gen');
  fs.mkdirSync(genDir, { recursive: true });
  fs.mkdirSync(objDir, { recursive: true });
  fs.writeFileSync(
    path.join(genDir, 'version.h'),
    [
      `#define REBEEP_VERSION ${JSON.stringify(version)}`,
      `#define REBEEP_VER_MAJOR ${major}`,
      `#define REBEEP_VER_MINOR ${minor}`,
      `#define REBEEP_VER_PATCH ${patch}`,
      '',
    ].join('\n'),
  );

  const rel = (target) => {
    const relative = path.relative(outDir, target);
    return path.isAbsolute(relative) ? target : relative;
  };
  const args = [
    '-zq',
    '-bt=dos',
    '-l=dos',
    '-mm',
    '-0',
    '-os',
    '-w4',
    ...[genDir, ...includes].map((dir) => `-i=${rel(dir)}`),
    `-fo=${path.join(rel(objDir), path.sep)}`,
    `-fe=${rel(output)}`,
    `-fm=${rel(mapFile)}`,
    ...sources.map(rel),
  ];
  const result = await runTool(watcom, args, { cwd: outDir, env: watcomEnv(watcom) });
  if (result.code !== 0) {
    const detail = [result.stderr, result.stdout].map((text) => text.trim()).filter(Boolean).join('\n') || `exit code ${result.code}`;
    throw new CliError(`wcl failed building ${path.basename(output)}:\n${detail}`);
  }
  return result.stderr;
}
