import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SECTOR, buildFloppy, buildImage, checkImage, readImage, to83, toCrlf } from '../lib/fat.mjs';

const PART = 63 * SECTOR;
const SMALL = { cylinders: 30 };
const D_GEOMETRY = { cylinders: 130 };
const C_GEOMETRY = { cylinders: 260 };

const build = (extra = {}) => buildImage({ geometry: SMALL, clusterSize: 2048, ...extra });

function pattern(length, seed) {
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + seed * 7 + (i >> 8)) & 0xff;
  return out;
}

/** The tree every round-trip test uses, with the expected result worked out by hand. */
function fixture() {
  const files = [
    { path: 'AUTOEXEC.BAT', bytes: toCrlf(Buffer.from('@echo off\nPATH C:\\DOS\nrebeep\n')) },
    { path: 'GAMES/ONE/TWO/DEEP.DAT', bytes: pattern(5000, 1) },
    { path: 'DATA/MULTI.BIN', bytes: pattern(2048 * 3 + 100, 2) },
    { path: 'DATA/ONE.BIN', bytes: pattern(2048, 3) },
    { path: 'DATA/TWO.BIN', bytes: pattern(4096, 4) },
    { path: 'EMPTY.TXT', bytes: Buffer.alloc(0) },
    { path: 'lower\\case.txt', read: () => pattern(10, 5) },
  ];
  const expectedFiles = new Map([
    ['AUTOEXEC.BAT', files[0].bytes],
    ['GAMES/ONE/TWO/DEEP.DAT', files[1].bytes],
    ['DATA/MULTI.BIN', files[2].bytes],
    ['DATA/ONE.BIN', files[3].bytes],
    ['DATA/TWO.BIN', files[4].bytes],
    ['EMPTY.TXT', files[5].bytes],
    ['LOWER/CASE.TXT', pattern(10, 5)],
  ]);
  for (let i = 0; i < 70; i++) {
    const bytes = Buffer.from(`file ${i}`);
    files.push({ path: `BIG/F${String(i).padStart(3, '0')}.TXT`, bytes });
    expectedFiles.set(`BIG/F${String(i).padStart(3, '0')}.TXT`, bytes);
  }
  const dirs = ['EMPTYDIR', 'games/zed'];
  const expectedDirs = new Set([
    'GAMES', 'GAMES/ONE', 'GAMES/ONE/TWO', 'GAMES/ZED', 'DATA', 'BIG', 'LOWER', 'EMPTYDIR',
  ]);
  return { files, dirs, expectedFiles, expectedDirs };
}

function assertClean(image) {
  assert.deepEqual(checkImage(image).errors, []);
}

/** Independent decoding of the partition layout, straight from the boot sector bytes. */
function layoutOf(image) {
  const spc = image[PART + 0x0d];
  const reserved = image.readUInt16LE(PART + 0x0e);
  const fats = image[PART + 0x10];
  const rootEntries = image.readUInt16LE(PART + 0x11);
  const spf = image.readUInt16LE(PART + 0x16);
  const fatStart = PART + reserved * SECTOR;
  const rootStart = fatStart + fats * spf * SECTOR;
  const dataStart = rootStart + rootEntries * 32;
  const clusterBytes = spc * SECTOR;
  return {
    spc,
    spf,
    fatStart,
    rootStart,
    dataStart,
    clusterBytes,
    fatAt: (copy, cluster) => fatStart + copy * spf * SECTOR + cluster * 2,
    clusterAt: (cluster) => dataStart + (cluster - 2) * clusterBytes,
    fat: (cluster) => image.readUInt16LE(fatStart + cluster * 2),
  };
}

function rootEntries(image) {
  const { rootStart } = layoutOf(image);
  const out = [];
  for (let at = rootStart; image[at] !== 0; at += 32) {
    out.push({
      at,
      name: image.toString('latin1', at, at + 11),
      attr: image[at + 11],
      cluster: image.readUInt16LE(at + 26),
      size: image.readUInt32LE(at + 28),
    });
  }
  return out;
}

function setFat(image, cluster, value, copies = [0, 1]) {
  const layout = layoutOf(image);
  for (const copy of copies) image.writeUInt16LE(value, layout.fatAt(copy, cluster));
}

/** Smallest FAT that covers the clusters, by brute force. */
function expectedSizing(cylinders, clusterSize) {
  const partition = cylinders * 16 * 63 - 63;
  const spc = clusterSize / SECTOR;
  for (let spf = 1; ; spf++) {
    const clusters = Math.floor((partition - 1 - 2 * spf - 32) / spc);
    if (Math.ceil(((clusters + 2) * 2) / SECTOR) <= spf) return { spf, spc, clusters, partition };
  }
}

