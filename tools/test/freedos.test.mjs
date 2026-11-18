import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { CliError } from '../lib/cli.mjs';
import { buildImage, checkImage, readImage, toCrlf } from '../lib/fat.mjs';
import { buildFreedosC, composeFreedosTree } from '../lib/freedos.mjs';
import { toolRecordPath } from '../lib/manifest.mjs';
import { layout, repoLayout } from '../lib/paths.mjs';
import { makeTempDir, removeDir } from './helpers.mjs';
import { makeZip } from './zipfixture.mjs';

const pattern = (length, seed) => Buffer.from(Array.from({ length }, (_, i) => (i * seed + 5) & 0xff));

const MBR_CODE = pattern(446, 13);
const KERNEL = pattern(10000, 31);
const LIVE_KERNEL = Buffer.from('live kernel');
const LIVE_COMMAND = Buffer.from('live command');
const COMMAND = pattern(3000, 17);

/** A 512-byte boot sector whose code area (0x3E-0x1FD) is a recognisable pattern. */
const BOOT_TEMPLATE = (() => {
  const bs = Buffer.alloc(512, 0x11);
  bs.set([0xeb, 0x3c, 0x90]);
  bs.write('FRDOS5.1', 3, 'latin1');
  pattern(0x1fe - 0x3e, 29).copy(bs, 0x3e);
  bs.writeUInt16LE(0xaa55, 510);
  return bs;
})();

const JEMM = {
  'JEMMEX.EXE': Buffer.from('jemmex 5.87'),
  'JEMM386.EXE': Buffer.from('jemm386 5.87'),
  'JLOAD.EXE': Buffer.from('jload 5.87'),
  'QPIEMU.DLL': Buffer.from('qpiemu 5.87'),
};
const FDCONFIG = Buffer.from('!LASTDRIVE=Z\nMENU 1\n');
const FDAUTO = Buffer.from('@ECHO OFF\r\nSET A=B\n');

const defaultPackages = () => ({
  'KERNEL.ZIP': [
    { name: 'APPINFO/', dir: true },
    { name: 'BIN/', dir: true },
    { name: 'BIN/KERNL386.SYS', data: KERNEL },
    { name: 'BIN/COUNTRY.SYS', data: 'country' },
    { name: 'SOURCE/X.C', data: 'int x;' },
  ],
  'FREECOM.ZIP': [
    { name: 'BIN/COMMAND.COM', data: COMMAND },
    { name: 'doc/freecom/readme.txt', data: 'freecom' },
  ],
  'MEM.ZIP': [
    { name: 'BIN/MEM.EXE', data: 'mem' },
    { name: 'BIN/LONGFILENAME.EXE', data: 'long' },
  ],
  'A.ZIP': [{ name: 'DOC/SAME.TXT', data: 'same' }],
  'B.ZIP': [{ name: 'DOC/SAME.TXT', data: 'same' }],
});

/** A synthetic FD14LITE.img: 2 KiB clusters, junk in the live FREEDOS/BIN, packages in PACKAGES/BASE. */
function makeLiveImage(packages = defaultPackages(), root = [
  { path: 'KERNEL.SYS', bytes: LIVE_KERNEL },
  { path: 'COMMAND.COM', bytes: LIVE_COMMAND },
]) {
  const files = [
    ...root,
    { path: 'FREEDOS/BIN/LIVEJUNK.COM', bytes: Buffer.from('junk') },
    { path: 'PACKAGES/BASE/INDEX.LST', bytes: Buffer.from('not a zip') },
  ];
  for (const [name, entries] of Object.entries(packages)) {
    files.push({ path: `PACKAGES/BASE/${name}`, bytes: makeZip(entries) });
  }
  return buildImage({
    geometry: { cylinders: 66, heads: 16, sectorsPerTrack: 63 },
    clusterSize: 2048,
    label: 'FD14-LITE',
    files,
    mbrBootCode: MBR_CODE,
    bootSectorTemplate: BOOT_TEMPLATE,
  }).image;
}

