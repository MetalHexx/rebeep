import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../lib/cli.mjs';
import { SECTOR, buildFloppy, checkImage, readImage } from '../lib/fat.mjs';
import { formatBytes, writeAtomic } from '../lib/fsx.mjs';
import { composeRelease, readBuiltTarget, releaseNotes } from '../lib/release.mjs';
import { writeZip } from '../lib/zip.mjs';
import { readPackageVersion } from './build.mjs';

/** Every entry in the zip and on the floppy carries this stamp, so the outputs are reproducible. */
const RELEASE_DATE = new Date(1996, 0, 1, 12, 0, 0);
const FLOPPY_LABEL = 'REBEEP';
const PACKAGED_TARGETS = ['REBEEP.COM', 'RBTEST.COM'];

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** Runs the `build run` verb through the registry, as `build run --deploy` does for `disk deploy`. */
async function buildAll(ctx) {
  const { default: nouns } = await import('./index.mjs');
  const build = nouns.find((n) => n.name === 'build')?.verbs.find((v) => v.name === 'run');
  if (!build) throw new CliError('build run is not registered');
  await build.run({ ...ctx, noun: 'build', verb: 'run', args: {}, opts: {} });
}

function bootSector(repo) {
  const file = path.join(repo.build, 'FDBOOT.BIN');
  if (!fs.existsSync(file)) throw new CliError(`${file} is missing`, { hint: 'rebeep build run' });
  const bytes = fs.readFileSync(file);
  if (bytes.length !== SECTOR || bytes.readUInt16LE(SECTOR - 2) !== 0xaa55) {
    throw new CliError(`${file} must be a ${SECTOR}-byte boot sector ending in 55AA`);
  }
  return bytes;
}

/** Writes the floppy and proves it: it passes the checker and every file reads back identical. */
function makeFloppy(repo, { files, dirs }) {
  let built;
  try {
    built = buildFloppy({ files, dirs, label: FLOPPY_LABEL, date: RELEASE_DATE, bootSectorTemplate: bootSector(repo) });
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(`the package does not fit on the 1.44 MB floppy: ${err.message}`);
  }
  const check = checkImage(built.image);
  if (!check.ok) throw new CliError(`the floppy image failed its check:\n  ${check.errors.join('\n  ')}`);

  const read = readImage(built.image);
  const listed = new Map(read.list().filter((e) => !e.isDir).map((e) => [e.path, e]));
  for (const file of files) {
    const key = file.path.toUpperCase();
    if (!listed.has(key) || Buffer.compare(read.readFile(key), file.bytes) !== 0) {
      throw new CliError(`the floppy image does not hold ${file.path} as written`);
    }
  }
  if (listed.size !== files.length) throw new CliError('the floppy image holds files that are not in the package');
  return built;
}

function notesFile(md, version, outputs) {
  const { heading, body } = releaseNotes(md, { version });
  const rows = outputs.map((o) => `| ${o.file} | \`${o.sha256}\` |`);
  return [`# ${heading}`, '', body, '', '## SHA-256', '', '| File | SHA-256 |', '|---|---|', ...rows, ''].join('\n');
}

async function releaseCreate(ctx) {
  const { repo } = ctx;
  if (!ctx.opts['skip-build']) await buildAll(ctx);

  const version = readPackageVersion(repo);
  ctx.log.step(`Composing the ${version} package`);
  const composed = composeRelease(ctx, { version });
  if (composed.problems.length) {
    throw new CliError(`the package has ${composed.problems.length} problem(s):\n  ${composed.problems.join('\n  ')}`);
  }
  const { files, dirs } = composed;

  const zipName = `rebeep-${version}.zip`;
  const floppyName = `rebeep-${version}-floppy.img`;
  const zip = writeZip(files.map((f) => ({ name: f.path, bytes: f.bytes, date: RELEASE_DATE })));
  const floppy = makeFloppy(repo, { files, dirs });

  const downloads = [
    { file: zipName, bytes: zip },
    { file: floppyName, bytes: floppy.image },
  ].map((o) => ({ ...o, sha256: sha256(o.bytes) }));
  const sums = downloads.map((o) => `${o.sha256}  ${o.file}\n`).join('');

  const buildJson = JSON.parse(fs.readFileSync(path.join(repo.build, 'build.json'), 'utf8'));
  const releaseJson = `${JSON.stringify({
    version,
    targets: PACKAGED_TARGETS.map((name) => ({ name, sha256: readBuiltTarget(repo, name, buildJson).sha256 })),
  }, null, 2)}\n`;
  const notes = notesFile(fs.readFileSync(path.join(repo.root, 'CHANGELOG.md'), 'utf8'), version, downloads);

  const outDir = path.join(repo.build, 'release');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const outputs = [
    ...downloads,
    { file: 'SHA256SUMS.txt', bytes: Buffer.from(sums) },
    { file: 'release.json', bytes: Buffer.from(releaseJson) },
    { file: 'NOTES.md', bytes: Buffer.from(notes) },
  ];
  for (const o of outputs) writeAtomic(path.join(outDir, o.file), (tmp) => fs.writeFileSync(tmp, o.bytes));

  return {
    version,
    files: files.map((f) => ({ path: f.path, size: f.bytes.length })),
    outputs: outputs.map((o) => ({ file: o.file, bytes: o.bytes.length, sha256: sha256(o.bytes) })),
  };
}

export default {
  name: 'release',
  summary: 'Build the release package',
  verbs: [
    {
      name: 'create',
      summary: 'Build ReBeep and write the zip, floppy image, checksums and notes to build/release/',
      description: 'Checks every text in the package (ASCII, CRLF, 80 columns, 8.3 names) and fails listing every problem.',
      args: [],
      options: [{ name: 'skip-build', type: 'boolean', description: 'Package the current build/ without building first' }],
      destructive: false,
      examples: ['rebeep release create', 'rebeep release create --skip-build'],
      run: releaseCreate,
      render: (data, log) => {
        log.table(
          data.outputs.map((o) => ({ file: o.file, size: formatBytes(o.bytes), sha256: o.sha256 })),
          [
            { key: 'file', label: 'FILE' },
            { key: 'size', label: 'SIZE' },
            { key: 'sha256', label: 'SHA-256' },
          ],
        );
      },
    },
  ],
};
