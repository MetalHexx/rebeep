import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './cli.mjs';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const UNRELEASED_HEADING = /^## \[Unreleased\]\s*$/;
const DATED_HEADING = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\s*$/;
const LINK_REFERENCE = /^\[[^\]]+\]:\s/;
const SCANNED = ['src', 'tests', 'release', 'docs', 'README.md'];

/** `{ major, minor, patch }` for a plain `X.Y.Z`, or null for anything else. */
export function parseSemver(s) {
  const m = typeof s === 'string' ? SEMVER.exec(s) : null;
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

/** Negative, zero or positive, as `a` sorts before, with or after `b`. Both must be valid. */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

/**
 * The version `target` asks for: `major`, `minor` or `patch` bumps `current`; an exact `X.Y.Z` must
 * be newer than `current`, or equal to it when `allowEqual` (the first release of an undated version).
 */
export function nextVersion(current, target, { allowEqual = false } = {}) {
  const cur = parseSemver(current);
  if (!cur) throw new CliError(`the current version '${current}' is not X.Y.Z`);
  switch (target) {
    case 'major':
      return `${cur.major + 1}.0.0`;
    case 'minor':
      return `${cur.major}.${cur.minor + 1}.0`;
    case 'patch':
      return `${cur.major}.${cur.minor}.${cur.patch + 1}`;
    default: {
      if (!parseSemver(target)) {
        throw new CliError(`'${target}' is not major, minor, patch or an exact X.Y.Z`);
      }
      const order = compareSemver(target, current);
      if (order < 0 || (order === 0 && !allowEqual)) {
        throw new CliError(`${target} is not newer than the current version ${current}`);
      }
      return target;
    }
  }
}

/**
 * Every `## ` heading of a changelog, in file order: `{ version, date, body, heading }`. `version` is
 * `'Unreleased'`, `'X.Y.Z'`, or null for a heading in neither form. `date` is null unless dated.
 * `body` is the text under the heading with link-reference lines removed and the edges trimmed.
 */
export function changelogEntries(md) {
  const entries = [];
  let current = null;
  for (const line of md.split(/\r?\n/)) {
    if (/^## /.test(line)) {
      const dated = DATED_HEADING.exec(line);
      let version = null;
      if (UNRELEASED_HEADING.test(line)) version = 'Unreleased';
      else if (dated) version = dated[1];
      current = { version, date: dated ? dated[2] : null, heading: line.trim(), lines: [] };
      entries.push(current);
    } else if (current && !LINK_REFERENCE.test(line)) {
      current.lines.push(line);
    }
  }
  return entries.map(({ lines, ...entry }) => ({ ...entry, body: lines.join('\n').trim() }));
}

/** The package version, read from `package.json`. */
export function readVersion(repo) {
  return JSON.parse(fs.readFileSync(path.join(repo.root, 'package.json'), 'utf8')).version;
}

/** The changelog text, or null when `CHANGELOG.md` is missing. */
export function readChangelog(repo) {
  const file = path.join(repo.root, 'CHANGELOG.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

/** The newest entry that carries a date, or undefined. */
export const newestDated = (entries) => entries.find((e) => e.date);

function trackedFiles(root) {
  const run = spawnSync('git', ['ls-files', '-z', '--', ...SCANNED], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (run.error || run.status !== 0) {
    const why = run.error ? run.error.message : run.stderr.trim() || `exit code ${run.status}`;
    throw new Error(`cannot list tracked files with git: ${why}`);
  }
  return run.stdout.split('\0').filter(Boolean);
}

function hardCodedVersions(root, version) {
  const escaped = version.replace(/\./g, '\\.');
  const literal = new RegExp(`(?<![\\d.])${escaped}(?!\\d|\\.\\d)`);
  const define = /%define\s+REBEEP_VERSION\b/;
  const problems = [];
  let files;
  try {
    files = trackedFiles(root);
  } catch (err) {
    return [err.message];
  }
  for (const file of files) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    fs.readFileSync(full, 'latin1')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (define.test(line)) problems.push(`${file}:${i + 1}: defines REBEEP_VERSION; the build defines it from package.json`);
        if (literal.test(line)) problems.push(`${file}:${i + 1}: hard-codes the version ${version}; package.json is the only place`);
      });
  }
  return problems;
}

/** The rules a changelog's headings and their order must keep; empty means ok. */
export function changelogProblems(entries) {
  const problems = [];
  if (entries[0]?.version !== 'Unreleased') {
    problems.push(
      entries.some((e) => e.version === 'Unreleased')
        ? 'CHANGELOG.md: "## [Unreleased]" must be the first entry'
        : 'CHANGELOG.md has no "## [Unreleased]" heading',
    );
  }
  for (const e of entries) {
    if (e.version === null) problems.push(`CHANGELOG.md: heading "${e.heading}" is not "## [X.Y.Z] - YYYY-MM-DD"`);
  }
  const dated = entries.filter((e) => e.date);
  for (let i = 1; i < dated.length; i++) {
    if (compareSemver(dated[i - 1].version, dated[i].version) <= 0) {
      problems.push(`CHANGELOG.md: ${dated[i].version} is listed after ${dated[i - 1].version}; entries go newest first`);
    }
  }
  return problems;
}

/**
 * Every way the repo's version bookkeeping is wrong, as messages; empty means ok. `release` also
 * needs a dated changelog entry with a body for the version, and `tag` must be `v` plus the version.
 */
export function checkVersions(repo, { release = false, tag } = {}) {
  const problems = [];
  const version = readVersion(repo);
  const valid = parseSemver(version) !== null;
  if (!valid) problems.push(`package.json version '${version}' is not a valid X.Y.Z`);

  const md = readChangelog(repo);
  if (md === null) {
    problems.push('CHANGELOG.md is missing');
  } else {
    const entries = changelogEntries(md);
    problems.push(...changelogProblems(entries));
    const newest = newestDated(entries);
    if (valid && newest && newest.version !== version) {
      problems.push(`package.json version ${version} is not the newest dated changelog entry (${newest.version})`);
    }
    if (valid && release) {
      const own = entries.find((e) => e.date && e.version === version);
      if (!own) problems.push(`CHANGELOG.md has no dated entry for ${version}`);
      else if (own.body === '') problems.push(`the CHANGELOG.md entry for ${version} is empty`);
    }
  }

  if (tag !== undefined && valid && tag !== `v${version}`) {
    problems.push(`tag ${tag} does not match package.json version ${version} (expected v${version})`);
  }
  if (valid) problems.push(...hardCodedVersions(repo.root, version));
  return problems;
}

/** Today's date in the local time zone as YYYY-MM-DD. */
export function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Moves the `[Unreleased]` body in `md` under a new `## [version] - date` heading and leaves an
 * empty `[Unreleased]`. Line endings and link references are kept. Throws when there is nothing to move.
 */
export function releaseChangelog(md, version, date) {
  const eol = md.includes('\r\n') ? '\r\n' : '\n';
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => UNRELEASED_HEADING.test(l));
  if (start < 0) throw new CliError('CHANGELOG.md has no "## [Unreleased]" heading');
  let end = lines.findIndex((l, i) => i > start && (/^## /.test(l) || LINK_REFERENCE.test(l)));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end);
  while (body.length && body[0].trim() === '') body.shift();
  while (body.length && body[body.length - 1].trim() === '') body.pop();
  if (body.length === 0) throw new CliError('[Unreleased] in CHANGELOG.md is empty, so there is nothing to release');
  const out = [
    ...lines.slice(0, start + 1),
    '',
    `## [${version}] - ${date}`,
    '',
    ...body,
    '',
    ...lines.slice(end),
  ];
  return { text: out.join(eol), moved: body.length };
}
