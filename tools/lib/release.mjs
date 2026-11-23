/**
 * The release package: what goes in it, the plain-text rendering of the changelog, and the
 * checks that keep every text file readable on a DOS machine. Nothing here writes to disk.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './cli.mjs';
import { sha256Buffer } from './download.mjs';
import { to83, toCrlf } from './fat.mjs';
import { changelogEntries, changelogProblems, compareSemver } from './version.mjs';

const WIDTH = 78;
const MAX_LINE = 80;
const BINARY_EXTENSIONS = new Set(['COM', 'EXE', 'ANS']);
const BOOT_CONFIGS = new Set(['CONFIG.SYS', 'AUTOEXEC.BAT', 'FDCONFIG.SYS', 'FDAUTO.BAT']);
export const PACKAGED_TARGETS = ['REBEEP.COM', 'RBTEST.COM', 'RBSTUDIO.EXE'];
const REQUIRED_FILES = ['README.TXT', 'INSTALL.BAT', 'RBPLAY.BAT'];
/** Package files whose `@VERSION@` is filled in with the version. */
const VERSIONED = new Set(['README.TXT', 'INSTALL.BAT']);

// ---------------------------------------------------------------------------------------------
// Changelog

const ASCII_REPLACEMENTS = {
  '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '--',
};

/** Plain-text form of one line of Markdown: links reduced to their text, code and bold marks dropped. */
function plain(text) {
  const ascii = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/[‘’“”–—]/g, (c) => ASCII_REPLACEMENTS[c]);
  const bad = /[^\x00-\x7f]/.exec(ascii);
  if (bad) {
    throw new CliError(`CHANGELOG.md has a character that is not ASCII (U+${bad[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}) in: ${text}`);
  }
  return ascii;
}

/** Greedy word wrap to `WIDTH` columns; a word longer than the line stands alone. */
function wrap(text, first, rest) {
  const lines = [];
  let line = first;
  let empty = true;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!empty && line.length + 1 + word.length > WIDTH) {
      lines.push(line);
      line = rest;
      empty = true;
    }
    line += (empty ? '' : ' ') + word;
    empty = false;
  }
  lines.push(line);
  return lines;
}

/** One entry's body as indented, wrapped plain text. */
function entryText(lines) {
  const out = [];
  let item = null;
  const flush = () => {
    if (item) out.push(...wrap(item.text, item.first, item.rest));
    item = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const section = /^#{3,} +(.*)$/.exec(line);
    const bullet = /^(\s*)[-*] +(.*)$/.exec(line);
    if (section) {
      flush();
      if (out.length) out.push('');
      out.push(`${plain(section[1])}:`);
    } else if (bullet) {
      flush();
      const nested = bullet[1].length >= 2;
      item = nested
        ? { first: '    - ', rest: '      ', text: plain(bullet[2]) }
        : { first: '  * ', rest: '    ', text: plain(bullet[2]) };
    } else if (line.trim() === '') {
      flush();
    } else if (item) {
      item.text += ` ${plain(line.trim())}`;
    } else {
      out.push(...wrap(plain(line.trim()), '', ''));
    }
  }
  flush();
  return out;
}

/**
 * The changelog as plain text: a title, then each dated version up to and including `version`,
 * newest first. `[Unreleased]` is left out.
 * @param {string} md The contents of CHANGELOG.md.
 * @param {{version: string}} options
 * @returns {string} LF-separated text, ASCII only
 * @throws {CliError} on a character that has no ASCII form
 */
export function changesText(md, { version }) {
  const lines = ['ReBeep - Changes', '================', ''];
  const entries = changelogEntries(md).filter((e) => e.date && compareSemver(e.version, version) <= 0);
  if (!entries.length) lines.push('No released versions yet.', '');
  for (const entry of entries) {
    const title = `Version ${entry.version} (${entry.date})`;
    lines.push(title, '-'.repeat(title.length), ...entryText(entry.body.split('\n')), '');
  }
  return lines.join('\n');
}

