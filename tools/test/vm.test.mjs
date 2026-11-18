import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import vmNoun from '../commands/vm.mjs';
import { sha256File } from '../lib/download.mjs';
import { createLog } from '../lib/log.mjs';
import { repoLayout } from '../lib/paths.mjs';
import { launchDetached } from '../lib/proc.mjs';
import { hashTree } from '../lib/zip.mjs';
import { captureStreams } from './helpers.mjs';
import { FAKE_86BOX, alive, seedEnv, seedMsdosMedia, snapshotTree, waitFor, writeFile } from './vmenv.mjs';

const C_BYTES = 260 * 16 * 63 * 512;
const real = (p) => fs.realpathSync.native(p);

let s;
beforeEach(() => {
  s = seedEnv('rebeep-vm-');
});
afterEach(() => s.cleanup());

const vmPaths = (name) => s.paths.vm(name);
const markC = (name, byte) => {
  const fd = fs.openSync(vmPaths(name).cImg, 'r+');
  fs.writeSync(fd, Buffer.alloc(16, byte), 0, 16, 4096);
  fs.closeSync(fd);
};
const create = (name = 'mirror-msdos') => {
  const result = s.rebeep('vm', 'create', name);
  assert.equal(result.code, 0, result.stderr);
  return result;
};
const stopVm = async (name) => {
  const { pid } = JSON.parse(fs.readFileSync(vmPaths(name).pid, 'utf8'));
  process.kill(pid);
  await waitFor(() => !alive(pid), { what: 'the fake to exit' });
};

