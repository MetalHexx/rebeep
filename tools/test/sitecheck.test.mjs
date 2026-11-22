import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { BUDGET_BYTES, checkSiteDir, parseTags } from '../lib/sitecheck.mjs';
import { makeTempDir, removeDir, runRebeep } from './helpers.mjs';

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`;

const INDEX = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${CSP}
  <title>Fixture page</title>
  <meta name="description" content="A fixture.">
  <link rel="stylesheet" href="css/site.css?v=1">
  <link rel="icon" href="./img/icon.png">
  <script src="js/site.js" defer></script>
</head>
<body>
  <!-- <img src="commented-out.png"> -->
  <h1>Fixture</h1>
  <a href="#main">Skip</a>
  <a href="./">Home</a>
  <a href="docs/">Docs</a>
  <a href="docs/page.html#top">Page</a>
  <a href="mailto:someone@example.test">Mail</a>
  <a href="https://example.test/" target="_blank" rel="noreferrer noopener">Out</a>
  <a href="https://example.test/same-tab">Same tab</a>
  <img src="img/icon.png" alt="">
  <picture><source srcset="img/icon.webp 1x, img/icon.png 2x" type="image/webp"><img src="img/icon.png" alt="Icon"></picture>
  <svg xmlns="http://www.w3.org/2000/svg"></svg>
  <!-- release:start -->
  <p>latest</p>
  <!-- release:end -->
  <script>var a = "<a href='nowhere.html'>";</script>
</body>
</html>
`;

const SUBPAGE = `<!doctype html>
<html lang="en"><head>${CSP}<title>Docs</title><meta name="description" content="Docs."></head>
<body><h1>Docs</h1><a href="../">Back</a><a href="page.html">Self</a></body></html>
`;

const goodFiles = () => ({
  'index.html': INDEX,
  'docs/index.html': SUBPAGE,
  'docs/page.html': SUBPAGE,
  'css/site.css': `@font-face { src: url("../fonts/f.woff") } .a { background: url(data:image/png;base64,AAAA) }\n`,
  'js/site.js': 'console.log("https://example.test/");\n',
  'img/icon.png': Buffer.from([1, 2, 3]),
  'img/icon.webp': Buffer.from([4, 5]),
  'fonts/f.woff': Buffer.from([6]),
});

describe('parseTags', () => {
  test('reads quoted, single-quoted and bare attributes and skips comments and script bodies', () => {
    const tags = parseTags(`<!-- <b> --><A HREF='x y' data-n=3 hidden><script>"<i>"</script><br/>`);
    assert.deepEqual(
      tags.map((t) => t.name),
      ['a', 'script', 'br'],
    );
    assert.equal(tags[0].attrs.get('href'), 'x y');
    assert.equal(tags[0].attrs.get('data-n'), '3');
    assert.equal(tags[0].attrs.get('hidden'), '');
  });

  test('a > inside a quoted attribute does not end the tag', () => {
    const [tag] = parseTags('<a title="a > b" href="x">');
    assert.equal(tag.attrs.get('href'), 'x');
  });
});

