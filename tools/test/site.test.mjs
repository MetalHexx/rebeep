import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import vm from 'node:vm';
import { CliError } from '../lib/cli.mjs';
import { createLog } from '../lib/log.mjs';
import { repoLayout } from '../lib/paths.mjs';
import {
  DEFAULT_API_BASE,
  buildSite,
  escapeHtml,
  readLatestRelease,
  readRepoSlug,
  stampRelease,
  validateRelease,
} from '../lib/site.mjs';
import { startSiteServer } from '../lib/siteserve.mjs';
import { DEV_JS } from '../lib/sitedev.mjs';
import { captureStreams, makeTempDir, removeDir, runRebeep } from './helpers.mjs';
import { runRebeepAsync, serve } from './serve.mjs';

const SLUG = 'test-owner/test-repo';
const LATEST = `/repos/${SLUG}/releases/latest`;
const DOWNLOADS = `https://github.com/${SLUG}/releases/download`;

const FALLBACK_BLOCK = `<p class="release" data-release="latest">
  <a class="release__link" href="https://github.com/${SLUG}/releases/latest">See the latest release on GitHub</a>
</p>`;

const INDEX = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fixture</title>
  <link rel="stylesheet" href="css/site.css">
</head>
<body>
  <main>
    <section class="hero">
      <!-- release:start -->
      ${FALLBACK_BLOCK.replaceAll('\n', '\n      ')}
      <!-- release:end -->
    </section>
  </main>
</body>
</html>
`;

const CSS = 'body { color: #f0f0d0; }\n';

/** A release as the GitHub API returns it; `over` replaces top-level fields. */
function releaseJson({ tag = 'v7.8.9', assets, ...over } = {}) {
  const version = tag.slice(1);
  const asset = (name, size) => ({ name, size, browser_download_url: `${DOWNLOADS}/${tag}/${name}` });
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: '2026-11-21T09:30:00Z',
    assets: assets ?? [
      asset(`rebeep-${version}.zip`, 25600),
      asset(`rebeep-${version}-floppy.img`, 1474560),
      asset('SHA256SUMS.txt', 200),
    ],
    ...over,
  };
}

const withoutAsset = (json, name) => ({ ...json, assets: json.assets.filter((a) => a.name !== name) });
const asBody = (json) => Buffer.from(JSON.stringify(json));

/** A temp repo with a package.json that names `SLUG` and a minimal `site/`. */
function makeRepo({ index = INDEX } = {}) {
  const root = makeTempDir('rebeep-site-');
  const pkg = { name: 'rebeep', version: '0.0.0', repository: { type: 'git', url: `https://github.com/${SLUG}.git` } };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2));
  fs.mkdirSync(path.join(root, 'site', 'css'), { recursive: true });
  fs.writeFileSync(path.join(root, 'site', 'index.html'), index);
  fs.writeFileSync(path.join(root, 'site', 'css', 'site.css'), CSS);
  fs.writeFileSync(path.join(root, 'site', 'AGENTS.md'), '# not for the web\n');
  return root;
}

const siteFile = (root, ...parts) => path.join(root, 'site', ...parts);
const builtFile = (root, ...parts) => path.join(root, 'build', 'site', ...parts);
const readBuilt = (root, ...parts) => fs.readFileSync(builtFile(root, ...parts), 'utf8');

/** Every file under `dir`, as one string. */
function readTree(dir) {
  return fs
    .readdirSync(dir, { recursive: true })
    .map((rel) => path.join(dir, rel))
    .filter((file) => fs.statSync(file).isFile())
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
}

/** A server answering every request with `handler`; `close` also drops open connections. */
async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}