describe('vm create', () => {
  test('a blank route makes a zero-filled C: of the profile geometry, the folders, and D:', () => {
    create();
    const vm = vmPaths('mirror-msdos');
    assert.equal(fs.statSync(vm.cImg).size, C_BYTES);
    assert.ok(fs.readFileSync(vm.cImg).subarray(0, 1 << 20).every((b) => b === 0));
    assert.ok(fs.statSync(vm.dImg).size > 0);
    assert.ok(fs.statSync(vm.nvr).isDirectory());
    assert.ok(fs.statSync(vm.floppy).isDirectory());
    assert.deepEqual(fs.readdirSync(vm.dir).filter((n) => n.endsWith('.tmp')), []);
  });

  test('creating again skips without --force and leaves c.img untouched', () => {
    create();
    markC('mirror-msdos', 7);
    const before = fs.readFileSync(vmPaths('mirror-msdos').cImg).subarray(4096, 4112);
    const again = s.rebeep('vm', 'create', 'mirror-msdos');
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, /already exists, kept/);
    assert.deepEqual(fs.readFileSync(vmPaths('mirror-msdos').cImg).subarray(4096, 4112), before);
  });

  test('--force needs --yes: without it, it exits 2 and leaves c.img alone', () => {
    create();
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    markC('mirror-msdos', 7);
    const result = s.rebeep('vm', 'create', 'mirror-msdos', '--force');
    assert.equal(result.code, 2);
    assert.match(result.stderr, /needs --yes/);
    assert.equal(fs.readFileSync(vmPaths('mirror-msdos').cImg)[4096], 7);
  });

  test('--force on a blank route is refused without a baseline, and replaces C: with one', () => {
    create();
    markC('mirror-msdos', 7);
    const refused = s.json('vm', 'create', 'mirror-msdos', '--force', '--yes');
    assert.equal(refused.code, 1);
    assert.match(refused.envelope.error.hint, /vm reset mirror-msdos --rebuild/);
    assert.equal(fs.readFileSync(vmPaths('mirror-msdos').cImg)[4096], 7);

    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    assert.equal(s.rebeep('vm', 'create', 'mirror-msdos', '--force', '--yes').code, 0);
    assert.ok(fs.readFileSync(vmPaths('mirror-msdos').cImg).subarray(4096, 4112).every((b) => b === 0));
  });

  test('create --preview changes nothing, even empty folders', () => {
    create();
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    const before = snapshotTree(s.home);
    for (const args of [['mirror-msdos', '--force'], ['slow-386sx'], ['mirror-freedos']]) {
      const result = s.rebeep('vm', 'create', ...args, '--preview');
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /would (replace|create)/);
    }
    assert.deepEqual(snapshotTree(s.home), before);
  });

  test('a clone without a baseline fails with the snapshot hint and creates nothing', () => {
    const result = s.json('vm', 'create', 'slow-386sx');
    assert.equal(result.code, 1);
    assert.match(result.envelope.error.message, /mirror-msdos, which has no baseline/);
    assert.equal(result.envelope.error.hint, 'rebeep vm snapshot mirror-msdos');
    assert.equal(fs.existsSync(vmPaths('slow-386sx').dir), false);
  });

  test('a clone copies the baseline C: but not its NVR', () => {
    create();
    markC('mirror-msdos', 9);
    writeFile(path.join(vmPaths('mirror-msdos').nvr, 'machine.nvr'), 'cmos');
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);

    create('slow-386sx');
    const clone = vmPaths('slow-386sx');
    assert.equal(fs.statSync(clone.cImg).size, C_BYTES);
    assert.ok(fs.readFileSync(clone.cImg).subarray(4096, 4112).every((b) => b === 9));
    assert.deepEqual(fs.readdirSync(clone.nvr), []);
  });

  test('a clone refuses a baseline whose geometry differs from the profile', () => {
    create();
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    const { meta } = s.paths.baseline('mirror-msdos');
    const data = JSON.parse(fs.readFileSync(meta, 'utf8'));
    data.geometry.cylinders = 100;
    fs.writeFileSync(meta, JSON.stringify(data));
    const result = s.rebeep('vm', 'create', 'slow-386sx');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /geometry 100\/16\/63/);
  });

  test('the build route fails clearly when the FreeDOS builder module is missing', () => {
    const result = s.json('vm', 'create', 'mirror-freedos');
    assert.equal(result.code, 1);
    assert.equal(result.envelope.error.message, 'The FreeDOS C: builder could not be loaded');
    assert.equal(fs.existsSync(vmPaths('mirror-freedos').dir), false);
  });

  test('the build route writes the builder image and logs its warnings; reset rebuilds it', () => {
    const builder = path.join(s.tmp, 'builder.mjs');
    fs.writeFileSync(
      builder,
      "export async function buildFreedosC(ctx, profile) {\n  return { image: Buffer.from(profile.name), warnings: ['builder says hi'] };\n}\n",
    );
    s.env.REBEEP_FREEDOS_BUILDER = builder;
    const result = s.rebeep('vm', 'create', 'mirror-freedos');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /builder says hi/);
    const vm = vmPaths('mirror-freedos');
    assert.equal(fs.readFileSync(vm.cImg, 'utf8'), 'mirror-freedos');

    fs.writeFileSync(vm.cImg, 'damaged');
    writeFile(path.join(vm.nvr, 'x.nvr'), 'x');
    const reset = s.rebeep('vm', 'reset', 'mirror-freedos', '--yes');
    assert.equal(reset.code, 0, reset.stderr);
    assert.match(reset.stdout, /no baseline, rebuilding/);
    assert.equal(fs.readFileSync(vm.cImg, 'utf8'), 'mirror-freedos');
    assert.deepEqual(fs.readdirSync(vm.nvr), []);
  });

  test('a builder that is broken, rather than missing, is reported as it is', () => {
    const broken = path.join(s.tmp, 'broken.mjs');
    fs.writeFileSync(broken, 'export const = ;');
    s.env.REBEEP_FREEDOS_BUILDER = broken;
    let result = s.rebeep('vm', 'create', 'mirror-freedos');
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stderr, /could not be loaded/);
    assert.match(result.stderr, /SyntaxError|Unexpected token/);

    const transitive = path.join(s.tmp, 'transitive.mjs');
    fs.writeFileSync(transitive, "import './not-there.mjs';\nexport async function buildFreedosC() {}\n");
    s.env.REBEEP_FREEDOS_BUILDER = transitive;
    result = s.rebeep('vm', 'create', 'mirror-freedos');
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stderr, /could not be loaded/);
    assert.match(result.stderr, /not-there\.mjs/);
    assert.equal(fs.existsSync(vmPaths('mirror-freedos').dir), false);
  });

  test('a missing ROM is named, and an unfetched tool says how to fetch it', () => {
    fs.rmSync(path.join(s.paths.tool('86box-roms', '6.0'), 'roms', 'video', 'et4000', 'ET4000.BIN'));
    let result = s.rebeep('vm', 'create', 'mirror-msdos');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing ROM: video\/et4000\/ET4000\.BIN/);
    assert.equal(fs.existsSync(vmPaths('mirror-msdos').dir), false);

    fs.rmSync(path.join(s.paths.tool('jemm', '5.87'), '.rebeep-tool.json'));
    result = s.rebeep('vm', 'create', 'mirror-msdos');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /jemm 5\.87 is not fetched/);
    assert.match(result.stderr, /rebeep tool fetch jemm/);
  });

  test('an unknown VM is a usage error that lists the valid ones', () => {
    const result = s.rebeep('vm', 'create', 'nope');
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Valid VMs: mirror-freedos, mirror-msdos, slow-386sx/);
  });
});

