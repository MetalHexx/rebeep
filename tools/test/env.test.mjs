import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { hashTree } from '../lib/zip.mjs';
import { runRebeep } from './helpers.mjs';
import { seedEnv, seedMsdosMedia, snapshotTree, writeFile } from './vmenv.mjs';

let s;
beforeEach(() => {
  s = seedEnv('rebeep-env-');
});
afterEach(() => s.cleanup());

const setup = () => {
  const result = s.json('env', 'setup');
  assert.equal(result.code, 0, result.stderr);
  return result.envelope.data;
};
const rows = (data) => Object.fromEntries(data.vms.map((v) => [v.vm, v]));
const marker = (vm) => {
  const fd = fs.openSync(s.paths.vm(vm).cImg, 'r+');
  fs.writeSync(fd, Buffer.from('hand-installed'), 0, 14, 4096);
  fs.closeSync(fd);
};
const markerOf = (vm) => fs.readFileSync(s.paths.vm(vm).cImg).subarray(4096, 4110).toString();

describe('env setup', () => {
  test('creates what it can and reports why it skipped the rest', () => {
    const data = setup();
    const byVm = rows(data);
    assert.equal(byVm['mirror-msdos'].status, 'created');
    assert.equal(byVm['slow-386sx'].status, 'skipped');
    assert.equal(byVm['slow-386sx'].detail, 'needs a mirror-msdos baseline');
    assert.equal(byVm['mirror-freedos'].status, 'skipped');
    assert.equal(byVm['mirror-freedos'].detail, 'The FreeDOS C: builder could not be loaded');

    assert.ok(fs.existsSync(s.paths.vm('mirror-msdos').cImg));
    assert.ok(fs.existsSync(s.paths.vm('mirror-msdos').dImg));
    assert.equal(fs.existsSync(s.paths.vm('slow-386sx').dir), false);
    assert.equal(fs.existsSync(s.paths.vm('mirror-freedos').dir), false);
    assert.deepEqual(data.tools.map((t) => t.status), ['already fetched', 'already fetched', 'already fetched', 'already fetched']);
    assert.ok(data.next.some((step) => step.includes('media add msdos622')));
    assert.ok(data.next.some((step) => step.includes('vm run mirror-msdos --install')));
  });

  test('is idempotent: a second run keeps C: and redeploys D:', () => {
    setup();
    marker('mirror-msdos');
    const second = rows(setup());
    assert.equal(second['mirror-msdos'].status, 'present');
    assert.equal(markerOf('mirror-msdos'), 'hand-installed');
    assert.equal(second['slow-386sx'].status, 'skipped');
    const text = s.rebeep('env', 'setup');
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /VM\s+STATUS\s+DETAIL/);
    assert.match(text.stdout, /Next steps:/);
  });

  test('creates the clone once its source has a baseline', () => {
    setup();
    marker('mirror-msdos');
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    const byVm = rows(setup());
    assert.equal(byVm['slow-386sx'].status, 'created');
    assert.equal(markerOf('slow-386sx'), 'hand-installed');
  });

  test('a VM that fails is reported and the rest carry on; the exit code is 1', () => {
    setup();
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    fs.rmSync(path.join(s.paths.tool('86box-roms', '6.0'), 'roms', 'machines', 'awardsx'), { recursive: true });
    const result = s.json('env', 'setup');
    assert.equal(result.code, 1);
    assert.match(result.envelope.error.message, /1 VM failed \(slow-386sx\)/);
    const byVm = rows(result.envelope.data);
    assert.equal(byVm['slow-386sx'].status, 'failed');
    assert.match(byVm['slow-386sx'].detail, /missing ROM/);
    assert.equal(byVm['mirror-msdos'].status, 'present');
    assert.equal(byVm['mirror-freedos'].status, 'skipped');
    assert.equal(fs.existsSync(s.paths.vm('slow-386sx').dir), false);

    const text = s.rebeep('env', 'setup');
    assert.equal(text.code, 1);
    assert.match(text.stdout, /slow-386sx\s+failed/);
  });
});

