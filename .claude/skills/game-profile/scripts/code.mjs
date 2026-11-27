#!/usr/bin/env node
// Reads a game's files as data, for the game-profile skill: never runs them, never extracts them.
// The file is read in memory from the game's zip in the lab (`rebeep media add game`), and an
// EXEPACK executable is unpacked in memory. Node built-ins and the repo's own zip reader only.
//
//   node code.mjs --game <NAME> --list
//       The files in the game's zip.
//   node code.mjs --game <NAME> --file <FILE>
//       What the file is (MZ or COM, packed or not), then every place its code touches the
//       speaker's ports (42h, 43h, 61h) and the timer's (40h), with the control word written to
//       43h when a MOV AL comes just before.
//   node code.mjs --game <NAME> --file <FILE> --find "B0 B6 E6 43" [--find ...]
//       Offsets of a byte pattern; ?? matches any byte. A count 0952h is the bytes 52 09.
//   node code.mjs --game <NAME> --file <FILE> --dis <offset> [--lines 40]
//       Disassembles from a hex offset with the lab's ndisasm. The image goes to a temporary
//       folder for ndisasm to read, and is deleted straight after.
//
// Offsets are into the load image: past the MZ header, after unpacking. They are hex.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readZipFile, stripCommonRoot } from '../../../../tools/lib/zip.mjs';

function fail(message) {
  console.error(`code.mjs: ${message}`);
  process.exit(2);
}

const hex = (n, width = 4) => n.toString(16).toUpperCase().padStart(width, '0');

function rebeepHome() {
  return process.env.REBEEP_HOME ? path.resolve(process.env.REBEEP_HOME) : path.join(os.homedir(), '.rebeep');
}

function openGame(name) {
  const zip = path.join(rebeepHome(), 'media', 'games', `${name.toUpperCase()}.zip`);
  if (!fs.existsSync(zip)) fail(`no game ${name} in the lab (${zip}): add it with rebeep media add game`);
  return stripCommonRoot(readZipFile(zip).entries).filter((e) => !e.isDir && !e.isSymlink);
}

function findEntry(entries, file) {
  const want = file.replace(/\\/g, '/').toUpperCase();
  const exact = entries.filter((e) => e.name.toUpperCase() === want);
  if (exact.length) return exact[0];
  const base = entries.filter((e) => path.posix.basename(e.name).toUpperCase() === want);
  if (base.length === 1) return base[0];
  if (base.length > 1) fail(`${file} is in several folders: ${base.map((e) => e.name).join(', ')}. Give its path`);
  return fail(`no ${file} in the game's zip: --list shows its files`);
}

/** Unpacks an EXEPACK image in memory, or returns null when it isn't one. */
function unexepack(image, cs) {
  const at = cs * 16;
  let sigAt = -1;
  if (image.toString('latin1', at + 16, at + 18) === 'RB') sigAt = 16;
  else if (image.toString('latin1', at + 14, at + 16) === 'RB') sigAt = 14;
  if (sigAt < 0) return null;
  const destLen = image.readUInt16LE(at + 12) * 16;
  const skipLen = sigAt === 16 ? image.readUInt16LE(at + 14) : 1;
  const packedLen = at - (skipLen - 1) * 16;
  const src = image.subarray(0, packedLen);
  const dest = Buffer.alloc(Math.max(destLen, packedLen));
  src.copy(dest);
  let s = packedLen - 1;
  for (let pad = 0; pad < 16 && src[s] === 0xff; pad++) s--;
  let d = destLen - 1;
  for (;;) {
    if (s < 2) throw new Error('EXEPACK data ends early');
    const op = src[s--];
    const count = (src[s] << 8) | src[s - 1];
    s -= 2;
    if ((op & 0xfe) === 0xb0) {
      const fill = src[s--];
      for (let k = 0; k < count; k++) dest[d--] = fill;
    } else if ((op & 0xfe) === 0xb2) {
      for (let k = 0; k < count; k++) dest[d--] = src[s--];
    } else {
      throw new Error(`EXEPACK: unknown command ${hex(op, 2)}h`);
    }
    if (op & 1) break;
  }
  return dest.subarray(0, destLen);
}

