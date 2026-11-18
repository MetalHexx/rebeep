/**
 * FAT16 hard-disk images in pure JavaScript.
 *
 * `buildImage` writes a raw disk (MBR plus one FAT16 partition) from an in-memory file tree,
 * `readImage` reads such images (including ones this module did not write), `checkImage` is a
 * small fsck, and `toCrlf` / `to83` are the text and name helpers the CLI needs around them.
 * Everything works on Buffers; nothing here touches the file system.
 *
 * Disk layout (sector size 512): LBA 0 is the MBR, the single partition starts at LBA 63 and runs
 * to the end of the disk. Inside it: 1 reserved sector (the boot sector), 2 FATs, a 512-entry
 * root directory, then the data area whose first cluster is number 2.
 */

export const SECTOR = 512;

const PARTITION_START = 63;
const PARTITION_TABLE = 0x1be;
const BOOT_CODE_SIZE = 446;
const DIR_ENTRY = 32;
const ROOT_ENTRIES = 512;
const FAT_COUNT = 2;
const MEDIA = 0xf8;
const MIN_CLUSTERS = 4085;
const MAX_CLUSTERS = 65524;
const MAX_FAT_SECTORS = 256;
const MAX_DIR_ENTRIES = 65536;
const FAT_EOC = 0xffff;
const FAT_EOC_MIN = 0xfff8;
const FAT_BAD = 0xfff7;
const ATTR_VOLUME = 0x08;
const ATTR_DIRECTORY = 0x10;
const ATTR_ARCHIVE = 0x20;
const FAT16_TYPES = new Set([0x04, 0x06, 0x0e]);
const MAX_REPORTED_ERRORS = 50;

// ---------------------------------------------------------------------------------------------
// Shared helpers

function asBuffer(value, what) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`${what} must be a Buffer`);
}

/** Uppercases ASCII letters only, so no locale or Unicode case mapping can sneak a letter in. */
function upperAscii(text) {
  return text.replace(/[a-z]/g, (c) => c.toUpperCase());
}

function splitPath(path) {
  return path.split(/[\\/]/);
}

function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

const hex = (n, width = 2) => `0x${n.toString(16).toUpperCase().padStart(width, '0')}`;

// ---------------------------------------------------------------------------------------------
// 8.3 names

const NAME_CHARS = /^[A-Z0-9!#$%&'()@^_`{}~-]+$/;
const DEVICE_NAMES = new Set([
  'CON', 'AUX', 'NUL', 'PRN', 'CLOCK$',
  'COM1', 'COM2', 'COM3', 'COM4',
  'LPT1', 'LPT2', 'LPT3',
]);

/** Why an already-uppercased segment is not a valid 8.3 name, or null when it is. */
function nameProblem(name) {
  if (name === '') return 'empty path segment';
  if (name === '.' || name === '..') return 'reserved name';
  const dot = name.indexOf('.');
  const base = dot < 0 ? name : name.slice(0, dot);
  const ext = dot < 0 ? '' : name.slice(dot + 1);
  if (ext.includes('.')) return 'more than one dot';
  if (base === '') return 'empty base name';
  if (dot >= 0 && ext === '') return 'empty extension';
  if (base.length > 8) return 'base name longer than 8 characters';
  if (ext.length > 3) return 'extension longer than 3 characters';
  if (!NAME_CHARS.test(base) || (ext !== '' && !NAME_CHARS.test(ext))) {
    return 'characters not allowed in an 8.3 name';
  }
  if (DEVICE_NAMES.has(base)) return 'reserved DOS device name';
  return null;
}

/**
 * Uppercases and validates one path segment as an 8.3 name.
 * @param {string} name
 * @returns {string} the uppercase name, for example `BOOT.BAT`
 * @throws {Error} when the name is not a valid 8.3 name
 */
export function to83(name) {
  if (typeof name !== 'string') throw new TypeError('name must be a string');
  const upper = upperAscii(name);
  const problem = nameProblem(upper);
  if (problem) throw new Error(`Invalid 8.3 name "${name}": ${problem}`);
  return upper;
}

/** The 11-byte space-padded form stored in a directory entry. */
function pack83(name) {
  const dot = name.indexOf('.');
  const base = dot < 0 ? name : name.slice(0, dot);
  const ext = dot < 0 ? '' : name.slice(dot + 1);
  return base.padEnd(8) + ext.padEnd(3);
}

const LABEL_FORBIDDEN = /[*?/\\|.,;:+=[\]()&^<>"]/;

function normalizeLabel(label) {
  if (label === undefined || label === null || label === '') return null;
  if (typeof label !== 'string') throw new TypeError('label must be a string');
  const upper = upperAscii(label);
  if (upper.length > 11) throw new Error(`Volume label "${label}" is longer than 11 characters`);
  if (!/^[\x20-\x7e]+$/.test(upper) || LABEL_FORBIDDEN.test(upper)) {
    throw new Error(`Volume label "${label}" contains characters DOS does not allow`);
  }
  return upper;
}

/** FNV-1a over the label, so the same label always yields the same volume ID. */
function volumeIdFromLabel(label) {
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(label ?? '', 'latin1')) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Dates

/** Packs a Date (local wall-clock fields, as DOS does) into FAT date and time words. */
function dosStamp(date) {
  let year = 1996;
  let month = 1;
  let day = 1;
  let hour = 12;
  let minute = 0;
  let second = 0;
  if (date !== undefined) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new TypeError('date must be a valid Date');
    }
    year = date.getFullYear();
    month = date.getMonth() + 1;
    day = date.getDate();
    hour = date.getHours();
    minute = date.getMinutes();
    second = date.getSeconds();
    if (year < 1980 || year > 2107) {
      throw new RangeError(`date ${date.toISOString()} is outside the FAT range 1980-2107`);
    }
  }
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hour << 11) | (minute << 5) | (second >> 1),
  };
}

