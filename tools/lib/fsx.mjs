import fs from 'node:fs';
import path from 'node:path';

/** `1.5 MB`, `812 KB`, `0 B`. */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function syncFile(file) {
  const fd = fs.openSync(file, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Runs `write(tmp)` against `<to>.tmp`, flushes it to disk, then renames it over `to`. The temp file never survives a failure. */
export function writeAtomic(to, write) {
  const tmp = `${to}.tmp`;
  try {
    write(tmp);
    syncFile(tmp);
    fs.renameSync(tmp, to);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Copies `from` over `to` through a flushed temp file. */
export function copyAtomic(from, to) {
  writeAtomic(to, (tmp) => fs.copyFileSync(from, tmp));
}

/** Replaces folder `to` with a copy of `from`, or with an empty folder when `from` is missing. */
export function replaceDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true });
  else fs.mkdirSync(to, { recursive: true });
}

/** Leaves `dir` existing and empty. */
export function emptyDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

/** Total bytes of the files under `target` (a symlink counts as itself). */
export function treeSize(target) {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(target).reduce((sum, name) => sum + treeSize(path.join(target, name)), 0);
}