/** The load image of a file and a line saying what it is. */
function loadImage(name, bytes) {
  if (bytes.length >= 28 && (bytes.toString('latin1', 0, 2) === 'MZ' || bytes.toString('latin1', 0, 2) === 'ZM')) {
    const lastPage = bytes.readUInt16LE(2);
    const pages = bytes.readUInt16LE(4);
    const header = bytes.readUInt16LE(8) * 16;
    const end = Math.min(bytes.length, pages * 512 - (lastPage ? 512 - lastPage : 0));
    const image = bytes.subarray(header, end);
    const head = bytes.toString('latin1', 0, Math.min(bytes.length, 512));
    if (/LZ09|LZ91/.test(bytes.toString('latin1', 0x1c, 0x20))) {
      return { image, code: true, what: 'an MZ executable packed with LZEXE: not unpacked, so the scan sees packed bytes' };
    }
    if (/PKLITE/i.test(head)) {
      return { image, code: true, what: 'an MZ executable packed with PKLITE: not unpacked, so the scan sees packed bytes' };
    }
    try {
      const unpacked = unexepack(image, bytes.readUInt16LE(0x16));
      if (unpacked) return { image: unpacked, code: true, what: `an MZ executable packed with EXEPACK, unpacked in memory to ${unpacked.length} bytes` };
    } catch (err) {
      return { image, code: true, what: `an MZ executable that looks packed with EXEPACK, but did not unpack (${err.message})` };
    }
    return { image, code: true, what: `an MZ executable, ${image.length} bytes of image` };
  }
  if (/\.COM$/i.test(name)) return { image: bytes, code: true, what: 'a .COM program: it loads at 100h, so add 100h to an offset for its address' };
  return { image: bytes, code: false, what: 'not a program: data, so no port scan (--find and --dis still work)' };
}

const PORT_OPS = [
  { bytes: [0xe6, 0x42], says: 'OUT 42h,AL: a count byte to channel 2, the speaker\'s pitch' },
  { bytes: [0xe6, 0x43], says: 'OUT 43h,AL: a control word', control: true },
  { bytes: [0xe6, 0x61], says: 'OUT 61h,AL: the speaker\'s gate and bit' },
  { bytes: [0xe4, 0x61], says: 'IN AL,61h: reads the speaker bits' },
  { bytes: [0xe4, 0x42], says: 'IN AL,42h: reads channel 2\'s count back' },
  { bytes: [0xe6, 0x40], says: 'OUT 40h,AL: channel 0, the timer\'s tick rate' },
  { bytes: [0xba, 0x42, 0x00], says: 'MOV DX,42h: port 42h through DX' },
  { bytes: [0xba, 0x43, 0x00], says: 'MOV DX,43h: port 43h through DX' },
  { bytes: [0xba, 0x61, 0x00], says: 'MOV DX,61h: port 61h through DX' },
];

function matchAt(image, at, pattern) {
  for (let k = 0; k < pattern.length; k++) {
    if (pattern[k] >= 0 && image[at + k] !== pattern[k]) return false;
  }
  return true;
}

function offsetsOf(image, pattern) {
  const out = [];
  for (let at = 0; at + pattern.length <= image.length; at++) if (matchAt(image, at, pattern)) out.push(at);
  return out;
}

function controlWord(value) {
  const channel = value >> 6;
  if (channel === 3) return 'read-back';
  return `channel ${channel}, mode ${(value >> 1) & 7}`;
}