// ---------------------------------------------------------------------------------------------
// Layout

function normalizeGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') throw new TypeError('geometry is required');
  const { cylinders, heads = 16, sectorsPerTrack = 63 } = geometry;
  if (!Number.isInteger(cylinders) || cylinders < 1) {
    throw new RangeError('geometry.cylinders must be a positive integer');
  }
  if (!Number.isInteger(heads) || heads < 1 || heads > 255) {
    throw new RangeError('geometry.heads must be an integer from 1 to 255');
  }
  if (!Number.isInteger(sectorsPerTrack) || sectorsPerTrack < 1 || sectorsPerTrack > 63) {
    throw new RangeError('geometry.sectorsPerTrack must be an integer from 1 to 63');
  }
  const totalSectors = cylinders * heads * sectorsPerTrack;
  if (totalSectors <= PARTITION_START || totalSectors > 0xffffffff) {
    throw new RangeError(`geometry of ${totalSectors} sectors cannot hold a partition at LBA ${PARTITION_START}`);
  }
  return { cylinders, heads, sectorsPerTrack, totalSectors };
}

/**
 * Sizes the FAT16 partition: the smallest FAT that covers every data cluster, then the range
 * assertions that keep the volume unambiguously FAT16.
 */
function computeLayout(geo, clusterSize) {
  const where = `${geo.cylinders} cylinders x ${geo.heads} heads x ${geo.sectorsPerTrack} sectors ` +
    `with ${clusterSize}-byte clusters`;
  if (!Number.isInteger(clusterSize) || clusterSize < SECTOR || clusterSize > 32768 || !isPowerOfTwo(clusterSize)) {
    throw new RangeError(`clusterSize must be a power of two from 512 to 32768 bytes, got ${clusterSize}`);
  }
  const sectorsPerCluster = clusterSize / SECTOR;
  const partitionSectors = geo.totalSectors - PARTITION_START;
  const rootSectors = (ROOT_ENTRIES * DIR_ENTRY) / SECTOR;

  const sizeFor = (sectorsPerFat) => {
    const dataSectors = partitionSectors - 1 - FAT_COUNT * sectorsPerFat - rootSectors;
    if (dataSectors < sectorsPerCluster) throw new Error(`${where}: the disk is too small to hold any data`);
    const clusterCount = Math.floor(dataSectors / sectorsPerCluster);
    return { clusterCount, needed: Math.ceil(((clusterCount + 2) * 2) / SECTOR) };
  };

  // A bigger FAT only ever shrinks the data area, so the need for a FAT of `n` sectors falls as `n`
  // grows: start from the need at 1 sector (always enough), then walk down to the smallest that fits.
  let sectorsPerFat = sizeFor(1).needed;
  while (sectorsPerFat > 1 && sizeFor(sectorsPerFat - 1).needed <= sectorsPerFat - 1) sectorsPerFat--;
  const { clusterCount } = sizeFor(sectorsPerFat);

  if (clusterCount < MIN_CLUSTERS) {
    throw new Error(`${where}: ${clusterCount} clusters is below the FAT16 minimum of ${MIN_CLUSTERS}; ` +
      'use smaller clusters or a larger disk');
  }
  if (clusterCount > MAX_CLUSTERS) {
    throw new Error(`${where}: ${clusterCount} clusters is above the FAT16 maximum of ${MAX_CLUSTERS}; ` +
      'use larger clusters or a smaller disk');
  }
  if (sectorsPerFat > MAX_FAT_SECTORS) {
    throw new Error(`${where}: a ${sectorsPerFat}-sector FAT exceeds the FAT16 limit of ${MAX_FAT_SECTORS}`);
  }
  return {
    partitionSectors,
    sectorsPerCluster,
    sectorsPerFat,
    rootSectors,
    clusterCount,
    rootStart: 1 + FAT_COUNT * sectorsPerFat,
    dataStart: 1 + FAT_COUNT * sectorsPerFat + rootSectors,
  };
}

/** CHS bytes for a partition table entry (head, sector|cylinder-high, cylinder-low). */
function chs(lba, geo) {
  const perCylinder = geo.heads * geo.sectorsPerTrack;
  let cylinder = Math.floor(lba / perCylinder);
  let head = Math.floor(lba / geo.sectorsPerTrack) % geo.heads;
  let sector = (lba % geo.sectorsPerTrack) + 1;
  if (cylinder > 1023) {
    cylinder = 1023;
    head = geo.heads - 1;
    sector = geo.sectorsPerTrack;
  }
  return [head, (sector & 0x3f) | ((cylinder >> 2) & 0xc0), cylinder & 0xff];
}

// ---------------------------------------------------------------------------------------------
// Building

function createNode(name, parent, isDir, source) {
  return {
    name,
    parent,
    isDir,
    source,
    children: isDir ? new Map() : null,
    item: null,
    bytes: null,
    cluster: 0,
    clusters: 0,
    placed: false,
  };
}

function nodePath(node) {
  const parts = [];
  for (let n = node; n.parent; n = n.parent) parts.push(n.name);
  return parts.reverse().join('/');
}