describe('env status', () => {
  test('--json has the home, tools, media, VMs and next steps', () => {
    setup();
    seedMsdosMedia(s.paths);
    const { code, envelope } = s.json('env', 'status');
    assert.equal(code, 0);
    const data = envelope.data;
    assert.equal(data.home, s.home);
    assert.deepEqual(data.tools.map((t) => t.name), ['86box', '86box-roms', 'jemm', 'freedos']);
    assert.ok(data.tools.every((t) => t.state === 'fetched' && t.strategy === 'download' && t.version));
    assert.deepEqual(data.media.map((m) => m.kind), ['msdos622']);
    assert.deepEqual(data.vms.map((v) => v.name), ['ega-msdos', 'mirror-freedos', 'mirror-msdos', 'slow-386sx']);
    const msdos = data.vms.find((v) => v.name === 'mirror-msdos');
    assert.equal(msdos.c.present, true);
    assert.equal(msdos.d.present, true);
    assert.equal(msdos.baseline, null);
    assert.equal(msdos.running, false);
    assert.ok(data.next.includes('rebeep vm run mirror-msdos --install'));
    assert.ok(!data.next.some((step) => step.includes('media add msdos622')));
  });

  test('the text form prints the home and the sections, and writes nothing', () => {
    const before = fs.existsSync(s.home);
    const result = s.rebeep('env', 'status');
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes(s.home));
    assert.match(result.stdout, /TOOL\s+VERSION\s+STRATEGY\s+STATE/);
    assert.match(result.stdout, /VM\s+C:\s+D:\s+BASELINE\s+RUNNING/);
    assert.equal(fs.existsSync(s.home), before);
    assert.equal(fs.existsSync(s.paths.vms), false);
  });
});

describe('env reset', () => {
  test('--preview lists the VMs and the skipped ones, and changes nothing', () => {
    setup();
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    const before = snapshotTree(s.home);
    const result = s.rebeep('env', 'reset', '--preview');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /would reset mirror-msdos/);
    assert.match(result.stdout, /would skip slow-386sx: no baseline/);
    assert.deepEqual(snapshotTree(s.home), before);
  });

  test('every baseline is verified before anything is changed', () => {
    setup();
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    setup();
    assert.equal(s.rebeep('vm', 'snapshot', 'slow-386sx', '--yes').code, 0);
    marker('mirror-msdos');
    const damaged = fs.readFileSync(s.paths.vm('mirror-msdos').cImg);
    const fd = fs.openSync(s.paths.baseline('slow-386sx').cImg, 'r+');
    fs.writeSync(fd, Buffer.from('tamper'), 0, 6, 0);
    fs.closeSync(fd);

    const result = s.rebeep('env', 'reset', '--yes');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /slow-386sx baseline c\.img does not match/);
    assert.ok(fs.readFileSync(s.paths.vm('mirror-msdos').cImg).equals(damaged), 'mirror-msdos was not touched');
  });

  test('without --yes it exits 2; with it, every VM that has a baseline is reset and the rest are skipped', () => {
    setup();
    marker('mirror-msdos');
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    setup();
    marker('slow-386sx');
    const cImg = s.paths.vm('mirror-msdos').cImg;
    fs.writeFileSync(cImg, 'damaged');

    assert.equal(s.rebeep('env', 'reset').code, 2);
    assert.equal(fs.readFileSync(cImg, 'utf8'), 'damaged');

    const { code, envelope } = s.json('env', 'reset', '--yes');
    assert.equal(code, 0);
    assert.deepEqual(envelope.data.reset, ['mirror-msdos']);
    assert.deepEqual(envelope.data.skipped, ['ega-msdos', 'mirror-freedos', 'slow-386sx']);
    assert.equal(markerOf('mirror-msdos'), 'hand-installed');
    assert.equal(markerOf('slow-386sx'), 'hand-installed', 'a VM with no baseline is left alone');
  });
});

