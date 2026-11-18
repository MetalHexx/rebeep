import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { sha256Buffer } from '../lib/download.mjs';
import {
  MAX_ENTRIES,
  MAX_ENTRY_BYTES,
  checkEntryName,
  crc32,
  extractZip,
  hashTree,
  readZip,
  stripCommonRoot,
} from '../lib/zip.mjs';
import { makeTempDir, removeDir } from './helpers.mjs';
import { makeZip } from './zipfixture.mjs';

const posix = process.platform !== 'win32';
const hello = Buffer.from('hello hello hello hello world');

let tmp;
let dest;
beforeEach(() => {
  tmp = makeTempDir('rebeep-zip-');
  dest = path.join(tmp, 'out');
});
afterEach(() => removeDir(tmp));

function writeZip(entries, options) {
  const file = path.join(tmp, 'in.zip');
  fs.writeFileSync(file, makeZip(entries, options));
  return file;
}

const outsideDest = () => fs.readdirSync(tmp).filter((n) => n !== 'out' && n !== 'in.zip');

describe('readZip', () => {
  test('crc32 matches the standard check value', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  });

  for (const zip64 of [false, true]) {
    test(`round-trips stored and deflated entries${zip64 ? ' (zip64)' : ''}`, () => {
      const { entries } = readZip(
        makeZip(
          [
            { name: 'a.txt', data: hello, method: 0 },
            { name: 'dir/b.txt', data: hello, method: 8, mode: 0o755 },
            { name: 'dir', dir: true },
            { name: 'empty', data: '' },
          ],
          { zip64 },
        ),
      );
      assert.deepEqual(entries.map((e) => e.name), ['a.txt', 'dir/b.txt', 'dir/', 'empty']);
      assert.deepEqual(entries[0].read(), hello);
      assert.deepEqual(entries[1].read(), hello);
      assert.equal(entries[1].size, hello.length);
      assert.equal(entries[1].method, 8);
      assert.equal(entries[1].mode & 0o777, 0o755);
      assert.equal(entries[2].isDir, true);
      assert.equal(entries[3].read().length, 0);
    });
  }

  test('detects a CRC mismatch', () => {
    const { entries } = readZip(makeZip([{ name: 'a', data: hello, crc: 123 }]));
    assert.throws(() => entries[0].read(), /CRC mismatch/);
  });

  test('names an unsupported compression method', () => {
    const { entries } = readZip(makeZip([{ name: 'a', data: hello, method: 9 }]));
    assert.throws(() => entries[0].read(), /method 9/);
  });

  test('flags symlink entries and reads their target', () => {
    const { entries } = readZip(makeZip([{ name: 'l', symlinkTo: 'a/b' }]));
    assert.equal(entries[0].isSymlink, true);
    assert.equal(entries[0].read().toString(), 'a/b');
  });

  describe('local header must agree with the central directory', () => {
    const build = () => Buffer.from(makeZip([{ name: 'ok.txt', data: 'payload', method: 8 }]));

    test('name', () => {
      const zip = build();
      zip.write('no.txt', zip.indexOf('ok.txt'), 'latin1');
      assert.throws(() => readZip(zip).entries[0].read(), /disagrees.*name/);
    });
    test('method', () => {
      const zip = build();
      zip.writeUInt16LE(0, 8);
      assert.throws(() => readZip(zip).entries[0].read(), /disagrees.*method/);
    });
    test('encryption flag', () => {
      const zip = build();
      zip.writeUInt16LE(zip.readUInt16LE(6) | 1, 6);
      assert.throws(() => readZip(zip).entries[0].read(), /disagrees.*encryption/);
    });
    test('sizes, unless the data descriptor flag is set', () => {
      const zip = build();
      zip.writeUInt32LE(zip.readUInt32LE(22) + 1, 22);
      assert.throws(() => readZip(zip).entries[0].read(), /disagrees.*sizes/);
      zip.writeUInt16LE(zip.readUInt16LE(6) | 8, 6);
      assert.equal(readZip(zip).entries[0].read().toString(), 'payload');
    });
  });

  test('refuses an entry that declares more than the per-entry limit, without inflating it', () => {
    const { entries } = readZip(makeZip([{ name: 'bomb', data: 'tiny', method: 8, declaredSize: MAX_ENTRY_BYTES + 1 }]));
    assert.throws(() => entries[0].read(), /byte limit/);
  });

  test('rejects data that is not a zip', () => {
    assert.throws(() => readZip(Buffer.from('not a zip file at all, really')), /not found/);
  });
});