/** Builds the directory tree from the caller's paths; collisions and bad names throw together. */
function buildTree(files, dirs, onInvalid) {
  const root = createNode('', null, true, '');
  const skipped = [];
  const invalid = [];
  const collisions = [];

  const place = (path, isDir, item) => {
    if (typeof path !== 'string') throw new TypeError('Every file and directory path must be a string');
    const names = [];
    for (const segment of splitPath(path)) {
      const upper = upperAscii(segment);
      const problem = nameProblem(upper);
      if (problem) {
        if (onInvalid === 'skip') skipped.push(path);
        else invalid.push(`${path} (${problem})`);
        return;
      }
      names.push(upper);
    }
    let dir = root;
    for (let i = 0; i < names.length; i++) {
      const leaf = i === names.length - 1;
      const wantDir = !leaf || isDir;
      const existing = dir.children.get(names[i]);
      if (existing) {
        if (!(wantDir && existing.isDir)) {
          collisions.push(`${path} conflicts with ${existing.source} at ${nodePath(existing)}`);
          return;
        }
        dir = existing;
        continue;
      }
      const node = createNode(names[i], dir, wantDir, path);
      if (leaf && !isDir) node.item = item;
      dir.children.set(names[i], node);
      dir = node;
    }
  };

  for (const file of files) {
    if (!file || typeof file !== 'object') throw new TypeError('Every entry in files must be an object with a path');
    place(file.path, false, file);
  }
  for (const dir of dirs) place(dir, true, null);

  const problems = [];
  if (invalid.length) problems.push(`Not valid 8.3 paths:\n  ${invalid.join('\n  ')}`);
  if (collisions.length) problems.push(`Colliding paths:\n  ${collisions.join('\n  ')}`);
  if (problems.length) throw new Error(problems.join('\n'));
  return { root, skipped };
}

/** Pre-order walk in directory order. */
function collect(root) {
  const fileNodes = [];
  const dirNodes = [];
  const walk = (dir) => {
    dirNodes.push(dir);
    for (const child of dir.children.values()) {
      if (child.isDir) walk(child);
      else fileNodes.push(child);
    }
  };
  walk(root);
  return { fileNodes, dirNodes };
}

/**
 * Takes `bytes` when the file has them and returns the size known without calling read():
 * the length of `bytes`, else the caller's declared `size`, else null.
 */
function knownSize(node) {
  const { item } = node;
  let size = null;
  if (item.bytes !== undefined && item.bytes !== null) {
    node.bytes = asBuffer(item.bytes, `${node.source}: file content`);
    size = node.bytes.length;
  } else if (typeof item.read !== 'function') {
    throw new TypeError(`${node.source}: a file needs bytes or a read() function (use an empty Buffer for an empty file)`);
  }
  if (item.size !== undefined) {
    if (!Number.isInteger(item.size) || item.size < 0) {
      throw new RangeError(`${node.source}: size must be a non-negative integer`);
    }
    if (size !== null && size !== item.size) {
      throw new RangeError(`${node.source}: size is ${item.size} but bytes holds ${size}`);
    }
    size = item.size;
  }
  return size;
}

/** Moves the boot files to the front of the root directory and returns their nodes in order. */
function orderBootFiles(root, bootFiles) {
  const boot = [];
  for (const entry of bootFiles) {
    if (typeof entry !== 'string') throw new TypeError('bootFiles entries must be strings');
    const segments = splitPath(entry);
    const node = segments.length === 1 ? root.children.get(upperAscii(segments[0])) : undefined;
    if (!node || node.isDir) throw new Error(`bootFiles entry "${entry}" is not a file in the root directory`);
    if (boot.includes(node)) throw new Error(`bootFiles lists "${entry}" more than once`);
    boot.push(node);
  }
  const ordered = new Map(boot.map((node) => [node.name, node]));
  for (const [name, node] of root.children) if (!ordered.has(name)) ordered.set(name, node);
  root.children = ordered;
  return boot;
}

function writeEntry(out, offset, name11, attr, cluster, size, stamp) {
  out.write(name11, offset, 11, 'latin1');
  out[offset + 11] = attr;
  out.writeUInt16LE(stamp.time, offset + 14);
  out.writeUInt16LE(stamp.date, offset + 16);
  out.writeUInt16LE(stamp.date, offset + 18);
  out.writeUInt16LE(stamp.time, offset + 22);
  out.writeUInt16LE(stamp.date, offset + 24);
  out.writeUInt16LE(cluster, offset + 26);
  out.writeUInt32LE(size, offset + 28);
}

function writeBpb(bs, { geo, layout, label, volumeId }) {
  const small = layout.partitionSectors < 0x10000;
  bs.writeUInt16LE(SECTOR, 0x0b);
  bs[0x0d] = layout.sectorsPerCluster;
  bs.writeUInt16LE(1, 0x0e);
  bs[0x10] = FAT_COUNT;
  bs.writeUInt16LE(ROOT_ENTRIES, 0x11);
  bs.writeUInt16LE(small ? layout.partitionSectors : 0, 0x13);
  bs[0x15] = MEDIA;
  bs.writeUInt16LE(layout.sectorsPerFat, 0x16);
  bs.writeUInt16LE(geo.sectorsPerTrack, 0x18);
  bs.writeUInt16LE(geo.heads, 0x1a);
  bs.writeUInt32LE(PARTITION_START, 0x1c);
  bs.writeUInt32LE(small ? 0 : layout.partitionSectors, 0x20);
  bs[0x24] = 0x80;
  bs[0x25] = 0;
  bs[0x26] = 0x29;
  bs.writeUInt32LE(volumeId, 0x27);
  bs.write((label ?? 'NO NAME').padEnd(11), 0x2b, 11, 'latin1');
  bs.write('FAT16   ', 0x36, 8, 'latin1');
}

