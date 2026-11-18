import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import media from '../commands/media.mjs';
import { sha256Buffer } from '../lib/download.mjs';
import { layout } from '../lib/paths.mjs';
import { makeTempDir, removeDir, runRebeep } from './helpers.mjs';
import { makeZip } from './zipfixture.mjs';

const FLOPPY = 1474560;

let tmp;
let home;
beforeEach(() => {
  tmp = makeTempDir('rebeep-media-');
  home = path.join(tmp, 'home');
});
afterEach(() => removeDir(tmp));

const rebeep = (...args) => runRebeep(args, { env: { REBEEP_HOME: home } });
const paths = () => layout(home);

function makeDisks(names = ['disk1.IMA', 'Disk2.img', 'DISK3.ima'], size = FLOPPY) {
  const dir = path.join(tmp, 'disks');
  fs.mkdirSync(dir, { recursive: true });
  names.forEach((name, i) => fs.writeFileSync(path.join(dir, name), Buffer.alloc(size, i + 1)));
  return dir;
}

function makeGame(entries, file = 'game.zip') {
  const zip = path.join(tmp, file);
  fs.writeFileSync(zip, makeZip(entries));
  return zip;
}

describe('media add msdos622', () => {
  test('copies three images as DISK1..3.IMA and writes media.json', () => {
    const dir = makeDisks(['b.img', 'A.IMA', 'c.ima']);
    const result = rebeep('media', 'add', 'msdos622', dir, '--json');
    assert.equal(result.code, 0, result.stderr);
    const dest = paths().mediaMsdos;
    assert.deepEqual(fs.readdirSync(dest).sort(), ['DISK1.IMA', 'DISK2.IMA', 'DISK3.IMA', 'media.json']);
    const meta = JSON.parse(fs.readFileSync(path.join(dest, 'media.json'), 'utf8'));
    assert.equal(meta.kind, 'msdos622');
    assert.deepEqual(meta.files.map((f) => path.basename(f.source)), ['A.IMA', 'b.img', 'c.ima']);
    assert.deepEqual(meta.files.map((f) => f.name), ['DISK1.IMA', 'DISK2.IMA', 'DISK3.IMA']);
    assert.equal(meta.files[0].size, FLOPPY);
    assert.equal(meta.files[0].sha256, sha256Buffer(fs.readFileSync(path.join(dest, 'DISK1.IMA'))));
    assert.equal(JSON.parse(result.stdout).ok, true);
  });

  test('re-adding replaces the previous set', () => {
    rebeep('media', 'add', 'msdos622', makeDisks());
    const other = path.join(tmp, 'other');
    fs.mkdirSync(other);
    ['x.ima', 'y.ima', 'z.ima'].forEach((n, i) => fs.writeFileSync(path.join(other, n), Buffer.alloc(FLOPPY, 9 + i)));
    assert.equal(rebeep('media', 'add', 'msdos622', other).code, 0);
    assert.equal(fs.readFileSync(path.join(paths().mediaMsdos, 'DISK1.IMA'))[0], 9);
  });

  test('two images is an error that says what was found', () => {
    const result = rebeep('media', 'add', 'msdos622', makeDisks(['a.ima', 'b.ima']));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /found 2: a\.ima, b\.ima/);
    assert.equal(fs.existsSync(paths().mediaMsdos), false);
  });

  test('a wrong-size image is an error naming the file', () => {
    const result = rebeep('media', 'add', 'msdos622', makeDisks(undefined, 1000));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /is 1000 bytes.*1474560/);
    assert.equal(fs.existsSync(paths().mediaMsdos), false);
  });

  test('a failed re-add keeps the existing media', () => {
    rebeep('media', 'add', 'msdos622', makeDisks());
    assert.equal(rebeep('media', 'add', 'msdos622', path.join(tmp, 'nope')).code, 1);
    assert.equal(fs.existsSync(path.join(paths().mediaMsdos, 'DISK1.IMA')), true);
  });

  test('accepts symlinks that resolve to regular files, and records the stored copy', { skip: process.platform === 'win32' }, () => {
    const real = path.join(tmp, 'real');
    fs.mkdirSync(real);
    const dir = path.join(tmp, 'links');
    fs.mkdirSync(dir);
    ['a', 'b', 'c'].forEach((n, i) => {
      fs.writeFileSync(path.join(real, `${n}.ima`), Buffer.alloc(FLOPPY, i + 1));
      fs.symlinkSync(path.join(real, `${n}.ima`), path.join(dir, `${n}.ima`));
    });
    fs.symlinkSync(path.join(tmp, 'nowhere'), path.join(dir, 'broken.ima'));
    const result = rebeep('media', 'add', 'msdos622', dir);
    assert.equal(result.code, 0, result.stderr);
    const meta = JSON.parse(fs.readFileSync(path.join(paths().mediaMsdos, 'media.json'), 'utf8'));
    for (const f of meta.files) {
      assert.equal(f.sha256, sha256Buffer(fs.readFileSync(path.join(paths().mediaMsdos, f.name))));
    }
  });

  test('an unknown kind is a usage error', () => {
    assert.equal(rebeep('media', 'add', 'floppy', tmp).code, 2);
  });
});

