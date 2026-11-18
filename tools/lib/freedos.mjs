/**
 * The scripted FreeDOS C: for `mirror-freedos`: a bootable FreeDOS 1.4 hard-disk image built in
 * memory from the pinned FreeDOS 1.4 LiteUSB image (`FD14LITE.img`), the pinned Jemm and the
 * repo's boot files. No installer, no clicks.
 *
 * What goes where:
 * - The MBR boot code and the partition boot sector are taken from the live image. `buildImage`
 *   replaces only the BPB area (0x0B-0x3D) of the boot sector, so FreeDOS's boot code is kept.
 * - Every `PACKAGES/BASE/*.ZIP` is installed under `FREEDOS/`: `<folder>/<rest>` becomes
 *   `FREEDOS/<FOLDER>/<REST>`. The live `FREEDOS/` folder is the installer's live environment and
 *   is not copied. `SOURCE/` is dropped. `CPI/` (the CPIDOS code page files) is kept: it is binary
 *   data that FreeDOS expects under `%DOSDIR%\CPI`, not source code. Any other top-level folder is
 *   skipped with a warning (the real BASE set has only APPINFO, BIN, CPI, DOC, HELP, NLS, SOURCE).
 * - `KERNEL.SYS` is the 386 kernel and `COMMAND.COM` is FreeCOM, both from the packages.
 * - Jemm lives in `JEMM/`, from the pinned Jemm. FreeDOS's own Jemm package (5.85) is also
 *   installed under `FREEDOS/BIN`, so a bare `JEMMEX` on the PATH would find the older copy; the
 *   boot files always use the full `C:\JEMM\` path.
 *
 * Boot-path conclusions (from disassembling the FD14LITE.img partition boot sector):
 * - It copies itself to 1FE0:7C00, stores the BIOS drive number (DL) into BPB offset 0x24 of that
 *   copy and later passes it to the kernel in BL. The 0x80 that `buildImage` writes there is
 *   therefore never used; either value is fine for a first hard disk.
 * - It computes the FAT, root and data start from the BPB: hidden sectors (32-bit), reserved
 *   sectors, FAT count times sectors per FAT, and root entries over bytes per sector / 32. Nothing
 *   about 2 KiB clusters or a 64-sector FAT is hard-coded. Sectors per cluster is read from the BPB
 *   for every cluster it loads.
 * - It reads the whole root directory (32 sectors) and the whole first FAT into 0060:0000, then
 *   builds the kernel's cluster chain at 1FE0:2000 and loads the clusters in chain order to
 *   0060:0000. So the kernel need not be contiguous or at cluster 2, and any cluster size works.
 * - Limits: the FAT is held in memory, so it must stay under 256 sectors (128 KiB; the chain list
 *   sits above it); `buildImage` already enforces that cap. The kernel must be under about 137 KB
 *   (46 KB now). In CHS mode the geometry comes from the BPB (heads 16, 63 sectors per track), and
 *   a CHS read can address 1023 cylinders at most; C: has 260.
 * - It uses INT 13h extensions when the BIOS offers them and CHS otherwise, both from BPB fields.
 * - It finds `KERNEL  SYS` by name in the root, skipping the volume label entry. `bootFiles` puts
 *   `KERNEL.SYS` first in the root at cluster 2; that is not required but it is cheap.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './cli.mjs';
import { buildImage, checkImage, readImage, to83, toCrlf } from './fat.mjs';
import { resolveTool } from './manifest.mjs';
import { listFiles, readZip } from './zip.mjs';

const LIVE_IMAGE = 'FD14LITE.IMG';
const BASE_PACKAGE = /^PACKAGES\/BASE\/[^/]+\.ZIP$/i;
const INSTALLED_FOLDERS = new Set(['APPINFO', 'BIN', 'CPI', 'DOC', 'HELP', 'NLS']);
const JEMM_FILES = ['JEMMEX.EXE', 'JEMM386.EXE', 'JLOAD.EXE', 'QPIEMU.DLL'];
const MAX_EXAMPLES = 10;

/** Uppercases ASCII letters only, like `fat.mjs`, so no Unicode case mapping can make a name valid. */
const upper = (text) => text.replace(/[a-z]/g, (c) => c.toUpperCase());

const isValid83Path = (filePath) =>
  filePath.split('/').every((segment) => {
    try {
      to83(segment);
      return true;
    } catch {
      return false;
    }
  });

const examples = (list) => `${list.slice(0, MAX_EXAMPLES).join(', ')}${list.length > MAX_EXAMPLES ? ', ...' : ''}`;

const basename = (zipPath) => zipPath.slice(zipPath.lastIndexOf('/') + 1);

/**
 * Installs every BASE package of the live image under `FREEDOS/`, in package-name order. Returns
 * the files by uppercase path as `{ bytes, pkg }` and pushes the warnings about what was skipped.
 */
