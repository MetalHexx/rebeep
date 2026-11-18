import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { deployDisk } from '../commands/disk.mjs';
import { composeDelivery } from '../lib/delivery.mjs';
import { checkImage, readImage } from '../lib/fat.mjs';
import { repoLayout } from '../lib/paths.mjs';
import { hashTree } from '../lib/zip.mjs';
import { seedEnv, writeFile } from './vmenv.mjs';
import { makeZip } from './zipfixture.mjs';

const GAME = [
  { name: 'game/' , dir: true },
  { name: 'game/GAME.EXE', data: 'MZ game bytes' },
  { name: 'game/DATA/LEVEL1.DAT', data: 'level one', method: 8 },
  { name: 'game/EMPTY/', dir: true },
  { name: 'game/a long name.txt', data: 'skip me' },
];

let s;
beforeEach(() => {
  s = seedEnv('rebeep-disk-');
});
afterEach(() => s.cleanup());

const addGame = (name, entries = GAME) => writeFile(path.join(s.paths.mediaGames, `${name}.zip`), makeZip(entries));
const readD = (vm = 'mirror-msdos') => readImage(fs.readFileSync(s.paths.vm(vm).dImg));
const listed = (image) => image.list().map((e) => e.path.toUpperCase());

/** A command context for calling the library directly, with `build/` pointed at a temp folder. */
function context(buildDir = path.join(s.tmp, 'build')) {
  return { paths: s.paths, repo: { ...repoLayout(), build: buildDir }, env: s.env };
}

