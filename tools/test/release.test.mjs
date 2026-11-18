import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { checkImage, readImage, toCrlf } from '../lib/fat.mjs';
import { changesText, checkPackageText, releaseNotes } from '../lib/release.mjs';
import { readZip } from '../lib/zip.mjs';
import { makeTempDir, removeDir, runRebeep } from './helpers.mjs';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- Something not released yet.

## [1.1.0] - 2026-03-02

### Added

- A [linked](https://example.test/page) thing with \`code\` in it, and a long tail that has to wrap because it runs well past the seventy-eight column limit.
  This line continues the same bullet.

### Fixed

- A fix with \u2018curly\u2019 quotes \u2013 and a dash.

## [1.0.0] - 2026-01-05

### Added

- The first release.

[Unreleased]: https://example.test/compare/1.1.0...HEAD
[1.0.0]: https://example.test/releases/1.0.0
`;

describe('changesText', () => {
  test('lists each dated version up to the requested one, newest first', () => {
    const text = changesText(CHANGELOG, { version: '1.1.0' });
    const lines = text.split('\n');
    assert.equal(lines[0], 'ReBeep - Changes');
    const v11 = lines.indexOf('Version 1.1.0 (2026-03-02)');
    const v10 = lines.indexOf('Version 1.0.0 (2026-01-05)');
    assert.ok(v11 > 0 && v10 > v11);
    assert.equal(lines[v11 + 1], '-'.repeat('Version 1.1.0 (2026-03-02)'.length));
    assert.ok(!text.includes('Something not released'));
    assert.ok(!text.includes('example.test'));
  });

  test('leaves out versions newer than the requested one', () => {
    const text = changesText(CHANGELOG, { version: '1.0.3' });
    assert.ok(text.includes('Version 1.0.0'));
    assert.ok(!text.includes('Version 1.1.0'));
  });

  test('turns sections into headings and wraps bullets at 78 columns with a hanging indent', () => {
    const lines = changesText(CHANGELOG, { version: '1.1.0' }).split('\n');
    assert.ok(lines.includes('Added:'));
    assert.ok(lines.includes('Fixed:'));
    const start = lines.findIndex((l) => l.startsWith('  * A linked thing with code in it'));
    assert.ok(start >= 0, 'links and backticks are stripped');
    assert.ok(lines.every((l) => l.length <= 78));
    assert.ok(lines[start + 1].startsWith('    ') && !lines[start + 1].startsWith('     '));
    assert.ok(lines.slice(start, start + 4).join(' ').replace(/\s+/g, ' ').includes('continues the same bullet.'));
  });

  test('converts curly quotes and dashes to ASCII', () => {
    const text = changesText(CHANGELOG, { version: '1.1.0' });
    assert.ok(text.includes("A fix with 'curly' quotes - and a dash."));
    assert.ok(!/[^\x00-\x7f]/.test(text));
  });

  test('rejects any other non-ASCII character', () => {
    const md = CHANGELOG.replace('The first release.', 'The first release\u2026');
    assert.throws(() => changesText(md, { version: '1.1.0' }), /not ASCII \(U\+2026\)/);
  });
});

describe('releaseNotes', () => {
  test('takes the dated entry for the version', () => {
    const { heading, body } = releaseNotes(CHANGELOG, { version: '1.0.0' });
    assert.equal(heading, 'ReBeep 1.0.0');
    assert.ok(body.includes('The first release.'));
    assert.ok(!body.includes('example.test/releases'));
  });

  test('falls back to the unreleased entry', () => {
    const { heading, body } = releaseNotes(CHANGELOG, { version: '2.0.0' });
    assert.equal(heading, 'ReBeep 2.0.0 - Unreleased preview');
    assert.ok(body.includes('Something not released yet.'));
  });
});

describe('checkPackageText', () => {
  const crlf = (text) => Buffer.from(text.replaceAll('\n', '\r\n'));

  test('accepts a clean file', () => {
    assert.deepEqual(checkPackageText('README.TXT', crlf('hello\nworld\n')), []);
  });

  test('reports a non-ASCII byte', () => {
    const problems = checkPackageText('A.TXT', Buffer.from([0x61, 0xe9, 0x0d, 0x0a]));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /non-ASCII byte 0xE9 on line 1/);
  });

  test('reports a line that does not end in CRLF', () => {
    assert.match(checkPackageText('A.TXT', Buffer.from('one\r\ntwo\n')).join('\n'), /line 2 does not end in CRLF/);
    assert.match(checkPackageText('A.TXT', Buffer.from('one\r\ntwo')).join('\n'), /last line does not end in CRLF/);
  });

  test('reports a line over 80 columns, and accepts exactly 80', () => {
    assert.deepEqual(checkPackageText('A.TXT', crlf(`${'x'.repeat(80)}\n`)), []);
    assert.match(checkPackageText('A.TXT', crlf(`${'x'.repeat(81)}\n`)).join('\n'), /line 1 is 81 columns/);
  });

  test('reports a name segment that is not 8.3', () => {
    assert.match(checkPackageText('SAMPLES/LONGERNAME.TXT', crlf('x\n')).join('\n'), /LONGERNAME\.TXT/);
    assert.match(checkPackageText('readme.txt', crlf('x\n')).join('\n'), /not upper case/);
  });

  test('checks only the name of a program', () => {
    assert.deepEqual(checkPackageText('REBEEP.COM', Buffer.from([0xff, 0x0a, 0x00])), []);
  });
});

describe('release create', () => {
  let root;
  const FDBOOT = (() => {
    const sector = Buffer.alloc(512, 0x90);
    sector.set([0xeb, 0x3c, 0x90]);
    sector.write('FDBOOT-CODE', 0x3e, 'latin1');
    sector.writeUInt16LE(0xaa55, 510);
    return sector;
  })();
  const REBEEP = Buffer.from('fake rebeep program');
  const RBTEST = Buffer.from('fake rbtest program');

  const put = (rel, bytes) => {
    const file = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  };
  const text = (value) => toCrlf(Buffer.from(value));

  beforeEach(() => {
    root = makeTempDir('rebeep-release-');
    put('package.json', JSON.stringify({ name: 'rebeep', version: '1.1.0' }));
    put('CHANGELOG.md', CHANGELOG);
    put('release/README.TXT', text('ReBeep @VERSION@\nA readme.\n'));
    put('release/INSTALL.BAT', text('@echo off\necho install\n'));
    put('release/RBPLAY.BAT', text('@echo off\necho play\n'));
    put('release/AGENTS.md', 'not packaged\n');
    put('release/SAMPLES/MSDOS/CONFIG.SYS', text('DEVICE=C:\\DOS\\HIMEM.SYS\n'));
    put('release/SAMPLES/FREEDOS/FDAUTO.BAT', text('@echo off\n'));
    put('build/REBEEP.COM', REBEEP);
    put('build/RBTEST.COM', RBTEST);
    put('build/FDBOOT.BIN', FDBOOT);
    put('build/build.json', JSON.stringify({
      targets: [
        { name: 'REBEEP.COM', sha256: sha256(REBEEP) },
        { name: 'RBTEST.COM', sha256: sha256(RBTEST) },
        { name: 'FDBOOT.BIN', sha256: sha256(FDBOOT) },
      ],
    }));
  });
  afterEach(() => removeDir(root));

  const create = (extra = []) =>
    runRebeep(['release', 'create', '--skip-build', '--json', ...extra], { env: { REBEEP_REPO_ROOT: root } });
  const out = (name) => fs.readFileSync(path.join(root, 'build', 'release', name));

  test('writes the zip, the floppy, the checksums, release.json and the notes', () => {
    const result = create();
    assert.equal(result.code, 0, result.stderr);
    const { data } = JSON.parse(result.stdout);
    assert.equal(data.version, '1.1.0');
    assert.deepEqual(
      data.outputs.map((o) => o.file),
      ['rebeep-1.1.0.zip', 'rebeep-1.1.0-floppy.img', 'SHA256SUMS.txt', 'release.json', 'NOTES.md'],
    );
    assert.deepEqual(
      data.files.map((f) => f.path),
      ['CHANGES.TXT', 'INSTALL.BAT', 'RBPLAY.BAT', 'RBTEST.COM', 'README.TXT', 'REBEEP.COM',
        'SAMPLES/FREEDOS/FDAUTO.BAT', 'SAMPLES/MSDOS/CONFIG.SYS'],
    );

    const zip = readZip(out('rebeep-1.1.0.zip'));
    const floppy = out('rebeep-1.1.0-floppy.img');
    assert.equal(floppy.length, 1474560);
    assert.deepEqual(checkImage(floppy), { ok: true, errors: [] });
    const disk = readImage(floppy);
    for (const entry of zip.entries) {
      assert.deepEqual(disk.readFile(entry.name), entry.read(), entry.name);
    }
    assert.equal(disk.readFile('SAMPLES\\MSDOS\\CONFIG.SYS').toString(), 'DEVICE=C:\\DOS\\HIMEM.SYS\r\n');
    assert.match(zip.entries.find((e) => e.name === 'README.TXT').read().toString(), /^ReBeep 1\.1\.0\r\n/);
    assert.ok(!zip.entries.some((e) => e.name.includes('AGENTS')));

    assert.equal(floppy.toString('latin1', 0x3e, 0x3e + 11), 'FDBOOT-CODE');
    assert.equal(floppy.readUInt16LE(510), 0xaa55);

    const sums = out('SHA256SUMS.txt').toString().trim().split('\n');
    assert.deepEqual(sums, [
      `${sha256(out('rebeep-1.1.0.zip'))}  rebeep-1.1.0.zip`,
      `${sha256(floppy)}  rebeep-1.1.0-floppy.img`,
    ]);

    assert.deepEqual(JSON.parse(out('release.json')), {
      version: '1.1.0',
      targets: [
        { name: 'REBEEP.COM', sha256: sha256(REBEEP) },
        { name: 'RBTEST.COM', sha256: sha256(RBTEST) },
      ],
    });

    const notes = out('NOTES.md').toString();
    assert.match(notes, /^# ReBeep 1\.1\.0\n/);
    assert.ok(notes.includes('A [linked](https://example.test/page) thing'));
    assert.ok(notes.includes('## SHA-256') && notes.includes(sha256(floppy)));
  });

  test('is reproducible and replaces what was in build/release', () => {
    put('build/release/STALE.TXT', 'old');
    assert.equal(create().code, 0);
    const first = sha256(out('rebeep-1.1.0.zip')) + sha256(out('rebeep-1.1.0-floppy.img'));
    assert.ok(!fs.existsSync(path.join(root, 'build', 'release', 'STALE.TXT')));
    assert.equal(create().code, 0);
    assert.equal(sha256(out('rebeep-1.1.0.zip')) + sha256(out('rebeep-1.1.0-floppy.img')), first);
  });

  test('heads the notes "Unreleased preview" when the version has no dated entry', () => {
    put('package.json', JSON.stringify({ name: 'rebeep', version: '1.2.0' }));
    assert.equal(create().code, 0);
    const notes = out('NOTES.md').toString();
    assert.match(notes, /^# ReBeep 1\.2\.0 - Unreleased preview\n/);
    assert.ok(notes.includes('Something not released yet.'));
  });

  test('fails listing every problem in the package texts', () => {
    put('release/README.TXT', Buffer.from('ReBeep @VERSION@\nLF only\n'));
    put('release/INSTALL.BAT', Buffer.concat([Buffer.from('@echo off\r\necho caf'), Buffer.from([0xe9]), Buffer.from('\r\n')]));
    put('release/RBPLAY.BAT', text(`${'x'.repeat(81)}\n`));
    put('release/CONFIG.SYS', text('x\n'));
    const result = create();
    assert.equal(result.code, 1);
    const { error } = JSON.parse(result.stdout);
    const message = typeof error === 'string' ? error : error.message;
    assert.match(message, /README\.TXT: line 1 does not end in CRLF/);
    assert.match(message, /README\.TXT: line 2 does not end in CRLF/);
    assert.match(message, /INSTALL\.BAT: non-ASCII byte 0xE9/);
    assert.match(message, /RBPLAY\.BAT: line 1 is 81 columns/);
    assert.match(message, /CONFIG\.SYS: a boot config file must not sit at the top level of the package/);
    assert.ok(!fs.existsSync(path.join(root, 'build', 'release')));
  });

  test('refuses a changelog heading that version check would refuse', () => {
    put('CHANGELOG.md', CHANGELOG.replace('## [1.1.0] - 2026-03-02', '## [1.1.0-rc1] - 2026-03-02'));
    const result = create();
    assert.equal(result.code, 1);
    const { error } = JSON.parse(result.stdout);
    const message = typeof error === 'string' ? error : error.message;
    assert.match(message, /CHANGELOG\.md: heading "## \[1\.1\.0-rc1\] - 2026-03-02" is not/);
    assert.ok(!fs.existsSync(path.join(root, 'build', 'release')));
  });

  test('fails when the package does not fit on the floppy', () => {
    put('release/SAMPLES/MSDOS/AUTOEXEC.BAT', toCrlf(Buffer.from(`${'x'.repeat(70)}\n`.repeat(21000))));
    const result = create();
    assert.equal(result.code, 1);
    assert.match(result.stdout, /does not fit on the 1\.44 MB floppy/);
  });

  test('fails when a program no longer matches build.json', () => {
    put('build/REBEEP.COM', 'changed');
    const result = create();
    assert.equal(result.code, 1);
    assert.match(result.stdout, /REBEEP\.COM does not match build\/build\.json/);
  });
});