function installPackages(live, warnings) {
  const zips = live
    .list()
    .filter((entry) => !entry.isDir && BASE_PACKAGE.test(entry.path))
    .map((entry) => entry.path)
    .sort();
  if (zips.length === 0) throw new CliError('the FreeDOS image has no PACKAGES/BASE/*.ZIP packages to install');

  const installed = new Map();
  const outside = [];
  const invalid = [];
  const conflicts = [];
  for (const zipPath of zips) {
    const pkg = basename(zipPath);
    let entries;
    try {
      entries = readZip(live.readFile(zipPath)).entries;
    } catch (err) {
      throw new CliError(`cannot read package ${pkg}: ${err.message}`);
    }
    for (const entry of entries) {
      if (entry.isDir || entry.isSymlink) continue;
      const segments = entry.name.split('/');
      const folder = upper(segments[0]);
      if (folder === 'SOURCE') continue;
      if (segments.length < 2 || !INSTALLED_FOLDERS.has(folder)) {
        outside.push(`${pkg}:${entry.name}`);
        continue;
      }
      const target = upper(['FREEDOS', folder, ...segments.slice(1)].join('/'));
      if (!isValid83Path(target)) {
        invalid.push(target);
        continue;
      }
      let bytes;
      try {
        bytes = entry.read();
      } catch (err) {
        throw new CliError(`cannot read ${entry.name} from package ${pkg}: ${err.message}`);
      }
      const first = installed.get(target);
      if (!first) installed.set(target, { bytes, pkg });
      else if (!first.bytes.equals(bytes)) conflicts.push(`${target} (${first.pkg} kept, ${pkg} ignored)`);
    }
  }

  if (conflicts.length) {
    warnings.push(`${conflicts.length} path(s) appear in several packages with different content, ` +
      `the first was kept: ${examples(conflicts)}`);
  }
  if (invalid.length) {
    warnings.push(`skipped ${invalid.length} package file(s) whose names are not valid 8.3 names: ${examples(invalid)}`);
  }
  if (outside.length) {
    warnings.push(`skipped ${outside.length} package file(s) outside the known folders ` +
      `(${[...INSTALLED_FOLDERS].join(', ')}): ${examples(outside)}`);
  }
  return installed;
}

/**
 * The pure core of the builder: turns the live image, the pinned Jemm files and the two repo boot
 * files into the file tree and boot code for `buildImage`. Throws a `CliError` listing everything
 * that would make the disk unbootable (no kernel, no shell, no `COUNTRY.SYS`, no `MEM`).
 *
 * @param {object} input
 * @param {Buffer} input.liveImage The whole `FD14LITE.img`.
 * @param {Record<string, Buffer>} input.jemmFiles `JEMMEX.EXE`, `JEMM386.EXE`, `JLOAD.EXE` and
 *   `QPIEMU.DLL`, by file name (any case).
 * @param {Buffer} input.fdconfig `FDCONFIG.SYS`; line endings are normalised to CRLF.
 * @param {Buffer} input.fdauto `FDAUTO.BAT`; line endings are normalised to CRLF.
 * @returns {{files: {path: string, bytes: Buffer}[], dirs: string[], bootFiles: string[],
 *   mbrBootCode: Buffer, bootSectorTemplate: Buffer, warnings: string[]}}
 */