describe('checkSiteDir', () => {
  let dir;
  beforeEach(() => {
    dir = makeTempDir('rebeep-sitecheck-');
  });
  afterEach(() => removeDir(dir));

  /** Writes the good site with `over` applied (null removes a file) and returns the report. */
  const failing = (over = {}) => {
    removeDir(dir);
    dir = makeTempDir('rebeep-sitecheck-');
    const files = { ...goodFiles(), ...over };
    for (const [rel, body] of Object.entries(files)) {
      if (body === null) continue;
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), body);
    }
    return checkSiteDir(dir);
  };
  const failedIds = (report) => report.checks.filter((c) => !c.ok).map((c) => c.id);
  const problemsOf = (report, id) => report.checks.find((c) => c.id === id).problems.join('\n');
  const index = (edit) => ({ 'index.html': edit(INDEX) });

  test('a good site passes every check', () => {
    const report = failing();
    assert.deepEqual(failedIds(report), []);
    assert.equal(report.ok, true);
    assert.equal(report.checks.length, 11);
  });

  test('a missing build is an error that says to run site create', () => {
    assert.throws(
      () => checkSiteDir(path.join(dir, 'nope')),
      (err) => /no build/.test(err.message) && /site create/.test(err.hint),
    );
  });

  test('entry: no index.html', () => {
    assert.ok(failedIds(failing({ 'index.html': null })).includes('entry'));
  });

  test('weight: a file over 1 MiB, and a folder over the budget', () => {
    const big = failing({ 'img/big.bin': Buffer.alloc(1024 * 1024) });
    assert.deepEqual(failedIds(big), ['weight']);
    assert.match(problemsOf(big, 'weight'), /img\/big\.bin .*1 MiB/);
    assert.match(problemsOf(big, 'weight'), /budget/);

    const heavy = failing({ 'img/heavy.bin': Buffer.alloc(BUDGET_BYTES) });
    assert.deepEqual(failedIds(heavy), ['weight']);
    assert.doesNotMatch(problemsOf(heavy, 'weight'), /1 MiB/);
  });

  test('links: broken src, href, srcset and css url() are all reported; fragments, mailto and https are not', () => {
    const report = failing({
      ...index((h) =>
        h
          .replace('js/site.js', 'js/missing.js')
          .replace('href="docs/"', 'href="nodocs/"')
          .replace('img/icon.webp 1x', 'img/gone.webp 1x')
          .replace('</body>', '<a href="/abs.html">x</a><a href="../up.html">y</a></body>'),
      ),
      'css/site.css': '.a { background: url(../img/nope.png) }',
    });
    assert.deepEqual(failedIds(report), ['links']);
    const text = problemsOf(report, 'links');
    for (const bad of ['js/missing.js', 'nodocs/', 'img/gone.webp', '/abs.html', '../up.html', 'url(../img/nope.png)']) {
      assert.ok(text.includes(bad), `${bad} in:\n${text}`);
    }
    assert.match(text, /root-absolute/);
    assert.equal(report.checks.find((c) => c.id === 'links').problems.length, 6);
  });

  test('links: a directory without a trailing slash resolves when it has an index.html', () => {
    assert.deepEqual(failedIds(failing(index((h) => h.replace('href="docs/"', 'href="docs"')))), []);
  });

  test('links: resolves relative to the page that holds the link, and is case-sensitive', () => {
    const report = failing({ 'docs/index.html': SUBPAGE.replace('page.html', 'Page.html') });
    assert.match(problemsOf(report, 'links'), /docs\/index\.html: <a> Page\.html/);
  });

  test('https: an http:// URL fails in html, css and js, but the w3.org namespace passes', () => {
    const report = failing({
      ...index((h) => h.replace('</body>', '<a href="http://example.test/a">x</a></body>')),
      'css/site.css': '.a { background: url(http://example.test/b.png) }',
      'js/site.js': 'fetch("http://example.test/c")',
    });
    assert.ok(failedIds(report).includes('https'));
    const text = problemsOf(report, 'https');
    for (const file of ['index.html', 'css/site.css', 'js/site.js']) assert.ok(text.includes(file), text);
    assert.doesNotMatch(text, /w3\.org/);
  });

  test('alt: an img without alt fails, an empty alt does not', () => {
    const report = failing(index((h) => h.replace('<h1>', '<img src="img/icon.png"><h1>')));
    assert.deepEqual(failedIds(report), ['alt']);
    assert.match(problemsOf(report, 'alt'), /index\.html/);
  });

  test('h1: none and two both fail', () => {
    assert.deepEqual(failedIds(failing(index((h) => h.replace(/<h1>.*<\/h1>/, '')))), ['h1']);
    const two = failing(index((h) => h.replace('</body>', '<h1 class="x">Two</h1></body>')));
    assert.deepEqual(failedIds(two), ['h1']);
    assert.match(problemsOf(two, 'h1'), /2 <h1>/);
  });

  test('csp: a missing or empty Content-Security-Policy meta fails', () => {
    assert.deepEqual(failedIds(failing(index((h) => h.replace(CSP, '')))), ['csp']);
    assert.deepEqual(failedIds(failing(index((h) => h.replace("default-src 'self'", '')))), ['csp']);
  });

  test('dev: a __dev reference fails in any text file', () => {
    const report = failing({ 'js/site.js': 'new EventSource("/__dev/events")' });
    assert.deepEqual(failedIds(report), ['dev']);
    assert.match(problemsOf(report, 'dev'), /js\/site\.js/);
    const inHtml = failing(index((h) => h.replace('</body>', '<script src="/__dev.js"></script></body>')));
    assert.ok(failedIds(inHtml).includes('dev'));
  });

  test('markers: a missing, doubled or reversed marker fails', () => {
    const swapped = (h) =>
      h.replace('<!-- release:start -->', '<!-- release:TMP -->')
        .replace('<!-- release:end -->', '<!-- release:start -->')
        .replace('<!-- release:TMP -->', '<!-- release:end -->');
    for (const edit of [
      (h) => h.replace('<!-- release:start -->', ''),
      (h) => h.replace('<!-- release:end -->', '<!-- release:end --><!-- release:end -->'),
      swapped,
    ]) {
      assert.deepEqual(failedIds(failing(index(edit))), ['markers'], edit.toString());
    }
  });

  test('head: no lang, no title or no description fails, each on its own', () => {
    const lang = failing(index((h) => h.replace(' lang="en"', '')));
    assert.deepEqual(failedIds(lang), ['head']);
    assert.match(problemsOf(lang, 'head'), /no lang/);
    const title = failing(index((h) => h.replace('<title>Fixture page</title>', '<title></title>')));
    assert.deepEqual(failedIds(title), ['head']);
    assert.match(problemsOf(title, 'head'), /no <title>/);
    const description = failing(index((h) => h.replace(/<meta name="description"[^>]*>/, '')));
    assert.deepEqual(failedIds(description), ['head']);
    assert.match(problemsOf(description, 'head'), /no <meta name="description">/);
  });

  test('noopener: external target=_blank needs it; local links are left alone', () => {
    const bad = failing(index((h) => h.replace('rel="noreferrer noopener"', 'rel="noreferrer"')));
    assert.deepEqual(failedIds(bad), ['noopener']);
    assert.deepEqual(failedIds(failing(index((h) => h.replace('rel="noreferrer noopener"', '')))), ['noopener']);
    const local = failing(index((h) => h.replace('</body>', '<a href="docs/" target="_blank">x</a></body>')));
    assert.deepEqual(failedIds(local), []);
  });

  test('every failure is reported, not just the first', () => {
    const report = failing({
      ...index((h) => h.replace(CSP, '').replace('<h1>Fixture</h1>', '')),
      'js/site.js': 'x = "/__dev"',
    });
    assert.deepEqual(failedIds(report).sort(), ['csp', 'dev', 'h1']);
    assert.equal(report.ok, false);
  });
});