/**
 * The Markdown body of the changelog entry for `version`, or of `[Unreleased]` when there is no
 * dated entry yet.
 * @returns {{heading: string, body: string}} `heading` is `ReBeep <version>` or
 *   `ReBeep <version> - Unreleased preview`
 */
export function releaseNotes(md, { version }) {
  const entries = changelogEntries(md);
  const dated = entries.find((e) => e.version === version);
  const entry = dated ?? entries.find((e) => e.version === 'Unreleased');
  if (!entry) throw new CliError(`CHANGELOG.md has no entry for ${version} and no [Unreleased] section`);
  return {
    heading: dated ? `ReBeep ${version}` : `ReBeep ${version} - Unreleased preview`,
    body: entry.body,
  };
}

// ---------------------------------------------------------------------------------------------
// Checks

/**
 * The problems with one package file: a name segment that is not an uppercase 8.3 name and, for
 * text files, a non-ASCII byte, a line not ending in CRLF or a line over 80 columns.
 * @param {string} filePath Package path, `/` or `\` separated.
 * @param {Buffer} bytes
 * @returns {string[]}
 */
export function checkPackageText(filePath, bytes) {
  const problems = [];
  for (const segment of filePath.split(/[\\/]/)) {
    try {
      if (to83(segment) !== segment) problems.push(`${filePath}: name ${segment} is not upper case`);
    } catch (err) {
      problems.push(`${filePath}: ${err.message}`);
    }
  }
  if (BINARY_EXTENSIONS.has(filePath.slice(filePath.lastIndexOf('.') + 1).toUpperCase())) return problems;

  const highByte = bytes.findIndex((b) => b > 0x7f);
  if (highByte >= 0) {
    const line = bytes.subarray(0, highByte).toString('latin1').split('\n').length;
    problems.push(`${filePath}: non-ASCII byte 0x${bytes[highByte].toString(16).toUpperCase()} on line ${line}`);
  }
  const text = bytes.toString('latin1');
  const lines = text.split('\n');
  const unterminated = lines.pop();
  lines.forEach((line, i) => {
    if (!line.endsWith('\r')) problems.push(`${filePath}: line ${i + 1} does not end in CRLF`);
  });
  if (unterminated !== '') problems.push(`${filePath}: the last line does not end in CRLF`);
  [...lines, unterminated].forEach((line, i) => {
    const width = line.replace(/\r$/, '').length;
    if (width > MAX_LINE) problems.push(`${filePath}: line ${i + 1} is ${width} columns; the limit is ${MAX_LINE}`);
  });
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Composition

function listTree(dir, prefix) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listTree(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

function readBuildJson(repo) {
  const file = path.join(repo.build, 'build.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new CliError(`cannot read ${file}: ${err.message}`, { hint: 'rebeep build run' });
  }
}

/** The build.json record of `name` and the bytes of `build/<name>`, which must still match it. */
export function readBuiltTarget(repo, name, buildJson = readBuildJson(repo)) {
  const target = buildJson.targets?.find((t) => t.name === name);
  if (!target) throw new CliError(`build/build.json has no ${name}`, { hint: 'rebeep build run' });
  const file = path.join(repo.build, name);
  if (!fs.existsSync(file)) throw new CliError(`${file} is missing`, { hint: 'rebeep build run' });
  const bytes = fs.readFileSync(file);
  if (sha256Buffer(bytes) !== target.sha256) {
    throw new CliError(`${file} does not match build/build.json`, { hint: 'rebeep build run' });
  }
  return { bytes, sha256: target.sha256 };
}

/**
 * The package path of a build.json `files` entry deployed to `REBEEP` or a folder below it
 * (`REBEEP/FACTORY` gives `FACTORY/<name>`), or null for one deployed elsewhere.
 */
function packagedDataPath(entry) {
  const [root, ...below] = String(entry.deploy).split('/');
  return root === 'REBEEP' ? [...below, entry.name].join('/') : null;
}

/** The bytes of a build.json `files` entry in `build/files/<deploy>/`, which must still match it. */
function readBuiltDataFile(repo, entry) {
  const file = path.join(repo.build, 'files', ...String(entry.deploy).split('/'), entry.name);
  if (!fs.existsSync(file)) throw new CliError(`${file} is missing`, { hint: 'rebeep build run' });
  const bytes = fs.readFileSync(file);
  if (sha256Buffer(bytes) !== entry.sha256) {
    throw new CliError(`${file} does not match build/build.json`, { hint: 'rebeep build run' });
  }
  return bytes;
}

/**
 * Builds the package tree: the built programs, the built data files deployed to `REBEEP` (at their
 * path below it), everything under `release/` except its AGENTS.md
 * (README.TXT and INSTALL.BAT with `@VERSION@` replaced) and a generated CHANGES.TXT. Paths use `/`. `problems`
 * lists everything `checkPackageText` found, any boot config file at the top level, any `@VERSION@` left unfilled, a
 * REBEEP.COM that doesn't name the version (a stale build), and every CHANGELOG.md rule `version check` applies.
 * @param {{repo: object}} ctx
 * @param {{version: string}} options
 * @returns {{files: {path: string, bytes: Buffer}[], dirs: string[], problems: string[]}}
 */
export function composeRelease(ctx, { version }) {
  const { repo } = ctx;
  const releaseDir = path.join(repo.root, 'release');
  const files = [];

  const buildJson = readBuildJson(repo);
  for (const name of PACKAGED_TARGETS) files.push({ path: name, bytes: readBuiltTarget(repo, name, buildJson).bytes });
  for (const entry of buildJson.files ?? []) {
    const packaged = packagedDataPath(entry);
    if (packaged) files.push({ path: packaged, bytes: readBuiltDataFile(repo, entry) });
  }

  if (!fs.existsSync(releaseDir)) throw new CliError(`${releaseDir} is missing`);
  for (const rel of listTree(releaseDir, '').map((p) => p.slice(1)).filter((p) => p.toUpperCase() !== 'AGENTS.MD')) {
    let bytes = fs.readFileSync(path.join(releaseDir, ...rel.split('/')));
    if (VERSIONED.has(rel)) bytes = Buffer.from(bytes.toString('latin1').replaceAll('@VERSION@', version), 'latin1');
    files.push({ path: rel, bytes });
  }
  for (const name of REQUIRED_FILES) {
    if (!files.some((f) => f.path === name)) throw new CliError(`${path.join(releaseDir, name)} is missing`);
  }

  const changelog = path.join(repo.root, 'CHANGELOG.md');
  if (!fs.existsSync(changelog)) throw new CliError(`${changelog} is missing`);
  const md = fs.readFileSync(changelog, 'utf8');
  files.push({ path: 'CHANGES.TXT', bytes: toCrlf(Buffer.from(changesText(md, { version }), 'latin1')) });

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const problems = changelogProblems(changelogEntries(md));
  for (const file of files) {
    problems.push(...checkPackageText(file.path, file.bytes));
    if (!file.path.includes('/') && BOOT_CONFIGS.has(file.path)) {
      problems.push(`${file.path}: a boot config file must not sit at the top level of the package`);
    }
    if (file.bytes.includes('@VERSION@')) {
      problems.push(`${file.path}: @VERSION@ is filled in only in ${[...VERSIONED].join(' and ')}`);
    }
  }
  const program = files.find((f) => f.path === 'REBEEP.COM');
  if (!program.bytes.includes(`ReBeep ${version}`)) {
    problems.push(`REBEEP.COM: does not say "ReBeep ${version}"; rebuild it with rebeep build run`);
  }
  const dirs = [...new Set(files.flatMap((f) => f.path.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))))].sort();
  return { files, dirs, problems };
}
