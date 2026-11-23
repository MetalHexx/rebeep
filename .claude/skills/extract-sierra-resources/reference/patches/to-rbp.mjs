// Convert an AdLib patch bank (SCI0 patch 3, decoded) to ReBeep .RBP text files, one per instrument.
// Each file is parsed back against the format rules and inverted to the SCI bytes, so the mapping is
// checked to lose nothing. That round trip does not show that the SCI fields mean what the mapping
// assumes; reference/patches/README.md lists those assumptions.
// Usage: node to-rbp.mjs <decoded patch .bin> <out folder> <name prefix, 1-4 characters>
import fs from 'node:fs';
import path from 'node:path';
import { ADLIB, readAdlibPatch } from '../../lib/sci.mjs';

const [src, outDir, prefix] = process.argv.slice(2);
if (!src || !outDir || !prefix) {
  console.error('usage: node to-rbp.mjs <decoded patch .bin> <out folder> <name prefix>');
  process.exit(2);
}
// Names are at most 8 characters, from A-Z 0-9 _ -, with at least one non-digit.
if (!/^(?=[A-Z0-9]*[A-Z])[A-Z0-9]{1,4}$/.test(prefix)) {
  console.error('name prefix: 1-4 characters, A-Z and 0-9, with at least one letter');
  process.exit(2);
}

// Register KSL bits (0-3) to the .RBP KSL index (0, 1.5, 3, 6 dB per octave). The map is its own inverse.
const KSL_FILE = [0, 2, 1, 3];
// .RBP operator line order and value ranges.
const KEYS = ['AR', 'DR', 'SL', 'RR', 'OL', 'KSL', 'MULT', 'WAVE', 'TREM', 'VIB', 'SUS', 'KSR'];
const RANGE = [15, 15, 15, 15, 63, 3, 15, 3, 1, 1, 1, 1];

function opFields(r, m) {
  return [
    r[m.ar], r[m.dr], 15 - r[m.sl], r[m.rr], 63 - r[m.amp], KSL_FILE[r[m.ksl]],
    r[m.mult], r[m.wave], r[m.am], r[m.vib], r[m.egt], r[m.ksr],
  ];
}

function convert(r) {
  if (r.every((v) => v === 0)) return { skip: 'all-zero record' };
  const alg = r[ADLIB.algorithm];
  if (alg > 1) return { skip: `algorithm byte ${alg}` };
  const fb = r[ADLIB.feedback];
  if (fb > 7) return { skip: `feedback byte 0x${fb.toString(16)} outside 0-7` };
  const op1 = opFields(r, ADLIB.op1);
  const op2 = opFields(r, ADLIB.op2);
  for (const op of [op1, op2]) {
    const bad = op.findIndex((v, i) => !(Number.isInteger(v) && v >= 0 && v <= RANGE[i]));
    if (bad >= 0) return { skip: `${KEYS[bad]} out of range (${op[bad]})` };
  }
  return { skip: null, conn: alg === 1 ? 'FM' : 'AM', fb, op1, op2 };
}

function render(c) {
  return [
    '[PATCH]', 'FORMAT=1', 'OCTAVE=4',
    '[2OP]', `CONNECTION=${c.conn}`, `FEEDBACK=${c.fb}`, `; ${KEYS.join(' ')}`,
    `OP1=${c.op1.join(' ')}`, `OP2=${c.op2.join(' ')}`,
  ].join('\r\n') + '\r\n';
}

