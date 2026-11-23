// Convert decoded sound resources to Standard MIDI Files (format 0).
// Usage: node to-midi.mjs <sound file> <out.mid>
//        node to-midi.mjs --dir <decoded folder> <out folder>   (converts every sound-NNN.bin)
// A loose SOUND.NNN file from the game folder works as the input for the single-file form.
import fs from 'node:fs';
import path from 'node:path';
import { parseSound, toMidi } from '../../lib/sci.mjs';

function convert(inFile, outFile) {
  const s = parseSound(fs.readFileSync(inFile));
  fs.writeFileSync(outFile, toMidi(s));
  const noteChannels = [...new Set(s.events.filter((e) => e.ch !== undefined && e.ch !== 15 && (e.status >> 4) === 9).map((e) => e.ch))].sort((a, b) => a - b);
  const programs = [...new Set(s.events.filter((e) => (e.status >> 4) === 0xc && e.ch !== 15).map((e) => `${e.ch}:${e.d1}`))];
  const problems = s.problems.length ? `  PROBLEMS: ${s.problems.join('; ')}` : '';
  console.log(
    `${path.basename(inFile)}: flag ${s.flag}, ${s.events.length} events, ${(s.lastTick / 60).toFixed(1)} s, ` +
    `ended by ${s.endedBy}, note channels [${noteChannels.join(',')}], programs [${programs.join(' ')}]${problems}`
  );
}

const args = process.argv.slice(2);
if (args[0] === '--dir' && args.length === 3) {
  const [, dir, outDir] = args;
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(dir).filter((x) => /^sound-\d+\.bin$/.test(x))) {
    convert(path.join(dir, f), path.join(outDir, f.replace(/\.bin$/, '.mid')));
  }
} else if (args.length === 2) {
  convert(args[0], args[1]);
} else {
  console.error('usage: node to-midi.mjs <sound file> <out.mid>\n       node to-midi.mjs --dir <decoded folder> <out folder>');
  process.exit(2);
}