function scan(image) {
  console.log('Candidates: the same bytes can sit inside data or another instruction. Check each with --dis.');
  for (const op of PORT_OPS) {
    const at = offsetsOf(image, op.bytes);
    if (!at.length) continue;
    console.log(`\n${op.says}: ${at.length}`);
    for (const a of at.slice(0, 24)) {
      let note = '';
      if (op.control) {
        for (let back = 2; back <= 8 && a - back >= 0; back++) {
          if (image[a - back] === 0xb0) {
            const v = image[a - back + 1];
            note = `  MOV AL,${hex(v, 2)}h: 43h=${hex(v, 2)}h (${controlWord(v)})`;
            break;
          }
        }
      }
      console.log(`  ${hex(a, 5)}${note}`);
    }
    if (at.length > 24) console.log(`  ... and ${at.length - 24} more`);
  }
}

function parsePattern(text) {
  const parts = text.trim().split(/\s+/);
  return parts.map((p) => {
    if (p === '??') return -1;
    if (!/^[0-9a-f]{2}$/i.test(p)) fail(`'${p}' in "${text}" is not a byte: write two hex digits, or ??`);
    return parseInt(p, 16);
  });
}

function findNdisasm() {
  if (process.env.REBEEP_NDISASM) return process.env.REBEEP_NDISASM;
  const exe = process.platform === 'win32' ? 'ndisasm.exe' : 'ndisasm';
  const root = path.join(rebeepHome(), 'tools', 'nasm');
  const versions = fs.existsSync(root) ? fs.readdirSync(root).sort().reverse() : [];
  for (const v of versions) {
    const bin = path.join(root, v, exe);
    if (fs.existsSync(bin)) return bin;
  }
  return 'ndisasm'; // a system NASM on Linux and macOS brings it
}

function disassemble(image, offset, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebeep-code-'));
  try {
    const file = path.join(dir, 'IMAGE.BIN');
    fs.writeFileSync(file, image);
    const bin = findNdisasm();
    const run = spawnSync(bin, ['-b', '16', '-e', String(offset), '-o', String(offset), file],
      { encoding: 'latin1', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) fail(`could not run ndisasm (${bin}): ${run.error.message}. Set REBEEP_NDISASM`);
    console.log(run.stdout.split(/\r?\n/).slice(0, lines).join('\n'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv) {
  const opts = { find: [] };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    const next = () => argv[++k] ?? fail(`${a} needs a value`);
    if (a === '--game') opts.game = next();
    else if (a === '--file') opts.file = next();
    else if (a === '--find') opts.find.push(next());
    else if (a === '--dis') opts.dis = next();
    else if (a === '--lines') opts.lines = next();
    else if (a === '--list') opts.list = true;
    else fail(`unknown option ${a}`);
  }
  if (!opts.game) fail('usage: code.mjs --game <NAME> (--list | --file <FILE> [--find "<bytes>"] [--dis <offset>])');
  const entries = openGame(opts.game);
  if (opts.list) {
    for (const e of entries) console.log(`${String(e.size).padStart(8)}  ${e.name}`);
    return;
  }
  if (!opts.file) fail('give --list, or --file <FILE>');
  const entry = findEntry(entries, opts.file);
  const { image, code, what } = loadImage(entry.name, entry.read());
  console.log(`${entry.name}: ${what}.`);
  if (opts.dis !== undefined) {
    if (!/^[0-9a-f]+h?$/i.test(opts.dis)) fail('--dis takes a hex offset, such as 1A2B');
    const lines = opts.lines ? parseInt(opts.lines, 10) : 40;
    disassemble(image, parseInt(opts.dis.replace(/h$/i, ''), 16), lines);
    return;
  }
  if (opts.find.length) {
    for (const f of opts.find) {
      const at = offsetsOf(image, parsePattern(f));
      console.log(`"${f}": ${at.length ? at.slice(0, 40).map((a) => hex(a, 5)).join(' ') : 'not found'}` +
        `${at.length > 40 ? ` ... and ${at.length - 40} more` : ''}`);
    }
    return;
  }
  if (code) scan(image);
}

main(process.argv.slice(2));
