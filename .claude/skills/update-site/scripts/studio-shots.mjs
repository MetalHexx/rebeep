// Turns raw 720x400 studio screenshots (86Box's Tools > Take raw screenshot) into the published pictures: 4:3 PNGs and
// an animated GIF for the docs, and lossless WebPs for the site. Needs ffmpeg with libwebp on PATH.
//
//   node studio-shots.mjs --map <shots.json> [--repo <repo root>]
//
// shots.json (paths relative to it):
//   { "stills": { "splash": "raw/splash.png", "menu": "raw/menu.png", ... },
//     "synth":  ["raw/roll-18.png", "raw/roll-26.png", ...],
//     "site":   ["splash"] }
// Writes docs/images/studio/<still>.png and synth.gif, and site/img/studio/<site still>.webp and synth.webp (the synth
// frames stacked top to bottom in one picture, which the page steps through).
//
// A VGA text screen is 720x400, shown on a 4:3 monitor, so its pixels are taller than wide. Every output is 960x720:
// each pixel is enlarged 4x by nearest neighbour, then box-filtered down, so the text stays sharp and only edges blend.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const W = 960;
const H = 720;
const FRAME_SECONDS = 1.3;
const SCALE = `scale=2880:2160:flags=neighbor,scale=${W}:${H}:flags=area`;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function ffmpeg(args) {
  const run = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (run.error) throw new Error(`ffmpeg not found: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr.trim()}`);
}

/** A raw shot must be the card's text output pixel for pixel: a 720x400 PNG. */
function checkRaw(file) {
  const head = readFileSync(file).subarray(0, 24);
  if (head.toString('latin1', 1, 4) !== 'PNG') throw new Error(`${file} is not a PNG`);
  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);
  if (width !== 720 || height !== 400) {
    throw new Error(`${file} is ${width}x${height}, not 720x400: take it with 86Box's "Take raw screenshot"`);
  }
}

const mapFile = path.resolve(arg('--map', ''));
const repo = path.resolve(arg('--repo', process.cwd()));
const map = JSON.parse(readFileSync(mapFile, 'utf8'));
const from = (p) => path.resolve(path.dirname(mapFile), p);
const docs = path.join(repo, 'docs', 'images', 'studio');
const site = path.join(repo, 'site', 'img', 'studio');
mkdirSync(docs, { recursive: true });
mkdirSync(site, { recursive: true });

const written = [];
for (const [name, raw] of Object.entries(map.stills ?? {})) {
  checkRaw(from(raw));
  const out = path.join(docs, `${name}.png`);
  ffmpeg(['-i', from(raw), '-vf', SCALE, '-compression_level', '9', '-pred', 'mixed', out]);
  written.push(out);
  if ((map.site ?? []).includes(name)) {
    const webp = path.join(site, `${name}.webp`);
    ffmpeg(['-i', from(raw), '-vf', SCALE, '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', webp]);
    written.push(webp);
  }
}

const frames = (map.synth ?? []).map(from);
if (frames.length > 0) {
  frames.forEach(checkRaw);
  const inputs = frames.flatMap((f) => ['-i', f]);
  const scaled = frames.map((_, i) => `[${i}:v]${SCALE}[f${i}]`).join(';');
  const labels = frames.map((_, i) => `[f${i}]`).join('');

  // The GIF: one palette for all frames, no dithering, each frame held FRAME_SECONDS, looping.
  const gif = path.join(docs, 'synth.gif');
  ffmpeg([...inputs, '-filter_complex',
    `${scaled};${labels}concat=n=${frames.length}:v=1:a=0,settb=1/1000,setpts=N*${FRAME_SECONDS * 1000},split[a][b];` +
      '[a]palettegen=stats_mode=full:reserve_transparent=0[p];[b][p]paletteuse=dither=none',
    '-loop', '0', '-fps_mode', 'passthrough', gif]);
  written.push(gif);

  // The site's sprite: the frames stacked, lossless, each followed by 8 black rows so the page's rounding at a
  // frame's edge shows black rather than the next frame (site.css knows the 728-row pitch).
  const sprite = path.join(site, 'synth.webp');
  const padded = frames.map((_, i) => `[${i}:v]${SCALE},pad=${W}:${H + 8}:0:0:black[f${i}]`).join(';');
  ffmpeg([...inputs, '-filter_complex', `${padded};${labels}vstack=inputs=${frames.length}`,
    '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', sprite]);
  written.push(sprite);
}

for (const file of written) {
  console.log(`${path.relative(repo, file).replaceAll('\\', '/')}  ${(statSync(file).size / 1024).toFixed(1)} KB`);
}
