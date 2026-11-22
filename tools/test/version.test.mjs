import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { changelogEntries, checkVersions, nextVersion, parseSemver, releaseChangelog } from '../lib/version.mjs';
import { makeTempDir, removeDir, runRebeep } from './helpers.mjs';

const UNRELEASED_ONLY = `# Changelog

## [Unreleased]

### Added

- A new thing.
`;

const WITH_RELEASE = `# Changelog

## [Unreleased]

## [1.2.0] - 2026-02-01

### Added

- Shipped.

## [1.1.0] - 2026-01-01

- Older.

[Unreleased]: https://example.test/compare/v1.2.0...HEAD
`;

describe('parseSemver and nextVersion', () => {
  test('parses X.Y.Z only', () => {
    assert.deepEqual(parseSemver('1.2.3'), { major: 1, minor: 2, patch: 3 });
    for (const bad of ['1.2', '1.2.3-rc1', 'v1.2.3', '', null]) assert.equal(parseSemver(bad), null);
  });

  test('bumps each part and resets the lower ones', () => {
    assert.equal(nextVersion('1.2.3', 'major'), '2.0.0');
    assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0');
    assert.equal(nextVersion('1.2.3', 'patch'), '1.2.4');
  });

  test('an exact version must be newer, or equal only when allowed', () => {
    assert.equal(nextVersion('1.2.3', '1.5.0'), '1.5.0');
    assert.throws(() => nextVersion('1.2.3', '1.2.3'), /not newer/);
    assert.throws(() => nextVersion('1.2.3', '1.2.2', { allowEqual: true }), /not newer/);
    assert.equal(nextVersion('1.2.3', '1.2.3', { allowEqual: true }), '1.2.3');
    assert.throws(() => nextVersion('1.2.3', 'banana'), /major, minor, patch/);
  });
});

describe('changelogEntries', () => {
  test('reads headings, dates and bodies, and drops link references', () => {
    const entries = changelogEntries(WITH_RELEASE);
    assert.deepEqual(
      entries.map((e) => [e.version, e.date]),
      [['Unreleased', null], ['1.2.0', '2026-02-01'], ['1.1.0', '2026-01-01']],
    );
    assert.equal(entries[0].body, '');
    assert.equal(entries[1].body, '### Added\n\n- Shipped.');
    assert.equal(entries[2].body, '- Older.');
  });

  test('flags a heading in neither form with a null version', () => {
    const [entry] = changelogEntries('## Version one\n\ntext\n');
    assert.equal(entry.version, null);
    assert.equal(entry.heading, '## Version one');
  });
});

describe('releaseChangelog', () => {
  test('moves the body under a dated heading and keeps link references', () => {
    const md = WITH_RELEASE.replace('## [Unreleased]\n', '## [Unreleased]\n\n- Fresh.\n');
    const { text, moved } = releaseChangelog(md, '1.3.0', '2026-03-03');
    const entries = changelogEntries(text);
    assert.deepEqual(entries.map((e) => e.version), ['Unreleased', '1.3.0', '1.2.0', '1.1.0']);
    assert.equal(entries[0].body, '');
    assert.equal(entries[1].date, '2026-03-03');
    assert.equal(entries[1].body, '- Fresh.');
    assert.equal(moved, 1);
    assert.ok(text.includes('[Unreleased]: https://example.test'));
  });

  test('refuses an empty [Unreleased]', () => {
    assert.throws(() => releaseChangelog(WITH_RELEASE, '1.3.0', '2026-03-03'), /empty/);
  });

  test('keeps CRLF line endings', () => {
    const { text } = releaseChangelog(UNRELEASED_ONLY.replace(/\n/g, '\r\n'), '1.0.0', '2026-03-03');
    assert.ok(!/(?<!\r)\n/.test(text));
  });
});