async function waitUntil(predicate, what, ms = 10000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

let home;
beforeEach(() => {
  home = makeTempDir('rebeep-home-');
});
afterEach(() => removeDir(home));

const rebeep = (root, args, env = {}) =>
  runRebeepAsync(['site', ...args], { env: { REBEEP_HOME: home, REBEEP_REPO_ROOT: root, ...env } });

describe('site help', () => {
  test('lists the noun, and describes both verbs and their options', () => {
    const noun = runRebeep(['site', '--help']);
    assert.equal(noun.code, 0);
    assert.match(noun.stdout, /\bcreate\b/);
    assert.match(noun.stdout, /\brun\b/);

    const create = runRebeep(['site', 'create', '--help']);
    assert.equal(create.code, 0);
    assert.match(create.stdout, /rebeep site create/);
    assert.match(create.stdout, /--offline/);

    const run = runRebeep(['site', 'run', '--help']);
    assert.equal(run.code, 0);
    assert.match(run.stdout, /--port <n>/);
    assert.match(run.stdout, /--offline/);
  });
});

describe('escapeHtml', () => {
  test('escapes the characters that break out of text and attributes', () => {
    assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    assert.equal(escapeHtml(42), '42');
  });
});

describe('validateRelease', () => {
  const ok = (json) => validateRelease(json, SLUG);

  test('accepts a published release and normalises it', () => {
    const { release } = ok(releaseJson({ published_at: '2026-12-31T23:30:00-05:00' }));
    assert.equal(release.tag, 'v7.8.9');
    assert.equal(release.version, '7.8.9');
    assert.equal(release.date, '2027-01-01', 'the date is the UTC date');
    assert.deepEqual(release.zip, { url: `${DOWNLOADS}/v7.8.9/rebeep-7.8.9.zip`, size: 25600 });
    assert.equal(release.floppy.size, 1474560);
    assert.deepEqual(release.sums, { url: `${DOWNLOADS}/v7.8.9/SHA256SUMS.txt` });
  });

  test('SHA256SUMS.txt is optional', () => {
    assert.equal(ok(withoutAsset(releaseJson(), 'SHA256SUMS.txt')).release.sums, null);
  });

  test('falls back on anything that would half-stamp the page', () => {
    const base = releaseJson();
    const badUrl = (name, url) => ({
      ...base,
      assets: base.assets.map((a) => (a.name === name ? { ...a, browser_download_url: url } : a)),
    });
    const cases = {
      'not an object': null,
      draft: { ...base, draft: true },
      prerelease: { ...base, prerelease: true },
      'hostile tag': releaseJson({ tag: 'v1.0.0<script>' }),
      'tag without v': { ...base, tag_name: '7.8.9' },
      'tag with a suffix': releaseJson({ tag: 'v7.8.9-rc1' }),
      'no date': { ...base, published_at: undefined },
      'bad date': { ...base, published_at: 'last Tuesday' },
      'no zip': withoutAsset(base, 'rebeep-7.8.9.zip'),
      'no floppy': withoutAsset(base, 'rebeep-7.8.9-floppy.img'),
      'zip with no size': { ...base, assets: base.assets.map((a) => (a.name.endsWith('.zip') ? { ...a, size: undefined } : a)) },
      'zip on another host': badUrl('rebeep-7.8.9.zip', 'https://evil.example/rebeep-7.8.9.zip'),
      'floppy from another repo': badUrl('rebeep-7.8.9-floppy.img', 'https://github.com/other/repo/releases/download/v7.8.9/rebeep-7.8.9-floppy.img'),
      'floppy from another tag': badUrl('rebeep-7.8.9-floppy.img', `${DOWNLOADS}/v1.0.0/rebeep-7.8.9-floppy.img`),
    };
    for (const [name, json] of Object.entries(cases)) {
      const result = ok(json);
      assert.equal(result.release, undefined, name);
      assert.equal(typeof result.fallback, 'string', name);
    }
  });

  test('a bad tag is not echoed back whole', () => {
    const { fallback } = ok(releaseJson({ tag: `v1.0.0${'x'.repeat(500)}` }));
    assert.ok(fallback.length < 120);
  });
});

describe('stampRelease', () => {
  const release = validateRelease(releaseJson({ tag: 'v1.0.0' }), SLUG).release;
  const url = (name) => `${DOWNLOADS}/v1.0.0/${name}`;
  const STAMPED = `<!-- release:start -->
<p class="release" data-release="stamped">
  <span class="release__version">v1.0.0</span>
  <span class="release__dot" aria-hidden="true">·</span>
  <time class="release__date" datetime="2026-11-21">21 Nov 2026</time>
  <span class="release__dot" aria-hidden="true">·</span>
  <a class="release__file" href="${url('rebeep-1.0.0.zip')}">Zip <span class="release__size">25 KB</span></a>
  <a class="release__file" href="${url('rebeep-1.0.0-floppy.img')}">Floppy image <span class="release__size">1.4 MB</span></a>
  <a class="release__file" href="${url('SHA256SUMS.txt')}">Checksums</a>
</p>
<!-- release:end -->`;
  const template = (indent = '') => `<!-- release:start -->\n${FALLBACK_BLOCK}\n<!-- release:end -->`
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');

  test('writes the contract markup between the markers', () => {
    assert.equal(stampRelease(template(), release), STAMPED);
  });

  test('indents like the start marker and keeps the text around it', () => {
    const html = `<section>\n${template('      ')}\n</section>\n`;
    const expected = `<section>\n${STAMPED.split('\n').map((l) => `      ${l}`).join('\n')}\n</section>\n`;
    assert.equal(stampRelease(html, release), expected);
  });

  test('leaves out the checksums link when the release has no checksums', () => {
    const stamped = stampRelease(template(), { ...release, sums: null });
    assert.doesNotMatch(stamped, /Checksums/);
    assert.match(stamped, /Floppy image/);
  });

  test('escapes every value', () => {
    const hostile = {
      tag: '<b>v1</b>',
      date: '2026-11-21',
      zip: { url: 'https://x.test/?a=1&b="2"', size: 10 },
      floppy: { url: `https://x.test/'q'<`, size: 10 },
      sums: null,
    };
    const stamped = stampRelease(template(), hostile);
    assert.doesNotMatch(stamped, /<b>|"2"|'q'/);
    assert.match(stamped, /&lt;b&gt;v1&lt;\/b&gt;/);
    assert.match(stamped, /a=1&amp;b=&quot;2&quot;/);
    assert.match(stamped, /&#39;q&#39;&lt;/);
  });

  test('without a release the html is returned as written', () => {
    const html = template('  ');
    assert.equal(stampRelease(html), html);
  });

  test('exactly one marker pair is required, in order', () => {
    const pair = template();
    const cases = {
      'no markers': '<p>nothing here</p>',
      'a lone start marker': '<!-- release:start -->',
      'a lone end marker': '<!-- release:end -->',
      'two pairs': `${pair}\n${pair}`,
      'two start markers': `<!-- release:start -->${pair}`,
      'end before start': '<!-- release:end -->\n<!-- release:start -->',
    };
    for (const [name, html] of Object.entries(cases)) {
      for (const stampWith of [release, null]) {
        assert.throws(() => stampRelease(html, stampWith), CliError, name);
      }
    }
  });
});

describe('readRepoSlug', () => {
  const slugOf = (repository) => {
    const root = makeTempDir('rebeep-slug-');
    try {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ repository }));
      return readRepoSlug({ root });
    } finally {
      removeDir(root);
    }
  };

  test('reads owner/name from the usual repository forms', () => {
    assert.equal(slugOf({ url: 'https://github.com/o/r.git' }), 'o/r');
    assert.equal(slugOf({ url: 'git+https://github.com/o/r.git' }), 'o/r');
    assert.equal(slugOf({ url: 'git@github.com:o/r.git' }), 'o/r');
    assert.equal(slugOf('github:o/r'), 'o/r');
    assert.equal(slugOf('https://github.com/o/my.repo'), 'o/my.repo');
  });

  test('rejects a repository that is missing or not on GitHub', () => {
    assert.throws(() => slugOf(undefined), CliError);
    assert.throws(() => slugOf({ url: 'https://gitlab.com/o/r.git' }), CliError);
  });
});