/**
 * Builds a complete hard-disk image: MBR, one active FAT16 partition (type 0x06) at LBA 63,
 * two FATs, a 512-entry root and the file tree. Output is byte-for-byte reproducible for the
 * same input.
 *
 * @param {object} options
 * @param {{cylinders: number, heads?: number, sectorsPerTrack?: number}} options.geometry
 *   Disk geometry; heads default to 16 and sectors per track to 63.
 * @param {number} options.clusterSize Bytes per cluster: a power of two from 512 to 32768.
 * @param {{path: string, bytes?: Buffer, read?: () => Buffer, size?: number}[]} [options.files]
 *   Files by 8.3 path (`/` or `\` separators). `read` is called once, only for files that are kept.
 *   Give `size` with `read` to let a volume overflow be caught before any file is read; `read` must
 *   then return exactly that many bytes. Without it the overflow is caught as soon as the running
 *   total exceeds the volume.
 * @param {string[]} [options.dirs] Extra (possibly empty) directories to create.
 * @param {string} [options.label] Volume label, up to 11 characters.
 * @param {number} [options.volumeId] Volume serial number; derived from the label when omitted.
 * @param {Date} [options.date] Timestamp for every entry (local wall-clock fields);
 *   defaults to 1996-01-01 12:00:00.
 * @param {Buffer} [options.mbrBootCode] Up to 446 bytes of MBR boot code.
 * @param {Buffer} [options.bootSectorTemplate] A 512-byte boot sector whose code is kept; only
 *   its BPB area (bytes 0x0B-0x3D) is replaced.
 * @param {string[]} [options.bootFiles] Root files placed first in the root directory and first,
 *   contiguously, in the data area.
 * @param {'error'|'skip'} [options.onInvalid] What to do with paths that are not valid 8.3 names.
 * @returns {{image: Buffer, skipped: string[], stats: object}}
 */