describe('round trip', () => {
  const { files, dirs, expectedFiles, expectedDirs } = fixture();
  const { image, skipped } = build({ files, dirs, label: 'rebeep d' });

  it('lists exactly the tree and every file reads back byte for byte', () => {
    const disk = readImage(image);
    const listing = disk.list();
    assert.deepEqual(skipped, []);
    assert.deepEqual(
      listing.filter((e) => e.isDir).map((e) => e.path).sort(),
      [...expectedDirs].sort(),
    );
    assert.deepEqual(
      listing.filter((e) => !e.isDir).map((e) => e.path).sort(),
      [...expectedFiles.keys()].sort(),
    );
    for (const [path, bytes] of expectedFiles) {
      const entry = listing.find((e) => e.path === path);
      assert.equal(entry.size, bytes.length, path);
      assert.equal(entry.attr, 0x20, path);
      assert.ok(disk.readFile(path).equals(bytes), path);
    }
    for (const dir of expectedDirs) assert.equal(listing.find((e) => e.path === dir).attr, 0x10, dir);
  });

  it('is clean, including a directory that spans two clusters', () => {
    assertClean(image);
    const layout = layoutOf(image);
    const big = rootEntries(image).find((e) => e.name.startsWith('BIG'));
    assert.equal(layout.fat(big.cluster), big.cluster + 1);
    assert.equal(layout.fat(big.cluster + 1), 0xffff);
  });

  it('keeps empty files at cluster 0 and exact multiples of the cluster size at exact lengths', () => {
    const layout = layoutOf(image);
    const empty = rootEntries(image).find((e) => e.name.startsWith('EMPTY'));
    assert.equal(empty.cluster, 0);
    assert.equal(empty.size, 0);
    const disk = readImage(image);
    assert.equal(disk.readFile('DATA/ONE.BIN').length, layout.clusterBytes);
    assert.equal(disk.readFile('DATA/TWO.BIN').length, layout.clusterBytes * 2);
  });

  it('lists depth first in input order', () => {
    const { image: small } = build({
      files: [
        { path: 'B/X.TXT', bytes: Buffer.from('x') },
        { path: 'A.TXT', bytes: Buffer.from('a') },
        { path: 'B/Y/Z.TXT', bytes: Buffer.from('z') },
        { path: 'C.TXT', bytes: Buffer.from('c') },
      ],
      dirs: ['E'],
    });
    assert.deepEqual(readImage(small).list().map((e) => e.path), [
      'B', 'B/X.TXT', 'B/Y', 'B/Y/Z.TXT', 'A.TXT', 'C.TXT', 'E',
    ]);
  });

  it('looks files up without regard to case or separator style', () => {
    const disk = readImage(image);
    assert.ok(disk.readFile('games\\one/two\\deep.dat').equals(expectedFiles.get('GAMES/ONE/TWO/DEEP.DAT')));
    assert.equal(disk.exists('data'), true);
    assert.equal(disk.exists('Data/One.Bin'), true);
    assert.equal(disk.exists('DATA/NOPE.BIN'), false);
    assert.equal(disk.exists('AUTOEXEC.BAT/X'), false);
    assert.throws(() => disk.readFile('NOPE.TXT'), /not found/);
    assert.throws(() => disk.readFile('DATA'), /directory/);
  });

  it('reports sensible stats', () => {
    const { stats, image: img } = build({ files: [
      { path: 'TWO.BIN', bytes: pattern(3000, 1) },
      { path: 'SUB/ONE.BIN', bytes: pattern(1, 2) },
    ] });
    const layout = layoutOf(img);
    assert.equal(stats.usedClusters, 4);
    assert.equal(stats.freeClusters, stats.clusterCount - 4);
    let allocated = 0;
    for (let c = 2; c < stats.clusterCount + 2; c++) if (layout.fat(c) !== 0) allocated++;
    assert.equal(allocated, stats.usedClusters);
    assert.equal(stats.sectorsPerCluster, 4);
    assert.equal(stats.totalSectors, 30 * 16 * 63);
    assert.equal(stats.partitionSectors, stats.totalSectors - 63);
  });
});

describe('checkImage', () => {
  const { image: baseline } = build({
    files: [
      { path: 'A.BIN', bytes: pattern(2048 * 2 + 5, 1) },
      { path: 'B.BIN', bytes: pattern(2048 + 5, 2) },
      { path: 'SUB/C.BIN', bytes: pattern(100, 3) },
    ],
  });
  const find = (image, prefix) => rootEntries(image).find((e) => e.name.startsWith(prefix));
  const corrupt = (mutate) => {
    const image = Buffer.from(baseline);
    mutate(image);
    return checkImage(image);
  };

  it('accepts the untouched baseline', () => assertClean(baseline));

  it('catches a cross-link', () => {
    const result = corrupt((img) => setFat(img, find(img, 'B').cluster + 1, find(img, 'A').cluster + 1));
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /cross-linked/);
  });

  it('catches a chain that loops', () => {
    const result = corrupt((img) => setFat(img, find(img, 'A').cluster + 2, find(img, 'A').cluster));
    assert.match(result.errors.join('\n'), /loops/);
  });

  it('catches FATs that differ', () => {
    const result = corrupt((img) => setFat(img, 3000, 0xffff, [1]));
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /FAT 2 differs/);
  });

  it('catches a truncated chain and the clusters it orphans', () => {
    const result = corrupt((img) => setFat(img, find(img, 'A').cluster + 1, 0xffff));
    const text = result.errors.join('\n');
    assert.match(text, /A\.BIN: size \d+ needs 3 cluster\(s\) but the chain has 2/);
    assert.match(text, /1 lost cluster/);
  });

  it('catches a chain that runs into a free cluster or out of range', () => {
    assert.match(corrupt((img) => setFat(img, find(img, 'A').cluster, 0)).errors.join('\n'), /free cluster/);
    assert.match(corrupt((img) => setFat(img, find(img, 'A').cluster, 0xfff0)).errors.join('\n'), /outside the data area/);
  });

  it('catches a size that disagrees with the chain', () => {
    const result = corrupt((img) => img.writeUInt32LE(2048 * 10, find(img, 'B').at + 28));
    assert.match(result.errors.join('\n'), /B\.BIN: size 20480 needs 10 cluster/);
  });

  it('catches a bad "." or ".." entry', () => {
    const sub = find(baseline, 'SUB').cluster;
    const dotdot = corrupt((img) => img.writeUInt16LE(sub + 40, layoutOf(img).clusterAt(sub) + 32 + 26));
    assert.match(dotdot.errors.join('\n'), /"\.\." entry/);
    const dot = corrupt((img) => img.writeUInt16LE(sub + 40, layoutOf(img).clusterAt(sub) + 26));
    assert.match(dot.errors.join('\n'), /"\." entry/);
  });

  it('catches a directory entry with a non-zero size', () => {
    const result = corrupt((img) => img.writeUInt32LE(4096, find(img, 'SUB').at + 28));
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /SUB: directory entry has non-zero size 4096/);
  });

  it('catches duplicate names in a directory, ignoring case', () => {
    const result = corrupt((img) => img.write('a       bin', find(img, 'B').at, 11, 'latin1'));
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /\/: duplicate name a\.bin/);
  });

  describe('timestamps', () => {
    const word = (year, month, day) => ((year - 1980) << 9) | (month << 5) | day;
    const CREATE = 16;
    const ACCESS = 18;
    const WRITE = 24;
    const check = (offset, value) => corrupt((img) => img.writeUInt16LE(value, find(img, 'A').at + offset));

    it('catches an invalid month or day in any date field', () => {
      assert.match(check(WRITE, word(2001, 13, 1)).errors.join('\n'), /A\.BIN: invalid write date \(month 13, day 1\)/);
      assert.match(check(CREATE, word(2001, 5, 0)).errors.join('\n'), /A\.BIN: invalid create date \(month 5, day 0\)/);
      assert.match(check(ACCESS, word(2001, 2, 30)).errors.join('\n'), /A\.BIN: invalid access date/);
      assert.match(check(ACCESS, word(2001, 2, 29)).errors.join('\n'), /A\.BIN: invalid access date/);
      assert.match(check(ACCESS, word(2001, 0, 1)).errors.join('\n'), /A\.BIN: invalid access date/);
      assert.match(check(ACCESS, word(2001, 4, 31)).errors.join('\n'), /A\.BIN: invalid access date/);
    });

    it('also checks the "." and ".." entries of a subdirectory', () => {
      const sub = find(baseline, 'SUB').cluster;
      const result = corrupt((img) => img.writeUInt16LE(word(2001, 14, 1), layoutOf(img).clusterAt(sub) + 24));
      assert.match(result.errors.join('\n'), /SUB\/\.: invalid write date/);
    });

    it('accepts unset dates and real days such as 29 February in a leap year', () => {
      for (const offset of [CREATE, ACCESS, WRITE]) {
        assert.deepEqual(check(offset, 0).errors, []);
        assert.deepEqual(check(offset, word(2000, 2, 29)).errors, []);
        assert.deepEqual(check(offset, word(2001, 12, 31)).errors, []);
      }
    });
  });

  it('catches a damaged FAT[0], signatures and BPB', () => {
    assert.match(corrupt((img) => setFat(img, 0, 0xfff0)).errors.join('\n'), /FAT\[0\]/);
    assert.match(corrupt((img) => { img[510] = 0; }).errors.join('\n'), /MBR signature/);
    assert.match(corrupt((img) => { img[PART + 510] = 0; }).errors.join('\n'), /boot sector signature/);
    assert.match(corrupt((img) => img.writeUInt32LE(0, PART + 0x1c)).errors.join('\n'), /hidden sectors/);
    assert.match(corrupt((img) => img.writeUInt16LE(1, PART + 0x16)).errors.join('\n'), /cannot cover/);
  });

  it('reports an image that is too short instead of throwing', () => {
    assert.equal(checkImage(baseline.subarray(0, baseline.length - 4096)).ok, false);
    assert.equal(checkImage(Buffer.alloc(100)).ok, false);
  });
});

