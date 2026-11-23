// Check decoded sounds against the game's loose SOUND.NNN copies, and check MIDI files for SMF structure.
// Usage: node verify.mjs <game folder> <decoded folder> [midi folder]
import fs from 'node:fs';
import path from 'node:path';

const [gameDir, decodedDir, midiDir] = process.argv.slice(2);
if (!gameDir || !decodedDir) {
  console.error('usage: node verify.mjs <game folder> <decoded folder> [midi folder]');
  process.exit(2);
}

// Loose copies sit in the game root (the folder identify reports), not in subfolders.
const looseDir = gameDir;
const same = [];
const differ = [];
const missing = [];
for (const f of fs.readdirSync(looseDir).filter((x) => /^SOUND\.\d{3}$/i.test(x)).sort()) {
  let loose = fs.readFileSync(path.join(looseDir, f));
  if (loose[0] === 0x84 && loose[1] === 0) loose = loose.subarray(2);
  const num = f.slice(6);
  const decPath = path.join(decodedDir, `sound-${num}.bin`);
  if (!fs.existsSync(decPath)) { missing.push(f); continue; }
  const dec = fs.readFileSync(decPath);
  if (dec.length === loose.length && Buffer.compare(dec, loose) === 0) { same.push(f); continue; }
  let diff = 0;
  for (let i = 0; i < Math.min(dec.length, loose.length); i++) if (dec[i] !== loose[i]) diff++;
  differ.push(`${f} (${diff} byte(s) differ, sizes ${dec.length}/${loose.length})`);
}

if (same.length + differ.length + missing.length === 0) console.log('no loose SOUND copies in the game root, so there is nothing to compare.');
console.log(`identical to loose copy: ${same.length} (${same.join(', ') || 'none'})`);
console.log(`differ from loose copy: ${differ.length}`);
for (const line of differ) console.log(`  ${line}`);
if (missing.length) console.log(`no decoded copy for: ${missing.join(', ')}`);

if (midiDir && fs.existsSync(midiDir)) {
  let good = 0;
  const bad = [];
  for (const f of fs.readdirSync(midiDir).filter((x) => x.endsWith('.mid'))) {
    const b = fs.readFileSync(path.join(midiDir, f));
    const hdr = b.toString('latin1', 0, 4) === 'MThd' && b.readUInt16BE(8) === 0 && b.readUInt16BE(12) === 60;
    const trk = b.toString('latin1', 14, 18) === 'MTrk' && b.readUInt32BE(18) === b.length - 22;
    const end = b.subarray(b.length - 3).toString('hex') === 'ff2f00';
    if (hdr && trk && end) good++; else bad.push(f);
  }
  console.log(`MIDI files valid: ${good}, invalid: ${bad.length}${bad.length ? ' (' + bad.join(', ') + ')' : ''}`);
}