const compose = (packages, root) =>
  composeFreedosTree({ liveImage: makeLiveImage(packages, root), jemmFiles: JEMM, fdconfig: FDCONFIG, fdauto: FDAUTO });

const pathsOf = (tree) => tree.files.map((f) => f.path);
const bytesAt = (tree, p) => tree.files.find((f) => f.path === p)?.bytes;

describe('composeFreedosTree', () => {
  test('lays out the root, the boot files, Jemm and the temp folder', () => {
    const tree = compose();
    assert.deepEqual(tree.bootFiles, ['KERNEL.SYS', 'COMMAND.COM']);
    assert.deepEqual(tree.dirs, ['FREEDOS/TEMP']);
    assert.deepEqual(bytesAt(tree, 'KERNEL.SYS'), KERNEL);
    assert.deepEqual(bytesAt(tree, 'COMMAND.COM'), COMMAND);
    assert.deepEqual(bytesAt(tree, 'FDCONFIG.SYS'), Buffer.from('!LASTDRIVE=Z\r\nMENU 1\r\n'));
    assert.deepEqual(bytesAt(tree, 'FDAUTO.BAT'), Buffer.from('@ECHO OFF\r\nSET A=B\r\n'));
    for (const [name, bytes] of Object.entries(JEMM)) assert.deepEqual(bytesAt(tree, `JEMM/${name}`), bytes);
    assert.deepEqual(tree.mbrBootCode, MBR_CODE);
    assert.equal(tree.bootSectorTemplate.length, 512);
    assert.deepEqual(tree.bootSectorTemplate.subarray(0x3e, 0x1fe), BOOT_TEMPLATE.subarray(0x3e, 0x1fe));
  });

  test('installs the packages uppercased under FREEDOS and leaves out sources and the live folder', () => {
    const paths = pathsOf(compose());
    assert.ok(paths.includes('FREEDOS/BIN/MEM.EXE'));
    assert.ok(paths.includes('FREEDOS/BIN/COUNTRY.SYS'));
    assert.ok(paths.includes('FREEDOS/DOC/FREECOM/README.TXT'));
    assert.ok(!paths.some((p) => /SOURCE|X\.C$/.test(p)));
    assert.ok(!paths.some((p) => p.includes('LIVEJUNK') || p.includes('INDEX')));
  });

  test('skips non-8.3 names with one warning, and names the file', () => {
    const tree = compose();
    assert.ok(!pathsOf(tree).some((p) => p.includes('LONGFILENAME')));
    const warnings = tree.warnings.filter((w) => w.includes('8.3'));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /1 package file.*FREEDOS\/BIN\/LONGFILENAME\.EXE/);
  });

  test('caps the examples in the invalid-name warning', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ name: `DOC/TOOLONGNAME${i}.TXT`, data: 'x' }));
    const warning = compose({ ...defaultPackages(), 'MANY.ZIP': many }).warnings.find((w) => w.includes('8.3'));
    assert.match(warning, /^skipped 26 /);
    assert.equal(warning.match(/FREEDOS\//g).length, 10);
    assert.ok(warning.endsWith('...'));
  });

  test('a duplicate path with the same bytes is silent; different bytes warn and keep the first', () => {
    assert.ok(!compose().warnings.some((w) => w.includes('SAME.TXT')));
    const tree = compose({ ...defaultPackages(), 'B.ZIP': [{ name: 'DOC/SAME.TXT', data: 'other' }] });
    const warning = tree.warnings.find((w) => w.includes('SAME.TXT'));
    assert.match(warning, /FREEDOS\/DOC\/SAME\.TXT \(A\.ZIP kept, B\.ZIP ignored\)/);
    assert.deepEqual(bytesAt(tree, 'FREEDOS/DOC/SAME.TXT'), Buffer.from('same'));
    assert.equal(pathsOf(tree).filter((p) => p === 'FREEDOS/DOC/SAME.TXT').length, 1);
  });

  test('keeps CPI, and skips entries outside the known folders with a warning', () => {
    const tree = compose({
      ...defaultPackages(),
      'EXTRA.ZIP': [
        { name: 'CPI/EGA.CPX', data: 'cpi' },
        { name: 'LINKS/MENU.LNK', data: 'link' },
        { name: 'README', data: 'loose' },
      ],
    });
    assert.ok(pathsOf(tree).includes('FREEDOS/CPI/EGA.CPX'));
    assert.ok(!pathsOf(tree).some((p) => p.includes('LINKS') || p.endsWith('/README')));
    const warning = tree.warnings.find((w) => w.includes('outside the known folders'));
    assert.match(warning, /EXTRA\.ZIP:LINKS\/MENU\.LNK/);
    assert.match(warning, /EXTRA\.ZIP:README/);
  });

  test('warns when CHKDSK is not installed, and not when it is', () => {
    assert.ok(compose().warnings.some((w) => w.includes('CHKDSK')));
    const withChkdsk = compose({ ...defaultPackages(), 'CHKDSK.ZIP': [{ name: 'BIN/CHKDSK.EXE', data: 'chk' }] });
    assert.ok(!withChkdsk.warnings.some((w) => w.includes('CHKDSK')));
  });

  test('falls back to the live KERNEL.SYS and COMMAND.COM, with warnings', () => {
    const { 'FREECOM.ZIP': _command, ...noShell } = defaultPackages();
    const tree = compose({
      ...noShell,
      'KERNEL.ZIP': [{ name: 'BIN/COUNTRY.SYS', data: 'country' }],
    });
    assert.deepEqual(bytesAt(tree, 'KERNEL.SYS'), LIVE_KERNEL);
    assert.deepEqual(bytesAt(tree, 'COMMAND.COM'), LIVE_COMMAND);
    assert.ok(tree.warnings.some((w) => w.includes('KERNL386.SYS') && w.includes("live image's KERNEL.SYS")));
    assert.ok(tree.warnings.some((w) => w.includes('COMMAND.COM') && w.includes("live image's COMMAND.COM")));
  });

  test('a missing KERNEL.ZIP falls back to the live kernel when COUNTRY.SYS comes from elsewhere', () => {
    const { 'KERNEL.ZIP': _kernel, ...rest } = defaultPackages();
    const tree = compose({ ...rest, 'COUNTRY.ZIP': [{ name: 'BIN/COUNTRY.SYS', data: 'country' }] });
    assert.deepEqual(bytesAt(tree, 'KERNEL.SYS'), LIVE_KERNEL);
    assert.ok(tree.warnings.some((w) => w.includes("live image's KERNEL.SYS")));
  });

  test('fails with every problem listed when the disk would not boot', () => {
    const { 'KERNEL.ZIP': _kernel, 'MEM.ZIP': _mem, ...rest } = defaultPackages();
    assert.throws(
      () => compose(rest, []),
      (err) => err instanceof CliError &&
        /KERNEL\.SYS is missing/.test(err.message) &&
        /COUNTRY\.SYS is missing/.test(err.message) &&
        /MEM\.EXE is missing/.test(err.message),
    );
  });

  test('an empty package kernel and a missing Jemm file are refused', () => {
    const emptyKernel = { ...defaultPackages(), 'KERNEL.ZIP': [{ name: 'BIN/KERNL386.SYS', data: '' }, { name: 'BIN/COUNTRY.SYS', data: 'c' }] };
    assert.ok(compose(emptyKernel).warnings.some((w) => w.includes("live image's KERNEL.SYS")));
    assert.throws(
      () => composeFreedosTree({
        liveImage: makeLiveImage(),
        jemmFiles: { ...JEMM, 'JLOAD.EXE': Buffer.alloc(0) },
        fdconfig: FDCONFIG,
        fdauto: FDAUTO,
      }),
      /JEMM\/JLOAD\.EXE is missing or empty/,
    );
  });

  test('a live image without BASE packages is refused', () => {
    assert.throws(() => compose({}), /no PACKAGES\/BASE/);
  });

  test('a corrupt package names itself in the error', () => {
    assert.throws(
      () => compose({ ...defaultPackages(), 'BAD.ZIP': [{ name: 'BIN/X.EXE', data: 'x', crc: 1 }] }),
      (err) => err instanceof CliError && /BIN\/X\.EXE from package BAD\.ZIP/.test(err.message),
    );
  });
});