describe('disk deploy', () => {
  test('builds a D: with the env files, JEMM and the game, and the image checks out', () => {
    addGame('GPC');
    assert.equal(s.rebeep('vm', 'create', 'mirror-msdos').code, 0);
    const result = s.json('disk', 'deploy');
    assert.equal(result.code, 0, result.stderr);

    const buf = fs.readFileSync(s.paths.vm('mirror-msdos').dImg);
    assert.deepEqual(checkImage(buf), { ok: true, errors: [] });
    const image = readImage(buf);
    assert.equal(image.bpb.label, 'REBEEP');
    const names = listed(image);
    for (const wanted of [
      'README.TXT', 'ENV/BOOT.BAT', 'ENV/MSDOS622/CONFIG.SYS', 'ENV/MSDOS622/AUTOEXEC.BAT',
      'ENV/FREEDOS/FDCONFIG.SYS', 'JEMM/JEMMEX.EXE', 'JEMM/QPIEMU.DLL', 'GAMES/GPC/GAME.EXE',
      'GAMES/GPC/DATA/LEVEL1.DAT', 'GAMES/GPC/EMPTY', 'REBEEP',
    ]) {
      assert.ok(names.includes(wanted), `${wanted} is on D:`);
    }
    assert.ok(!names.some((n) => n.includes('.REBEEP-TOOL')), 'the tool record is left out');

    const boot = image.readFile('ENV/BOOT.BAT');
    assert.ok(boot.includes('\r\n'));
    assert.ok(!/[^\r]\n/.test(boot.toString('latin1')), 'every line ends in CRLF');
    assert.equal(image.readFile('GAMES/GPC/GAME.EXE').toString(), 'MZ game bytes');
    assert.equal(image.readFile('GAMES/GPC/DATA/LEVEL1.DAT').toString(), 'level one');
    assert.equal(image.readFile('JEMM/JEMMEX.EXE').toString(), 'placeholder JEMMEX.EXE');
  });

  test('a game file with a long name is skipped, with a warning that names the game', () => {
    addGame('GPC');
    s.rebeep('vm', 'create', 'mirror-msdos');
    const { envelope } = s.json('disk', 'deploy', 'mirror-msdos');
    const [deployed] = envelope.data.deployed;
    assert.ok(deployed.skipped.some((n) => n.includes('a long name.txt')));
    assert.ok(deployed.warnings.some((w) => /GPC/.test(w) && /8\.3/.test(w)));
    assert.ok(!listed(readD()).some((n) => n.includes('LONG')));
  });

  test('a hostile zip entry skips that game instead of failing the deploy', () => {
    addGame('BAD', [{ name: '../escape.exe', data: 'x' }, { name: 'ok.exe', data: 'y' }]);
    addGame('GPC');
    s.rebeep('vm', 'create', 'mirror-msdos');
    const { code, envelope } = s.json('disk', 'deploy');
    assert.equal(code, 0);
    assert.ok(envelope.data.warnings.some((w) => /game BAD skipped/.test(w)));
    const names = listed(readD());
    assert.ok(names.includes('GAMES/GPC/GAME.EXE'));
    assert.ok(!names.some((n) => n.startsWith('GAMES/BAD')));
    assert.equal(fs.existsSync(path.join(s.tmp, 'escape.exe')), false);
  });

  test('an unreadable zip skips just that game', () => {
    writeFile(path.join(s.paths.mediaGames, 'JUNK.zip'), 'not a zip');
    s.rebeep('vm', 'create', 'mirror-msdos');
    const { code, envelope } = s.json('disk', 'deploy');
    assert.equal(code, 0);
    assert.ok(envelope.data.warnings.some((w) => /game JUNK skipped/.test(w)));
  });

  test('puts REBEEP.COM on D: when build.json lists a deploy target, and warns when nothing is built', () => {
    const ctx = context();
    fs.mkdirSync(path.dirname(s.paths.vm('mirror-msdos').dImg), { recursive: true });

    const empty = composeDelivery(ctx);
    assert.ok(empty.warnings.includes('nothing built yet, so REBEEP\\ is empty'));
    assert.ok(empty.dirs.includes('REBEEP'));
    const emptyImage = (deployDisk(ctx, 'mirror-msdos'), readD());
    assert.ok(emptyImage.list().some((e) => e.path.toUpperCase() === 'REBEEP' && e.isDir));

    writeFile(path.join(ctx.repo.build, 'REBEEP.COM'), 'com bytes');
    writeFile(path.join(ctx.repo.build, 'REBEEP.MAP'), 'not deployed');
    writeFile(
      path.join(ctx.repo.build, 'build.json'),
      JSON.stringify({
        builtAt: new Date().toISOString(),
        nasm: '3.02',
        targets: [
          { name: 'REBEEP.COM', size: 9, sha256: 'x', deploy: 'REBEEP' },
          { name: 'REBEEP.MAP', size: 12, sha256: 'x' },
          { name: 'GONE.COM', size: 1, sha256: 'x', deploy: 'REBEEP' },
        ],
      }),
    );
    const report = deployDisk(ctx, 'mirror-msdos');
    assert.ok(report.warnings.some((w) => /GONE\.COM.*missing/.test(w)));
    assert.ok(!report.warnings.some((w) => /nothing built/.test(w)));
    const image = readD();
    assert.equal(image.readFile('REBEEP/REBEEP.COM').toString(), 'com bytes');
    assert.ok(!image.exists('REBEEP/REBEEP.MAP'));
    assert.deepEqual(checkImage(fs.readFileSync(s.paths.vm('mirror-msdos').dImg)).ok, true);
  });

  test('writes AUTOLOAD.FLG next to an autoload target that was built, and only then', () => {
    const ctx = context();
    fs.mkdirSync(path.dirname(s.paths.vm('mirror-msdos').dImg), { recursive: true });
    writeFile(path.join(ctx.repo.build, 'REBEEP.COM'), 'com bytes');
    writeFile(path.join(ctx.repo.build, 'RBTEST.COM'), 'test bytes');
    const manifest = (targets) =>
      writeFile(path.join(ctx.repo.build, 'build.json'), JSON.stringify({ builtAt: '', nasm: '3.02', targets }));

    manifest([
      { name: 'REBEEP.COM', size: 9, sha256: 'x', deploy: 'REBEEP', autoload: true },
      { name: 'RBTEST.COM', size: 10, sha256: 'x', deploy: 'REBEEP', autoload: false },
    ]);
    deployDisk(ctx, 'mirror-msdos');
    assert.equal(readD().readFile('REBEEP/AUTOLOAD.FLG').toString(), 'autoload\r\n');

    manifest([
      { name: 'REBEEP.COM', size: 9, sha256: 'x', deploy: 'REBEEP', autoload: false },
      { name: 'RBTEST.COM', size: 10, sha256: 'x', deploy: 'REBEEP' },
    ]);
    deployDisk(ctx, 'mirror-msdos');
    assert.ok(!readD().exists('REBEEP/AUTOLOAD.FLG'));

    manifest([{ name: 'GONE.COM', size: 1, sha256: 'x', deploy: 'REBEEP', autoload: true }]);
    const report = deployDisk(ctx, 'mirror-msdos');
    assert.ok(report.warnings.some((w) => /GONE\.COM.*missing/.test(w)));
    assert.ok(!readD().exists('REBEEP/AUTOLOAD.FLG'));
  });

  test('without JEMM fetched the disk is still built, with a warning', () => {
    fs.rmSync(path.join(s.paths.tool('jemm', '5.87'), '.rebeep-tool.json'));
    const ctx = context();
    fs.mkdirSync(path.dirname(s.paths.vm('mirror-msdos').dImg), { recursive: true });
    const report = deployDisk(ctx, 'mirror-msdos');
    assert.ok(report.warnings.some((w) => /jemm is not fetched/.test(w)));
    assert.ok(!listed(readD()).some((n) => n.startsWith('JEMM/')));
    assert.ok(readD().exists('JEMM'));
  });

  test('replaces D: through a temp file and reports what it wrote', () => {
    s.rebeep('vm', 'create', 'mirror-msdos');
    const { envelope } = s.json('disk', 'deploy', 'mirror-msdos');
    const [deployed] = envelope.data.deployed;
    assert.equal(deployed.vm, 'mirror-msdos');
    assert.ok(deployed.files > 5);
    assert.ok(deployed.bytesUsed > 0);
    assert.deepEqual(fs.readdirSync(s.paths.vm('mirror-msdos').dir).filter((n) => n.includes('.tmp')), []);
  });

  test('with no VM created it says so and exits 0; a named VM that is not created is an error with a hint', () => {
    const none = s.rebeep('disk', 'deploy');
    assert.equal(none.code, 0, none.stderr);
    assert.match(none.stdout, /no VMs are created yet/);
    assert.equal(fs.existsSync(s.paths.vms), false);

    const named = s.json('disk', 'deploy', 'mirror-msdos');
    assert.equal(named.code, 1);
    assert.equal(named.envelope.error.hint, 'rebeep vm create mirror-msdos');
    assert.equal(s.rebeep('disk', 'deploy', 'nope').code, 2);
  });

  test('deploys to every created VM, and only those', () => {
    s.rebeep('vm', 'create', 'mirror-msdos');
    const { envelope } = s.json('disk', 'deploy');
    assert.deepEqual(envelope.data.deployed.map((d) => d.vm), ['mirror-msdos']);
  });

  test('refuses while that VM runs', async () => {
    s.rebeep('vm', 'create', 'mirror-msdos');
    assert.equal(s.rebeep('vm', 'run', 'mirror-msdos').code, 0);
    await s.fakeRecord();
    const before = fs.readFileSync(s.paths.vm('mirror-msdos').dImg);
    const result = s.rebeep('disk', 'deploy', 'mirror-msdos');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /mirror-msdos is running/);
    assert.ok(fs.readFileSync(s.paths.vm('mirror-msdos').dImg).equals(before));
  });
});