describe('readLatestRelease', () => {
  test('returns the validated release', async () => {
    const api = await serve({ [LATEST]: asBody(releaseJson()) });
    try {
      const found = await readLatestRelease({ slug: SLUG, apiBase: api.base });
      assert.equal(found.release.tag, 'v7.8.9');
      assert.deepEqual(api.hits, [LATEST]);
    } finally {
      await api.close();
    }
  });

  test('falls back instead of throwing on an HTTP error, bad JSON or a failed validation', async () => {
    const bodies = {
      '/status500': () => ({ status: 500, body: 'boom' }),
      '/notjson': () => ({ status: 200, body: 'not json' }),
      '/draft': () => ({ status: 200, body: JSON.stringify(releaseJson({ draft: true })) }),
    };
    const api = await listen((req, res) => {
      const { status, body } = bodies[req.url.split('/repos')[0]]();
      res.writeHead(status);
      res.end(body);
    });
    try {
      for (const prefix of Object.keys(bodies)) {
        const found = await readLatestRelease({ slug: SLUG, apiBase: `${api.base}${prefix}` });
        assert.equal(found.release, undefined, prefix);
        assert.equal(typeof found.fallback, 'string', prefix);
      }
    } finally {
      await api.close();
    }
  });

  test('falls back when nothing listens', async () => {
    const api = await serve({});
    await api.close();
    const found = await readLatestRelease({ slug: SLUG, apiBase: api.base });
    assert.match(found.fallback, /cannot reach/);
  });

  test('falls back when the API does not answer in time', async () => {
    const api = await listen(() => {});
    try {
      const started = Date.now();
      const found = await readLatestRelease({ slug: SLUG, apiBase: api.base, timeoutMs: 150 });
      assert.match(found.fallback, /did not answer within 150 ms/);
      assert.ok(Date.now() - started < 5000);
    } finally {
      await api.close();
    }
  });

  test('sends the token only to the default api.github.com', async () => {
    const seen = [];
    const realFetch = globalThis.fetch;
    // Stands in for the network, so no request ever leaves the machine.
    globalThis.fetch = async (url, init) => {
      seen.push({ url, authorization: init.headers.Authorization });
      return new Response('{}', { status: 404 });
    };
    try {
      await readLatestRelease({ slug: SLUG, apiBase: DEFAULT_API_BASE, token: 'sekret' });
      await readLatestRelease({ slug: SLUG, apiBase: `${DEFAULT_API_BASE}/`, token: 'sekret' });
      await readLatestRelease({ slug: SLUG, apiBase: 'http://127.0.0.1:1', token: 'sekret' });
      await readLatestRelease({ slug: SLUG });
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.deepEqual(
      seen.map((s) => s.authorization),
      ['Bearer sekret', 'Bearer sekret', undefined, undefined],
    );
    assert.equal(seen[0].url, `${DEFAULT_API_BASE}${LATEST}`);
  });
});

describe('buildSite', () => {
  let root;
  beforeEach(() => {
    root = makeRepo();
  });
  afterEach(() => removeDir(root));

  test('copies site/ without AGENTS.md and stamps index.html', () => {
    const release = validateRelease(releaseJson(), SLUG).release;
    const result = buildSite({ repo: repoLayout(root), release });
    assert.deepEqual(result, { out: path.join(root, 'build', 'site'), stamped: true });
    assert.equal(readBuilt(root, 'css', 'site.css'), CSS);
    assert.equal(fs.existsSync(builtFile(root, 'AGENTS.md')), false);
    assert.match(readBuilt(root, 'index.html'), /data-release="stamped"/);
    assert.equal(fs.readFileSync(siteFile(root, 'index.html'), 'utf8'), INDEX, 'the source is untouched');
  });

  test('fails clearly when there is no site/ folder or no index.html', () => {
    fs.rmSync(siteFile(root, 'index.html'));
    assert.throws(() => buildSite({ repo: repoLayout(root) }), /index\.html is missing/);
    removeDir(siteFile(root));
    assert.throws(() => buildSite({ repo: repoLayout(root) }), /no site\/ folder/);
  });
});

describe('site create', () => {
  let root;
  let api;
  beforeEach(() => {
    root = makeRepo();
  });
  afterEach(async () => {
    removeDir(root);
    await api?.close();
    api = undefined;
  });

  const create = (args = [], env = {}) => rebeep(root, ['create', ...args], env);
  const withApi = async (files) => {
    api = await serve(files);
    return { REBEEP_GITHUB_API: api.base };
  };

  test('stamps the latest release into build/site/index.html', async () => {
    const env = await withApi({ [LATEST]: asBody(releaseJson()) });
    const result = await create([], env);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(api.hits, [LATEST]);
    assert.match(result.stdout, /stamped v7\.8\.9, 2026-11-21/);

    const html = readBuilt(root, 'index.html');
    assert.match(html, /<span class="release__version">v7\.8\.9<\/span>/);
    assert.match(html, /<time class="release__date" datetime="2026-11-21">21 Nov 2026<\/time>/);
    assert.ok(html.includes(`href="${DOWNLOADS}/v7.8.9/rebeep-7.8.9.zip"`));
    assert.ok(html.includes(`href="${DOWNLOADS}/v7.8.9/rebeep-7.8.9-floppy.img"`));
    assert.ok(html.includes(`href="${DOWNLOADS}/v7.8.9/SHA256SUMS.txt"`));
    assert.doesNotMatch(html, /data-release="latest"/);
    assert.equal(fs.existsSync(builtFile(root, 'AGENTS.md')), false);
  });

  test('escapes values that come from the API', async () => {
    const json = releaseJson();
    json.assets[0].browser_download_url += '?a=1&b="2"<i>';
    const env = await withApi({ [LATEST]: asBody(json) });
    const result = await create([], env);
    assert.equal(result.code, 0, result.stderr);
    const html = readBuilt(root, 'index.html');
    assert.ok(html.includes('rebeep-7.8.9.zip?a=1&amp;b=&quot;2&quot;&lt;i&gt;"'));
    assert.doesNotMatch(html, /"2"<i>/);
  });

  test('a release without its floppy image falls back, with no version anywhere', async () => {
    const env = await withApi({ [LATEST]: asBody(withoutAsset(releaseJson(), 'rebeep-7.8.9-floppy.img')) });
    const result = await create([], env);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /warning: .*floppy/);
    const tree = readTree(builtFile(root));
    assert.doesNotMatch(tree, /7\.8\.9/);
    assert.match(tree, /data-release="latest"/);
  });

  test('a hostile tag falls back and nothing it holds reaches the page', async () => {
    const env = await withApi({ [LATEST]: asBody(releaseJson({ tag: 'v1.0.0<script>' })) });
    const result = await create([], env);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /warning:/);
    assert.doesNotMatch(readTree(builtFile(root)), /<script|1\.0\.0/);
  });

  test('an unreachable API falls back with exit 0 and a warning', async () => {
    const env = await withApi({});
    await api.close();
    const result = await create([], env);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /warning: .*cannot reach/);
    assert.match(readBuilt(root, 'index.html'), /data-release="latest"/);
  });

  test('an HTTP error falls back with exit 0 and a warning', async () => {
    const down = await listen((_req, res) => {
      res.writeHead(500);
      res.end('boom');
    });
    try {
      const result = await create([], { REBEEP_GITHUB_API: down.base });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stderr, /warning: .*HTTP 500/);
      assert.match(readBuilt(root, 'index.html'), /data-release="latest"/);
    } finally {
      await down.close();
    }
  });

  test('--offline never calls the API and leaves no version in the output', async () => {
    const env = await withApi({ [LATEST]: asBody(releaseJson()) });
    const result = await create(['--offline', '--json'], env);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(api.hits, []);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.stamped, false);
    assert.equal(envelope.data.fallback, 'offline');
    assert.doesNotMatch(readTree(builtFile(root)), /7\.8\.9/);
    assert.match(readBuilt(root, 'index.html'), /data-release="latest"/);
  });

  test('a missing or doubled marker is an error, and the last build stays', async () => {
    assert.equal((await create(['--offline'])).code, 0);
    const good = readBuilt(root, 'index.html');

    const broken = {
      missing: INDEX.replace('<!-- release:start -->', '').replace('<!-- release:end -->', ''),
      doubled: INDEX.replace('</main>', `${INDEX.match(/<!-- release:start -->[^]*<!-- release:end -->/)[0]}</main>`),
    };
    for (const [name, html] of Object.entries(broken)) {
      fs.writeFileSync(siteFile(root, 'index.html'), html);
      const result = await create(['--offline']);
      assert.equal(result.code, 1, name);
      assert.match(result.stderr, /release marker pair/, name);
      assert.equal(readBuilt(root, 'index.html'), good, name);
    }
  });

  test('fails clearly when the repo has no site/ folder', async () => {
    removeDir(siteFile(root));
    for (const args of [['create', '--offline'], ['run', '--offline']]) {
      const result = await rebeep(root, args);
      assert.equal(result.code, 1, args.join(' '));
      assert.match(result.stderr, /no site\/ folder/);
    }
  });
});