export function buildImage(options = {}) {
  const {
    geometry,
    clusterSize,
    files = [],
    dirs = [],
    label,
    volumeId,
    date,
    mbrBootCode,
    bootSectorTemplate,
    bootFiles = [],
    onInvalid = 'error',
  } = options;

  if (onInvalid !== 'error' && onInvalid !== 'skip') throw new TypeError("onInvalid must be 'error' or 'skip'");
  const geo = normalizeGeometry(geometry);
  const layout = computeLayout(geo, clusterSize);
  const volumeLabel = normalizeLabel(label);
  const serial = volumeId === undefined ? volumeIdFromLabel(volumeLabel) : volumeId;
  if (!Number.isInteger(serial) || serial < 0 || serial > 0xffffffff) {
    throw new RangeError('volumeId must be an unsigned 32-bit integer');
  }
  const stamp = dosStamp(date);
  const bootCode = mbrBootCode === undefined ? null : asBuffer(mbrBootCode, 'mbrBootCode');
  if (bootCode && bootCode.length > BOOT_CODE_SIZE) {
    throw new RangeError(`mbrBootCode is ${bootCode.length} bytes; the MBR holds ${BOOT_CODE_SIZE}`);
  }
  const template = bootSectorTemplate === undefined ? null : asBuffer(bootSectorTemplate, 'bootSectorTemplate');
  if (template && template.length !== SECTOR) {
    throw new RangeError(`bootSectorTemplate must be ${SECTOR} bytes, got ${template.length}`);
  }

  const { root, skipped } = buildTree(files, dirs, onInvalid);
  const bootNodes = orderBootFiles(root, bootFiles);
  const { fileNodes, dirNodes } = collect(root);

  const { clusterCount, sectorsPerFat, rootSectors } = layout;
  const clusterBytes = clusterSize;
  let needed = 0;
  const addClusters = (count) => {
    needed += count;
    if (needed > clusterCount) {
      throw new Error(`The contents need at least ${needed} clusters of ${clusterBytes} bytes ` +
        `but the volume has ${clusterCount}`);
    }
  };
  for (const dir of dirNodes) {
    if (!dir.parent) {
      const entries = dir.children.size + (volumeLabel ? 1 : 0);
      if (entries > ROOT_ENTRIES) {
        throw new Error(`The root directory needs ${entries} entries (including the volume label) ` +
          `but a FAT16 root holds ${ROOT_ENTRIES}`);
      }
      continue;
    }
    const entries = dir.children.size + 2;
    if (entries > MAX_DIR_ENTRIES) {
      throw new Error(`Directory ${nodePath(dir)} needs ${entries} entries; the FAT limit is ${MAX_DIR_ENTRIES}`);
    }
    dir.clusters = Math.max(1, Math.ceil((entries * DIR_ENTRY) / clusterBytes));
    addClusters(dir.clusters);
  }

  // Capacity is enforced before and while content is loaded, so an oversized tree fails without
  // calling every read(): first against the sizes already known, then as each read() returns.
  const lazy = [];
  for (const node of fileNodes) {
    const size = knownSize(node);
    if (size !== null) {
      node.clusters = Math.ceil(size / clusterBytes);
      addClusters(node.clusters);
    }
    if (!node.bytes) lazy.push(node);
  }
  for (const node of lazy) {
    const data = asBuffer(node.item.read(), `${node.source}: file content`);
    const declared = node.item.size;
    if (declared === undefined) {
      node.clusters = Math.ceil(data.length / clusterBytes);
      addClusters(node.clusters);
    } else if (data.length !== declared) {
      throw new RangeError(`${node.source}: read() returned ${data.length} bytes but size is ${declared}`);
    }
    node.bytes = data;
  }

  const image = Buffer.alloc(geo.totalSectors * SECTOR);
  const partitionOffset = PARTITION_START * SECTOR;
  const fat = Buffer.alloc(sectorsPerFat * SECTOR);
  fat.writeUInt16LE(0xff00 | MEDIA, 0);
  fat.writeUInt16LE(FAT_EOC, 2);

  let next = 2;
  const allocate = (count) => {
    if (count === 0) return 0;
    const first = next;
    for (let i = 0; i < count; i++) fat.writeUInt16LE(i === count - 1 ? FAT_EOC : first + i + 1, (first + i) * 2);
    next += count;
    return first;
  };
  const placeFile = (node) => {
    node.cluster = allocate(node.clusters);
    node.placed = true;
  };
  const placeDir = (dir) => {
    for (const child of dir.children.values()) {
      if (child.isDir) {
        child.cluster = allocate(child.clusters);
        placeDir(child);
      } else if (!child.placed) {
        placeFile(child);
      }
    }
  };
  for (const node of bootNodes) placeFile(node);
  placeDir(root);

  const dataOffset = partitionOffset + layout.dataStart * SECTOR;
  const clusterOffset = (cluster) => dataOffset + (cluster - 2) * clusterBytes;

  for (const node of fileNodes) if (node.bytes.length) image.set(node.bytes, clusterOffset(node.cluster));
  for (const dir of dirNodes) {
    const isRoot = !dir.parent;
    const out = Buffer.alloc(isRoot ? rootSectors * SECTOR : dir.clusters * clusterBytes);
    let at = 0;
    const put = (name11, attr, cluster, size) => {
      writeEntry(out, at, name11, attr, cluster, size, stamp);
      at += DIR_ENTRY;
    };
    if (isRoot) {
      if (volumeLabel) put(volumeLabel.padEnd(11), ATTR_VOLUME, 0, 0);
    } else {
      put('.'.padEnd(11), ATTR_DIRECTORY, dir.cluster, 0);
      put('..'.padEnd(11), ATTR_DIRECTORY, dir.parent.cluster, 0);
    }
    for (const child of dir.children.values()) {
      put(pack83(child.name), child.isDir ? ATTR_DIRECTORY : ATTR_ARCHIVE, child.cluster,
        child.isDir ? 0 : child.bytes.length);
    }
    image.set(out, isRoot ? partitionOffset + layout.rootStart * SECTOR : clusterOffset(dir.cluster));
  }

  fat.copy(image, partitionOffset + SECTOR);
  fat.copy(image, partitionOffset + SECTOR + sectorsPerFat * SECTOR);

  const bs = image.subarray(partitionOffset, partitionOffset + SECTOR);
  if (template) {
    template.copy(bs);
  } else {
    bs.set([0xeb, 0x3c, 0x90]);
    bs.write('MSDOS5.0', 3, 8, 'latin1');
    bs.set([0xcd, 0x18, 0xeb, 0xfe], 0x3e);
  }
  writeBpb(bs, { geo, layout, label: volumeLabel, volumeId: serial });
  bs.writeUInt16LE(0xaa55, 510);

  if (bootCode) bootCode.copy(image, 0);
  const entry = PARTITION_TABLE;
  image[entry] = 0x80;
  image.set(chs(PARTITION_START, geo), entry + 1);
  image[entry + 4] = 0x06;
  image.set(chs(geo.totalSectors - 1, geo), entry + 5);
  image.writeUInt32LE(PARTITION_START, entry + 8);
  image.writeUInt32LE(layout.partitionSectors, entry + 12);
  image.writeUInt16LE(0xaa55, 510);

  const used = next - 2;
  return {
    image,
    skipped,
    stats: {
      totalSectors: geo.totalSectors,
      partitionSectors: layout.partitionSectors,
      clusterCount,
      sectorsPerFat,
      sectorsPerCluster: layout.sectorsPerCluster,
      usedClusters: used,
      freeClusters: clusterCount - used,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Reading

function parseMbr(buf) {
  if (buf.length < SECTOR) throw new Error('Image is smaller than one sector');
  if (buf.readUInt16LE(510) !== 0xaa55) throw new Error('MBR signature 0x55AA not found');
  const partitions = [];
  for (let index = 0; index < 4; index++) {
    const at = PARTITION_TABLE + index * 16;
    const type = buf[at + 4];
    if (type === 0) continue;
    partitions.push({
      index,
      active: buf[at] === 0x80,
      type,
      startLba: buf.readUInt32LE(at + 8),
      sectors: buf.readUInt32LE(at + 12),
    });
  }
  return { bootCode: Buffer.from(buf.subarray(0, BOOT_CODE_SIZE)), partitions };
}

function parseBpb(bs) {
  const totalSectors16 = bs.readUInt16LE(0x13);
  const signature = bs[0x26];
  const extended = signature === 0x29;
  return {
    bytesPerSector: bs.readUInt16LE(0x0b),
    sectorsPerCluster: bs[0x0d],
    reservedSectors: bs.readUInt16LE(0x0e),
    fatCount: bs[0x10],
    rootEntries: bs.readUInt16LE(0x11),
    totalSectors: totalSectors16 || bs.readUInt32LE(0x20),
    media: bs[0x15],
    sectorsPerFat: bs.readUInt16LE(0x16),
    sectorsPerTrack: bs.readUInt16LE(0x18),
    heads: bs.readUInt16LE(0x1a),
    hiddenSectors: bs.readUInt32LE(0x1c),
    volumeId: extended || signature === 0x28 ? bs.readUInt32LE(0x27) : 0,
    label: extended ? bs.toString('latin1', 0x2b, 0x36).trimEnd() : '',
    fsType: extended ? bs.toString('latin1', 0x36, 0x3e).trimEnd() : '',
  };
}

/** Locates the FAT16 partition in `buf` and validates its BPB; throws a clear error otherwise. */
function openVolume(buf, partitionIndex) {
  const mbr = parseMbr(buf);
  const entry = mbr.partitions.find((p) => p.index === partitionIndex);
  if (!entry) throw new Error(`Partition ${partitionIndex} is not defined in the MBR`);
  if (!FAT16_TYPES.has(entry.type)) {
    throw new Error(`Partition ${partitionIndex} has type ${hex(entry.type)}: unsupported ` +
      '(only FAT16 types 0x04, 0x06 and 0x0E can be read)');
  }
  const partitionOffset = entry.startLba * SECTOR;
  if (partitionOffset + SECTOR > buf.length) throw new Error('Image ends before the partition boot sector');
  const bootSector = Buffer.from(buf.subarray(partitionOffset, partitionOffset + SECTOR));
  const bpb = parseBpb(bootSector);

  if (bpb.bytesPerSector !== SECTOR) {
    throw new Error(`Unsupported sector size ${bpb.bytesPerSector}; only ${SECTOR}-byte sectors are supported`);
  }
  if (bpb.rootEntries === 0 || bpb.sectorsPerFat === 0) {
    throw new Error('Unsupported file system: FAT32 is not supported');
  }
  if (!isPowerOfTwo(bpb.sectorsPerCluster) || bpb.sectorsPerCluster > 128) {
    throw new Error(`Invalid BPB: ${bpb.sectorsPerCluster} sectors per cluster`);
  }
  if (bpb.reservedSectors === 0) throw new Error('Invalid BPB: no reserved sectors');
  if (bpb.fatCount === 0) throw new Error('Invalid BPB: no FATs');

  const rootSectors = Math.ceil((bpb.rootEntries * DIR_ENTRY) / SECTOR);
  const firstData = bpb.reservedSectors + bpb.fatCount * bpb.sectorsPerFat + rootSectors;
  if (bpb.totalSectors <= firstData) throw new Error('Invalid BPB: total sectors do not cover the FAT and root directory');
  const clusterCount = Math.floor((bpb.totalSectors - firstData) / bpb.sectorsPerCluster);
  if (clusterCount < MIN_CLUSTERS) {
    throw new Error(`Unsupported file system: ${clusterCount} clusters means FAT12, which is not supported`);
  }
  if (clusterCount > MAX_CLUSTERS) {
    throw new Error(`Unsupported file system: ${clusterCount} clusters means FAT32, which is not supported`);
  }
  if (bpb.sectorsPerFat * (SECTOR / 2) < clusterCount + 2) {
    throw new Error(`Invalid BPB: a ${bpb.sectorsPerFat}-sector FAT cannot cover ${clusterCount} clusters`);
  }
  if (partitionOffset + bpb.totalSectors * SECTOR > buf.length) {
    throw new Error('Image is truncated: the file system extends past the end of the data');
  }

  const fatOffset = partitionOffset + bpb.reservedSectors * SECTOR;
  const rootOffset = fatOffset + bpb.fatCount * bpb.sectorsPerFat * SECTOR;
  const dataOffset = rootOffset + rootSectors * SECTOR;
  const clusterBytes = bpb.sectorsPerCluster * SECTOR;
  return {
    buf,
    mbr,
    entry,
    bootSector,
    bpb,
    partitionOffset,
    fatOffset,
    rootOffset,
    rootBytes: rootSectors * SECTOR,
    dataOffset,
    clusterBytes,
    clusterCount,
    maxCluster: clusterCount + 1,
    fatEntry: (cluster) => buf.readUInt16LE(fatOffset + cluster * 2),
    clusterOffset: (cluster) => dataOffset + (cluster - 2) * clusterBytes,
  };
}

/**
 * Follows a cluster chain. `claim(cluster)` may return a problem string to stop the walk (used by
 * the checker to detect cross-links). Returns the clusters visited and the first problem, if any.
 */
function followChain(vol, first, claim) {
  const clusters = [];
  let cluster = first;
  for (;;) {
    if (cluster < 2 || cluster > vol.maxCluster) {
      return { clusters, problem: `cluster ${cluster} is outside the data area (2-${vol.maxCluster})` };
    }
    const claimed = claim?.(cluster);
    if (claimed) return { clusters, problem: claimed };
    if (clusters.length >= vol.clusterCount) return { clusters, problem: 'cluster chain loops' };
    clusters.push(cluster);
    const next = vol.fatEntry(cluster);
    if (next >= FAT_EOC_MIN) return { clusters, problem: null };
    if (next === FAT_BAD) return { clusters, problem: `cluster ${cluster} continues into a bad cluster` };
    if (next === 0) return { clusters, problem: `cluster ${cluster} continues into a free cluster` };
    cluster = next;
  }
}

function readClusters(vol, clusters) {
  return Buffer.concat(clusters.map((c) => vol.buf.subarray(vol.clusterOffset(c), vol.clusterOffset(c) + vol.clusterBytes)));
}

/**
 * Directory entries in order, stopping at the first 0x00 entry and skipping deleted entries,
 * long-file-name entries and the volume label. `.` and `..` are included when present.
 */
function parseEntries(bytes) {
  const entries = [];
  for (let at = 0; at + DIR_ENTRY <= bytes.length; at += DIR_ENTRY) {
    const first = bytes[at];
    if (first === 0x00) break;
    if (first === 0xe5) continue;
    const attr = bytes[at + 11];
    if ((attr & 0x3f) === 0x0f) continue;
    if ((attr & 0x18) === ATTR_VOLUME) continue;
    const raw = Buffer.from(bytes.subarray(at, at + 11));
    if (raw[0] === 0x05) raw[0] = 0xe5;
    const text = raw.toString('latin1');
    const base = text.slice(0, 8).trimEnd();
    const ext = text.slice(8).trimEnd();
    entries.push({
      name: ext ? `${base}.${ext}` : base,
      attr,
      isDir: (attr & ATTR_DIRECTORY) !== 0,
      cluster: bytes.readUInt16LE(at + 26),
      size: bytes.readUInt32LE(at + 28),
      dates: {
        create: bytes.readUInt16LE(at + 16),
        access: bytes.readUInt16LE(at + 18),
        write: bytes.readUInt16LE(at + 24),
      },
    });
  }
  return entries;
}

/**
 * Whether a FAT date word has a real month and day. A zero word means "not recorded", which DOS
 * and other tools leave in the create and access fields, so it is accepted. Leap years follow the
 * DOS rule (every fourth year).
 */
function validDateWord(word) {
  if (word === 0) return true;
  const year = 1980 + (word >> 9);
  const month = (word >> 5) & 0x0f;
  const day = word & 0x1f;
  if (month < 1 || month > 12) return false;
  const days = [31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= days;
}

/**
 * Reads a FAT16 disk image: an MBR with a FAT16 partition of type 0x04, 0x06 or 0x0E and any
 * cluster size. Long-file-name entries and deleted entries are skipped.
 *
 * @param {Buffer} buf The whole disk image.
 * @param {{partition?: number}} [options] MBR slot (0-3) of the partition to open.
 * @returns {object} `mbr`, `partitionOffset`, `bootSector`, `bpb` (its `label` and `fsType` have
 *   trailing spaces trimmed), plus `list()`, `readFile(path)` and `exists(path)`; paths use `/` or
 *   `\` and ignore case.
 */
export function readImage(buf, { partition = 0 } = {}) {
  const vol = openVolume(asBuffer(buf, 'image'), partition);
  const root = { name: '', isDir: true, cluster: 0, children: null };

  const childrenOf = (dir, path) => {
    if (!dir.children) {
      let bytes;
      if (dir === root) {
        bytes = vol.buf.subarray(vol.rootOffset, vol.rootOffset + vol.rootBytes);
      } else {
        const { clusters, problem } = followChain(vol, dir.cluster);
        if (problem) throw new Error(`Directory ${path}: ${problem}`);
        bytes = readClusters(vol, clusters);
      }
      dir.children = parseEntries(bytes).filter((e) => e.name !== '.' && e.name !== '..');
    }
    return dir.children;
  };

  const resolve = (path) => {
    if (typeof path !== 'string') throw new TypeError('path must be a string');
    let node = root;
    let walked = '';
    for (const segment of splitPath(path).filter(Boolean).map(upperAscii)) {
      if (!node.isDir) return null;
      node = childrenOf(node, walked).find((e) => upperAscii(e.name) === segment) ?? null;
      if (!node) return null;
      walked = walked ? `${walked}/${node.name}` : node.name;
    }
    return node;
  };

  return {
    mbr: vol.mbr,
    partitionOffset: vol.partitionOffset,
    bootSector: vol.bootSector,
    bpb: vol.bpb,

    list() {
      const out = [];
      const seen = new Set();
      const walk = (dir, prefix) => {
        for (const e of childrenOf(dir, prefix)) {
          const path = prefix ? `${prefix}/${e.name}` : e.name;
          out.push({ path, isDir: e.isDir, size: e.size, attr: e.attr });
          if (!e.isDir) continue;
          if (seen.has(e.cluster)) throw new Error(`Directory ${path} shares cluster ${e.cluster} with another directory`);
          seen.add(e.cluster);
          walk(e, path);
        }
      };
      walk(root, '');
      return out;
    },

    readFile(path) {
      const node = resolve(path);
      if (!node) throw new Error(`File not found: ${path}`);
      if (node.isDir) throw new Error(`${path} is a directory`);
      if (node.size === 0) return Buffer.alloc(0);
      if (node.cluster === 0) throw new Error(`${path}: size is ${node.size} but the file has no clusters`);
      const { clusters, problem } = followChain(vol, node.cluster);
      if (problem) throw new Error(`${path}: ${problem}`);
      if (clusters.length * vol.clusterBytes < node.size) {
        throw new Error(`${path}: cluster chain is shorter than the file size of ${node.size} bytes`);
      }
      const out = Buffer.alloc(node.size);
      clusters.forEach((cluster, i) => {
        const start = vol.clusterOffset(cluster);
        const take = Math.min(vol.clusterBytes, node.size - i * vol.clusterBytes);
        if (take > 0) vol.buf.copy(out, i * vol.clusterBytes, start, start + take);
      });
      return out;
    },

    exists(path) {
      return resolve(path) !== null;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Checking

/**
 * A small fsck for the first partition of an image: signatures, BPB sanity, identical FATs,
 * FAT[0]/FAT[1], every chain in range with no loops or cross-links, chain length matching file
 * size, correct `.` and `..` entries, no duplicate names in a directory, no directory with a
 * non-zero size, valid month and day in every timestamp (an unset zero date is fine), and no lost
 * clusters. Never throws on a damaged image.
 *
 * @param {Buffer} buf The whole disk image.
 * @returns {{ok: boolean, errors: string[]}}
 */
export function checkImage(buf) {
  const errors = [];
  let overflow = 0;
  const report = (message) => {
    if (errors.length < MAX_REPORTED_ERRORS) errors.push(message);
    else overflow++;
  };
  const finish = () => {
    if (overflow) errors.push(`... and ${overflow} more error(s)`);
    return { ok: errors.length === 0, errors };
  };

  let vol;
  try {
    const image = asBuffer(buf, 'image');
    const [first] = parseMbr(image).partitions;
    if (!first) throw new Error('MBR has no partitions');
    vol = openVolume(image, first.index);
  } catch (err) {
    report(err.message);
    return finish();
  }
  const { bpb, entry } = vol;

  if (vol.bootSector.readUInt16LE(510) !== 0xaa55) report('Partition boot sector signature 0x55AA not found');
  if (bpb.hiddenSectors !== entry.startLba) {
    report(`BPB hidden sectors (${bpb.hiddenSectors}) differ from the partition start LBA (${entry.startLba})`);
  }
  if (bpb.totalSectors > entry.sectors) {
    report(`BPB total sectors (${bpb.totalSectors}) exceed the partition size (${entry.sectors})`);
  }

  const fatBytes = bpb.sectorsPerFat * SECTOR;
  const fatCopy = (n) => vol.buf.subarray(vol.fatOffset + n * fatBytes, vol.fatOffset + (n + 1) * fatBytes);
  for (let n = 1; n < bpb.fatCount; n++) {
    if (Buffer.compare(fatCopy(0), fatCopy(n)) !== 0) {
      const a = fatCopy(0);
      const b = fatCopy(n);
      let at = 0;
      while (a[at] === b[at]) at++;
      report(`FAT ${n + 1} differs from FAT 1 (first difference at FAT entry ${at >> 1})`);
    }
  }
  if (vol.fatEntry(0) !== (0xff00 | bpb.media)) {
    report(`FAT[0] is ${hex(vol.fatEntry(0), 4)}; expected ${hex(0xff00 | bpb.media, 4)} (media byte ${hex(bpb.media)})`);
  }
  if ((vol.fatEntry(1) & 0x3fff) !== 0x3fff) {
    report(`FAT[1] is ${hex(vol.fatEntry(1), 4)}; expected an end-of-chain value such as 0xFFFF`);
  }

  const owner = new Int32Array(vol.maxCluster + 1);
  const owners = [''];
  const chainFor = (path, first) => {
    const id = owners.push(path) - 1;
    return followChain(vol, first, (cluster) => {
      const current = owner[cluster];
      if (current === 0) {
        owner[cluster] = id;
        return null;
      }
      return current === id
        ? `cluster chain loops back to cluster ${cluster}`
        : `cluster ${cluster} is cross-linked with ${owners[current] || '/'}`;
    });
  };

  const pending = [{ path: '', cluster: 0, parent: 0, bytes: vol.buf.subarray(vol.rootOffset, vol.rootOffset + vol.rootBytes) }];
  while (pending.length) {
    const dir = pending.pop();
    const where = dir.path || '/';
    if (dir.cluster !== 0) {
      const dot = dir.bytes.subarray(0, 11).toString('latin1');
      const dotdot = dir.bytes.subarray(32, 43).toString('latin1');
      if (dot !== '.'.padEnd(11) || !(dir.bytes[11] & ATTR_DIRECTORY) || dir.bytes.readUInt16LE(26) !== dir.cluster) {
        report(`${where}: the "." entry is missing or does not point at the directory itself`);
      }
      if (dotdot !== '..'.padEnd(11) || !(dir.bytes[43] & ATTR_DIRECTORY) || dir.bytes.readUInt16LE(58) !== dir.parent) {
        report(`${where}: the ".." entry is missing or does not point at the parent directory`);
      }
    }
    const names = new Set();
    for (const e of parseEntries(dir.bytes)) {
      const dotEntry = dir.cluster !== 0 && (e.name === '.' || e.name === '..');
      const path = dir.path ? `${dir.path}/${e.name}` : e.name;
      for (const [field, word] of Object.entries(e.dates)) {
        if (!validDateWord(word)) {
          report(`${path}: invalid ${field} date (month ${(word >> 5) & 0x0f}, day ${word & 0x1f})`);
        }
      }
      if (dotEntry) continue;
      const key = upperAscii(e.name);
      if (names.has(key)) report(`${where}: duplicate name ${e.name}`);
      names.add(key);
      if (e.isDir && e.size !== 0) report(`${path}: directory entry has non-zero size ${e.size}`);
      if (e.cluster === 0) {
        if (e.isDir) report(`${path}: directory has no first cluster`);
        else if (e.size !== 0) report(`${path}: size is ${e.size} but the file has no clusters`);
        continue;
      }
      const { clusters, problem } = chainFor(path, e.cluster);
      if (problem) {
        report(`${path}: ${problem}`);
        continue;
      }
      if (e.isDir) {
        pending.push({ path, cluster: e.cluster, parent: dir.cluster, bytes: readClusters(vol, clusters) });
        continue;
      }
      const expected = Math.ceil(e.size / vol.clusterBytes);
      if (clusters.length !== expected) {
        report(`${path}: size ${e.size} needs ${expected} cluster(s) but the chain has ${clusters.length}`);
      }
    }
  }

  let lost = 0;
  let firstLost = 0;
  for (let cluster = 2; cluster <= vol.maxCluster; cluster++) {
    const value = vol.fatEntry(cluster);
    if (value !== 0 && value !== FAT_BAD && owner[cluster] === 0) {
      if (lost === 0) firstLost = cluster;
      lost++;
    }
  }
  if (lost) report(`${lost} lost cluster(s) allocated but not referenced by any entry (first: ${firstLost})`);
  return finish();
}

// ---------------------------------------------------------------------------------------------
// Text

/**
 * Converts LF or CRLF line endings to CRLF. Idempotent; a lone CR is left alone.
 * @param {Buffer} buf
 * @returns {Buffer} a new Buffer
 */
export function toCrlf(buf) {
  const src = asBuffer(buf, 'toCrlf input');
  const needsCr = (i) => src[i] === 0x0a && (i === 0 || src[i - 1] !== 0x0d);
  let extra = 0;
  for (let i = 0; i < src.length; i++) if (needsCr(i)) extra++;
  const out = Buffer.allocUnsafe(src.length + extra);
  let at = 0;
  for (let i = 0; i < src.length; i++) {
    if (needsCr(i)) out[at++] = 0x0d;
    out[at++] = src[i];
  }
  return out;
}