describe('site check (CLI)', () => {
  let root;
  let home;
  beforeEach(() => {
    root = makeTempDir('rebeep-sitecheck-repo-');
    home = makeTempDir('rebeep-sitecheck-home-');
    fs.mkdirSync(path.join(root, 'site'));
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x","version":"0.0.0"}');
  });
  afterEach(() => {
    removeDir(root);
    removeDir(home);
  });
  const check = (...args) =>
    runRebeep(['site', 'check', ...args], { env: { REBEEP_HOME: home, REBEEP_REPO_ROOT: root } });
  const build = (files) => {
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(root, 'build', 'site', rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
  };

  test('help describes the verb', () => {
    const result = runRebeep(['site', 'check', '--help']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /rebeep site check/);
    assert.match(runRebeep(['site', '--help']).stdout, /\bcheck\b/);
  });

  test('fails with a hint when build/site/ is missing', () => {
    const result = check();
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no build/);
    assert.match(result.stderr, /site create/);
  });

  test('prints a pass list and exits 0 on a good build', () => {
    build(goodFiles());
    const result = check();
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /PASS {2}exactly one <h1>/);
    assert.doesNotMatch(result.stdout, /FAIL/);
    assert.match(result.stdout, /11 checks passed/);
  });

  test('lists every failure and exits 1', () => {
    build({ ...goodFiles(), 'index.html': INDEX.replace(CSP, '').replace('<h1>Fixture</h1>', '') });
    const result = check();
    assert.equal(result.code, 1);
    assert.match(result.stdout, /FAIL {2}a Content-Security-Policy/);
    assert.match(result.stdout, /FAIL {2}exactly one <h1>/);
    assert.match(result.stdout, /PASS {2}every <img> has an alt/);
    assert.match(result.stderr, /2 of 11 site checks failed/);
  });

  test('--json reports failure as ok: false with the report', () => {
    build({ ...goodFiles(), 'index.html': INDEX.replace('<h1>Fixture</h1>', '') });
    const result = check('--json');
    assert.equal(result.code, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, false);
    assert.match(JSON.stringify(envelope), /exactly one <h1>/);
  });
});