describe('vm run', () => {
  test('launches 86Box detached with the right arguments, renders the cfg and records the pid', async () => {
    create();
    const result = s.rebeep('vm', 'run', 'mirror-msdos');
    assert.equal(result.code, 0, result.stderr);
    const vm = vmPaths('mirror-msdos');
    const record = await s.fakeRecord();

    assert.deepEqual(record.argv, [
      '-P', vm.dir,
      '-R', path.join(s.paths.tool('86box-roms', '6.0'), 'roms'),
      '-O', s.paths.globalCfg,
      '-N',
      '-V', 'mirror-msdos',
    ]);
    assert.ok(!record.argv.includes('-I'));
    assert.equal(real(record.cwd), real(vm.dir));

    const cfg = fs.readFileSync(vm.cfg, 'utf8');
    assert.match(cfg, /^hdd_01_fn = c\.img$/m);
    assert.match(cfg, /^hdd_02_fn = d\.img$/m);
    assert.doesNotMatch(cfg, /fdd_01_fn/);
    assert.match(fs.readFileSync(s.paths.globalCfg, 'utf8'), /vmm_disabled = 1/);

    const pidRecord = JSON.parse(fs.readFileSync(vm.pid, 'utf8'));
    assert.equal(pidRecord.pid, record.pid);
    assert.match(result.stdout, new RegExp(`pid ${record.pid}`));
    assert.equal(s.json('vm', 'list').envelope.data.vms.find((v) => v.name === 'mirror-msdos').running, true);
  });

  test('refuses a VM that is already running, and snapshot and reset refuse too', async () => {
    create();
    assert.equal(s.rebeep('vm', 'run', 'mirror-msdos').code, 0);
    await s.fakeRecord();
    for (const verb of [['run'], ['snapshot', '--yes'], ['reset', '--yes'], ['create', '--force', '--yes']]) {
      const result = s.rebeep('vm', verb[0], 'mirror-msdos', ...verb.slice(1));
      assert.equal(result.code, 1, verb.join(' '));
      assert.match(result.stderr, /mirror-msdos is running\. Quit 86Box first\./);
    }
    const deploy = s.rebeep('disk', 'deploy', 'mirror-msdos');
    assert.equal(deploy.code, 1);
    assert.match(deploy.stderr, /is running/);

    await stopVm('mirror-msdos');
    assert.equal(s.json('vm', 'list').envelope.data.vms.find((v) => v.name === 'mirror-msdos').running, false);
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
  });

  test('deploys D: first when d.img is missing', async () => {
    create();
    fs.rmSync(vmPaths('mirror-msdos').dImg);
    assert.equal(s.rebeep('vm', 'run', 'mirror-msdos').code, 0);
    await s.fakeRecord();
    assert.ok(fs.existsSync(vmPaths('mirror-msdos').dImg));
  });

  test('--install copies the floppies, attaches no D:, keeps a floppy already there, and never writes the source media', async () => {
    create();
    const media = seedMsdosMedia(s.paths);
    const sourceHashes = hashTree(media);
    const vm = vmPaths('mirror-msdos');
    writeFile(path.join(vm.floppy, 'DISK1.IMA'), 'mid-install');

    const result = s.rebeep('vm', 'run', 'mirror-msdos', '--install');
    assert.equal(result.code, 0, result.stderr);
    await s.fakeRecord();

    assert.deepEqual(fs.readdirSync(vm.floppy).sort(), ['DISK1.IMA', 'DISK2.IMA', 'DISK3.IMA', 'source.json']);
    assert.equal(fs.readFileSync(path.join(vm.floppy, 'DISK1.IMA'), 'utf8'), 'mid-install');
    assert.equal(fs.readFileSync(path.join(vm.floppy, 'DISK2.IMA'))[0], 2);
    const cfg = fs.readFileSync(vm.cfg, 'utf8');
    assert.match(cfg, /^fdd_01_fn = floppy\/DISK1\.IMA$/m);
    assert.doesNotMatch(cfg, /hdd_02/);
    assert.deepEqual(hashTree(media), sourceHashes);
    for (const name of ['DISK1.IMA', 'DISK2.IMA', 'DISK3.IMA']) assert.ok(result.stdout.includes(path.join(vm.floppy, name)), name);
    assert.match(result.stdout, /Del/);
  });

  test('--install without the media says how to import it, and a VM with no C: says how to create it', () => {
    create();
    const install = s.rebeep('vm', 'run', 'mirror-msdos', '--install');
    assert.equal(install.code, 1);
    assert.match(install.stderr, /missing install media: DISK1\.IMA/);
    assert.match(install.stderr, /rebeep media add msdos622/);

    const none = s.rebeep('vm', 'run', 'slow-386sx');
    assert.equal(none.code, 1);
    assert.match(none.stderr, /rebeep vm create slow-386sx/);
  });
});