/**
 * What the FreeDOS FAT16 boot sector does, from the BPB alone: find `KERNEL  SYS` in the root,
 * follow its chain in the first FAT and read the clusters in order.
 */
function loadKernelFromBpb(image) {
  const partition = image.readUInt32LE(0x1be + 8) * 512;
  const bs = image.subarray(partition, partition + 512);
  const bytesPerSector = bs.readUInt16LE(0x0b);
  const sectorsPerCluster = bs[0x0d];
  const hidden = bs.readUInt32LE(0x1c);
  const fatStart = hidden + bs.readUInt16LE(0x0e);
  const sectorsPerFat = bs.readUInt16LE(0x16);
  const rootStart = fatStart + bs[0x10] * sectorsPerFat;
  const rootSectors = bs.readUInt16LE(0x11) / (bytesPerSector / 32);
  const dataStart = rootStart + rootSectors;

  const root = image.subarray(rootStart * bytesPerSector, dataStart * bytesPerSector);
  let index = 0;
  while (root.toString('latin1', index * 32, index * 32 + 11) !== 'KERNEL  SYS') index++;
  const size = root.readUInt32LE(index * 32 + 28);
  let cluster = root.readUInt16LE(index * 32 + 26);
  const firstCluster = cluster;

  const fat = image.subarray(fatStart * bytesPerSector, (fatStart + sectorsPerFat) * bytesPerSector);
  const parts = [];
  while (cluster < 0xfff8) {
    const at = (dataStart + (cluster - 2) * sectorsPerCluster) * bytesPerSector;
    parts.push(image.subarray(at, at + sectorsPerCluster * bytesPerSector));
    cluster = fat.readUInt16LE(cluster * 2);
  }
  return { bytes: Buffer.concat(parts).subarray(0, size), firstCluster, rootIndex: index };
}

