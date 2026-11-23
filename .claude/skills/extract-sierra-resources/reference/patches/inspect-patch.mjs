// Inspect an AdLib patch bank (SCI0 patch 3, decoded). Prints the instrument count, whether the AB CD
// separator is present, the first three instruments as hex, and each field's value range across the bank.
// Usage: node inspect-patch.mjs <decoded patch .bin>
import fs from 'node:fs';
import { ADLIB, readAdlibPatch } from '../../lib/sci.mjs';

const [file] = process.argv.slice(2);
if (!file) {
  console.error('usage: node inspect-patch.mjs <decoded patch .bin>');
  process.exit(2);
}
const buf = fs.readFileSync(file);
const recs = readAdlibPatch(buf);
const separator = buf.length - recs.length * ADLIB.record === 2;
console.log(`${buf.length} bytes: ${recs.length} instruments of ${ADLIB.record} bytes; AB CD separator ${separator ? 'present' : 'absent'}`);
for (let i = 0; i < Math.min(3, recs.length); i++) {
  console.log(`instrument ${i}: ${[...recs[i]].map((v) => v.toString(16).padStart(2, '0')).join(' ')}`);
}

const fields = [
  ...Object.entries(ADLIB.op1).map(([name, off]) => [off, `op1 ${name}`]),
  ...Object.entries(ADLIB.op2).map(([name, off]) => [off, `op2 ${name}`]),
  [ADLIB.feedback, 'feedback'],
  [ADLIB.algorithm, 'algorithm'],
].sort((a, b) => a[0] - b[0]);
console.log('offset  field        min-max');
for (const [off, name] of fields) {
  let lo = 255;
  let hi = 0;
  for (const r of recs) {
    lo = Math.min(lo, r[off]);
    hi = Math.max(hi, r[off]);
  }
  console.log(`0x${off.toString(16).padStart(2, '0')}    ${name.padEnd(12)} ${lo}-${hi}`);
}