describe('site run', () => {
  let root;
  beforeEach(() => {
    root = makeRepo();
  });
  afterEach(() => removeDir(root));

  test('rejects a port that is not a number', async () => {
    const result = await rebeep(root, ['run', '--offline', '--port', 'eighty']);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /--port must be a whole number/);
  });

  test('a port that is in use fails with a --port hint', async () => {
    const busy = await listen((_req, res) => res.end());
    try {
      const port = new URL(busy.base).port;
      const result = await rebeep(root, ['run', '--offline', '--port', port]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, new RegExp(`port ${port} is already in use`));
      assert.match(result.stderr, /--port/);
    } finally {
      await busy.close();
    }
  });
});

/** One raw HTTP request; the path is sent exactly as given, so traversal forms are not tidied away. */
function request(port, requestPath, { method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Opens the preview's event stream and collects what it sends. */
function openEvents(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/rebeep/__dev/events', agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (text += chunk));
      resolve({
        status: res.statusCode,
        headers: res.headers,
        text: () => text,
        reloads: () => text.split('event: reload\n').length - 1,
        ended: new Promise((done) => res.on('close', done)),
        destroy: () => req.destroy(),
      });
    });
    req.on('error', reject);
  });
}

describe('the dev server', () => {
  let root;
  let preview;
  let streams;
  let opened;

  beforeEach(async () => {
    root = makeRepo();
    streams = captureStreams();
    const log = createLog({ stdout: streams.stdout, stderr: streams.stderr });
    preview = await startSiteServer({ repo: repoLayout(root), port: 0, log, debounceMs: 20 });
    opened = [];
  });
  afterEach(async () => {
    for (const events of opened) events.destroy();
    await preview.close();
    removeDir(root);
  });

  const events = async () => {
    const stream = await openEvents(preview.port);
    opened.push(stream);
    await waitUntil(() => stream.text().includes('retry:'), 'the event stream to open');
    return stream;
  };

  test('serves the page under /rebeep/ on 127.0.0.1, uncached', async () => {
    assert.equal(preview.url, `http://127.0.0.1:${preview.port}/rebeep/`);
    const page = await request(preview.port, '/rebeep/');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /^text\/html/);
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.match(page.body, /<title>Fixture<\/title>/);

    const css = await request(preview.port, '/rebeep/css/site.css');
    assert.equal(css.status, 200);
    assert.match(css.headers['content-type'], /^text\/css/);
    assert.equal(css.headers['cache-control'], 'no-store');
    assert.equal(css.body, CSS);

    const index = await request(preview.port, '/rebeep/index.html');
    assert.equal(index.body, page.body);
  });

  test('redirects / and /rebeep to /rebeep/', async () => {
    for (const from of ['/', '/rebeep']) {
      const res = await request(preview.port, from);
      assert.equal(res.status, 302, from);
      assert.equal(res.headers.location, '/rebeep/', from);
    }
  });

  test('answers 404 for unknown files and 405 for anything but GET and HEAD', async () => {
    assert.equal((await request(preview.port, '/rebeep/nope.html')).status, 404);
    assert.equal((await request(preview.port, '/elsewhere')).status, 404);
    assert.equal((await request(preview.port, '/rebeep/__dev/unknown')).status, 404);
    assert.equal((await request(preview.port, '/rebeep/', { method: 'POST' })).status, 405);
    const head = await request(preview.port, '/rebeep/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
  });

  test('never serves anything outside build/site/, however the path is written', async () => {
    fs.mkdirSync(path.join(root, 'build', 'site-secret'));
    fs.writeFileSync(path.join(root, 'build', 'site-secret', 'x.txt'), 'SIBLING-SECRET');
    const attempts = [
      '/rebeep/../package.json',
      '/rebeep/css/../../package.json',
      '/rebeep/%2e%2e/package.json',
      '/rebeep/%2E%2E/%2E%2E/package.json',
      '/rebeep/..%2fpackage.json',
      '/rebeep/%2e%2e%2f%2e%2e%2fpackage.json',
      '/rebeep/..%5cpackage.json',
      '/rebeep/%252e%252e/package.json',
      '/rebeep/../site-secret/x.txt',
      '/rebeep/..%2fsite-secret%2fx.txt',
      '/rebeep/%00',
      '/rebeep/%zz',
    ];
    for (const attempt of attempts) {
      const res = await request(preview.port, attempt);
      assert.equal(res.status, 404, attempt);
      assert.doesNotMatch(res.body, /SIBLING-SECRET|"name": "rebeep"/, attempt);
    }
  });

  test('injects the dev client into served HTML only, never into the files on disk', async () => {
    const page = await request(preview.port, '/rebeep/');
    const link = '<link rel="stylesheet" href="/rebeep/__dev/dev.css">';
    const script = '<script src="/rebeep/__dev/dev.js" defer></script>';
    assert.ok(page.body.includes(`${link}\n${script}\n</head>`));
    assert.equal(page.body.split('__dev/dev.js').length - 1, 1);

    assert.doesNotMatch(readBuilt(root, 'index.html'), /__dev/);
    assert.doesNotMatch(fs.readFileSync(siteFile(root, 'index.html'), 'utf8'), /__dev/);
    assert.doesNotMatch((await request(preview.port, '/rebeep/css/site.css')).body, /__dev/);
  });

  test('matches </head> case-insensitively and serves html without one untouched', async () => {
    fs.writeFileSync(siteFile(root, 'upper.html'), '<HEAD><TITLE>x</TITLE></HEAD><BODY></BODY>');
    fs.writeFileSync(siteFile(root, 'bare.html'), '<p>no head</p>');
    await waitUntil(
      () => fs.existsSync(builtFile(root, 'upper.html')) && fs.existsSync(builtFile(root, 'bare.html')),
      'the rebuild',
    );

    assert.match((await request(preview.port, '/rebeep/upper.html')).body, /dev\.js" defer><\/script>\n<\/HEAD>/);
    assert.equal((await request(preview.port, '/rebeep/bare.html')).body, '<p>no head</p>');
  });

  test('serves a working dev client', async () => {
    const js = await request(preview.port, '/rebeep/__dev/dev.js');
    assert.equal(js.status, 200);
    assert.match(js.headers['content-type'], /^text\/javascript/);
    assert.equal(js.headers['cache-control'], 'no-store');
    assert.equal(js.body, DEV_JS);
    assert.doesNotThrow(() => new vm.Script(js.body), 'dev.js must be valid JavaScript');

    const css = await request(preview.port, '/rebeep/__dev/dev.css');
    assert.equal(css.status, 200);
    assert.match(css.headers['content-type'], /^text\/css/);
  });

  test('rebuilds and sends reload when a file under site/ changes', async () => {
    const stream = await events();
    assert.equal(stream.status, 200);
    assert.match(stream.headers['content-type'], /^text\/event-stream/);
    assert.equal(stream.headers['cache-control'], 'no-store');

    fs.mkdirSync(siteFile(root, 'js'));
    fs.writeFileSync(siteFile(root, 'js', 'site.js'), 'console.log("hi");\n');
    await waitUntil(() => stream.reloads() >= 1, 'a reload for a new file in a new folder');
    assert.equal((await request(preview.port, '/rebeep/js/site.js')).body, 'console.log("hi");\n');

    const before = stream.reloads();
    fs.writeFileSync(siteFile(root, 'css', 'site.css'), 'body { color: red; }\n');
    await waitUntil(() => readBuilt(root, 'css', 'site.css') === 'body { color: red; }\n', 'the edited file to be rebuilt');
    await waitUntil(() => stream.reloads() > before, 'a reload for an edited file');
    assert.equal((await request(preview.port, '/rebeep/css/site.css')).body, 'body { color: red; }\n');
  });

  test('a failed rebuild is logged and the last good build keeps being served', async () => {
    const stream = await events();
    const good = (await request(preview.port, '/rebeep/')).body;

    fs.writeFileSync(siteFile(root, 'index.html'), INDEX.replace('<!-- release:start -->', ''));
    await waitUntil(() => streams.err().includes('rebuild failed'), 'the failure to be logged');
    assert.match(streams.err(), /release marker pair/);
    assert.equal((await request(preview.port, '/rebeep/')).body, good);
    assert.equal(stream.reloads(), 0);

    fs.writeFileSync(siteFile(root, 'index.html'), INDEX.replace('Fixture', 'Fixed'));
    await waitUntil(() => stream.reloads() >= 1, 'a reload once the page is fixed');
    assert.match((await request(preview.port, '/rebeep/')).body, /<title>Fixed<\/title>/);
  });

  test('close() ends open event streams and frees the port, and may be called twice', async () => {
    const stream = await events();
    const closing = preview.close();
    await stream.ended;
    await closing;
    await preview.close();
    await assert.rejects(request(preview.port, '/rebeep/'), { code: 'ECONNREFUSED' });
    fs.writeFileSync(siteFile(root, 'css', 'site.css'), '/* after close */\n');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.doesNotMatch(readBuilt(root, 'css', 'site.css'), /after close/, 'the watcher is closed');
  });
});

describe('startSiteServer', () => {
  test('a burst of saves, as an editor makes them, rebuilds once', async () => {
    const root = makeRepo();
    const streams = captureStreams();
    const preview = await startSiteServer({
      repo: repoLayout(root),
      port: 0,
      log: createLog({ stdout: streams.stdout, stderr: streams.stderr }),
    });
    try {
      const stream = await openEvents(preview.port);
      await waitUntil(() => stream.text().includes('retry:'), 'the event stream to open');
      for (let i = 0; i < 5; i++) fs.writeFileSync(siteFile(root, 'css', 'site.css'), `/* ${i} */\n`);
      await waitUntil(() => stream.reloads() >= 1, 'the rebuild');
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(stream.reloads(), 1);
      assert.equal(readBuilt(root, 'css', 'site.css'), '/* 4 */\n');
      stream.destroy();
    } finally {
      await preview.close();
      removeDir(root);
    }
  });

  test('stamps the release it is given and keeps stamping it on every rebuild', async () => {
    const root = makeRepo();
    const streams = captureStreams();
    const release = validateRelease(releaseJson(), SLUG).release;
    const preview = await startSiteServer({
      repo: repoLayout(root),
      release,
      port: 0,
      log: createLog({ stdout: streams.stdout, stderr: streams.stderr }),
      debounceMs: 20,
    });
    try {
      assert.equal(preview.stamped, true);
      assert.match((await request(preview.port, '/rebeep/')).body, /v7\.8\.9/);
      const stream = await openEvents(preview.port);
      await waitUntil(() => stream.text().includes('retry:'), 'the event stream to open');
      fs.writeFileSync(siteFile(root, 'index.html'), INDEX.replace('Fixture', 'Edited'));
      await waitUntil(() => stream.reloads() >= 1, 'the rebuild');
      const page = (await request(preview.port, '/rebeep/')).body;
      assert.match(page, /<title>Edited<\/title>/);
      assert.match(page, /v7\.8\.9/);
      stream.destroy();
    } finally {
      await preview.close();
      removeDir(root);
    }
  });

  test('a taken port is a CliError that names --port, and nothing is left running', async () => {
    const root = makeRepo();
    const busy = await listen((_req, res) => res.end());
    try {
      const port = Number(new URL(busy.base).port);
      const log = createLog({ stdout: captureStreams().stdout, stderr: captureStreams().stderr });
      await assert.rejects(startSiteServer({ repo: repoLayout(root), port, log }), (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /already in use/);
        assert.match(err.hint, /--port/);
        return true;
      });
    } finally {
      await busy.close();
      removeDir(root);
    }
  });
});