export function composeFreedosTree({ liveImage, jemmFiles, fdconfig, fdauto }) {
  const warnings = [];
  const problems = [];
  const live = readImage(liveImage);
  const installed = installPackages(live, warnings);

  const rootFile = (name, packagePath) => {
    const bytes = installed.get(packagePath)?.bytes;
    if (bytes?.length) return bytes;
    const fallback = live.exists(name) ? live.readFile(name) : null;
    if (fallback?.length) {
      warnings.push(`${packagePath} is missing from the BASE packages; using the live image's ${name}`);
      return fallback;
    }
    problems.push(`${name} is missing: it is not in the BASE packages as ${packagePath} or in the live image's root`);
    return null;
  };
  const kernel = rootFile('KERNEL.SYS', 'FREEDOS/BIN/KERNL386.SYS');
  const command = rootFile('COMMAND.COM', 'FREEDOS/BIN/COMMAND.COM');

  const jemm = new Map(Object.entries(jemmFiles ?? {}).map(([name, bytes]) => [upper(name), bytes]));
  for (const name of JEMM_FILES) {
    if (!jemm.get(name)?.length) problems.push(`JEMM/${name} is missing or empty in the Jemm files`);
  }

  if (!installed.has('FREEDOS/BIN/COUNTRY.SYS')) {
    problems.push('FREEDOS/BIN/COUNTRY.SYS is missing, but FDCONFIG.SYS loads it (KERNEL.ZIP ships it)');
  }
  if (!installed.has('FREEDOS/BIN/MEM.EXE') && !installed.has('FREEDOS/BIN/MEM.COM')) {
    problems.push('FREEDOS/BIN/MEM.EXE is missing (MEM.ZIP)');
  }
  if (!installed.has('FREEDOS/BIN/CHKDSK.EXE') && !installed.has('FREEDOS/BIN/CHKDSK.COM')) {
    warnings.push('FREEDOS/BIN/CHKDSK.EXE is missing (CHKDSK.ZIP); CHKDSK D: will not work');
  }
  if (problems.length) throw new CliError(`the FreeDOS C: would not boot:\n  ${problems.join('\n  ')}`);

  const files = [
    { path: 'KERNEL.SYS', bytes: kernel },
    { path: 'COMMAND.COM', bytes: command },
    { path: 'FDCONFIG.SYS', bytes: toCrlf(fdconfig) },
    { path: 'FDAUTO.BAT', bytes: toCrlf(fdauto) },
    ...JEMM_FILES.map((name) => ({ path: `JEMM/${name}`, bytes: jemm.get(name) })),
    ...[...installed].map(([filePath, { bytes }]) => ({ path: filePath, bytes })),
  ];
  return {
    files,
    dirs: ['FREEDOS/TEMP'],
    bootFiles: ['KERNEL.SYS', 'COMMAND.COM'],
    mbrBootCode: live.mbr.bootCode,
    bootSectorTemplate: live.bootSector,
    warnings,
  };
}

/** Finds a file anywhere under `dir`, ignoring case; `null` when there is none. */
function findFile(dir, wanted) {
  const hit = listFiles(dir).find((rel) => upper(basename(rel)) === wanted);
  return hit ? path.join(dir, ...hit.split('/')) : null;
}

/**
 * Builds the bootable FreeDOS C: image for a profile (`profile.c`: geometry, clusterSize, label)
 * from the fetched `freedos` and `jemm` tools and the repo's `env/86box/dos/freedos` boot files,
 * then runs `checkImage` on it.
 *
 * @param {object} ctx The CLI context (`ctx.repo`, `ctx.paths`, `ctx.env`, optional `ctx.log`).
 * @param {object} profile A parsed `profile.json`.
 * @returns {Promise<{image: Buffer, warnings: string[]}>}
 * @throws {CliError} when a tool is not fetched or lacks a file, or the result is unbootable or
 *   fails the consistency check.
 */
export async function buildFreedosC(ctx, profile) {
  const { geometry, clusterSize, label } = profile?.c ?? {};
  if (!geometry || !clusterSize) throw new CliError('the profile has no c.geometry and c.clusterSize to build a C: from');

  const freedos = resolveTool(ctx, 'freedos');
  const liveFile = freedos.dir && findFile(freedos.dir, LIVE_IMAGE);
  if (!liveFile) {
    throw new CliError(`FD14LITE.img was not found in ${freedos.dir}`, { hint: 'rebeep tool fetch freedos --force' });
  }
  const jemm = resolveTool(ctx, 'jemm');
  const jemmFiles = {};
  for (const name of JEMM_FILES) {
    const file = jemm.dir && findFile(jemm.dir, name);
    if (!file) throw new CliError(`${name} was not found in ${jemm.dir}`, { hint: 'rebeep tool fetch jemm --force' });
    jemmFiles[name] = await fs.promises.readFile(file);
  }

  const bootFiles = path.join(ctx.repo.dos, 'freedos');
  const [liveImage, fdconfig, fdauto] = await Promise.all([
    fs.promises.readFile(liveFile),
    fs.promises.readFile(path.join(bootFiles, 'FDCONFIG.SYS')),
    fs.promises.readFile(path.join(bootFiles, 'FDAUTO.BAT')),
  ]);

  const tree = composeFreedosTree({ liveImage, jemmFiles, fdconfig, fdauto });
  const { warnings } = tree;
  const built = buildImage({
    geometry,
    clusterSize,
    label,
    files: tree.files,
    dirs: tree.dirs,
    bootFiles: tree.bootFiles,
    mbrBootCode: tree.mbrBootCode,
    bootSectorTemplate: tree.bootSectorTemplate,
    onInvalid: 'skip',
  });
  if (built.skipped.length) warnings.push(`skipped ${built.skipped.length} file(s) with invalid names: ${examples(built.skipped)}`);

  const check = checkImage(built.image);
  if (!check.ok) throw new CliError(`the built FreeDOS C: failed its consistency check:\n  ${check.errors.join('\n  ')}`);
  ctx.log?.debug(`FreeDOS C: ${built.stats.usedClusters} of ${built.stats.clusterCount} clusters used`);
  return { image: built.image, warnings };
}