describe('vm snapshot and reset', () => {
  const nvrFile = (name) => path.join(vmPaths(name).nvr, 'machine.nvr');

  test('snapshot writes the baseline and meta; damage then reset restores C:, the NVR and D:', async () => {
    create();
    const vm = vmPaths('mirror-msdos');
    markC('mirror-msdos', 5);
    writeFile(nvrFile('mirror-msdos'), 'cmos-v1');
    const wanted = await sha256File(vm.cImg);

    const snap = s.json('vm', 'snapshot', 'mirror-msdos', '--yes');
    assert.equal(snap.code, 0, snap.stderr);
    const baseline = s.paths.baseline('mirror-msdos');
    const meta = JSON.parse(fs.readFileSync(baseline.meta, 'utf8'));
    assert.equal(meta.vm, 'mirror-msdos');
    assert.equal(meta.sha256, wanted);
    assert.equal(meta.size, C_BYTES);
    assert.deepEqual(meta.geometry, { cylinders: 260, heads: 16, sectorsPerTrack: 63 });
    assert.deepEqual(meta.tools, { '86box': '6.0', '86box-roms': '6.0', jemm: '5.87' });
    assert.ok(!Number.isNaN(Date.parse(meta.createdAt)));
    assert.equal(fs.readFileSync(path.join(baseline.nvr, 'machine.nvr'), 'utf8'), 'cmos-v1');

    markC('mirror-msdos', 0xee);
    fs.writeFileSync(nvrFile('mirror-msdos'), 'cmos-damaged');
    writeFile(path.join(vm.nvr, 'extra.nvr'), 'x');
    writeFile(path.join(vm.floppy, 'DISK1.IMA'), 'x');
    fs.rmSync(vm.dImg);

    const reset = s.rebeep('vm', 'reset', 'mirror-msdos', '--yes');
    assert.equal(reset.code, 0, reset.stderr);
    assert.equal(await sha256File(vm.cImg), wanted);
    assert.equal(fs.readFileSync(nvrFile('mirror-msdos'), 'utf8'), 'cmos-v1');
    assert.deepEqual(fs.readdirSync(vm.nvr), ['machine.nvr']);
    assert.deepEqual(fs.readdirSync(vm.floppy), []);
    assert.ok(fs.existsSync(vm.dImg));
  });

  test('replacing an existing baseline needs a confirmation', () => {
    create();
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos').code, 0, 'the first snapshot replaces nothing');
    const result = s.rebeep('vm', 'snapshot', 'mirror-msdos');
    assert.equal(result.code, 2);
    assert.match(result.stderr, /needs --yes/);
    assert.equal(s.rebeep('vm', 'reset', 'mirror-msdos').code, 2);
  });

  test('--preview changes nothing under the home folder', () => {
    create();
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    markC('mirror-msdos', 3);
    const before = hashTree(s.home);

    const snap = s.rebeep('vm', 'snapshot', 'mirror-msdos', '--preview');
    assert.equal(snap.code, 0, snap.stderr);
    assert.match(snap.stdout, /would save/);
    const reset = s.rebeep('vm', 'reset', 'mirror-msdos', '--preview');
    assert.equal(reset.code, 0, reset.stderr);
    assert.match(reset.stdout, /would replace/);
    assert.deepEqual(hashTree(s.home), before);
  });

  test('without a baseline a blank route refuses to reset, and --rebuild wipes it', () => {
    create();
    const vm = vmPaths('mirror-msdos');
    markC('mirror-msdos', 4);
    writeFile(path.join(vm.nvr, 'machine.nvr'), 'x');
    writeFile(path.join(vm.floppy, 'DISK1.IMA'), 'x');

    const refused = s.rebeep('vm', 'reset', 'mirror-msdos', '--yes');
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /--rebuild/);
    assert.equal(fs.readFileSync(vm.cImg).subarray(4096, 4112)[0], 4, 'nothing was touched');

    const rebuilt = s.rebeep('vm', 'reset', 'mirror-msdos', '--rebuild', '--yes');
    assert.equal(rebuilt.code, 0, rebuilt.stderr);
    assert.ok(fs.readFileSync(vm.cImg).subarray(4096, 4112).every((b) => b === 0));
    assert.deepEqual(fs.readdirSync(vm.nvr), []);
    assert.deepEqual(fs.readdirSync(vm.floppy), []);
  });

  test('a baseline for a different geometry, or one that was tampered with, is refused', () => {
    create();
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    const baseline = s.paths.baseline('mirror-msdos');

    const fd = fs.openSync(baseline.cImg, 'r+');
    fs.writeSync(fd, Buffer.from('tamper'), 0, 6, 0);
    fs.closeSync(fd);
    let result = s.rebeep('vm', 'reset', 'mirror-msdos', '--yes');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /does not match its meta\.json/);

    const meta = JSON.parse(fs.readFileSync(baseline.meta, 'utf8'));
    meta.geometry.heads = 8;
    fs.writeFileSync(baseline.meta, JSON.stringify(meta));
    result = s.rebeep('vm', 'reset', 'mirror-msdos', '--yes');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /geometry 260\/8\/63/);
  });
});