describe('checkVersions on a fixture repo', () => {
  let root;
  const repo = () => ({ root });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const track = () => {
    spawnSync('git', ['init', '-q'], { cwd: root });
    spawnSync('git', ['add', '-A'], { cwd: root });
  };
  const setup = ({ version = '1.2.0', changelog = WITH_RELEASE } = {}) => {
    write('package.json', `${JSON.stringify({ name: 'x', version }, null, 2)}\n`);
    write('CHANGELOG.md', changelog);
    write('src/main.asm', '; nothing here\n');
    track();
  };
  const problems = (opts) => checkVersions(repo(), opts).join('\n');

  beforeEach(() => {
    root = makeTempDir('rebeep-version-');
  });
  afterEach(() => removeDir(root));

  test('a consistent repo has no problems', () => {
    setup();
    assert.deepEqual(checkVersions(repo()), []);
    assert.deepEqual(checkVersions(repo(), { release: true, tag: 'v1.2.0' }), []);
  });

  test('an undated version is fine while there are no dated entries', () => {
    setup({ version: '0.1.0', changelog: UNRELEASED_ONLY });
    assert.deepEqual(checkVersions(repo()), []);
    assert.match(problems({ release: true }), /no dated entry for 0\.1\.0/);
  });

  test('a hand-edited version with no entry fails while dated entries exist', () => {
    setup({ version: '1.3.0' });
    assert.match(problems(), /not the newest dated changelog entry \(1\.2\.0\)/);
  });

  test('catches an invalid package version', () => {
    setup({ version: '1.2' });
    assert.match(problems(), /not a valid X\.Y\.Z/);
  });

  test('catches a missing [Unreleased]', () => {
    setup({ changelog: WITH_RELEASE.replace('## [Unreleased]\n', '') });
    assert.match(problems(), /no "## \[Unreleased\]"/);
  });

  test('catches entries out of order', () => {
    setup({ version: '1.0.0', changelog: WITH_RELEASE.replace('[1.2.0] - 2026-02-01', '[1.0.0] - 2026-02-01') });
    assert.match(problems(), /1\.1\.0 is listed after 1\.0\.0/);
  });

  test('catches a malformed heading', () => {
    setup({ changelog: `${WITH_RELEASE}\n## Misc\n` });
    assert.match(problems(), /heading "## Misc"/);
  });

  test('release mode rejects an empty entry, and a tag must match', () => {
    setup({ changelog: WITH_RELEASE.replace('### Added\n\n- Shipped.\n\n', '') });
    assert.match(problems({ release: true }), /entry for 1\.2\.0 is empty/);
    assert.match(problems({ tag: 'v1.2.1' }), /tag v1\.2\.1 does not match/);
  });

  test('catches a hard-coded version and a %define, but not a longer number', () => {
    setup();
    write('docs/page.md', 'Version 1.2.0 ships.\nBuild 11.2.0 and 1.2.01 and 1.2.0.5 are different.\n');
    write('src/v.asm', '%define REBEEP_VERSION "x"\n');
    write('site/index.html', '<p class="release__version">v1.2.0</p>\n');
    write('site/css/site.css', '.a { width: 11.2.0px } /* 1.2.0 */\n');
    write('tools/ignored.txt', 'mentions 1.2.0 outside the scanned folders\n');
    track();
    assert.deepEqual(
      checkVersions(repo()).map((p) => p.split(': ')[0]).sort(),
      ['docs/page.md:1', 'site/css/site.css:1', 'site/index.html:1', 'src/v.asm:1'],
    );
  });
});

describe('rebeep version', () => {
  let root;
  const run = (args) => runRebeep(args, { env: { REBEEP_REPO_ROOT: root } });
  const text = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const packageVersion = () => JSON.parse(text('package.json')).version;

  beforeEach(() => {
    root = makeTempDir('rebeep-version-cli-');
    fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'x', version: '0.1.0' }, null, 2)}\n`);
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), UNRELEASED_ONLY);
    spawnSync('git', ['init', '-q'], { cwd: root });
    spawnSync('git', ['add', '-A'], { cwd: root });
  });
  afterEach(() => removeDir(root));

  test('show reports an undated version', () => {
    const { code, stdout } = run(['version', 'show', '--json']);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(stdout).data, {
      version: '0.1.0',
      tag: 'v0.1.0',
      dated: false,
      date: null,
      unreleasedLines: 2,
    });
  });

  test('check lists each problem and exits 1', () => {
    assert.equal(run(['version', 'check']).code, 0);
    const bad = run(['version', 'check', '--release', '--tag', 'v9.9.9']);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /no dated entry for 0\.1\.0/);
    assert.match(bad.stderr, /tag v9\.9\.9 does not match/);
  });

  test('bump --preview changes nothing', () => {
    const result = run(['version', 'bump', 'minor', '--preview', '--json']);
    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).data.to, '0.2.0');
    assert.equal(text('CHANGELOG.md'), UNRELEASED_ONLY);
    assert.equal(packageVersion(), '0.1.0');
  });

  test('bump 0.1.0 dates the first release once, then is refused', () => {
    const first = run(['version', 'bump', '0.1.0', '--yes']);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(packageVersion(), '0.1.0');
    assert.ok(text('package.json').endsWith('}\n'));
    const [unreleased, release] = changelogEntries(text('CHANGELOG.md'));
    assert.equal(unreleased.body, '');
    assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(release.body, '### Added\n\n- A new thing.');
    assert.equal(JSON.parse(run(['version', 'show', '--json']).stdout).data.dated, true);

    const again = run(['version', 'bump', '0.1.0', '--yes']);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /not newer/);
  });

  test('bump needs --yes without a terminal and refuses an empty [Unreleased]', () => {
    assert.equal(run(['version', 'bump', 'patch']).code, 2);
    assert.equal(run(['version', 'bump', 'patch', '--yes']).code, 0);
    const empty = run(['version', 'bump', 'patch', '--yes']);
    assert.equal(empty.code, 1);
    assert.match(empty.stderr, /empty/);
    assert.equal(packageVersion(), '0.1.1');
  });
});
