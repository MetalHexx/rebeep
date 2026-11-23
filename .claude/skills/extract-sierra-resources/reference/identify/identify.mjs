// Identify a Sierra game folder: SCI0 or not, volumes, loose resources, version text, AGI markers.
// Usage: node identify.mjs <game folder>
// The folder may be the extracted zip root; the script looks one level down for RESOURCE.MAP.
import fs from 'node:fs';
import path from 'node:path';
import { readMap, findFile } from '../../lib/sci.mjs';

const folder = process.argv[2];
if (!folder) {
  console.error('usage: node identify.mjs <game folder>');
  process.exit(2);
}

function findGameRoot(dir) {
  if (findFile(dir, 'RESOURCE.MAP')) return dir;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) {
      const sub = path.join(dir, d.name);
      if (findFile(sub, 'RESOURCE.MAP')) return sub;
    }
  }
  return null;
}

const root = findGameRoot(folder);
if (!root) {
  const names = fs.readdirSync(folder).map((n) => n.toUpperCase());
  const agi = ['LOGDIR', 'PICDIR', 'SNDDIR', 'VIEWDIR', 'WORDS.TOK'].filter((n) => names.includes(n));
  console.log(`no RESOURCE.MAP under ${folder}`);
  if (agi.length) console.log(`AGI markers found (${agi.join(', ')}): AGI is not supported by this skill yet.`);
  else console.log('not an SCI0 game folder.');
  process.exit(1);
}

const files = fs.readdirSync(root);
const volumes = files.filter((f) => /^RESOURCE\.\d{3}$/i.test(f)).sort();
const looseSound = files.filter((f) => /^SOUND\.\d{3}$/i.test(f)).length;
const loosePatch = files.filter((f) => /^PATCH\.\d{3}$/i.test(f)).length;
const versionFile = findFile(root, 'VERSION');
const version = versionFile ? fs.readFileSync(versionFile, 'latin1').trim().slice(0, 80) : '(none)';

console.log(`game root: ${root}`);
const entries = readMap(root);
const volNums = new Set(volumes.map((v) => Number(v.slice(9))));
const sane = entries.length > 0 && entries.every((e) => e.type <= 20 && volNums.has(e.vol));
if (!sane) {
  console.log('engine: the map does not parse as SCI0 (6-byte entries). Probably SCI1 or later. Not supported yet.');
  process.exit(1);
}
console.log('engine: SCI0 map (6-byte entries)');
const uniq = new Map();
for (const e of entries) uniq.set(`${e.type}:${e.num}`, e.type);
const count = (t) => [...uniq.values()].filter((x) => x === t).length;
console.log(`map entries: ${entries.length} (unique resources ${uniq.size}; sound ${count(4)}, patch ${count(9)})`);
console.log(`volumes: ${volumes.join(', ') || '(none)'}`);
console.log(`loose files: SOUND.nnn ${looseSound}, PATCH.nnn ${loosePatch}`);
console.log(`VERSION: ${version}`);
// Subfolders can hold loose SOUND/PATCH files that the game never loads. Say so, so they are not mistaken for the game's own copies.
const cfgPath = findFile(root, 'RESOURCE.CFG');
const patchDirSet = cfgPath ? /patchdir/i.test(fs.readFileSync(cfgPath, 'latin1')) : false;
for (const d of fs.readdirSync(root, { withFileTypes: true }).filter((x) => x.isDirectory())) {
  const n = fs.readdirSync(path.join(root, d.name)).filter((f) => /^(SOUND|PATCH)\.\d{3}$/i.test(f)).length;
  if (n) {
    const note = patchDirSet ? 'RESOURCE.CFG sets patchDir, so check whether the game loads them' : 'RESOURCE.CFG has no patchDir, so the game does not load them';
    console.log(`subfolder ${d.name}\\: ${n} SOUND/PATCH file(s); ${note}`);
  }
}
