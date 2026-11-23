// Shared SCI0 code: resource map, volume headers, the three decoders, and the sound parser.
// Checked against Space Quest III (SCI0): LZW output matches the game's loose SOUND.NNN copies
// apart from one header byte per file. Raw (method 0) and Huffman (method 2) are not verified.
import fs from 'node:fs';
import path from 'node:path';

// RESOURCE.MAP: 6-byte entries. Word = type << 11 | number. Dword = volume << 26 | offset.
// The list ends at a word of 0xffff. The dword after it varies by game
// (Space Quest III: ffff ffff; King's Quest IV: 0000 0000).
export function readMap(folder) {
  const map = fs.readFileSync(path.join(folder, 'RESOURCE.MAP'));
  const entries = [];
  for (let p = 0; p + 6 <= map.length; p += 6) {
    const w = map.readUInt16LE(p);
    const v = map.readUInt32LE(p + 2);
    if (w === 0xffff) break;
    entries.push({ type: w >> 11, num: w & 0x7ff, vol: v >>> 26, off: v & 0x3ffffff });
  }
  return entries;
}

// Returns a cached reader for RESOURCE.00n volume files.
export function volumeReader(folder) {
  const cache = new Map();
  return (vol) => {
    if (!cache.has(vol)) {
      cache.set(vol, fs.readFileSync(path.join(folder, `RESOURCE.${String(vol).padStart(3, '0')}`)));
    }
    return cache.get(vol);
  };
}

// Resource header at a volume offset: id, comp (counts decomp and method words too), decomp, method.
// Payload = comp - 4 bytes starting 8 bytes in. The next resource starts at off + 4 + comp.
export function readHeader(vol, off) {
  const comp = vol.readUInt16LE(off + 2);
  return {
    id: vol.readUInt16LE(off),
    comp,
    decomp: vol.readUInt16LE(off + 4),
    method: vol.readUInt16LE(off + 6),
    payload: vol.subarray(off + 8, off + 4 + comp),
  };
}

// LZW (method 1). LSB-first codes, width 9 to 12, reset 0x100, end 0x101, first slot 0x102.
// The table stores where each string sits in the output. An entry is read back as its
// stored length plus one byte. Width grows at the start of a code once the next free slot
// passes 511, 1023 or 2047.
export function lzwSci(buf, size) {
  const out = Buffer.alloc(size);
  let written = 0;
  const tPos = new Uint32Array(4096);
  const tLen = new Uint16Array(4096);
  let width = 9;
  let endtoken = 0x1ff;
  let cur = 0x102;
  let bitPos = 0;
  const totalBits = buf.length * 8;
  const readCode = (n) => {
    if (bitPos + n > totalBits) return -1;
    let v = 0;
    for (let i = 0; i < n; i++, bitPos++) v |= ((buf[bitPos >> 3] >> (bitPos & 7)) & 1) << i;
    return v;
  };
  let error = null;
  while (written < size) {
    const tok = readCode(width);
    if (tok < 0) break;
    if (tok === 0x101) break;
    if (tok === 0x100) { width = 9; endtoken = 0x1ff; cur = 0x102; continue; }
    let L;
    if (tok > 0xff) {
      if (tok >= cur) { error = `bad token ${tok} at ${cur}`; break; }
      L = tLen[tok] + 1;
      const src = tPos[tok];
      // Byte by byte, so a string that refers to the entry being built reads back what was just written.
      for (let k = 0; k < L && written < size; k++) out[written++] = out[src + k];
    } else {
      L = 1;
      out[written++] = tok;
    }
    if (cur > endtoken && width < 12) { width++; endtoken = 2 * endtoken + 1; }
    if (cur <= endtoken) { tPos[cur] = written - L; tLen[cur] = L; cur++; }
  }
  const done = written === size && !error;
  return { ok: done, out, error: done ? null : error || `wrote ${written} of ${size}` };
}

// Huffman (method 2). Byte 0 = node count N, byte 1 = terminator (bit 8 set as a sentinel).
// Node n = two bytes at 2 + 2n: (value, siblings). Siblings low nibble = right step, high nibble
// = left step, both relative to the current node. Bits are MSB first. A right step of 0 is an
// escape: the next 8 raw bits form a literal byte.
export function huffSci(buf, size) {
  const numnodes = buf[0];
  const terminator = buf[1] | 0x100;
  const nodeB0 = (n) => buf[2 + 2 * n];
  const nodeB1 = (n) => buf[2 + 2 * n + 1];
  let bitPos = (2 + 2 * numnodes) * 8;
  const totalBits = buf.length * 8;
  const readBit = () => {
    if (bitPos >= totalBits) throw new Error('bitstream ended');
    const b = (buf[bitPos >> 3] >> (7 - (bitPos & 7))) & 1;
    bitPos++;
    return b;
  };
  const readRaw8 = () => {
    let v = 0;
    for (let i = 0; i < 8; i++) v = (v << 1) | readBit();
    return v;
  };
  const getc2 = () => {
    let n = 0;
    let guard = 0;
    while (nodeB1(n) !== 0) {
      if (++guard > 1e6) throw new Error('tree walk did not end');
      let step;
      if (readBit()) {
        step = nodeB1(n) & 0x0f;
        if (step === 0) return readRaw8() | 0x100;
      } else {
        step = nodeB1(n) >> 4;
      }
      n += step;
    }
    return nodeB0(n);
  };
  const out = Buffer.alloc(size);
  let written = 0;
  let error = null;
  try {
    while (written < size) {
      const c = getc2();
      if (c === terminator) break;
      out[written++] = c & 0xff;
    }
  } catch (e) {
    error = e.message;
  }
  const done = written === size && !error;
  return { ok: done, out, error: done ? null : error || `wrote ${written} of ${size}` };
}

