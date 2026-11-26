import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './cli.mjs';
import { END_MARKER, START_MARKER } from './site.mjs';

/** The repo guard's per-file limit. */
export const FILE_LIMIT_BYTES = 1024 * 1024;
/** The whole built folder must stay under this, so the page stays light. */
export const BUDGET_BYTES = 500 * 1024;

const TEXT_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.xml', '.webmanifest']);
const CODE_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs']);
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const extOf = (rel) => path.posix.extname(rel).toLowerCase();

/**
 * Reads every file under `dir` into `[{ rel, size, text }]`, `rel` with forward slashes. `text` is
 * the file as UTF-8 for text types and null for anything else (images, fonts).
 */
export function readSiteFiles(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new CliError(`there is no build at ${dir}`, { hint: 'Run `rebeep site create` first.' });
  }
  return fs
    .readdirSync(dir, { recursive: true })
    .map((rel) => String(rel).split(path.sep).join('/'))
    .filter((rel) => fs.statSync(path.join(dir, rel)).isFile())
    .sort()
    .map((rel) => {
      const full = path.join(dir, rel);
      return {
        rel,
        size: fs.statSync(full).size,
        text: TEXT_EXTENSIONS.has(extOf(rel)) ? fs.readFileSync(full, 'utf8') : null,
      };
    });
}

// ---- A small HTML tokenizer: tags and attributes, nothing more ----------------------------------

const COMMENT = /<!--[\s\S]*?-->/g;
const RAW_TEXT = /(<(script|style)\b[^>]*>)[\s\S]*?(<\/\2\s*>)/gi;
const TAG = /<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Every start tag as `{ name, attrs, text }`: `name` lower-case, `attrs` a Map of lower-case name to value. */
export function parseTags(html) {
  const source = html.replace(COMMENT, '').replace(RAW_TEXT, '$1$3');
  const tags = [];
  for (const m of source.matchAll(TAG)) {
    const attrs = new Map();
    for (const a of m[2].matchAll(ATTR)) {
      const name = a[1].toLowerCase();
      if (!attrs.has(name)) attrs.set(name, a[2] ?? a[3] ?? a[4] ?? '');
    }
    tags.push({ name: m[1].toLowerCase(), attrs, at: m.index, end: m.index + m[0].length, source });
  }
  return tags;
}

/** The text between a tag's end and the next `<`, trimmed (enough for `<title>`). */
const textAfter = (tag) => {
  const next = tag.source.indexOf('<', tag.end);
  return tag.source.slice(tag.end, next < 0 ? undefined : next).trim();
};

// ---- Links ---------------------------------------------------------------------------------------

const isExternal = (url) => SCHEME.test(url) || url.startsWith('//');

/** Local references a tag makes: `src`, `href` and every `srcset` candidate. */
function references(tag) {
  const urls = [];
  for (const name of ['src', 'href']) if (tag.attrs.has(name)) urls.push(tag.attrs.get(name).trim());
  if (tag.attrs.has('srcset')) {
    for (const candidate of tag.attrs.get('srcset').split(',')) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) urls.push(url);
    }
  }
  return urls.filter((url) => url !== '' && !url.startsWith('#') && !isExternal(url));
}

/**
 * Why `url`, written in the file `from`, does not resolve in `paths` (a Set of built files), or null
 * when it does. The query and fragment are dropped; a directory resolves to its `index.html`.
 */
function unresolved(url, from, paths) {
  const bare = url.split('#')[0].split('?')[0];
  if (bare === '') return null;
  if (bare.startsWith('/')) return 'is root-absolute, which breaks when the page is served under /rebeep/';
  let decoded = bare;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    // keep the raw text: a bad escape simply will not match a file
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), decoded));
  if (resolved === '..' || resolved.startsWith('../')) return 'points outside the build';
  let target = resolved.replace(/\/$/, '');
  if (target === '.') target = '';
  const index = target === '' ? 'index.html' : `${target}/index.html`;
  if (!decoded.endsWith('/') && target !== '' && paths.has(target)) return null;
  return paths.has(index) ? null : 'does not exist in the build';
}

/** Local `url(...)` references in CSS, other than data URIs and fragments. */
function cssReferences(css) {
  const urls = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) {
    const url = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (url !== '' && !url.startsWith('#') && !isExternal(url)) urls.push(url);
  }
  return urls;
}

// ---- The checks ----------------------------------------------------------------------------------

