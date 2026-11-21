// Stand-in for 86Box in tests. Records its arguments and working folder to the JSON file named by
// FAKE86BOX_OUT. Then it sleeps until it is killed (60 seconds at most), unless
// FAKE86BOX_RESULT_FILE is set: it then plays a probe that ran, writing that file's text into
// d.img as RESULT.TXT (nothing is written when the file does not exist), and exits.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildImage, readImage } from '../lib/fat.mjs';

// mirror-freedos' D:
const D_DISK = { geometry: { cylinders: 130, heads: 16, sectorsPerTrack: 63 }, clusterSize: 2048, label: 'REBEEP' };

const out = process.env.FAKE86BOX_OUT;
if (out) {
  fs.writeFileSync(out, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), pid: process.pid }));
}

const resultFile = process.env.FAKE86BOX_RESULT_FILE;
if (resultFile) {
  if (fs.existsSync(resultFile)) writeResult(resultFile);
  process.exit(0);
}

function writeResult(resultFile) {
  const dImg = path.join(process.cwd(), 'd.img');
  const image = readImage(fs.readFileSync(dImg));
  const entries = image.list().map((e) => ({ ...e, path: e.path.replace(/^[\\/]+/, '') }));
  const files = entries.filter((e) => !e.isDir).map((e) => ({ path: e.path, bytes: image.readFile(e.path) }));
  files.push({ path: 'RESULT.TXT', bytes: fs.readFileSync(resultFile) });
  const dirs = entries.filter((e) => e.isDir).map((e) => e.path);
  fs.writeFileSync(dImg, buildImage({ ...D_DISK, files, dirs }).image);
}

// Do not keep the VM folder locked (Windows) once it has been recorded.
process.chdir(os.tmpdir());
setTimeout(() => {}, 60000);