describe('vm list and show', () => {
  test('list reports every profile; show gives the profile, paths and disk states', () => {
    create();
    const list = s.json('vm', 'list').envelope.data.vms;
    assert.deepEqual(list.map((v) => v.name), ['mirror-freedos', 'mirror-msdos', 'slow-386sx']);
    const msdos = list.find((v) => v.name === 'mirror-msdos');
    assert.equal(msdos.c.bytes, C_BYTES);
    assert.equal(msdos.d.present, true);
    assert.equal(msdos.baseline, null);
    assert.equal(list.find((v) => v.name === 'slow-386sx').c.present, false);

    const show = s.json('vm', 'show', 'mirror-msdos').envelope.data;
    assert.equal(show.profile.dos, 'msdos622');
    assert.equal(show.paths.cImg, vmPaths('mirror-msdos').cImg);
    assert.equal(show.baseline, 'none');
    assert.equal(show.disks.c.present, true);

    const text = s.rebeep('vm', 'list').stdout;
    assert.match(text, /NAME\s+DESCRIPTION\s+DOS\s+C:\s+D:\s+BASELINE\s+RUNNING/);
  });
});

describe('snapshot safety', () => {
  const baselineIntact = async (name = 'mirror-msdos') => {
    const baseline = s.paths.baseline(name);
    const meta = JSON.parse(fs.readFileSync(baseline.meta, 'utf8'));
    assert.equal(await sha256File(baseline.cImg), meta.sha256);
    return meta;
  };

  test('a snapshot that fails part-way leaves the old baseline whole and findable', async () => {
    create();
    markC('mirror-msdos', 5);
    writeFile(path.join(vmPaths('mirror-msdos').nvr, 'machine.nvr'), 'cmos-v1');
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    const first = await baselineIntact();

    // a C: that cannot be copied (a folder where the image should be) fails the second snapshot
    fs.rmSync(vmPaths('mirror-msdos').cImg);
    fs.mkdirSync(vmPaths('mirror-msdos').cImg);
    const result = s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes');
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stderr, /is running/, 'it failed in the copy, not in the running check');

    assert.deepEqual(await baselineIntact(), first);
    assert.equal(fs.readFileSync(path.join(s.paths.baseline('mirror-msdos').nvr, 'machine.nvr'), 'utf8'), 'cmos-v1');
    assert.deepEqual(fs.readdirSync(s.paths.baselines).sort(), ['mirror-msdos'], 'no .new or .old is left behind');
    assert.deepEqual(fs.readdirSync(vmPaths('mirror-msdos').dir).filter((n) => n.endsWith('.tmp')), []);
  });

  test('a baseline moved aside by an interrupted snapshot is put back', () => {
    create();
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    const { dir } = s.paths.baseline('mirror-msdos');
    fs.renameSync(dir, `${dir}.old`);
    const result = s.rebeep('vm', 'reset', 'mirror-msdos', '--yes');
    assert.equal(result.code, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'meta.json')));
    assert.equal(fs.existsSync(`${dir}.old`), false);
  });

  test('a clone refuses a source baseline whose c.img was tampered with', () => {
    create();
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    const fd = fs.openSync(s.paths.baseline('mirror-msdos').cImg, 'r+');
    fs.writeSync(fd, Buffer.from('tamper'), 0, 6, 0);
    fs.closeSync(fd);
    const result = s.rebeep('vm', 'create', 'slow-386sx');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /does not match its meta\.json/);
    assert.equal(fs.existsSync(vmPaths('slow-386sx').dir), false);
  });
});

