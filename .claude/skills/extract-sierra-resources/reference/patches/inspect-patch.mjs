// Inspect a decoded patch resource (for example patch-003.bin, the AdLib bank in Space Quest III).
// The record layout is NOT confirmed. This prints the shape and per-column ranges so a human can
// test hypotheses about the fields.
// Usage: node inspect-patch.mjs <patch .bin> [record size=21] [header bytes=2]
import fs from 'node:fs';

const [file, recArg, hdrArg] = process.argv.slice(2);
if (!file) {
  console.error('usage: node inspect-patch.mjs <patch .bin> [record size=21] [header bytes=2]');
  process.exit(2);
}
const rec = Number(recArg ?? 21);
const hdr = Number(hdrArg ?? 2);
const p = fs.readFileSync(file);
const count = Math.floor((p.length - hdr) / rec);
console.log(`bytes ${p.length}; header ${hdr} bytes (${p.subarray(0, hdr).toString('hex') || 'none'})`);
console.log(`${count} records of ${rec} bytes, leftover ${(p.length - hdr) % rec}`);

const hex = (b) => b.toString('hex').match(/../g).join(' ');
for (let i = 0; i < Math.min(4, count); i++) {
  console.log(`record ${i}: ${hex(p.subarray(hdr + i * rec, hdr + (i + 1) * rec))}`);
}

const mins = Array(rec).fill(255);
const maxs = Array(rec).fill(0);
for (let i = 0; i < count; i++) {
  for (let c = 0; c < rec; c++) {
    const v = p[hdr + i * rec + c];
    if (v < mins[c]) mins[c] = v;
    if (v > maxs[c]) maxs[c] = v;
  }
}
console.log('column min-max:');
console.log(mins.map((m, c) => `${c}:${m}-${maxs[c]}`).join('  '));