describe('env clean', () => {
  const FOREIGN = ['notes.txt', 'projects'];

  function populate() {
    setup();
    seedMsdosMedia(s.paths);
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    writeFile(path.join(s.paths.mediaGames, 'GPC.zip'), 'zip');
    writeFile(path.join(s.paths.cache, 'download.zip'), 'cached');
    writeFile(path.join(s.home, 'notes.txt'), 'not ours');
    writeFile(path.join(s.home, 'projects', 'work.doc'), 'also not ours');
  }

  test('--preview lists every entry with what would happen, and changes nothing', () => {
    populate();
    const before = snapshotTree(s.home);
    const result = s.rebeep('env', 'clean', '--preview');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /ENTRY\s+SIZE\s+ACTION/);
    for (const name of ['cache', 'tools', 'vms']) assert.match(result.stdout, new RegExp(`^${name}\\s+.*delete`, 'm'));
    assert.match(result.stdout, /^baselines\s+.*kept/m);
    assert.match(result.stdout, /^media\s+.*kept/m);
    assert.match(result.stdout, /^notes\.txt\s+.*not ours, left alone/m);
    assert.match(result.stdout, /baselines\/ is kept/);
    assert.deepEqual(snapshotTree(s.home), before);
  });

  test('without --yes it exits 2 and deletes nothing, after showing what it would delete', () => {
    populate();
    const before = snapshotTree(s.home);
    const result = s.rebeep('env', 'clean');
    assert.equal(result.code, 2);
    assert.match(result.stdout, /ENTRY\s+SIZE\s+ACTION/);
    assert.deepEqual(snapshotTree(s.home), before);
  });

  test('--yes deletes only the known folders: media, baselines and foreign files all survive', () => {
    populate();
    const baselineBefore = hashTree(s.paths.baselines);
    const result = s.json('env', 'clean', '--yes');
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.envelope.data.removed, ['cache', 'tools', 'vms']);
    assert.deepEqual(fs.readdirSync(s.home).sort(), ['baselines', 'media', ...FOREIGN].sort());
    assert.deepEqual(hashTree(s.paths.baselines), baselineBefore);
    assert.equal(fs.readFileSync(path.join(s.home, 'projects', 'work.doc'), 'utf8'), 'also not ours');
    assert.ok(fs.existsSync(path.join(s.paths.mediaGames, 'GPC.zip')));
  });

  test('--all --yes also deletes baselines and media, and still leaves foreign files', () => {
    populate();
    const result = s.json('env', 'clean', '--all', '--yes');
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.envelope.data.removed, ['cache', 'tools', 'vms', 'baselines', 'media']);
    assert.deepEqual(fs.readdirSync(s.home).sort(), FOREIGN.slice().sort());
  });

  test('on an empty or missing home there is nothing to delete', () => {
    fs.rmSync(s.home, { recursive: true });
    const result = s.rebeep('env', 'clean', '--yes');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /nothing to delete/);
  });

  test('refuses a home that is the working folder, contains it, is the user home, or is a root', () => {
    populate();
    const deep = path.join(s.home, 'projects', 'deep');
    fs.mkdirSync(deep, { recursive: true });
    const before = snapshotTree(s.home);
    const clean = (env, opts = {}) => runRebeep(['env', 'clean', '--yes'], { env, cwd: opts.cwd });

    let result = clean(s.env, { cwd: s.home });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /refusing to clean.*the current folder/);

    result = clean(s.env, { cwd: deep });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /is, or contains, the current folder/);

    result = clean({ ...s.env, USERPROFILE: s.home, HOME: s.home });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /your home folder/);

    // --preview, so that a regression here can never delete anything at a real root
    result = runRebeep(['env', 'clean', '--preview', '--home', path.parse(s.home).root], { env: { ...s.env, REBEEP_HOME: undefined } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /filesystem root/);

    assert.deepEqual(snapshotTree(s.home), before);
  });

  test('refuses while a VM is running', async () => {
    populate();
    assert.equal(s.rebeep('vm', 'run', 'mirror-msdos').code, 0);
    await s.fakeRecord();
    const result = s.rebeep('env', 'clean', '--yes');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /mirror-msdos is running/);
    assert.ok(fs.existsSync(s.paths.vm('mirror-msdos').cImg));
  });
});