describe('vm create with a D: that cannot be built', () => {
  test('C: is created and D: is a warning, not a failure', () => {
    const big = path.join(s.paths.tool('jemm', '5.87'), 'BIG.BIN');
    const fd = fs.openSync(big, 'w');
    fs.ftruncateSync(fd, 70 * 1024 * 1024);
    fs.closeSync(fd);

    const result = s.json('vm', 'create', 'mirror-msdos');
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.envelope.data.deploy, null);
    assert.match(result.stderr, /D: was not deployed/);
    assert.equal(fs.statSync(vmPaths('mirror-msdos').cImg).size, C_BYTES);
    assert.equal(fs.existsSync(vmPaths('mirror-msdos').dImg), false);
  });
});

describe('read-only commands', () => {
  test('list, status and previews leave a stale pid file, and every folder, alone', () => {
    create();
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    const pidFile = vmPaths('mirror-msdos').pid;
    const dead = spawnSync(process.execPath, ['-e', '']);
    fs.writeFileSync(pidFile, JSON.stringify({ pid: dead.pid, names: ['86Box'] }));
    fs.mkdirSync(path.join(s.home, 'vms', 'mirror-msdos', 'empty-dir'));
    const before = snapshotTree(s.home);

    for (const args of [
      ['vm', 'list'],
      ['env', 'status'],
      ['vm', 'snapshot', 'mirror-msdos', '--preview'],
      ['vm', 'reset', 'mirror-msdos', '--preview'],
      ['env', 'reset', '--preview'],
      ['env', 'clean', '--preview'],
      ['env', 'clean', '--all', '--preview'],
    ]) {
      const result = s.rebeep(...args);
      assert.equal(result.code, 0, `${args.join(' ')}: ${result.stderr}`);
    }
    assert.deepEqual(snapshotTree(s.home), before);
    assert.ok(fs.existsSync(pidFile));
  });

  test('a damaged meta.json shows as invalid instead of breaking list and status', () => {
    create();
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    const { meta } = s.paths.baseline('mirror-msdos');
    for (const content of ['not json', '{}', JSON.stringify({ sha256: 'x', geometry: {}, createdAt: 'yesterday' })]) {
      fs.writeFileSync(meta, content);
      const list = s.rebeep('vm', 'list');
      assert.equal(list.code, 0, list.stderr);
      assert.match(list.stdout, /mirror-msdos.*invalid/);
      assert.equal(s.json('env', 'status').code, 0);
      assert.equal(s.json('vm', 'list').envelope.data.vms.find((v) => v.name === 'mirror-msdos').baseline.invalid, true);
    }
    const reset = s.rebeep('vm', 'reset', 'mirror-msdos', '--yes');
    assert.equal(reset.code, 1);
    assert.match(reset.stderr, /meta\.json is unusable/);
  });
});

