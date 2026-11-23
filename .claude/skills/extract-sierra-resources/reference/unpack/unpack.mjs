// Decode sound (type 4) and patch (type 9) resources from an SCI0 game folder.
// Writes sound-NNN.bin and patch-NNN.bin, plus INDEX.txt, to the output folder.
// Each decoded sound is compared with the game's loose SOUND.NNN copy when one exists.
// Usage: node unpack.mjs <game folder> <out folder>
import fs from 'node:fs';
import path from 'node:path';
import { readMap, volumeReader, decodeEntry } from '../../lib/sci.mjs';

const [folder, outDir] = process.argv.slice(2);
if (!folder || !outDir) {
  console.error('usage: node unpack.mjs <game folder> <out folder>');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const entries = readMap(folder);
const vol = volumeReader(folder);
const seen = new Set();
const lines = [];
const tally = { ok: 0, fail: 0 };

for (const e of entries) {
  if (e.type !== 4 && e.type !== 9) continue;
  const key = `${e.type}:${e.num}`;
  if (seen.has(key)) continue; // the same resource is listed once per volume
  seen.add(key);

  const r = decodeEntry(vol(e.vol), e);
  const isSound = e.type === 4;
  const num = String(e.num).padStart(3, '0');
  const name = `${isSound ? 'sound' : 'patch'}-${num}`;

  let loose = 'no loose copy';
  const loosePath = path.join(folder, `${isSound ? 'SOUND' : 'PATCH'}.${num}`);
  if (r.ok && fs.existsSync(loosePath)) {
    let body = fs.readFileSync(loosePath);
    // Loose files start with a type word: 0x84 0x00 for sound, 0x89 0x00 for patch.
    if (body[1] === 0 && (body[0] & 0x80) && (body[0] & 0x7f) === e.type) body = body.subarray(2);
    let diff = 0;
    const n = Math.min(body.length, r.out.length);
    for (let i = 0; i < n; i++) if (body[i] !== r.out[i]) diff++;
    if (body.length !== r.out.length) loose = `loose size differs (${body.length} vs ${r.out.length})`;
    else loose = diff === 0 ? 'loose match' : `loose differs in ${diff} byte(s)`;
  }

  if (r.ok) fs.writeFileSync(path.join(outDir, `${name}.bin`), r.out);
  tally[r.ok ? 'ok' : 'fail']++;
  lines.push(
    `${name.padEnd(12)} method ${r.method} ${r.ok ? 'ok  ' : 'FAIL'} ${String(r.out.length).padStart(6)} bytes  ${loose}` +
    (r.ok ? '' : `  (${r.error})`)
  );
}

fs.writeFileSync(path.join(outDir, 'INDEX.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log(`\nok ${tally.ok}, failed ${tally.fail} -> ${outDir}`);
