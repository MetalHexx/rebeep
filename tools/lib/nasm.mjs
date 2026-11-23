import { spawn } from 'node:child_process';
import path from 'node:path';
import { CliError } from './cli.mjs';

/**
 * Runs a program with an argument array, never through a shell. Output is captured; with `echo`
 * it is also forwarded to this process's stdout and stderr as it arrives. `timedOut` is set when
 * `timeoutMs` ran out and the process was killed.
 */
export function runProcess(bin, args, { cwd, env, echo = false, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (echo) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (echo) process.stderr.write(chunk);
    });
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, timeoutMs)
      : undefined;
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new CliError(`could not start ${bin}: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, elapsedMs: Date.now() - started });
    });
  });
}

/** `<envVar>_PREFIX_ARGS`: a JSON array of strings placed before every argument list. */
function parsePrefixArgs(raw, envVar) {
  if (raw === undefined) return [];
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new CliError(`${envVar}_PREFIX_ARGS must be a JSON array of strings`);
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new CliError(`${envVar}_PREFIX_ARGS must be a JSON array of strings`);
  }
  return value;
}

/**
 * How to run a tool: `envVar` names an absolute binary (with optional prefix args), which wins;
 * otherwise the tool manifest. The manifest is imported lazily so callers that never need a tool
 * don't load it.
 */
export async function resolveBinary(ctx, tool, envVar) {
  const override = ctx.env[envVar] || undefined;
  const prefixRaw = ctx.env[`${envVar}_PREFIX_ARGS`] || undefined;
  if (override) {
    if (!path.isAbsolute(override)) {
      throw new CliError(`${envVar} must be an absolute path (got '${override}')`);
    }
    return { bin: override, prefix: parsePrefixArgs(prefixRaw, envVar) };
  }
  if (prefixRaw !== undefined) throw new CliError(`${envVar}_PREFIX_ARGS needs ${envVar}`);

  const { resolveTool } = await import('./manifest.mjs');
  const { bin } = await resolveTool(ctx, tool);
  if (!bin) throw new CliError(`${tool} has no executable in the tool manifest`);
  return { bin, prefix: [] };
}

export function runTool({ bin, prefix }, args, opts = {}) {
  return runProcess(bin, [...prefix, ...args], opts);
}

/** Include folders get a trailing separator, which NASM needs to resolve `%include` names. */
const dirArg = (dir) => path.join(dir, path.sep);

/** The `major.minor.patch` numbers at the start of a version such as `0.1.0` or `1.2.3-beta.1`. */
export function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new CliError(`version '${version}' must start with major.minor.patch (for example 0.1.0)`);
  return { major: match[1], minor: match[2], patch: match[3] };
}

/**
 * Assembles one source with NASM, defining `REBEEP_VERSION` (the string) and `REBEEP_VER_MAJOR`,
 * `REBEEP_VER_MINOR` and `REBEEP_VER_PATCH` (numbers) from `version`. Returns NASM's stderr
 * (warnings) on success; throws a CliError carrying NASM's own message on failure.
 */
export async function assemble(nasm, { version, includes, defines = {}, listing, output, source }) {
  const { major, minor, patch } = versionParts(version);
  const args = [
    '-f',
    'bin',
    ...includes.flatMap((dir) => ['-I', dirArg(dir)]),
    `-DREBEEP_VERSION="${version}"`,
    `-DREBEEP_VER_MAJOR=${major}`,
    `-DREBEEP_VER_MINOR=${minor}`,
    `-DREBEEP_VER_PATCH=${patch}`,
    ...Object.entries(defines).map(([key, value]) => `-D${key}=${value}`),
    '-l',
    listing,
    '-o',
    output,
    source,
  ];
  const result = await runTool(nasm, args);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim() || `exit code ${result.code}`;
    throw new CliError(`nasm failed on ${path.basename(source)}:\n${detail}`);
  }
  return result.stderr;
}

/** NASM's version as printed by `nasm -v`, or null when the line has no version number. */
export async function nasmVersion(nasm) {
  const result = await runTool(nasm, ['-v']);
  if (result.code !== 0) {
    throw new CliError(`nasm -v failed: ${result.stderr.trim() || `exit code ${result.code}`}`);
  }
  return /version\s+(\S+)/i.exec(result.stdout)?.[1] ?? null;
}