/** A command context for running a verb in-process, so a test can act between its steps. */
function context(overrides = {}) {
  const streams = captureStreams();
  return {
    streams,
    ctx: {
      noun: 'vm',
      args: {},
      opts: {},
      json: false,
      preview: false,
      yes: true,
      confirm: async () => true,
      paths: s.paths,
      repo: repoLayout(),
      log: createLog({ stdout: streams.stdout, stderr: streams.stderr, color: false }),
      env: s.env,
      ...overrides,
    },
  };
}
const verbOf = (name) => vmNoun.verbs.find((v) => v.name === name);
const startFake = (name) => launchDetached(process.execPath, [FAKE_86BOX], { cwd: vmPaths(name).dir, pidFile: vmPaths(name).pid });

describe('install floppies', () => {
  const FLOPPY = 1474560;
  const SETS = { '120m': 1228800, '144m': FLOPPY, '720k': 737280 };
  const NAMES = ['x86BOOT.img', ...[1, 2, 3, 4, 5, 6].map((n) => `x86DSK0${n}.img`)];

  /** A fetched freedos-floppy tool laid out like the real zip: 120m/, 144m/ and 720k/ with the same file names. */
  function seedFloppyTool() {
    const manifest = JSON.parse(fs.readFileSync(s.manifestFile, 'utf8'));
    manifest.tools['freedos-floppy'] = {
      version: '1.4',
      description: 'test',
      onDemand: true,
      platforms: { any: { url: 'http://127.0.0.1:9/x.zip', sha256: 'a'.repeat(64), archive: 'zip' } },
    };
    fs.writeFileSync(s.manifestFile, JSON.stringify(manifest));
    const dir = s.paths.tool('freedos-floppy', '1.4');
    writeFile(path.join(dir, '.rebeep-tool.json'), JSON.stringify({ name: 'freedos-floppy', version: '1.4', sha256: 'a'.repeat(64), files: {} }));
    for (const [set, size] of Object.entries(SETS)) {
      for (const name of NAMES) writeFile(path.join(dir, set, name), Buffer.alloc(size, set.charCodeAt(0)));
    }
    return dir;
  }

  function useBuilder() {
    const builder = path.join(s.tmp, 'builder.mjs');
    fs.writeFileSync(builder, 'export async function buildFreedosC() {\n  return { image: Buffer.from("c"), warnings: [] };\n}\n');
    s.env.REBEEP_FREEDOS_BUILDER = builder;
    const created = s.rebeep('vm', 'create', 'mirror-freedos');
    assert.equal(created.code, 0, created.stderr);
  }

  test('the listed 144m floppies are attached in order, and the other sets are left out', () => {
    seedFloppyTool();
    useBuilder();
    const result = s.rebeep('vm', 'run', 'mirror-freedos', '--install');
    assert.equal(result.code, 0, result.stderr);
    const vm = vmPaths('mirror-freedos');
    assert.deepEqual(fs.readdirSync(vm.floppy).sort(), [...NAMES, 'source.json'].sort());
    for (const name of NAMES) {
      const bytes = fs.readFileSync(path.join(vm.floppy, name));
      assert.equal(bytes.length, FLOPPY, name);
      assert.equal(bytes[0], '1'.charCodeAt(0), `${name} comes from 144m`);
    }
    assert.match(fs.readFileSync(vm.cfg, 'utf8'), /^fdd_01_fn = floppy\/x86BOOT\.img$/m);
    const order = NAMES.map((n) => result.stdout.indexOf(path.join(vm.floppy, n)));
    assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), 'the paths are printed in attach order');
    assert.doesNotMatch(result.stderr, /bytes, not the/);
  });

  test('an image that is not floppy-sized is warned about, and a missing one is an error', () => {
    const dir = seedFloppyTool();
    useBuilder();
    fs.writeFileSync(path.join(dir, '144m', 'x86DSK03.img'), Buffer.alloc(1000));
    let result = s.rebeep('vm', 'run', 'mirror-freedos', '--install');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /x86DSK03\.img is 1000 bytes, not the 1474560/);

    fs.rmSync(vmPaths('mirror-freedos').pid);
    fs.rmSync(path.join(dir, '144m', 'x86DSK05.img'));
    result = s.rebeep('vm', 'run', 'mirror-freedos', '--install');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing install media: x86DSK05\.img/);
  });

  test('a tool and folder without a list picks only that folder, sorted', async () => {
    seedFloppyTool();
    const profiles = path.join(s.tmp, 'profiles');
    fs.cpSync(path.join(repoLayout().profiles, 'mirror-freedos'), path.join(profiles, 'mirror-freedos'), { recursive: true });
    const file = path.join(profiles, 'mirror-freedos', 'profile.json');
    const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
    profile.install = { tool: 'freedos-floppy', folder: '144m' };
    fs.writeFileSync(file, JSON.stringify(profile));
    writeFile(vmPaths('mirror-freedos').cImg, 'c');

    const { ctx } = context({ args: { vm: 'mirror-freedos' }, opts: { install: true }, repo: { ...repoLayout(), profiles } });
    const result = await verbOf('run').run(ctx);
    assert.deepEqual(result.floppies.map((f) => path.basename(f)), [...NAMES].sort());
    assert.equal(fs.readdirSync(vmPaths('mirror-freedos').floppy).filter((n) => n !== 'source.json').length, NAMES.length);
  });
});