const HTTP_URL = /http:\/\/(?!www\.w3\.org\/)[^\s"'<>)]*/gi;

/** One entry per check: `{ id, title, run(ctx) -> string[] }`, a problem per string; none means pass. */
const CHECKS = [
  {
    id: 'entry',
    title: 'index.html is in the build',
    run: ({ paths }) => (paths.has('index.html') ? [] : ['index.html is missing']),
  },
  {
    id: 'weight',
    title: `every file is under 1 MiB and the folder under ${kb(BUDGET_BYTES)}`,
    run: ({ files }) => {
      const problems = files
        .filter((f) => f.size >= FILE_LIMIT_BYTES)
        .map((f) => `${f.rel} is ${kb(f.size)}, over the 1 MiB file limit`);
      const total = files.reduce((sum, f) => sum + f.size, 0);
      if (total > BUDGET_BYTES) problems.push(`the build is ${kb(total)}, over the ${kb(BUDGET_BYTES)} budget`);
      return problems;
    },
  },
  {
    id: 'links',
    title: 'every local src, href and url() resolves to a built file',
    run: ({ html, css, paths }) => {
      const problems = [];
      for (const page of html) {
        for (const tag of page.tags) {
          for (const url of references(tag)) {
            const why = unresolved(url, page.rel, paths);
            if (why) problems.push(`${page.rel}: <${tag.name}> ${url} ${why}`);
          }
        }
      }
      for (const file of css) {
        for (const url of cssReferences(file.text)) {
          const why = unresolved(url, file.rel, paths);
          if (why) problems.push(`${file.rel}: url(${url}) ${why}`);
        }
      }
      return problems;
    },
  },
  {
    id: 'https',
    title: 'no http:// URLs in html, css or js (https only)',
    run: ({ code }) =>
      code.flatMap((f) => [...f.text.matchAll(HTTP_URL)].map((m) => `${f.rel}: ${m[0].slice(0, 80)}`)),
  },
  {
    id: 'alt',
    title: 'every <img> has an alt attribute',
    run: ({ html }) =>
      html.flatMap((page) =>
        page.tags
          .filter((t) => t.name === 'img' && !t.attrs.has('alt'))
          .map((t) => `${page.rel}: <img src="${t.attrs.get('src') ?? ''}"> has no alt`),
      ),
  },
  {
    id: 'h1',
    title: 'exactly one <h1> per page',
    run: ({ html }) =>
      html.flatMap((page) => {
        const count = page.tags.filter((t) => t.name === 'h1').length;
        return count === 1 ? [] : [`${page.rel}: ${count} <h1> elements`];
      }),
  },
  {
    id: 'csp',
    title: 'a Content-Security-Policy <meta> is present',
    run: ({ html }) =>
      html
        .filter(
          (page) =>
            !page.tags.some(
              (t) =>
                t.name === 'meta' &&
                t.attrs.get('http-equiv')?.trim().toLowerCase() === 'content-security-policy' &&
                (t.attrs.get('content') ?? '').trim() !== '',
            ),
        )
        .map((page) => `${page.rel}: no Content-Security-Policy meta`),
  },
  {
    id: 'dev',
    title: 'no __dev reference (the dev-server injection never ships)',
    run: ({ files }) => files.filter((f) => f.text?.includes('__dev')).map((f) => `${f.rel} mentions __dev`),
  },
  {
    id: 'markers',
    title: 'release markers each appear exactly once in index.html',
    run: ({ files }) => {
      const index = files.find((f) => f.rel === 'index.html');
      if (!index) return [];
      const count = (needle) => index.text.split(needle).length - 1;
      const problems = [];
      for (const marker of [START_MARKER, END_MARKER]) {
        if (count(marker) !== 1) problems.push(`index.html has ${count(marker)} of ${marker}, expected 1`);
      }
      if (problems.length === 0 && index.text.indexOf(END_MARKER) < index.text.indexOf(START_MARKER)) {
        problems.push(`${END_MARKER} comes before ${START_MARKER}`);
      }
      return problems;
    },
  },
  {
    id: 'head',
    title: '<html lang>, <title> and <meta name="description"> are present',
    run: ({ html }) =>
      html.flatMap((page) => {
        const problems = [];
        const root = page.tags.find((t) => t.name === 'html');
        if (!root?.attrs.get('lang')?.trim()) problems.push(`${page.rel}: <html> has no lang`);
        const title = page.tags.find((t) => t.name === 'title');
        if (!title || textAfter(title) === '') problems.push(`${page.rel}: no <title>`);
        const described = page.tags.some(
          (t) => t.name === 'meta' && t.attrs.get('name')?.toLowerCase() === 'description' && (t.attrs.get('content') ?? '').trim() !== '',
        );
        if (!described) problems.push(`${page.rel}: no <meta name="description">`);
        return problems;
      }),
  },
  {
    id: 'noopener',
    title: 'external target="_blank" links have rel="noopener"',
    run: ({ html }) =>
      html.flatMap((page) =>
        page.tags
          .filter((t) => t.attrs.get('target')?.trim().toLowerCase() === '_blank')
          .filter((t) => isExternal((t.attrs.get('href') ?? '').trim()))
          .filter((t) => !(t.attrs.get('rel') ?? '').toLowerCase().split(/\s+/).includes('noopener'))
          .map((t) => `${page.rel}: ${t.attrs.get('href')} opens a new tab without rel="noopener"`),
      ),
  },
];

/**
 * Runs every check over `files` (from `readSiteFiles`). Every check runs, so every failure is
 * reported. Returns `{ ok, checks: [{ id, title, ok, problems }], files, bytes }`.
 */
export function checkSite(files) {
  const withText = files.filter((f) => f.text !== null);
  const html = withText
    .filter((f) => extOf(f.rel) === '.html')
    .map((f) => ({ rel: f.rel, text: f.text, tags: parseTags(f.text) }));
  const ctx = {
    files,
    paths: new Set(files.map((f) => f.rel)),
    html,
    css: withText.filter((f) => extOf(f.rel) === '.css'),
    code: withText.filter((f) => CODE_EXTENSIONS.has(extOf(f.rel))),
  };
  const checks = CHECKS.map(({ id, title, run }) => {
    const problems = run(ctx);
    return { id, title, ok: problems.length === 0, problems };
  });
  return {
    ok: checks.every((c) => c.ok),
    checks,
    files: files.length,
    bytes: files.reduce((sum, f) => sum + f.size, 0),
  };
}

/** `readSiteFiles` then `checkSite` for the build folder `dir`. */
export const checkSiteDir = (dir) => checkSite(readSiteFiles(dir));
