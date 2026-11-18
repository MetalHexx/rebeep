import zlib from 'node:zlib';
import { crc32 } from '../lib/zip.mjs';

const U32 = 0xffffffff;

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}
function u64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

/**
 * Builds a zip in memory. An entry is `{ name, data?, dir?, symlinkTo?, mode?, method?, crc? }`.
 * Names are written raw, so hostile names can be tested. `mode` is a unix permission such as
 * 0o755 (the file type bits are added); `method` is 0 (stored, default) or 8 (deflate); `crc`
 * overrides the stored CRC-32; `declaredSize` overrides the stored uncompressed size.
 * `{ zip64: true }` writes zip64 sizes, offsets and directory.
 */
export function makeZip(entries, { zip64 = false } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  const push = (buf) => {
    parts.push(buf);
    offset += buf.length;
  };

  for (const entry of entries) {
    const isDir = Boolean(entry.dir);
    const isLink = entry.symlinkTo !== undefined;
    const name = isDir && !entry.name.endsWith('/') ? `${entry.name}/` : entry.name;
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = isDir ? Buffer.alloc(0) : Buffer.from(isLink ? entry.symlinkTo : (entry.data ?? ''));
    const method = isDir ? 0 : (entry.method ?? 0);
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = entry.crc ?? crc32(raw);
    const usize = entry.declaredSize ?? raw.length;
    const type = isDir ? 0o040000 : isLink ? 0o120000 : 0o100000;
    const perm = entry.mode ?? (isDir ? 0o755 : isLink ? 0o777 : 0o644);
    const mode = perm < 0o10000 ? type | perm : perm;

    const localOffset = offset;
    push(
      Buffer.concat([
        u32(0x04034b50), u16(20), u16(0x0800), u16(method), u16(0), u16(0x21),
        u32(crc), u32(body.length), u32(usize), u16(nameBuf.length), u16(0), nameBuf, body,
      ]),
    );

    const extra = zip64
      ? Buffer.concat([u16(0x0001), u16(24), u64(usize), u64(body.length), u64(localOffset)])
      : Buffer.alloc(0);
    central.push(
      Buffer.concat([
        u32(0x02014b50), u16((3 << 8) | 20), u16(20), u16(0x0800), u16(method), u16(0), u16(0x21),
        u32(crc), u32(zip64 ? U32 : body.length), u32(zip64 ? U32 : usize),
        u16(nameBuf.length), u16(extra.length), u16(0), u16(0), u16(0),
        u32((mode << 16) >>> 0), u32(zip64 ? U32 : localOffset), nameBuf, extra,
      ]),
    );
  }

  const directory = Buffer.concat(central);
  const directoryOffset = offset;
  push(directory);
  if (zip64) {
    const eocd64Offset = offset;
    push(
      Buffer.concat([
        u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0),
        u64(entries.length), u64(entries.length), u64(directory.length), u64(directoryOffset),
      ]),
    );
    push(Buffer.concat([u32(0x07064b50), u32(0), u64(eocd64Offset), u32(1)]));
  }
  push(
    Buffer.concat([
      u32(0x06054b50), u16(0), u16(0),
      u16(zip64 ? 0xffff : entries.length), u16(zip64 ? 0xffff : entries.length),
      u32(zip64 ? U32 : directory.length), u32(zip64 ? U32 : directoryOffset), u16(0),
    ]),
  );
  return Buffer.concat(parts);
}
