import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from './cli.mjs';
import { formatBytes, replaceDir } from './fsx.mjs';

export const DEFAULT_API_BASE = 'https://api.github.com';
export const START_MARKER = '<!-- release:start -->';
export const END_MARKER = '<!-- release:end -->';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TAG = /^v\d+\.\d+\.\d+$/;
const PUBLISHED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const GITHUB_REPO = /^(?:git\+)?(?:https:\/\/github\.com\/|git@github\.com:|github:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;
const SUMS_NAME = 'SHA256SUMS.txt';

/** `owner/name` from `package.json` `repository.url`, so the repo is named in one place only. */
export function readRepoSlug(repo) {
  const file = path.join(repo.root, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new CliError(`cannot read ${file}: ${err.message}`);
  }
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const match = typeof url === 'string' ? GITHUB_REPO.exec(url) : null;
  if (!match) {
    throw new CliError('package.json repository.url is not a GitHub repository URL', {
      hint: 'Set it to https://github.com/<owner>/<repo>.git, or run with --offline.',
    });
  }
  return `${match[1]}/${match[2]}`;
}

/** The GitHub API base and token for a lookup: `REBEEP_GITHUB_API` overrides the base (for tests). */
export function githubApi(env = process.env) {
  return {
    apiBase: env.REBEEP_GITHUB_API || DEFAULT_API_BASE,
    token: env.GITHUB_TOKEN || env.GH_TOKEN || undefined,
  };
}

const shown = (value) => JSON.stringify(String(value).slice(0, 40));

/**
 * Accepts a GitHub release only when the page can be stamped completely: published (not a draft or
 * prerelease), a `vX.Y.Z` tag, a valid `published_at`, and the zip and floppy image assets with
 * download URLs under this repo's release. `SHA256SUMS.txt` is optional. Returns `{ release }`, or
 * `{ fallback: reason }`.
 */
export function validateRelease(json, slug) {
  if (json === null || typeof json !== 'object') return { fallback: 'the response is not a release' };
  if (json.draft || json.prerelease) return { fallback: 'the latest release is a draft or a prerelease' };
  const tag = json.tag_name;
  if (typeof tag !== 'string' || !TAG.test(tag)) return { fallback: `unexpected release tag ${shown(tag)}` };
  const published = typeof json.published_at === 'string' && PUBLISHED_AT.test(json.published_at)
    ? Date.parse(json.published_at)
    : Number.NaN;
  if (Number.isNaN(published)) return { fallback: `unexpected published_at ${shown(json.published_at)}` };

  const version = tag.slice(1);
  const prefix = `https://github.com/${slug}/releases/download/${tag}/`;
  const assets = Array.isArray(json.assets) ? json.assets : [];
  const asset = (name) => {
    const found = assets.find((a) => a?.name === name);
    const url = found?.browser_download_url;
    if (typeof url !== 'string' || !url.startsWith(prefix)) return null;
    const size = Number.isSafeInteger(found.size) && found.size >= 0 ? found.size : null;
    return { url, size };
  };

  const zipName = `rebeep-${version}.zip`;
  const floppyName = `rebeep-${version}-floppy.img`;
  const zip = asset(zipName);
  const floppy = asset(floppyName);
  if (!zip || zip.size === null) return { fallback: `the release has no usable ${zipName}` };
  if (!floppy || floppy.size === null) return { fallback: `the release has no usable ${floppyName}` };
  const sums = asset(SUMS_NAME);

  return {
    release: {
      tag,
      version,
      date: new Date(published).toISOString().slice(0, 10),
      zip,
      floppy,
      sums: sums ? { url: sums.url } : null,
    },
  };
}

/**
 * Reads the latest release of `slug` from the GitHub API and validates it. Returns `{ release }` or
 * `{ fallback: reason }`; a network error, an HTTP error, a timeout or a release that fails
 * validation never throws. The token goes only to the default api.github.com.
 */
export async function readLatestRelease({ slug, apiBase = DEFAULT_API_BASE, token, timeoutMs = 10000 }) {
  const base = apiBase.replace(/\/+$/, '');
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'rebeep-site',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token && base === DEFAULT_API_BASE) headers.Authorization = `Bearer ${token}`;

  let json;
  try {
    const res = await fetch(`${base}/repos/${slug}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { fallback: `${base} answered HTTP ${res.status}` };
    json = await res.json();
  } catch (err) {
    if (err?.name === 'TimeoutError') return { fallback: `${base} did not answer within ${timeoutMs} ms` };
    if (err instanceof SyntaxError) return { fallback: `${base} sent a response that is not JSON` };
    return { fallback: `cannot reach ${base} (${err?.cause?.code ?? err?.message ?? 'network error'})` };
  }
  return validateRelease(json, slug);
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for HTML content and double- or single-quoted attributes. */
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** `2026-11-21` as `21 Nov 2026`. */
function formatDate(date) {
  const [year, month, day] = date.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

function releaseLines(release) {
  const file = (asset, label) => {
    const size = asset.size === undefined ? '' : ` <span class="release__size">${formatBytes(asset.size)}</span>`;
    return `  <a class="release__file" href="${escapeHtml(asset.url)}">${label}${size}</a>`;
  };
  const dot = '  <span class="release__dot" aria-hidden="true">·</span>';
  return [
    '<p class="release" data-release="stamped">',
    `  <span class="release__version">${escapeHtml(release.tag)}</span>`,
    dot,
    `  <time class="release__date" datetime="${escapeHtml(release.date)}">${escapeHtml(formatDate(release.date))}</time>`,
    dot,
    file(release.zip, 'Zip'),
    file(release.floppy, 'Floppy image'),
    ...(release.sums ? [file(release.sums, 'Checksums')] : []),
    '</p>',
  ];
}

function indexesOf(text, needle) {
  const found = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) found.push(at);
  return found;
}

/**
 * Replaces what sits between the release markers with the stamped release line, indented like the
 * start marker; the markers stay. Without a `release` the html is returned as written. Throws a
 * `CliError` unless there is exactly one start marker followed by one end marker.
 */
export function stampRelease(html, release = null) {
  const starts = indexesOf(html, START_MARKER);
  const ends = indexesOf(html, END_MARKER);
  if (starts.length !== 1 || ends.length !== 1) {
    throw new CliError(
      `index.html needs exactly one release marker pair, found ${starts.length} ${START_MARKER} and ${ends.length} ${END_MARKER}`,
      { hint: 'Keep one pair of release markers in the hero, with the fallback link between them.' },
    );
  }
  const [start] = starts;
  const [end] = ends;
  if (end < start) throw new CliError(`${END_MARKER} comes before ${START_MARKER} in index.html`);
  if (!release) return html;

  const before = html.slice(html.lastIndexOf('\n', start) + 1, start);
  const indent = /^[ \t]*/.exec(before)[0];
  const body = releaseLines(release).map((line) => `${indent}${line}`).join('\n');
  return `${html.slice(0, start + START_MARKER.length)}\n${body}\n${indent}${html.slice(end)}`;
}

/** Fails clearly when the repo has no `site/` folder or the folder has no `index.html`. */
export function requireSite(repo) {
  const isDir = fs.existsSync(repo.site) && fs.statSync(repo.site).isDirectory();
  if (!isDir) {
    throw new CliError(`there is no site/ folder at ${repo.site}`, {
      hint: 'Run this from the ReBeep repo, or point REBEEP_REPO_ROOT at it.',
    });
  }
  if (!fs.existsSync(path.join(repo.site, 'index.html'))) {
    throw new CliError(`site/index.html is missing in ${repo.site}`);
  }
}

/**
 * Builds the page into `out` (default `build/site/`): copies `site/` without any `AGENTS.md` to a
 * temp folder, stamps `index.html` with `release` (or leaves its fallback when `release` is null),
 * then swaps the result in, so a failed build leaves the previous output alone. Returns
 * `{ out, stamped }`.
 */
export function buildSite({ repo, release = null, out = repo.siteBuild }) {
  requireSite(repo);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'rebeep-site-'));
  try {
    fs.cpSync(repo.site, stage, { recursive: true, filter: (src) => path.basename(src) !== 'AGENTS.md' });
    const indexFile = path.join(stage, 'index.html');
    const html = fs.readFileSync(indexFile, 'utf8');
    const stamped = stampRelease(html, release);
    if (stamped !== html) fs.writeFileSync(indexFile, stamped);
    replaceDir(stage, out);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  return { out, stamped: Boolean(release) };
}
