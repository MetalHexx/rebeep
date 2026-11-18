import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { copyAtomic, formatBytes, replaceDir, writeAtomic } from '../lib/fsx.mjs';
import { makeTempDir, removeDir } from './helpers.mjs';

let tmp;
beforeEach(() => {
  tmp = makeTempDir('rebeep-fsx-');
});
afterEach(() => removeDir(tmp));

const put = (rel, text) => {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const names = () => fs.readdirSync(tmp).sort();

describe('replaceDir', () => {
  test('replaces the destination with a copy of the source', () => {
    put('src/a.nvr', 'new');
    put('dest/a.nvr', 'old');
    put('dest/extra.nvr', 'gone');
    replaceDir(path.join(tmp, 'src'), path.join(tmp, 'dest'));
    assert.deepEqual(fs.readdirSync(path.join(tmp, 'dest')), ['a.nvr']);
    assert.equal(fs.readFileSync(path.join(tmp, 'dest', 'a.nvr'), 'utf8'), 'new');
    assert.deepEqual(names(), ['dest', 'src']);
  });

  test('a missing source gives an empty folder, and a missing destination is fine', () => {
    put('dest/a.nvr', 'old');
    replaceDir(path.join(tmp, 'nope'), path.join(tmp, 'dest'));
    assert.deepEqual(fs.readdirSync(path.join(tmp, 'dest')), []);
    put('src/b.nvr', 'b');
    replaceDir(path.join(tmp, 'src'), path.join(tmp, 'fresh'));
    assert.deepEqual(fs.readdirSync(path.join(tmp, 'fresh')), ['b.nvr']);
  });

  test('a copy that fails part-way leaves the destination as it was, and nothing behind', () => {
    put('src/a.nvr', 'new');
    put('dest/a.nvr', 'old');
    const partial = (from, to) => {
      fs.mkdirSync(to);
      fs.writeFileSync(path.join(to, 'half.nvr'), 'half');
      throw new Error('disk full');
    };
    assert.throws(
      () => replaceDir(path.join(tmp, 'src'), path.join(tmp, 'dest'), { cpSync: partial, renameSync: fs.renameSync }),
      /disk full/,
    );
    assert.equal(fs.readFileSync(path.join(tmp, 'dest', 'a.nvr'), 'utf8'), 'old');
    assert.deepEqual(fs.readdirSync(path.join(tmp, 'dest')), ['a.nvr']);
    assert.deepEqual(names(), ['dest', 'src']);
  });

  test('a swap that fails puts the old destination back', () => {
    put('src/a.nvr', 'new');
    put('dest/a.nvr', 'old');
    let calls = 0;
    const failSecond = (a, b) => {
      if (++calls === 2) throw new Error('rename failed');
      fs.renameSync(a, b);
    };
    assert.throws(
      () => replaceDir(path.join(tmp, 'src'), path.join(tmp, 'dest'), { cpSync: fs.cpSync, renameSync: failSecond }),
      /rename failed/,
    );
    assert.equal(fs.readFileSync(path.join(tmp, 'dest', 'a.nvr'), 'utf8'), 'old');
    assert.deepEqual(names(), ['dest', 'src']);
  });
});

describe('writeAtomic and copyAtomic', () => {
  test('a failed write leaves the target and no temp file', () => {
    put('target.bin', 'old');
    const target = path.join(tmp, 'target.bin');
    assert.throws(
      () =>
        writeAtomic(target, (tmpFile) => {
          fs.writeFileSync(tmpFile, 'half');
          throw new Error('boom');
        }),
      /boom/,
    );
    assert.equal(fs.readFileSync(target, 'utf8'), 'old');
    assert.deepEqual(names(), ['target.bin']);
  });

  test('copyAtomic replaces the target with the source bytes', () => {
    put('from.bin', 'new');
    put('to.bin', 'old');
    copyAtomic(path.join(tmp, 'from.bin'), path.join(tmp, 'to.bin'));
    assert.equal(fs.readFileSync(path.join(tmp, 'to.bin'), 'utf8'), 'new');
    assert.deepEqual(names(), ['from.bin', 'to.bin']);
  });
});

describe('formatBytes', () => {
  test('uses B, KB and MB', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(2048), '2 KB');
    assert.equal(formatBytes(3 * 1024 ** 2), '3.0 MB');
  });
});