describe('install floppy copies', () => {
  test('a re-imported disk replaces its copy; a copy whose source is unchanged is kept', async () => {
    create();
    const media = seedMsdosMedia(s.paths);
    const vm = vmPaths('mirror-msdos');
    assert.equal(s.rebeep('vm', 'run', 'mirror-msdos', '--install').code, 0);
    await s.fakeRecord();
    const record = JSON.parse(fs.readFileSync(path.join(vm.floppy, 'source.json'), 'utf8'));
    assert.deepEqual(Object.keys(record).sort(), ['DISK1.IMA', 'DISK2.IMA', 'DISK3.IMA']);
    assert.equal(record['DISK2.IMA'], await sha256File(path.join(media, 'DISK2.IMA')));
    await stopVm('mirror-msdos');
    s.clearFakeRecord();

    fs.writeFileSync(path.join(media, 'DISK2.IMA'), Buffer.alloc(2048, 99));
    fs.writeFileSync(path.join(vm.floppy, 'DISK3.IMA'), 'user progress');
    const result = s.rebeep('vm', 'run', 'mirror-msdos', '--install');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /replaced: DISK2\.IMA/);
    assert.equal(fs.readFileSync(path.join(vm.floppy, 'DISK2.IMA'))[0], 99);
    assert.equal(fs.readFileSync(path.join(vm.floppy, 'DISK3.IMA'), 'utf8'), 'user progress');
    const after = JSON.parse(fs.readFileSync(path.join(vm.floppy, 'source.json'), 'utf8'));
    assert.equal(after['DISK2.IMA'], await sha256File(path.join(media, 'DISK2.IMA')));
  });
});

describe('a VM that starts while a verb waits for its confirmation', () => {
  test('reset refuses and changes nothing', async () => {
    create();
    markC('mirror-msdos', 5);
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    markC('mirror-msdos', 0xee);
    const vm = vmPaths('mirror-msdos');
    const before = await sha256File(vm.cImg);

    const { ctx } = context({
      args: { vm: 'mirror-msdos' },
      opts: { rebuild: false },
      yes: false,
      confirm: async () => {
        await startFake('mirror-msdos');
        return true;
      },
    });
    await assert.rejects(verbOf('reset').run(ctx), /mirror-msdos is running/);
    assert.equal(await sha256File(vm.cImg), before);
    assert.deepEqual(fs.readdirSync(vm.floppy), []);
  });

  test('snapshot refuses and leaves the old baseline alone', async () => {
    create();
    assert.equal(s.rebeep('vm', 'snapshot', 'mirror-msdos', '--yes').code, 0);
    const baseline = s.paths.baseline('mirror-msdos');
    const before = fs.readFileSync(baseline.meta, 'utf8');
    markC('mirror-msdos', 0xee);

    const { ctx } = context({
      args: { vm: 'mirror-msdos' },
      yes: false,
      confirm: async () => {
        await startFake('mirror-msdos');
        return true;
      },
    });
    await assert.rejects(verbOf('snapshot').run(ctx), /mirror-msdos is running/);
    assert.equal(fs.readFileSync(baseline.meta, 'utf8'), before);
    assert.deepEqual(fs.readdirSync(s.paths.baselines), ['mirror-msdos']);
  });
});
