import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { CliError } from './cli.mjs';
import { sha256Buffer } from './download.mjs';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;

/** Largest single entry `read()` will inflate. */
export const MAX_ENTRY_BYTES = 512 * 1024 ** 2;
/** Largest total of declared entry sizes `extractZip` will write. */
export const MAX_TOTAL_BYTES = 4 * 1024 ** 3;
/** Most entries `extractZip` will process. */
export const MAX_ENTRIES = 100_000;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of a buffer, as an unsigned integer. */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bad(message) {
  return new CliError(`invalid zip: ${message}`);
}

function toNumber(big, what) {
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw bad(`${what} is too large`);
  return Number(big);
}

function need(buf, offset, length, what) {
  if (offset < 0 || offset + length > buf.length) throw bad(`${what} is out of bounds`);
}

function findEocd(buf) {
  const lowest = Math.max(0, buf.length - 22 - U16_MAX);
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD && i + 22 + buf.readUInt16LE(i + 20) <= buf.length) return i;
  }
  throw bad('end of central directory not found');
}

function readDirectoryLocation(buf) {
  const eocd = findEocd(buf);
  let count = buf.readUInt16LE(eocd + 10);
  let size = buf.readUInt32LE(eocd + 12);
  let offset = buf.readUInt32LE(eocd + 16);
  const needs64 = count === U16_MAX || size === U32_MAX || offset === U32_MAX;
  if (needs64 && eocd >= 20 && buf.readUInt32LE(eocd - 20) === SIG_LOCATOR64) {
    const at = toNumber(buf.readBigUInt64LE(eocd - 20 + 8), 'zip64 directory offset');
    need(buf, at, 56, 'zip64 end of central directory');
    if (buf.readUInt32LE(at) !== SIG_EOCD64) throw bad('bad zip64 end of central directory');
    count = toNumber(buf.readBigUInt64LE(at + 32), 'entry count');
    size = toNumber(buf.readBigUInt64LE(at + 40), 'directory size');
    offset = toNumber(buf.readBigUInt64LE(at + 48), 'directory offset');
  }
  return { count, size, offset };
}

function applyZip64Extra(extra, fields) {
  let pos = 0;
  while (pos + 4 <= extra.length) {
    const id = extra.readUInt16LE(pos);
    const len = extra.readUInt16LE(pos + 2);
    const end = pos + 4 + len;
    if (end > extra.length) break;
    if (id === 0x0001) {
      let at = pos + 4;
      for (const key of ['size', 'compressedSize', 'localOffset']) {
        if (fields[key] !== U32_MAX) continue;
        if (at + 8 > end) throw bad('truncated zip64 extra field');
        fields[key] = toNumber(extra.readBigUInt64LE(at), key);
        at += 8;
      }
    }
    pos = end;
  }
}

function dosDate(date, time) {
  return new Date(
    ((date >> 9) & 0x7f) + 1980,
    (((date >> 5) & 0x0f) || 1) - 1,
    (date & 0x1f) || 1,
    (time >> 11) & 0x1f,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2,
  );
}

/** Rejects a local header that disagrees with the central directory entry. */
function checkLocalHeader(buf, entry, at) {
  const nameLen = buf.readUInt16LE(at + 26);
  need(buf, at + 30, nameLen, `local header of '${entry.name}'`);
  const mismatch = (what) => bad(`local header of '${entry.name}' disagrees with the central directory (${what})`);
  if (buf.toString('utf8', at + 30, at + 30 + nameLen) !== entry.name) throw mismatch('name');
  const flags = buf.readUInt16LE(at + 6);
  if ((flags & 1) !== (entry.encrypted ? 1 : 0)) throw mismatch('encryption flag');
  if (buf.readUInt16LE(at + 8) !== entry.method) throw mismatch('method');
  if ((flags & 8) === 0) {
    const compressed = buf.readUInt32LE(at + 18);
    const size = buf.readUInt32LE(at + 22);
    if ((compressed !== U32_MAX && compressed !== entry.compressedSize) || (size !== U32_MAX && size !== entry.size)) {
      throw mismatch('sizes');
    }
  }
}