describe('disk list', () => {
  test('shows the composed tree with sizes and writes nothing', () => {
    addGame('GPC');
    s.rebeep('vm', 'create', 'mirror-msdos');
    const before = hashTree(s.home);

    const text = s.rebeep('disk', 'list');
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /PATH\s+SIZE/);
    assert.match(text.stdout, /GAMES\/GPC\/GAME\.EXE/);

    const { envelope } = s.json('disk', 'list', 'slow-386sx');
    const files = Object.fromEntries(envelope.data.files.map((f) => [f.path, f.size]));
    assert.equal(files['GAMES/GPC/GAME.EXE'], 'MZ game bytes'.length);
    assert.ok(files['ENV/BOOT.BAT'] > 0);
    assert.ok(envelope.data.dirs.includes('REBEEP'));
    assert.deepEqual(hashTree(s.home), before);
    assert.equal(s.rebeep('disk', 'list', 'nope').code, 2);
  });

  test('lists without creating the home folder', () => {
    assert.equal(s.rebeep('disk', 'list').code, 0);
    assert.equal(fs.existsSync(s.paths.vms), false);
    assert.equal(fs.existsSync(s.paths.globalCfg), false);
  });
});

describe('one odd game never blocks D:', () => {
  const deployed = () => {
    s.rebeep('vm', 'create', 'mirror-msdos');
    const result = s.json('disk', 'deploy');
    assert.equal(result.code, 0, result.stderr);
    return result.envelope.data;
  };

  test('paths that collide when case is ignored keep the first and warn', () => {
    addGame('GPC', [
      { name: 'game/DATA.TXT', data: 'first' },
      { name: 'game/data.txt', data: 'second' },
      { name: 'game/SUB', data: 'a file' },
      { name: 'game/sub/X.TXT', data: 'under a file' },
      { name: 'game/OK.TXT', data: 'fine' },
    ]);
    const data = deployed();
    assert.ok(data.warnings.some((w) => /game GPC: skipped 2 entries.*collide/.test(w)), data.warnings.join('\n'));
    const image = readD();
    assert.equal(image.readFile('GAMES/GPC/DATA.TXT').toString(), 'first');
    assert.equal(image.readFile('GAMES/GPC/OK.TXT').toString(), 'fine');
    assert.equal(image.readFile('GAMES/GPC/SUB').toString(), 'a file');
    assert.ok(!image.exists('GAMES/GPC/SUB/X.TXT'));
  });

  test('a game that does not fit is skipped by name; the others stay', () => {
    addGame('AAA', [{ name: 'small.txt', data: 'fits' }]);
    addGame('BIG', [{ name: 'huge.dat', data: Buffer.alloc(70 * 1024 * 1024), method: 8 }]);
    addGame('ZZZ', [{ name: 'small.txt', data: 'also fits' }]);
    const data = deployed();
    assert.ok(data.warnings.some((w) => /game BIG skipped: it needs \d+ clusters but D: has \d+ left/.test(w)));
    const names = listed(readD());
    assert.ok(names.includes('GAMES/AAA/SMALL.TXT'));
    assert.ok(names.includes('GAMES/ZZZ/SMALL.TXT'));
    assert.ok(!names.some((n) => n.startsWith('GAMES/BIG')));
  });

  test('a zip whose data is corrupt skips just that game', () => {
    addGame('BAD', [{ name: 'ok.txt', data: 'x' }, { name: 'bad.txt', data: 'y', crc: 12345 }]);
    addGame('GPC');
    const data = deployed();
    assert.ok(data.warnings.some((w) => /game BAD skipped: .*CRC/.test(w)), data.warnings.join('\n'));
    const names = listed(readD());
    assert.ok(names.includes('GAMES/GPC/GAME.EXE'));
    assert.ok(!names.some((n) => n.startsWith('GAMES/BAD')));
  });
});