describe('buildFreedosC', () => {
  let tmp;
  beforeEach(() => {
    tmp = makeTempDir('rebeep-freedos-');
  });
  afterEach(() => removeDir(tmp));

  const profile = {
    c: { geometry: { cylinders: 260, heads: 16, sectorsPerTrack: 63 }, clusterSize: 4096, label: 'FREEDOS' },
  };

  /** A temp home whose fetched tools hold the synthetic image and Jemm files, in odd case and subfolders. */
  function makeCtx({ liveImage = makeLiveImage(), jemm = JEMM, fetched = ['freedos', 'jemm'] } = {}) {
    const manifest = path.join(tmp, 'manifest.json');
    const asset = { url: 'https://example.invalid/x.zip', sha256: 'a'.repeat(64), archive: 'zip' };
    fs.writeFileSync(manifest, JSON.stringify({
      tools: {
        freedos: { version: '1.4', description: 'f', platforms: { any: asset } },
        jemm: { version: '5.87', description: 'j', platforms: { any: asset } },
      },
    }));
    const paths = layout(path.join(tmp, 'home'));
    const seed = (name, version, files) => {
      const dir = paths.tool(name, version);
      for (const [rel, bytes] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), bytes);
      }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(toolRecordPath(paths, name, version), '{}');
    };
    if (fetched.includes('freedos')) seed('freedos', '1.4', { 'FD14-LiteUSB/fd14lite.img': liveImage });
    if (fetched.includes('jemm')) {
      seed('jemm', '5.87', Object.fromEntries(Object.entries(jemm).map(([n, b]) => [`Jemm/${n.toLowerCase()}`, b])));
    }
    return { paths, repo: repoLayout(), env: { REBEEP_MANIFEST: manifest } };
  }

  test('builds a bootable, consistent 260/16/63 image with FreeDOS boot code', async () => {
    const { image, warnings } = await buildFreedosC(makeCtx(), profile);
    assert.ok(Array.isArray(warnings));
    assert.deepEqual(checkImage(image), { ok: true, errors: [] });
    assert.equal(image.length, 260 * 16 * 63 * 512);

    assert.deepEqual(image.subarray(0, 446), MBR_CODE);
    const fs16 = readImage(image);
    const { bpb, bootSector } = fs16;
    assert.equal(bpb.hiddenSectors, 63);
    assert.equal(bpb.sectorsPerCluster, 8);
    assert.equal(bpb.heads, 16);
    assert.equal(bpb.sectorsPerTrack, 63);
    assert.equal(bpb.label, 'FREEDOS');
    assert.deepEqual(bootSector.subarray(0, 0x0b), BOOT_TEMPLATE.subarray(0, 0x0b));
    assert.deepEqual(bootSector.subarray(0x3e, 0x1fe), BOOT_TEMPLATE.subarray(0x3e, 0x1fe));
    assert.equal(bootSector.readUInt16LE(510), 0xaa55);
  });

  test('the boot sector finds KERNEL.SYS first in the root, at cluster 2, through the BPB alone', async () => {
    const { image } = await buildFreedosC(makeCtx(), profile);
    const loaded = loadKernelFromBpb(image);
    assert.equal(loaded.rootIndex, 1);
    assert.equal(loaded.firstCluster, 2);
    assert.deepEqual(loaded.bytes, KERNEL);
  });

  test('writes the root, Jemm, packages and the repo boot files into the image', async () => {
    const { image } = await buildFreedosC(makeCtx(), profile);
    const disk = readImage(image);
    const root = disk.list().filter((e) => !e.path.includes('/')).map((e) => e.path);
    assert.deepEqual(root, ['KERNEL.SYS', 'COMMAND.COM', 'FDCONFIG.SYS', 'FDAUTO.BAT', 'JEMM', 'FREEDOS']);
    assert.deepEqual(disk.readFile('COMMAND.COM'), COMMAND);
    for (const [name, bytes] of Object.entries(JEMM)) assert.deepEqual(disk.readFile(`JEMM/${name}`), bytes);
    assert.ok(disk.exists('FREEDOS/TEMP'));
    assert.deepEqual(disk.readFile('FREEDOS/DOC/FREECOM/README.TXT'), Buffer.from('freecom'));
    assert.ok(!disk.exists('FREEDOS/BIN/LIVEJUNK.COM'));

    const dos = path.join(repoLayout().dos, 'freedos');
    assert.deepEqual(disk.readFile('FDCONFIG.SYS'), toCrlf(fs.readFileSync(path.join(dos, 'FDCONFIG.SYS'))));
    assert.deepEqual(disk.readFile('FDAUTO.BAT'), toCrlf(fs.readFileSync(path.join(dos, 'FDAUTO.BAT'))));
  });

  test('returns the compose warnings', async () => {
    const { warnings } = await buildFreedosC(makeCtx(), profile);
    assert.ok(warnings.some((w) => w.includes('LONGFILENAME')));
  });

  test('a missing FD14LITE.img is a clear CliError', async () => {
    const ctx = makeCtx();
    fs.rmSync(path.join(ctx.paths.tool('freedos', '1.4'), 'FD14-LiteUSB'), { recursive: true });
    await assert.rejects(buildFreedosC(ctx, profile), (err) => err instanceof CliError && /FD14LITE\.img was not found/.test(err.message));
  });

  test('a missing Jemm file is a CliError with a hint', async () => {
    const { 'QPIEMU.DLL': _gone, ...partial } = JEMM;
    await assert.rejects(
      buildFreedosC(makeCtx({ jemm: partial }), profile),
      (err) => err instanceof CliError && /QPIEMU\.DLL was not found/.test(err.message) && /tool fetch jemm/.test(err.hint),
    );
  });

  test('an unfetched tool is a CliError with a hint', async () => {
    await assert.rejects(
      buildFreedosC(makeCtx({ fetched: ['jemm'] }), profile),
      (err) => err instanceof CliError && /not fetched/.test(err.message) && /tool fetch freedos/.test(err.hint),
    );
  });

  test('a profile without a C: size is a CliError', async () => {
    await assert.rejects(buildFreedosC(makeCtx(), { c: {} }), CliError);
  });
});