function makeReader(buf, entry, localOffset) {
  return () => {
    if (entry.size > MAX_ENTRY_BYTES) {
      throw new CliError(`'${entry.name}' declares ${entry.size} bytes, over the ${MAX_ENTRY_BYTES} byte limit`);
    }
    need(buf, localOffset, 30, `local header of '${entry.name}'`);
    if (buf.readUInt32LE(localOffset) !== SIG_LOCAL) throw bad(`bad local header for '${entry.name}'`);
    checkLocalHeader(buf, entry, localOffset);
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    need(buf, start, entry.compressedSize, `data of '${entry.name}'`);
    const raw = buf.subarray(start, start + entry.compressedSize);
    let data;
    if (entry.method === 0) data = Buffer.from(raw);
    else if (entry.method === 8) {
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(entry.size, 1) });
      } catch (err) {
        throw bad(`cannot inflate '${entry.name}': ${err.message}`);
      }
    } else throw new CliError(`unsupported zip compression method ${entry.method} for '${entry.name}'`);
    if (data.length !== entry.size) {
      throw bad(`'${entry.name}' is ${data.length} bytes, expected ${entry.size}`);
    }
    if (crc32(data) !== entry.crc32) throw bad(`CRC mismatch for '${entry.name}'`);
    return data;
  };
}

/**
 * Parses a zip held in memory. Names are not validated here (so a hostile zip can still be
 * listed); `extractZip` and the media importer pass every name through `checkEntryName`.
 * Entries are lazy: `read()` inflates, then checks the size and CRC-32.
 */