describe('checkEntryName', () => {
  const hostile = ['../x', 'a/../../x', '/abs', 'C:/x', 'C:x', 'a\\b', 'a:b', 'a\0b', '', '.', 'a/./b', 'a//b', '..'];
  for (const name of hostile) {
    test(`rejects ${JSON.stringify(name)}`, () => assert.throws(() => checkEntryName(name), /unsafe zip entry/));
  }
  test('accepts ordinary names and directory entries', () => {
    for (const name of ['a', 'a/b.txt', 'dir/', 'a b/c-d_e.f']) assert.equal(checkEntryName(name), name);
  });
});

describe('stripCommonRoot', () => {
  const entry = (name) => ({ name });
  test('removes a single shared top-level folder and its own entry', () => {
    const out = stripCommonRoot([entry('r/'), entry('r/a'), entry('r/d/'), entry('r/d/b')]);
    assert.deepEqual(out.map((e) => e.name), ['a', 'd/', 'd/b']);
  });
  test('leaves mixed or top-level files alone', () => {
    const mixed = [entry('r/a'), entry('s/b')];
    assert.equal(stripCommonRoot(mixed), mixed);
    const flat = [entry('a'), entry('r/b')];
    assert.equal(stripCommonRoot(flat), flat);
  });
});

describe('extractZip', () => {
  test('writes files and returns their SHA-256', () => {
    const zip = writeZip([
      { name: 'a.txt', data: hello },
      { name: 'sub/b.bin', data: 'bee', method: 8 },
      { name: 'sub', dir: true },
    ]);
    const { files } = extractZip(zip, dest);
    assert.deepEqual(files, { 'a.txt': sha256Buffer(hello), 'sub/b.bin': sha256Buffer(Buffer.from('bee')) });
    assert.deepEqual(fs.readFileSync(path.join(dest, 'sub', 'b.bin')), Buffer.from('bee'));
    assert.deepEqual(hashTree(dest), files);
  });

  test('stripRoot and into rewrite the layout', () => {
    const zip = writeZip([
      { name: 'root', dir: true },
      { name: 'root/a.txt', data: 'a' },
      { name: 'root/d/b.txt', data: 'b' },
    ]);
    const { files } = extractZip(zip, dest, { stripRoot: 'root', into: 'roms' });
    assert.deepEqual(Object.keys(files).sort(), ['roms/a.txt', 'roms/d/b.txt']);
    assert.equal(fs.readFileSync(path.join(dest, 'roms', 'd', 'b.txt'), 'utf8'), 'b');
  });

  test('an entry outside stripRoot is an error', () => {
    const zip = writeZip([{ name: 'root/a', data: 'a' }, { name: 'other/b', data: 'b' }]);
    assert.throws(() => extractZip(zip, dest, { stripRoot: 'root' }), /outside 'root\/'/);
  });

  for (const name of ['../x', 'a/../../x', '/abs', 'C:/x', 'C:x', 'a\\b', 'a:b', 'a\0b']) {
    test(`refuses ${JSON.stringify(name)} and writes nothing outside dest`, () => {
      const zip = writeZip([{ name, data: 'evil' }]);
      assert.throws(() => extractZip(zip, dest), /unsafe zip entry/);
      assert.deepEqual(outsideDest(), []);
    });
  }

  test('a hostile entry after good ones does not leave anything outside dest', () => {
    const zip = writeZip([{ name: 'ok.txt', data: 'ok' }, { name: '../../escape.txt', data: 'evil' }]);
    assert.throws(() => extractZip(zip, dest), /unsafe zip entry/);
    assert.deepEqual(outsideDest(), []);
    assert.equal(fs.existsSync(path.join(tmp, '..', 'escape.txt')), false);
  });

  test('refuses a zip whose declared total or entry count is over the limits', () => {
    const big = Array.from({ length: 9 }, (_, i) => ({ name: `f${i}`, data: 'x', declaredSize: MAX_ENTRY_BYTES - 1 }));
    assert.throws(() => extractZip(writeZip(big), dest), /in total/);
    const many = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({ name: `f${i}` }));
    assert.throws(() => extractZip(writeZip(many, { zip64: true }), dest), /entry limit/);
    assert.equal(fs.existsSync(dest) ? fs.readdirSync(dest).length : 0, 0);
  });

  test('refuses a corrupted entry', () => {
    const zip = writeZip([{ name: 'a', data: hello, crc: 1 }]);
    assert.throws(() => extractZip(zip, dest), /CRC mismatch/);
  });

  test('refuses names Windows cannot store safely', { skip: posix }, () => {
    for (const name of ['nul', 'con.txt', 'a/aux', 'trail.', 'sp ace ', 'conin$', 'CONOUT$.x', 'com¹', 'lpt0']) {
      assert.throws(() => extractZip(writeZip([{ name, data: 'x' }]), dest), /Windows cannot store/);
    }
  });

  test('refuses a symlink that escapes dest', { skip: !posix }, () => {
    for (const target of ['../outside', '/etc/passwd', 'a/../../outside']) {
      const zip = writeZip([{ name: 'link', symlinkTo: target }]);
      assert.throws(() => extractZip(zip, dest), /points outside/);
    }
    assert.deepEqual(outsideDest(), []);
  });

  test('refuses two links that compose into an escape', { skip: !posix }, () => {
    const zip = writeZip([
      { name: 'q/r/s', symlinkTo: '..' },
      { name: 'q/r/s/t', symlinkTo: '../..' },
      { name: 'q/r/s/t/evil.txt', data: 'evil' },
    ]);
    assert.throws(() => extractZip(zip, dest), /points outside/);
    assert.equal(fs.existsSync(path.join(dest, 'q', 't')) && fs.lstatSync(path.join(dest, 'q', 't')).isSymbolicLink(), false);
    assert.deepEqual(outsideDest(), []);
  });

  test('refuses writing through a symlinked folder that leads outside', { skip: !posix }, () => {
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    fs.mkdirSync(dest);
    fs.symlinkSync(outside, path.join(dest, 'out'));
    const zip = writeZip([{ name: 'out/evil.txt', data: 'evil' }]);
    assert.throws(() => extractZip(zip, dest), /would be written outside/);
    assert.deepEqual(fs.readdirSync(outside), []);
  });

  test('removes and refuses a dangling link whose target path escapes through another link', { skip: !posix }, () => {
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    fs.mkdirSync(dest);
    fs.symlinkSync(outside, path.join(dest, 'out'));
    const zip = writeZip([{ name: 'l', symlinkTo: 'out/missing' }]);
    assert.throws(() => extractZip(zip, dest), /resolves outside/);
    assert.equal(fs.existsSync(path.join(dest, 'l')) || (() => { try { fs.lstatSync(path.join(dest, 'l')); return true; } catch { return false; } })(), false);
  });

  test('keeps an inside symlink and hashes its target', { skip: !posix }, () => {
    const zip = writeZip([{ name: 'real.txt', data: 'x' }, { name: 'sub/l', symlinkTo: '../real.txt' }]);
    const { files } = extractZip(zip, dest);
    assert.equal(fs.readlinkSync(path.join(dest, 'sub', 'l')), '../real.txt');
    assert.equal(files['sub/l'], sha256Buffer(Buffer.from('../real.txt')));
  });

  test('exec bits survive', { skip: !posix }, () => {
    const zip = writeZip([
      { name: 'run.sh', data: '#!/bin/sh\n', mode: 0o755 },
      { name: 'plain', data: 'x', mode: 0o644 },
      { name: 'suid', data: 'x', mode: 0o4777 },
    ]);
    extractZip(zip, dest);
    assert.equal(fs.statSync(path.join(dest, 'run.sh')).mode & 0o7777, 0o755);
    assert.equal(fs.statSync(path.join(dest, 'plain')).mode & 0o7777, 0o644);
    assert.equal(fs.statSync(path.join(dest, 'suid')).mode & 0o7777, 0o755, 'setuid and group/other write bits are dropped');
  });
});