describe('media add game', () => {
  test('copies the zip, records it and does not extract it', () => {
    const zip = makeGame([{ name: 'GPC', dir: true }, { name: 'GPC/GPC.EXE', data: 'MZ', method: 8 }, { name: 'GPC/A.DAT', data: 'x' }]);
    const result = rebeep('media', 'add', 'game', zip, '--name', 'gpc', '--json');
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(fs.readdirSync(paths().mediaGames).sort(), ['GPC.json', 'GPC.zip']);
    assert.deepEqual(fs.readFileSync(path.join(paths().mediaGames, 'GPC.zip')), fs.readFileSync(zip));
    const meta = JSON.parse(fs.readFileSync(path.join(paths().mediaGames, 'GPC.json'), 'utf8'));
    assert.equal(meta.kind, 'game');
    assert.equal(meta.name, 'GPC');
    assert.equal(meta.entries, 2);
    assert.equal(meta.topFolderStripped, true);
    assert.equal(meta.sha256, sha256Buffer(fs.readFileSync(zip)));
    assert.equal(meta.size, fs.statSync(zip).size);
    assert.equal(meta.source, zip);
  });

  test('accepts a symlink to a zip', { skip: process.platform === 'win32' }, () => {
    const zip = makeGame([{ name: 'A.EXE', data: 'x' }]);
    const link = path.join(tmp, 'link.zip');
    fs.symlinkSync(zip, link);
    assert.equal(rebeep('media', 'add', 'game', link, '--name', 'LINK').code, 0);
    const meta = JSON.parse(fs.readFileSync(path.join(paths().mediaGames, 'LINK.json'), 'utf8'));
    assert.equal(meta.sha256, sha256Buffer(fs.readFileSync(zip)));
  });

  test('a flat zip is not marked as stripped', () => {
    const zip = makeGame([{ name: 'A.EXE', data: 'x' }, { name: 'B.DAT', data: 'y' }]);
    assert.equal(rebeep('media', 'add', 'game', zip, '--name', 'FLAT').code, 0);
    const meta = JSON.parse(fs.readFileSync(path.join(paths().mediaGames, 'FLAT.json'), 'utf8'));
    assert.equal(meta.topFolderStripped, false);
  });

  test('a hostile zip is refused and nothing is imported', () => {
    for (const name of ['../evil.exe', '/abs', 'C:/x', 'a\\b']) {
      const zip = makeGame([{ name: 'ok.txt', data: 'ok' }, { name, data: 'evil' }]);
      const result = rebeep('media', 'add', 'game', zip, '--name', 'EVIL');
      assert.equal(result.code, 1, name);
      assert.match(result.stderr, /unsafe zip entry/);
    }
    assert.equal(fs.existsSync(paths().mediaGames), false);
  });

  test('a zip with no files, and a non-zip, are refused', () => {
    assert.match(rebeep('media', 'add', 'game', makeGame([{ name: 'd', dir: true }]), '--name', 'EMPTY').stderr, /no files/);
    const junk = path.join(tmp, 'junk.zip');
    fs.writeFileSync(junk, 'not a zip at all, nothing to see here');
    assert.equal(rebeep('media', 'add', 'game', junk, '--name', 'JUNK').code, 1);
  });

  test('bad names exit 1; a missing --name exits 2', () => {
    const zip = makeGame([{ name: 'a', data: 'x' }]);
    for (const name of ['TOOLONGNAME', 'bad name', 'a.b', '../x', 'CON', '']) {
      const result = rebeep('media', 'add', 'game', zip, '--name', name);
      assert.equal(result.code, name === '' ? 2 : 1, JSON.stringify(name));
    }
    assert.equal(rebeep('media', 'add', 'game', zip).code, 2);
    assert.equal(fs.existsSync(paths().mediaGames), false);
  });
});