export function readZip(buf) {
  const { count, size, offset } = readDirectoryLocation(buf);
  need(buf, offset, size, 'central directory');
  const entries = [];
  let pos = offset;
  for (let i = 0; i < count; i++) {
    need(buf, pos, 46, 'central directory entry');
    if (buf.readUInt32LE(pos) !== SIG_CENTRAL) throw bad('bad central directory entry');
    const madeBy = buf.readUInt16LE(pos + 4);
    const flags = buf.readUInt16LE(pos + 8);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    need(buf, pos + 46, nameLen + extraLen, 'central directory entry');
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    const fields = {
      size: buf.readUInt32LE(pos + 24),
      compressedSize: buf.readUInt32LE(pos + 20),
      localOffset: buf.readUInt32LE(pos + 42),
    };
    applyZip64Extra(buf.subarray(pos + 46 + nameLen, pos + 46 + nameLen + extraLen), fields);
    const unixMode = madeBy >> 8 === 3 ? buf.readUInt32LE(pos + 38) >>> 16 : 0;
    const entry = {
      name,
      isDir: name.endsWith('/') || (unixMode & S_IFMT) === S_IFDIR,
      isSymlink: (unixMode & S_IFMT) === S_IFLNK,
      size: fields.size,
      compressedSize: fields.compressedSize,
      method: buf.readUInt16LE(pos + 10),
      crc32: buf.readUInt32LE(pos + 16),
      mode: unixMode || null,
      mtime: dosDate(buf.readUInt16LE(pos + 14), buf.readUInt16LE(pos + 12)),
      encrypted: (flags & 1) === 1,
    };
    entry.read = () => {
      if (entry.encrypted) throw new CliError(`'${name}' is encrypted, which is not supported`);
      return makeReader(buf, entry, fields.localOffset)();
    };
    entries.push(entry);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return { entries };
}

/** Like `readZip`, from a file. */
export function readZipFile(file) {
  return readZip(fs.readFileSync(file));
}

/**
 * Throws unless `name` is a safe relative entry name: no absolute path, drive letter, backslash,
 * colon, NUL, or empty, `.` or `..` segment. One trailing `/` (a directory entry) is allowed.
 */
export function checkEntryName(name) {
  const fail = (why) => {
    throw new CliError(`unsafe zip entry name ${JSON.stringify(name)}: ${why}`);
  };
  if (typeof name !== 'string' || name === '') fail('empty name');
  if (name.includes('\0')) fail('contains NUL');
  if (name.includes('\\')) fail('contains a backslash');
  if (name.includes(':')) fail('contains a colon');
  if (name.startsWith('/')) fail('absolute path');
  const body = name.endsWith('/') ? name.slice(0, -1) : name;
  for (const segment of body.split('/')) {
    if (segment === '') fail('empty path segment');
    if (segment === '.' || segment === '..') fail(`'${segment}' path segment`);
  }
  return name;
}

/**
 * If every entry sits under one top-level folder, returns the entries with that folder removed
 * from `name` (the folder's own entry is dropped); otherwise returns them unchanged.
 */
export function stripCommonRoot(entries) {
  let root = null;
  let hasContent = false;
  for (const entry of entries) {
    const slash = entry.name.indexOf('/');
    if (slash < 0) return entries;
    const top = entry.name.slice(0, slash);
    if (root === null) root = top;
    else if (root !== top) return entries;
    if (slash < entry.name.length - 1) hasContent = true;
  }
  if (root === null || !hasContent) return entries;
  return entries
    .filter((entry) => entry.name !== `${root}/`)
    .map((entry) => ({ ...entry, name: entry.name.slice(root.length + 1) }));
}

const WIN_RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

function checkWindowsSegment(segment, name) {
  if (WIN_RESERVED.test(segment) || /[. ]$/.test(segment) || /[<>"|?*]/.test(segment)) {
    throw new CliError(`zip entry ${JSON.stringify(name)} has a name Windows cannot store safely`);
  }
}

function isInside(base, target, { allowSame = false } = {}) {
  const rel = path.relative(base, target);
  if (rel === '') return allowSame;
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

function assertInside(base, target, name) {
  if (!isInside(base, target)) {
    throw new CliError(`zip entry ${JSON.stringify(name)} would be written outside the target folder`);
  }
}

/** Like `fs.realpathSync`, but a missing tail is resolved against its deepest existing ancestor. */
function realpathLoose(p) {
  try {
    return fs.realpathSync(p);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    const parent = path.dirname(p);
    if (parent === p) throw err;
    return path.join(realpathLoose(parent), path.basename(p));
  }
}

/**
 * A link target must be relative, use `..` only as a leading prefix, and, resolved against the
 * REAL folder that holds the link, stay inside the real root.
 */
function assertLinkInside(realRoot, realParent, linkTarget, name) {
  const parts = linkTarget.split('/');
  const firstReal = parts.findIndex((p) => p !== '..');
  const lateDotDot = firstReal >= 0 && parts.slice(firstReal).includes('..');
  if (
    linkTarget === '' ||
    linkTarget.includes('\0') ||
    path.isAbsolute(linkTarget) ||
    linkTarget.startsWith('/') ||
    lateDotDot ||
    !isInside(realRoot, path.resolve(realParent, linkTarget))
  ) {
    throw new CliError(
      `zip symlink ${JSON.stringify(name)} points outside the target folder (${JSON.stringify(linkTarget)})`,
    );
  }
}

/** Requires the symlinks at `rels` (default: every one under `root`) to really resolve inside it; removes and reports the first that does not. `realRoot` is `fs.realpathSync(root)`. */
export function assertLinksContained(root, realRoot, rels = listFiles(root)) {
  for (const rel of rels) {
    const abs = path.join(root, ...rel.split('/'));
    if (!fs.lstatSync(abs).isSymbolicLink()) continue;
    let real = null;
    try {
      try {
        real = fs.realpathSync(abs);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        real = realpathLoose(path.resolve(fs.realpathSync(path.dirname(abs)), fs.readlinkSync(abs)));
      }
    } catch {
      // a loop or unreadable link counts as escaping
    }
    if (real === null || !isInside(realRoot, real, { allowSame: true })) {
      fs.rmSync(abs, { force: true });
      throw new CliError(`zip symlink ${JSON.stringify(rel)} resolves outside the target folder`);
    }
  }
}

function hashOf(abs) {
  const stat = fs.lstatSync(abs);
  return sha256Buffer(stat.isSymbolicLink() ? Buffer.from(fs.readlinkSync(abs)) : fs.readFileSync(abs));
}

/** Sorted `/`-separated relative paths of every file and symlink under `dir`. Follows nothing. */
export function listFiles(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(path.join(abs, d.name), r);
      else out.push(r);
    }
  };
  walk(dir, '');
  return out.sort();
}

/** SHA-256 of every file under `dir` (a symlink hashes its target text), keyed by relative path. */
export function hashTree(dir) {
  const files = {};
  for (const rel of listFiles(dir)) files[rel] = hashOf(path.join(dir, ...rel.split('/')));
  return files;
}

/**
 * Extracts a zip into `dest`, refusing anything that would land outside it, and returns the
 * SHA-256 of every file written. `stripRoot` removes a leading folder (entries outside it are an
 * error); `into` then nests everything under a subfolder. `extractor: 'ditto'` uses `ditto` on
 * macOS (keeps framework symlinks) when neither `stripRoot` nor `into` is set.
 */
export function extractZip(zipPath, dest, { stripRoot, into, extractor, log } = {}) {
  const { entries } = readZipFile(zipPath);
  for (const entry of entries) checkEntryName(entry.name);
  if (stripRoot) checkEntryName(stripRoot);
  if (into) checkEntryName(into);

  const root = path.resolve(dest);
  fs.mkdirSync(root, { recursive: true });
  const realRoot = fs.realpathSync(root);
  const win = process.platform === 'win32';

  if (entries.length > MAX_ENTRIES) {
    throw new CliError(`zip has ${entries.length} entries, over the ${MAX_ENTRIES} entry limit`);
  }
  const declared = entries.reduce((sum, e) => sum + (e.isDir ? 0 : e.size), 0);
  if (declared > MAX_TOTAL_BYTES) {
    throw new CliError(`zip declares ${declared} bytes in total, over the ${MAX_TOTAL_BYTES} byte limit`);
  }

  if (extractor === 'ditto' && process.platform === 'darwin' && !stripRoot && !into) {
    execFileSync('ditto', ['-x', '-k', zipPath, root], { stdio: 'ignore' });
    assertLinksContained(root, realRoot);
    return { files: hashTree(root) };
  }

  const files = {};
  const links = [];
  if (into) fs.mkdirSync(path.join(root, ...into.split('/')), { recursive: true });
  for (const entry of entries) {
    let rel = entry.name.endsWith('/') ? entry.name.slice(0, -1) : entry.name;
    if (stripRoot) {
      if (rel === stripRoot && entry.isDir) continue;
      if (!rel.startsWith(`${stripRoot}/`)) {
        throw new CliError(`zip entry ${JSON.stringify(entry.name)} is outside '${stripRoot}/'`);
      }
      rel = rel.slice(stripRoot.length + 1);
    }
    if (into) rel = `${into}/${rel}`;
    const segments = rel.split('/');
    if (win) segments.forEach((s) => checkWindowsSegment(s, entry.name));

    const target = path.resolve(root, ...segments);
    assertInside(root, target, entry.name);

    if (entry.isDir) {
      fs.mkdirSync(target, { recursive: true });
      assertInside(realRoot, fs.realpathSync(target), entry.name);
      continue;
    }

    if (entry.isSymlink && win) {
      log?.warn(`skipping symlink ${entry.name} (not supported on Windows)`);
      continue;
    }

    const parent = path.dirname(target);
    fs.mkdirSync(parent, { recursive: true });
    if (!isInside(realRoot, fs.realpathSync(parent), { allowSame: true })) {
      throw new CliError(`zip entry ${JSON.stringify(entry.name)} would be written outside the target folder`);
    }
    fs.rmSync(target, { force: true });

    if (entry.isSymlink) {
      const linkTarget = entry.read().toString('utf8');
      assertLinkInside(realRoot, fs.realpathSync(parent), linkTarget, entry.name);
      fs.symlinkSync(linkTarget, target);
      files[rel] = sha256Buffer(Buffer.from(linkTarget));
      links.push(rel);
      continue;
    }

    const data = entry.read();
    fs.writeFileSync(target, data);
    if (!win && entry.mode != null && (entry.mode & 0o755) !== 0) fs.chmodSync(target, entry.mode & 0o755);
    files[rel] = sha256Buffer(data);
  }
  if (links.length) assertLinksContained(root, realRoot, links);
  return { files };
}

/** MS-DOS time and date words (local wall-clock fields) for a zip header. */
function zipStamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError('date must be a valid Date');
  const year = date.getFullYear();
  if (year < 1980 || year > 2107) throw new RangeError(`date ${date.toISOString()} is outside the zip range 1980-2107`);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Writes a zip: every entry deflated, or stored when that is not smaller, with its CRC-32, no
 * extra fields, version 20 and the given DOS timestamp, so the same input always gives the same
 * bytes. Names are used as given (`/` separators); there are no directory entries.
 *
 * @param {{name: string, bytes: Buffer, date: Date}[]} entries
 * @returns {Buffer}
 */
export function writeZip(entries) {
  if (entries.length >= U16_MAX) throw new RangeError(`a zip holds at most ${U16_MAX - 1} entries here, got ${entries.length}`);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, bytes, date } of entries) {
    checkEntryName(name);
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(bytes, { level: 9 });
    const stored = deflated.length >= bytes.length;
    const data = stored ? bytes : deflated;
    const method = stored ? 0 : 8;
    const stamp = zipStamp(date);
    if (offset + 30 + nameBytes.length + data.length >= U32_MAX) throw new RangeError('the zip is too large (zip64 is not written)');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc32(bytes), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 30); // the local header's fields from the version on have the same layout
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_EOCD, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