describe('MBR', () => {
  it('describes one active type-06 partition at LBA 63 for D:', () => {
    const { image, stats } = buildImage({ geometry: D_GEOMETRY, clusterSize: 2048 });
    assert.equal(image.length, 131040 * SECTOR);
    assert.equal(image.readUInt16LE(510), 0xaa55);
    const entry = 0x1be;
    assert.equal(image[entry], 0x80);
    assert.deepEqual([...image.subarray(entry + 1, entry + 4)], [1, 1, 0]);
    assert.equal(image[entry + 4], 0x06);
    assert.deepEqual([...image.subarray(entry + 5, entry + 8)], [15, 63, 129]);
    assert.equal(image.readUInt32LE(entry + 8), 63);
    assert.equal(image.readUInt32LE(entry + 12), 131040 - 63);
    assert.equal(stats.partitionSectors, 131040 - 63);
    for (const slot of [1, 2, 3]) {
      assert.ok(image.subarray(entry + slot * 16, entry + slot * 16 + 16).every((b) => b === 0));
    }
    assert.ok(image.subarray(0, 446).every((b) => b === 0));
    assertClean(image);
  });

  it('packs high cylinder bits into the end CHS for C:', () => {
    const { image } = buildImage({ geometry: C_GEOMETRY, clusterSize: 4096 });
    assert.deepEqual([...image.subarray(0x1be + 5, 0x1be + 8)], [15, 63 | 0x40, 259 & 0xff]);
    assert.equal(image.readUInt32LE(0x1be + 12), 262080 - 63);
    assertClean(image);
  });

  it('clamps the end CHS beyond cylinder 1023', () => {
    const { image } = buildImage({ geometry: { cylinders: 1100 }, clusterSize: 16384 });
    assert.deepEqual([...image.subarray(0x1be + 5, 0x1be + 8)], [15, 0xff, 0xff]);
    assert.equal(image.readUInt32LE(0x1be + 12), 1100 * 1008 - 63);
    assert.equal(readImage(image).mbr.partitions[0].sectors, 1100 * 1008 - 63);
  });

  it('copies the boot code when given and zero-pads it', () => {
    const code = pattern(300, 9);
    const { image } = build({ mbrBootCode: code });
    assert.ok(image.subarray(0, 300).equals(code));
    assert.ok(image.subarray(300, 446).every((b) => b === 0));
    assert.ok(readImage(image).mbr.bootCode.subarray(0, 300).equals(code));
    assert.throws(() => build({ mbrBootCode: Buffer.alloc(447) }), /446/);
  });

  it('reads back through readImage', () => {
    const { image } = build();
    assert.deepEqual(readImage(image).mbr.partitions, [
      { index: 0, active: true, type: 6, startLba: 63, sectors: 30 * 1008 - 63 },
    ]);
  });
});