// Decode one map entry. Methods: 0 raw, 1 LZW, 2 Huffman.
export function decodeEntry(vol, e) {
  const h = readHeader(vol, e.off);
  if (h.id !== ((e.type << 11) | e.num)) {
    return { ok: false, method: h.method, error: 'id mismatch', out: Buffer.alloc(0) };
  }
  let r;
  if (h.method === 0) {
    r = { ok: h.payload.length === h.decomp, out: Buffer.from(h.payload.subarray(0, h.decomp)), error: null };
  } else if (h.method === 1) {
    r = lzwSci(h.payload, h.decomp);
  } else if (h.method === 2) {
    r = huffSci(h.payload, h.decomp);
  } else {
    r = { ok: false, out: Buffer.alloc(0), error: `method ${h.method} not supported` };
  }
  return { ...r, method: h.method };
}

// Sound resource: optional 0x84 0x00 type word, then a flag byte and 16 channel pairs
// (voices, play flags), 33 bytes in all. Events follow as delta, then status, then parameters.
// Each F8 adds 240 ticks. FC stops the sequence. SCI ticks are 60 Hz.
export function parseSound(d) {
  const base = d[0] === 0x84 ? 2 : 0;
  const flag = d[base];
  const channels = [];
  for (let n = 0; n < 16; n++) {
    channels.push({ voices: d[base + 1 + 2 * n], flags: d[base + 2 + 2 * n] });
  }
  const events = [];
  const problems = [];
  let p = base + 33;
  let tick = 0;
  let status = 0;
  let endedBy = 'end of data';
  const byteAt = (i) => {
    if (i >= d.length) throw new Error('read past end');
    return d[i];
  };
  try {
    while (p < d.length) {
      let delta = 0;
      let b = byteAt(p++);
      while (b === 0xf8) { delta += 240; b = byteAt(p++); }
      if (b === 0xfc) { endedBy = 'FC stop'; break; }
      delta += b;
      tick += delta;
      const c = byteAt(p);
      if (c === 0xfc) { endedBy = 'FC stop'; break; }
      if (c & 0x80) { status = c; p++; }
      if (status === 0) { problems.push(`no status at ${p}`); break; }
      const hi = status & 0xf0;
      const ch = status & 0x0f;
      if (status === 0xf0) {
        const start = p;
        while (byteAt(p) !== 0xf7) p++;
        p++;
        events.push({ tick, sysex: true, len: p - start });
        continue;
      }
      if (hi === 0x80 || hi === 0x90 || hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
        const d1 = byteAt(p++);
        const d2 = byteAt(p++);
        events.push({ tick, status, ch, d1, d2 });
      } else if (hi === 0xc0 || hi === 0xd0) {
        const d1 = byteAt(p++);
        events.push({ tick, status, ch, d1 });
      } else {
        problems.push(`unknown status 0x${status.toString(16)} at ${p}`);
        break;
      }
    }
  } catch (err) {
    problems.push(err.message);
  }
  return { base, flag, channels, events, problems, endedBy, lastTick: tick };
}

// Controllers that only mean something to SCI drivers. They are dropped from the MIDI output.
const SCI_ONLY_CONTROLS = new Set([0x4b, 0x4c, 0x4e, 0x60]);

function vlq(n) {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return bytes;
}

// Standard MIDI File, format 0. 60 ticks per quarter note and a tempo of 1,000,000 us,
// so one MIDI tick equals one SCI tick (1/60 s). Channel 15 (SCI control) and SysEx are dropped.
export function toMidi(sound) {
  const track = [];
  const push = (...bs) => track.push(...bs);
  push(...vlq(0), 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40);
  let last = 0;
  for (const ev of sound.events) {
    if (ev.sysex || ev.ch === 15) continue;
    if ((ev.status & 0xf0) === 0xb0 && SCI_ONLY_CONTROLS.has(ev.d1)) continue;
    const delta = ev.tick - last;
    last = ev.tick;
    push(...vlq(delta));
    if (ev.d2 === undefined) push(ev.status, ev.d1);
    else push(ev.status, ev.d1, ev.d2);
  }
  push(...vlq(0), 0xff, 0x2f, 0x00);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 60];
  const n = track.length;
  const trk = [0x4d, 0x54, 0x72, 0x6b, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  return Buffer.from([...header, ...trk, ...track]);
}

// Find a file in a folder by name, ignoring case. Returns the full path or null.
export function findFile(folder, name) {
  const hit = fs.readdirSync(folder).find((f) => f.toUpperCase() === name.toUpperCase());
  return hit ? path.join(folder, hit) : null;
}