// Read a .RBP text back and apply the format rules: CRLF, FORMAT=1, [2OP] with CONNECTION, FEEDBACK
// and two operator lines of twelve numbers each, all in range. Keys and section names are case-insensitive.
function parse(text) {
  const body = text.replace(/\r\n/g, '');
  if (/[\r\n]/.test(body)) throw new Error('bare CR or LF');
  if (/[^\x20-\x7e]/.test(body)) throw new Error('non-printable character');
  const lines = text.split('\r\n');
  if (lines.pop() !== '') throw new Error('missing final CRLF');
  const sec = {};
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith(';')) continue;
    const head = line.match(/^\[(\w+)\]$/);
    if (head) {
      cur = head[1].toUpperCase();
      if (cur in sec) throw new Error(`duplicate section ${cur}`);
      sec[cur] = {};
      continue;
    }
    const kv = line.match(/^(\w+)\s*=\s*(.*)$/);
    if (!kv || !cur) throw new Error(`bad line: ${line}`);
    const key = kv[1].toUpperCase();
    if (key in sec[cur]) throw new Error(`duplicate key ${key} in ${cur}`);
    sec[cur][key] = kv[2].trim();
  }
  if (sec.PATCH?.FORMAT !== '1') throw new Error('FORMAT must be 1');
  if (sec.PATCH.OCTAVE !== undefined && !/^[0-7]$/.test(sec.PATCH.OCTAVE)) throw new Error('OCTAVE 0-7');
  const two = sec['2OP'];
  if (!two) throw new Error('missing [2OP]');
  const conn = (two.CONNECTION ?? '').toUpperCase();
  if (conn !== 'FM' && conn !== 'AM') throw new Error('CONNECTION must be FM or AM');
  if (!/^[0-7]$/.test(two.FEEDBACK ?? '')) throw new Error('FEEDBACK 0-7');
  const opNums = (key) => {
    const parts = (two[key] ?? '').split(/\s+/);
    if (parts.length !== 12 || parts.some((p) => !/^\d+$/.test(p))) throw new Error(`${key} needs 12 numbers`);
    const nums = parts.map(Number);
    nums.forEach((v, i) => {
      if (v > RANGE[i]) throw new Error(`${key} ${KEYS[i]} ${v} out of range`);
    });
    return nums;
  };
  return { conn, fb: Number(two.FEEDBACK), op1: opNums('OP1'), op2: opNums('OP2') };
}

// Invert the parsed values back to SCI bytes and compare with the source record.
function roundTrip(r, back) {
  const bad = [];
  const check = (m, v, tag) => {
    const expect = {
      [m.ar]: v[0], [m.dr]: v[1], [m.sl]: 15 - v[2], [m.rr]: v[3],
      [m.amp]: 63 - v[4], [m.ksl]: KSL_FILE[v[5]], [m.mult]: v[6],
      [m.wave]: v[7], [m.am]: v[8], [m.vib]: v[9], [m.egt]: v[10], [m.ksr]: v[11],
    };
    for (const [off, val] of Object.entries(expect)) {
      if (r[Number(off)] !== val) bad.push(`${tag} 0x${Number(off).toString(16)}`);
    }
  };
  check(ADLIB.op1, back.op1, 'op1');
  check(ADLIB.op2, back.op2, 'op2');
  if (r[ADLIB.algorithm] !== (back.conn === 'FM' ? 1 : 0)) bad.push('algorithm');
  if (r[ADLIB.feedback] !== back.fb) bad.push('feedback');
  return bad;
}

const recs = readAdlibPatch(fs.readFileSync(src));
fs.mkdirSync(outDir, { recursive: true });
const written = [];
const skipped = [];
recs.forEach((r, slot) => {
  const name = `${prefix}-${String(slot).padStart(3, '0')}`;
  const c = convert(r);
  if (c.skip) {
    skipped.push(`slot ${slot}: ${c.skip}`);
    return;
  }
  const text = render(c);
  const bad = roundTrip(r, parse(text));
  if (bad.length) throw new Error(`${name}: round trip failed at ${bad.join(', ')}`);
  fs.writeFileSync(path.join(outDir, `${name}.RBP`), text, 'ascii');
  written.push(`${name}  slot ${slot}  ${c.conn}  FEEDBACK ${c.fb}`);
});
fs.writeFileSync(path.join(outDir, 'INDEX.txt'), [...written, '', 'skipped:', ...skipped].join('\n') + '\n');
console.log(`${prefix}: ${recs.length} instruments, ${written.length} written, ${skipped.length} skipped`);
for (const s of skipped) console.log(`  skip ${s}`);