describe('media list and remove', () => {
  beforeEach(() => {
    rebeep('media', 'add', 'msdos622', makeDisks());
    rebeep('media', 'add', 'game', makeGame([{ name: 'A.EXE', data: 'x' }]), '--name', 'ONE');
  });

  test('list shows both kinds, with the 12-character hash prefix', () => {
    const body = JSON.parse(rebeep('media', 'list', '--json').stdout);
    assert.deepEqual(body.data.media.map((m) => m.kind), ['msdos622', 'game']);
    assert.equal(body.data.media[0].files, 3);
    assert.equal(body.data.media[0].size, 3 * FLOPPY);
    assert.equal(body.data.media[1].sha256.length, 12);
    const text = rebeep('media', 'list');
    assert.match(text.stdout, /game\s+ONE\s+1\s+/);
  });

  test('list on an empty home says so', () => {
    assert.match(runRebeep(['media', 'list']).stdout, /no media imported/);
  });

  test('remove needs --yes when not interactive', () => {
    const result = rebeep('media', 'remove', 'game', '--name', 'ONE');
    assert.equal(result.code, 2);
    assert.match(result.stderr, /--yes/);
    assert.equal(fs.existsSync(path.join(paths().mediaGames, 'ONE.zip')), true);
  });

  test('--preview deletes nothing', () => {
    const game = rebeep('media', 'remove', 'game', '--name', 'ONE', '--preview');
    assert.equal(game.code, 0, game.stderr);
    assert.match(game.stdout, /ONE\.zip/);
    assert.equal(rebeep('media', 'remove', 'msdos622', '--preview').code, 0);
    assert.equal(fs.existsSync(path.join(paths().mediaGames, 'ONE.zip')), true);
    assert.equal(fs.existsSync(paths().mediaMsdos), true);
  });

  test('remove --yes deletes the game or the disks', () => {
    assert.equal(rebeep('media', 'remove', 'game', '--name', 'one', '--yes').code, 0);
    assert.deepEqual(fs.readdirSync(paths().mediaGames), []);
    assert.equal(rebeep('media', 'remove', 'msdos622', '--yes').code, 0);
    assert.equal(fs.existsSync(paths().mediaMsdos), false);
  });

  test('remove of something not imported fails; game needs --name', () => {
    assert.equal(rebeep('media', 'remove', 'game', '--name', 'NOPE', '--yes').code, 1);
    assert.equal(rebeep('media', 'remove', 'game', '--yes').code, 2);
  });
});

describe('replacing media safely', () => {
  const quiet = { info() {}, ok() {}, warn() {}, step() {}, debug() {}, error() {} };
  const addVerb = media.verbs.find((v) => v.name === 'add');
  const ctxFor = (args, opts = {}, messages = []) => ({
    args,
    opts,
    paths: paths(),
    log: { ...quiet, info: (m) => messages.push(m) },
  });

  /** Runs `fn` with `fs.renameSync` failing for the staging move into `blocked` (the rollback may succeed). */
  async function withRenameFailure(blocked, fn) {
    const real = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to === blocked && String(from).includes('.tmp-')) throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
      return real(from, to);
    };
    try {
      return await fn();
    } finally {
      fs.renameSync = real;
    }
  }

  test('a failed swap keeps the previous MS-DOS disks and leaves no staging folder', async () => {
    assert.equal(rebeep('media', 'add', 'msdos622', makeDisks()).code, 0);
    const before = fs.readFileSync(path.join(paths().mediaMsdos, 'DISK1.IMA'));
    const other = path.join(tmp, 'other');
    fs.mkdirSync(other);
    ['x.ima', 'y.ima', 'z.ima'].forEach((n, i) => fs.writeFileSync(path.join(other, n), Buffer.alloc(FLOPPY, 90 + i)));

    await withRenameFailure(paths().mediaMsdos, async () => {
      await assert.rejects(addVerb.run(ctxFor({ kind: 'msdos622', path: other })), /could not replace/);
    });

    assert.deepEqual(fs.readFileSync(path.join(paths().mediaMsdos, 'DISK1.IMA')), before);
    assert.equal(fs.existsSync(path.join(paths().mediaMsdos, 'media.json')), true);
    assert.deepEqual(fs.readdirSync(paths().media).sort(), ['msdos622']);
  });

  test('re-adding says what it replaces, and reports replaced', async () => {
    assert.equal(rebeep('media', 'add', 'msdos622', makeDisks()).code, 0);
    const messages = [];
    const result = await addVerb.run(ctxFor({ kind: 'msdos622', path: path.join(tmp, 'disks') }, {}, messages));
    assert.equal(result.replaced, true);
    assert.match(messages.join('\n'), /replacing the MS-DOS 6\.22 disks already imported \(added /);
    assert.equal(fs.existsSync(`${paths().mediaMsdos}.old`), false);

    const zip = makeGame([{ name: 'A.EXE', data: 'x' }]);
    const first = await addVerb.run(ctxFor({ kind: 'game', path: zip }, { name: 'one' }, messages));
    assert.equal(first.replaced, false);
    const second = await addVerb.run(ctxFor({ kind: 'game', path: zip }, { name: 'one' }, messages));
    assert.equal(second.replaced, true);
    assert.match(messages.join('\n'), /replacing game ONE already imported \(\d+ B, sha256 [0-9a-f]{12}\)/);
    assert.deepEqual(fs.readdirSync(paths().mediaGames).sort(), ['ONE.json', 'ONE.zip']);
  });
});