describe('boot sector and BPB', () => {
  const cases = [
    { name: 'D: (130 cylinders, 2 KiB clusters)', geometry: D_GEOMETRY, clusterSize: 2048, spf: 128, spc: 4 },
    { name: 'C: (260 cylinders, 4 KiB clusters)', geometry: C_GEOMETRY, clusterSize: 4096, spf: 128, spc: 8 },
  ];
  for (const c of cases) {
    it(`writes every field for ${c.name}`, () => {
      const { image, stats } = buildImage({
        geometry: c.geometry, clusterSize: c.clusterSize, label: 'rebeep d', volumeId: 0x1234abcd,
      });
      const sizing = expectedSizing(c.geometry.cylinders, c.clusterSize);
      assert.equal(sizing.spf, c.spf);
      const bs = image.subarray(PART, PART + SECTOR);
      assert.deepEqual([...bs.subarray(0, 3)], [0xeb, 0x3c, 0x90]);
      assert.equal(bs.toString('latin1', 3, 11), 'MSDOS5.0');
      assert.equal(bs.readUInt16LE(0x0b), 512);
      assert.equal(bs[0x0d], c.spc);
      assert.equal(bs.readUInt16LE(0x0e), 1);
      assert.equal(bs[0x10], 2);
      assert.equal(bs.readUInt16LE(0x11), 512);
      assert.equal(bs.readUInt16LE(0x13), 0);
      assert.equal(bs[0x15], 0xf8);
      assert.equal(bs.readUInt16LE(0x16), c.spf);
      assert.equal(bs.readUInt16LE(0x18), 63);
      assert.equal(bs.readUInt16LE(0x1a), 16);
      assert.equal(bs.readUInt32LE(0x1c), 63);
      assert.equal(bs.readUInt32LE(0x20), sizing.partition);
      assert.equal(bs[0x24], 0x80);
      assert.equal(bs[0x25], 0);
      assert.equal(bs[0x26], 0x29);
      assert.equal(bs.readUInt32LE(0x27), 0x1234abcd);
      assert.equal(bs.toString('latin1', 0x2b, 0x36), 'REBEEP D   ');
      assert.equal(bs.toString('latin1', 0x36, 0x3e), 'FAT16   ');
      assert.deepEqual([...bs.subarray(0x3e, 0x42)], [0xcd, 0x18, 0xeb, 0xfe]);
      assert.equal(bs.readUInt16LE(510), 0xaa55);
      assert.equal(stats.clusterCount, sizing.clusters);
      assert.equal(stats.sectorsPerFat, c.spf);

      const layout = layoutOf(image);
      assert.equal(layout.fat(0), 0xfff8);
      assert.equal(layout.fat(1), 0xffff);
      const fatBytes = c.spf * SECTOR;
      assert.ok(image.subarray(layout.fatStart, layout.fatStart + fatBytes)
        .equals(image.subarray(layout.fatStart + fatBytes, layout.fatStart + 2 * fatBytes)));
      assert.equal(layout.dataStart, PART + (1 + 2 * c.spf + 32) * SECTOR);

      const root = rootEntries(image);
      assert.equal(root.length, 1);
      assert.equal(root[0].name, 'REBEEP D   ');
      assert.equal(root[0].attr, 0x08);
      assertClean(image);

      const bpb = readImage(image).bpb;
      assert.deepEqual(bpb, {
        bytesPerSector: 512, sectorsPerCluster: c.spc, reservedSectors: 1, fatCount: 2, rootEntries: 512,
        totalSectors: sizing.partition, media: 0xf8, sectorsPerFat: c.spf, sectorsPerTrack: 63, heads: 16,
        hiddenSectors: 63, volumeId: 0x1234abcd, label: 'REBEEP D', fsType: 'FAT16',
      });
    });
  }

  it('defaults the label to NO NAME and derives a stable volume ID from the label', () => {
    const plain = build().image;
    assert.equal(plain.toString('latin1', PART + 0x2b, PART + 0x36), 'NO NAME    ');
    assert.equal(rootEntries(plain).length, 0);
    const a = build({ label: 'ONE' }).image.readUInt32LE(PART + 0x27);
    const b = build({ label: 'one' }).image.readUInt32LE(PART + 0x27);
    const c = build({ label: 'TWO' }).image.readUInt32LE(PART + 0x27);
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it('rejects labels DOS would not accept', () => {
    assert.throws(() => build({ label: 'TWELVE CHARS' }), /11 characters/);
    assert.throws(() => build({ label: 'BAD.LABEL' }), /characters/);
  });

  it('keeps a template boot sector outside the BPB area and overwrites the BPB area', () => {
    const template = pattern(SECTOR, 11);
    template.set([0xeb, 0x58, 0x90]);
    template.write('FRDOS4.1', 3, 8, 'latin1');
    template.writeUInt16LE(0xaa55, 510);
    const { image } = build({ bootSectorTemplate: template, label: 'TPL' });
    const bs = image.subarray(PART, PART + SECTOR);
    assert.ok(bs.subarray(0, 0x0b).equals(template.subarray(0, 0x0b)));
    assert.ok(bs.subarray(0x3e).equals(template.subarray(0x3e)));
    assert.ok(!bs.subarray(0x0b, 0x3e).equals(template.subarray(0x0b, 0x3e)));
    assert.equal(bs.readUInt16LE(0x0b), 512);
    assert.equal(bs[0x0d], 4);
    assert.equal(bs.toString('latin1', 0x36, 0x3e), 'FAT16   ');
    assert.equal(bs.toString('latin1', 0x2b, 0x36), 'TPL        ');
    assertClean(image);
    assert.throws(() => build({ bootSectorTemplate: Buffer.alloc(100) }), /512/);
  });

  it('uses the 16-bit sector count only for partitions below 65536 sectors', () => {
    const { image } = buildImage({ geometry: { cylinders: 10 }, clusterSize: 512 });
    assert.equal(image.readUInt16LE(PART + 0x13), 10 * 1008 - 63);
    assert.equal(image.readUInt32LE(PART + 0x20), 0);
    assertClean(image);
    assert.equal(readImage(image).bpb.totalSectors, 10 * 1008 - 63);
  });
});

describe('sizing', () => {
  it('rejects too few clusters', () => {
    assert.throws(
      () => buildImage({ geometry: D_GEOMETRY, clusterSize: 32768 }),
      /130 cylinders.*32768-byte clusters.*below the FAT16 minimum/s,
    );
  });

  it('rejects too many clusters', () => {
    assert.throws(
      () => buildImage({ geometry: C_GEOMETRY, clusterSize: 512 }),
      /260 cylinders.*512-byte clusters.*above the FAT16 maximum/s,
    );
  });

  it('rejects cluster sizes that are not a power of two in range', () => {
    for (const size of [0, 256, 3000, 65536, '2048']) {
      assert.throws(() => build({ clusterSize: size }), /clusterSize/);
    }
  });

  it('rejects contents that do not fit', () => {
    const big = Buffer.alloc(2048 * 8000);
    assert.throws(() => build({ files: [{ path: 'BIG.BIN', bytes: big }] }), /clusters/);
  });

  describe('capacity is enforced without reading every lazy file', () => {
    const { clusterCount } = build().stats;
    const MIB = 1 << 20;
    const lazyFiles = (count, bytesEach, { declare }) => {
      const state = { reads: 0 };
      const files = Array.from({ length: count }, (_, i) => ({
        path: `L${i}.BIN`,
        ...(declare ? { size: bytesEach } : {}),
        read: () => {
          state.reads++;
          return Buffer.alloc(bytesEach);
        },
      }));
      return { files, state };
    };

    it('uses a declared size to fail before any read', () => {
      const { files, state } = lazyFiles(6, 8 * MIB, { declare: true });
      assert.throws(() => build({ files }), /need at least \d+ clusters of 2048 bytes but the volume has/);
      assert.equal(state.reads, 0);
    });

    it('stops reading as soon as the running total no longer fits', () => {
      const perFile = 4 * MIB;
      const { files, state } = lazyFiles(6, perFile, { declare: false });
      assert.throws(() => build({ files }), /need at least/);
      assert.equal(state.reads, Math.floor(clusterCount / (perFile / 2048)) + 1);
      assert.ok(state.reads < 6);
    });

    it('counts files whose bytes are known before it reads a lazy file', () => {
      const { files, state } = lazyFiles(1, 1, { declare: false });
      assert.throws(
        () => build({ files: [{ path: 'BIG.BIN', bytes: Buffer.alloc(2048 * clusterCount + 1) }, ...files] }),
        /need at least/,
      );
      assert.equal(state.reads, 0);
    });

    it('reads each declared file once when it fits and checks the declared size', () => {
      const { files, state } = lazyFiles(3, 5000, { declare: true });
      const { image } = build({ files });
      assert.equal(state.reads, 3);
      assert.equal(readImage(image).readFile('L1.BIN').length, 5000);
      assertClean(image);
      assert.throws(
        () => build({ files: [{ path: 'A.BIN', size: 10, read: () => Buffer.alloc(11) }] }),
        /read\(\) returned 11 bytes but size is 10/,
      );
      assert.throws(
        () => build({ files: [{ path: 'A.BIN', size: 10, bytes: Buffer.alloc(11) }] }),
        /size is 10 but bytes holds 11/,
      );
      for (const size of [-1, 1.5, '10']) {
        assert.throws(() => build({ files: [{ path: 'A.BIN', size, read: () => Buffer.alloc(0) }] }), /non-negative integer/);
      }
    });
  });

  it('finishes 64 MiB and 128 MiB builds quickly', () => {
    const started = Date.now();
    const d = buildImage({ geometry: D_GEOMETRY, clusterSize: 2048, files: [{ path: 'A.BIN', bytes: pattern(1 << 20, 1) }] });
    const c = buildImage({ geometry: C_GEOMETRY, clusterSize: 4096, files: [{ path: 'A.BIN', bytes: pattern(1 << 20, 1) }] });
    assert.ok(Date.now() - started < 5000);
    assertClean(d.image);
    assertClean(c.image);
  });
});

describe('names', () => {
  it('uppercases names', () => {
    const { image } = build({ files: [{ path: 'dos/autoexec.bat', bytes: Buffer.from('x') }] });
    assert.deepEqual(readImage(image).list().map((e) => e.path), ['DOS', 'DOS/AUTOEXEC.BAT']);
  });

  const bad = [
    'LONGFILENAME.TXT', 'A.TOOLONG', 'CON', 'nul.txt', 'BAD*.TXT', 'COM1.DAT', 'LPT3', 'CLOCK$',
    'A.B.C', '.HIDDEN', 'DOT.', 'SP ACE.TXT', 'DIR/', '/ROOT.TXT', 'A//B.TXT', 'A/./B.TXT', '..', 'CAF\u00c9.TXT',
  ];
  for (const path of bad) {
    it(`rejects ${JSON.stringify(path)}`, () => {
      assert.throws(() => build({ files: [{ path, bytes: Buffer.alloc(1) }] }), (err) => err.message.includes(path));
    });
  }

  it('lists every bad path in one error', () => {
    assert.throws(
      () => build({ files: [
        { path: 'GOOD.TXT', bytes: Buffer.alloc(1) },
        { path: 'LONGFILENAME.TXT', bytes: Buffer.alloc(1) },
        { path: 'nul.txt', bytes: Buffer.alloc(1) },
      ] }),
      (err) => err.message.includes('LONGFILENAME.TXT') && err.message.includes('nul.txt') && !err.message.includes('GOOD'),
    );
    assert.throws(() => build({ dirs: ['TOOLONGDIRNAME'] }), /TOOLONGDIRNAME/);
  });

  it('skips bad paths and reports them when onInvalid is "skip"', () => {
    let reads = 0;
    const kept = Buffer.from('kept');
    const { image, skipped } = build({
      onInvalid: 'skip',
      files: [
        { path: 'LONGFILENAME.TXT', read: () => { reads++; return kept; } },
        { path: 'NEWDIR/A.TOOLONG', bytes: kept },
        { path: 'OK.TXT', read: () => { reads++; return kept; } },
        { path: 'nul.txt', bytes: kept },
      ],
      dirs: ['BAD*DIR'],
    });
    assert.deepEqual(skipped, ['LONGFILENAME.TXT', 'NEWDIR/A.TOOLONG', 'nul.txt', 'BAD*DIR']);
    assert.equal(reads, 1);
    assert.deepEqual(readImage(image).list().map((e) => e.path), ['OK.TXT']);
    assertClean(image);
  });

  it('rejects two inputs that collide after uppercasing', () => {
    const f = (path) => ({ path, bytes: Buffer.alloc(1) });
    assert.throws(() => build({ files: [f('dir/file.txt'), f('DIR/FILE.TXT')] }), /conflicts with dir\/file\.txt/);
    assert.throws(() => build({ files: [f('X'), f('x/y.txt')] }), /conflicts/);
    assert.throws(() => build({ files: [f('a')], dirs: ['A'] }), /conflicts/);
    assert.throws(() => build({ files: [f('A/B.TXT')], dirs: ['a/b.txt'] }), /conflicts/);
  });

  it('accepts a listed directory that already exists', () => {
    const { image } = build({ files: [{ path: 'GAMES/A.TXT', bytes: Buffer.alloc(1) }], dirs: ['games', 'GAMES'] });
    assert.deepEqual(readImage(image).list().map((e) => e.path), ['GAMES', 'GAMES/A.TXT']);
  });

  it('rejects files with neither bytes nor read()', () => {
    assert.throws(() => build({ files: [{ path: 'A.TXT' }] }), /bytes or a read/);
  });

  it('to83 uppercases and validates one segment', () => {
    assert.equal(to83('boot.bat'), 'BOOT.BAT');
    assert.equal(to83('A'), 'A');
    assert.equal(to83('~1_{x}.@!#'), '~1_{X}.@!#');
    for (const name of ['', '.', '..', 'a/b', 'con', 'toolongname.txt']) assert.throws(() => to83(name), /Invalid 8\.3 name/);
  });
});

describe('root directory', () => {
  const entries = (n) => Array.from({ length: n }, (_, i) => ({ path: `F${i}.TXT`, bytes: Buffer.alloc(0) }));

  it('holds 512 entries including the label and no more', () => {
    const full = build({ label: 'FULL', files: entries(511) }).image;
    assert.equal(rootEntries(full).length, 512);
    assertClean(full);
    assert.throws(() => build({ label: 'FULL', files: entries(512) }), /512/);
    assert.equal(rootEntries(build({ files: entries(512) }).image).length, 512);
    assert.throws(() => build({ files: entries(513) }), /513 entries/);
  });

  it('counts root directories toward the limit', () => {
    assert.throws(() => build({ files: entries(512), dirs: ['SUB'] }), /513 entries/);
  });
});

describe('bootFiles', () => {
  it('puts boot files first in the root and contiguously from cluster 2', () => {
    const kernel = pattern(5000, 1);
    const command = pattern(3000, 2);
    const { image } = build({
      label: 'TEST',
      files: [
        { path: 'AUTOEXEC.BAT', bytes: Buffer.from('echo') },
        { path: 'DOS/X.TXT', bytes: Buffer.from('x') },
        { path: 'COMMAND.COM', bytes: command },
        { path: 'KERNEL.SYS', bytes: kernel },
        { path: 'ZZZ.TXT', bytes: Buffer.from('z') },
      ],
      bootFiles: ['kernel.sys', 'COMMAND.COM'],
    });
    const root = rootEntries(image);
    assert.deepEqual(root.map((e) => e.name.trimEnd()), [
      'TEST', 'KERNEL  SYS', 'COMMAND COM', 'AUTOEXECBAT', 'DOS', 'ZZZ     TXT',
    ]);
    assert.equal(root[1].cluster, 2);
    assert.equal(root[2].cluster, 5);
    const layout = layoutOf(image);
    assert.deepEqual([2, 3, 4, 5, 6].map((c) => layout.fat(c)), [3, 4, 0xffff, 6, 0xffff]);
    const disk = readImage(image);
    assert.ok(disk.readFile('KERNEL.SYS').equals(kernel));
    assert.ok(disk.readFile('COMMAND.COM').equals(command));
    assertClean(image);
  });

  it('rejects boot files that are missing, nested or repeated', () => {
    const files = [{ path: 'DOS/X.TXT', bytes: Buffer.from('x') }, { path: 'A.TXT', bytes: Buffer.from('a') }];
    assert.throws(() => build({ files, bootFiles: ['NOPE.SYS'] }), /NOPE\.SYS/);
    assert.throws(() => build({ files, bootFiles: ['DOS/X.TXT'] }), /root directory/);
    assert.throws(() => build({ files, bootFiles: ['DOS'] }), /root directory/);
    assert.throws(() => build({ files, bootFiles: ['A.TXT', 'a.txt'] }), /more than once/);
  });
});

describe('timestamps and reproducibility', () => {
  const stampOf = (image, index) => {
    const { at } = rootEntries(image)[index];
    return {
      createTime: image.readUInt16LE(at + 14),
      createDate: image.readUInt16LE(at + 16),
      accessDate: image.readUInt16LE(at + 18),
      writeTime: image.readUInt16LE(at + 22),
      writeDate: image.readUInt16LE(at + 24),
    };
  };

  it('defaults to 1996-01-01 12:00:00 in every date field', () => {
    const { image } = build({ files: [{ path: 'A.TXT', bytes: Buffer.from('a') }], label: 'L' });
    for (const index of [0, 1]) {
      assert.deepEqual(stampOf(image, index), {
        createTime: 0x6000, createDate: 0x2021, accessDate: 0x2021, writeTime: 0x6000, writeDate: 0x2021,
      });
    }
  });

  it('encodes a supplied Date', () => {
    const date = new Date(2001, 8, 9, 10, 20, 30);
    const { image } = build({ files: [{ path: 'A.TXT', bytes: Buffer.from('a') }], date });
    const expectedDate = ((2001 - 1980) << 9) | (9 << 5) | 9;
    const expectedTime = (10 << 11) | (20 << 5) | 15;
    assert.deepEqual(stampOf(image, 0), {
      createTime: expectedTime, createDate: expectedDate, accessDate: expectedDate,
      writeTime: expectedTime, writeDate: expectedDate,
    });
    assert.throws(() => build({ date: new Date(1975, 0, 1) }), /1980/);
    assert.throws(() => build({ date: new Date('nope') }), /valid Date/);
  });

  it('builds identical bytes from identical input', () => {
    const make = () => {
      const { files, dirs } = fixture();
      return build({ files, dirs, label: 'REPRO' }).image;
    };
    assert.ok(make().equals(make()));
  });
});

describe('readImage on images it did not write', () => {
  const files = [
    { path: 'A.TXT', bytes: Buffer.from('aaa') },
    { path: 'B.TXT', bytes: Buffer.from('bbb') },
    { path: 'C.TXT', bytes: Buffer.from('ccc') },
    { path: 'D.TXT', bytes: Buffer.from('ddd') },
  ];
  const base = () => Buffer.from(build({ files }).image);

  it('opens FAT16 partitions of type 0x04, 0x06 and 0x0E', () => {
    for (const type of [0x04, 0x06, 0x0e]) {
      const image = base();
      image[0x1be + 4] = type;
      const disk = readImage(image);
      assert.equal(disk.mbr.partitions[0].type, type);
      assert.ok(disk.readFile('A.TXT').equals(Buffer.from('aaa')));
    }
  });

  it('skips long-name and deleted entries and stops at the first empty entry', () => {
    const image = base();
    const { rootStart } = layoutOf(image);
    image[rootStart + 11] = 0x0f;
    image[rootStart + 32] = 0xe5;
    image.copy(image, rootStart + 4 * 32, rootStart + 3 * 32, rootStart + 4 * 32);
    image.fill(0, rootStart + 3 * 32, rootStart + 4 * 32);
    const names = readImage(image).list().map((e) => e.path);
    assert.deepEqual(names, ['C.TXT']);
  });

  it('refuses FAT12, FAT32 and other partition types with a clear error', () => {
    const fat12 = base();
    fat12[PART + 0x0d] = 64;
    assert.throws(() => readImage(fat12), /FAT12.*not supported/);
    const fat32 = base();
    fat32.writeUInt16LE(0, PART + 0x11);
    assert.throws(() => readImage(fat32), /FAT32.*not supported/);
    const ntfs = base();
    ntfs[0x1be + 4] = 0x07;
    assert.throws(() => readImage(ntfs), /unsupported/);
    assert.throws(() => readImage(base(), { partition: 1 }), /not defined/);
  });

  it('refuses images that are not disks', () => {
    const noMbr = base();
    noMbr[511] = 0;
    assert.throws(() => readImage(noMbr), /MBR signature/);
    assert.throws(() => readImage(Buffer.alloc(10)), /smaller than one sector/);
    const image = base();
    assert.throws(() => readImage(image.subarray(0, image.length - SECTOR * 100)), /truncated/);
  });

  it('refuses to read a file whose chain is shorter than its size', () => {
    const image = base();
    image.writeUInt32LE(100000, rootEntries(image)[0].at + 28);
    assert.throws(() => readImage(image).readFile('A.TXT'), /shorter than the file size/);
  });
});

describe('toCrlf', () => {
  const crlf = (text) => toCrlf(Buffer.from(text, 'latin1')).toString('latin1');

  it('converts LF to CRLF and leaves CRLF alone', () => {
    assert.equal(crlf('a\nb\n'), 'a\r\nb\r\n');
    assert.equal(crlf('a\r\nb\r\n'), 'a\r\nb\r\n');
  });

  it('normalises mixed input', () => {
    assert.equal(crlf('a\nb\r\nc\n\nd'), 'a\r\nb\r\nc\r\n\r\nd');
    assert.equal(crlf('\nx'), '\r\nx');
  });

  it('is idempotent and leaves a lone CR untouched', () => {
    const once = toCrlf(Buffer.from('a\nb\rc\r\r\nd\n'));
    assert.equal(once.toString('latin1'), 'a\r\nb\rc\r\r\nd\r\n');
    assert.ok(toCrlf(once).equals(once));
    assert.equal(toCrlf(Buffer.alloc(0)).length, 0);
  });

  it('does not modify its input', () => {
    const input = Buffer.from('a\nb');
    toCrlf(input);
    assert.equal(input.toString(), 'a\nb');
  });
});

describe('fsck.fat', () => {
  const tool = ['fsck.fat', 'dosfsck'].find((name) => !spawnSync(name, ['--help']).error);

  it('finds a built D: partition clean', (t) => {
    if (!tool) {
      t.skip('fsck.fat (or dosfsck) is not on PATH');
      return;
    }
    const { files, dirs } = fixture();
    const { image } = buildImage({ geometry: D_GEOMETRY, clusterSize: 2048, files, dirs, label: 'REBEEP D' });
    const dir = mkdtempSync(join(tmpdir(), 'rebeep-fat-'));
    try {
      const slice = join(dir, 'partition.img');
      writeFileSync(slice, image.subarray(PART));
      const result = spawnSync(tool, ['-n', slice], { encoding: 'utf8' });
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildFloppy', () => {
  /** Entry `n` of a FAT12 table, unpacked the long way: three bytes hold two entries. */
  function fat12(image, n) {
    const at = SECTOR + Math.floor((n * 3) / 2);
    const pair = image[at] | (image[at + 1] << 8);
    return n % 2 === 0 ? pair & 0xfff : pair >> 4;
  }

  const floppyTree = () => [
    { path: 'MULTI.BIN', bytes: pattern(512 * 5 + 7, 1) },
    { path: 'SUB/ONE.TXT', bytes: pattern(300, 2) },
    { path: 'EMPTY.TXT', bytes: Buffer.alloc(0) },
  ];

  it('writes the 1.44 MB geometry and an extended BPB', () => {
    const { image, stats } = buildFloppy({ label: 'rebeep', volumeId: 0x12345678 });
    assert.equal(image.length, 1474560);
    assert.deepEqual([...image.subarray(0, 3)], [0xeb, 0x3c, 0x90]);
    assert.equal(image.toString('latin1', 3, 11), 'MSDOS5.0');
    assert.equal(image.readUInt16LE(0x0b), 512);
    assert.equal(image[0x0d], 1);
    assert.equal(image.readUInt16LE(0x0e), 1);
    assert.equal(image[0x10], 2);
    assert.equal(image.readUInt16LE(0x11), 224);
    assert.equal(image.readUInt16LE(0x13), 2880);
    assert.equal(image[0x15], 0xf0);
    assert.equal(image.readUInt16LE(0x16), 9);
    assert.equal(image.readUInt16LE(0x18), 18);
    assert.equal(image.readUInt16LE(0x1a), 2);
    assert.equal(image.readUInt32LE(0x1c), 0);
    assert.equal(image[0x24], 0);
    assert.equal(image[0x26], 0x29);
    assert.equal(image.readUInt32LE(0x27), 0x12345678);
    assert.equal(image.toString('latin1', 0x2b, 0x36), 'REBEEP     ');
    assert.equal(image.toString('latin1', 0x36, 0x3e), 'FAT12   ');
    assert.equal(image.readUInt16LE(510), 0xaa55);
    assert.deepEqual([...image.subarray(0x3e, 0x40)], [0xcd, 0x18]);
    assert.deepEqual([...image.subarray(SECTOR, SECTOR + 3)], [0xf0, 0xff, 0xff]);
    assert.equal(stats.clusterCount, 2847);
  });

  it('packs FAT12 chains for even and odd clusters, and keeps both FATs equal', () => {
    const { image } = buildFloppy({ files: floppyTree() });
    // MULTI.BIN is the first file in the tree: 6 clusters, 2..7.
    assert.deepEqual([2, 3, 4, 5, 6, 7].map((n) => fat12(image, n)), [3, 4, 5, 6, 7, 0xfff]);
    assert.equal(fat12(image, 0), 0xff0);
    assert.equal(fat12(image, 1), 0xfff);
    assert.equal(fat12(image, 2000), 0);
    const fat1 = image.subarray(SECTOR, SECTOR + 9 * SECTOR);
    assert.equal(Buffer.compare(fat1, image.subarray(SECTOR + 9 * SECTOR, SECTOR + 18 * SECTOR)), 0);
  });

  it('round-trips through readImage and passes checkImage', () => {
    const files = floppyTree();
    const { image, stats } = buildFloppy({ files, label: 'TEST', date: new Date(2026, 5, 1, 8, 30, 10) });
    assert.deepEqual(checkImage(image), { ok: true, errors: [] });
    const read = readImage(image);
    assert.equal(read.mbr, null);
    assert.equal(read.bpb.fsType, 'FAT12');
    for (const f of files) assert.deepEqual(read.readFile(f.path), f.bytes);
    assert.ok(read.exists('sub'));
    assert.equal(stats.usedClusters, 6 + 1 + 1);
  });

  it('is reproducible', () => {
    const a = buildFloppy({ files: floppyTree(), label: 'X' }).image;
    const b = buildFloppy({ files: floppyTree(), label: 'X' }).image;
    assert.equal(Buffer.compare(a, b), 0);
  });

  it('patches the BPB into a boot sector template and keeps its code and signature', () => {
    const template = Buffer.alloc(SECTOR, 0x90);
    template.set([0xeb, 0x3c, 0x90]);
    template.set([0xde, 0xad, 0xbe, 0xef], 0x3e);
    template.writeUInt16LE(0xaa55, 510);
    template[0x1fd] = 0x77;
    const { image } = buildFloppy({ bootSectorTemplate: template, label: 'T' });
    assert.deepEqual([...image.subarray(0x3e, 0x42)], [0xde, 0xad, 0xbe, 0xef]);
    assert.deepEqual([...image.subarray(0x42, 0x44)], [0x90, 0x90]);
    assert.equal(image[0x1fd], 0x77);
    assert.equal(image.readUInt16LE(510), 0xaa55);
    assert.equal(image.readUInt16LE(0x13), 2880);
    assert.equal(image.toString('latin1', 0x36, 0x3e), 'FAT12   ');
    assert.throws(() => buildFloppy({ bootSectorTemplate: Buffer.alloc(100) }), /512 bytes/);
  });

  it('throws a clear error when the files do not fit', () => {
    const capacity = 2847 * SECTOR;
    assert.doesNotThrow(() => buildFloppy({ files: [{ path: 'FULL.BIN', bytes: Buffer.alloc(capacity) }] }));
    assert.throws(
      () => buildFloppy({ files: [{ path: 'BIG.BIN', bytes: Buffer.alloc(capacity + 1) }] }),
      /need at least 2848 clusters of 512 bytes but the volume has 2847/,
    );
  });

  it('rejects names that are not 8.3', () => {
    assert.throws(() => buildFloppy({ files: [{ path: 'TOOLONGNAME.TXT', bytes: Buffer.alloc(1) }] }), /8\.3/);
  });

  it('checkImage reports a damaged floppy FAT', () => {
    const { image } = buildFloppy({ files: floppyTree() });
    image[SECTOR + 3] ^= 0xff;
    assert.equal(checkImage(image).ok, false);
  });

  it('still reads hard-disk images as before', () => {
    const { image } = build({ files: [{ path: 'A.TXT', bytes: Buffer.from('hi') }] });
    assert.equal(readImage(image).readFile('A.TXT').toString(), 'hi');
    assert.notEqual(readImage(image).mbr, null);
  });

  const fsck = ['fsck.fat', 'dosfsck'].find((name) => !spawnSync(name, ['--help']).error);

  it('is clean under fsck.fat', (t) => {
    if (!fsck) {
      t.skip('fsck.fat (or dosfsck) is not on PATH');
      return;
    }
    const { image } = buildFloppy({ files: floppyTree(), label: 'REBEEP' });
    const dir = mkdtempSync(join(tmpdir(), 'rebeep-fat-'));
    try {
      const file = join(dir, 'floppy.img');
      writeFileSync(file, image);
      const result = spawnSync(fsck, ['-n', file], { encoding: 'utf8' });
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
