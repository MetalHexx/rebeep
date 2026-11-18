import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './cli.mjs';

/** Files larger than this are refused. */
export const SIZE_LIMIT_BYTES = 1024 * 1024;

/** Bytes read from each end of a file for the magic-number rules. */
export const EDGE_BYTES = 512;

/** DOS `.SYS` and `.BAT` files are exempt from the extension rule only up to this size. */
export const TEXT_EXEMPT_LIMIT_BYTES = 64 * 1024;

/** Lower-case extensions of files that never belong in the repo. */
export const PAYLOAD_EXTENSIONS = Object.freeze([
  '.img', '.ima', '.vhd', '.hdi', '.iso', '.rom', '.bin', '.awd', '.nvr', '.zip', '.7z', '.rar',
  '.tar', '.gz', '.dmg', '.appimage', '.exe', '.com', '.dll', '.ovl', '.drv', '.sys',
]);

/** Known payload names. Basenames are upper case; patterns match case-insensitively. */
export const KNOWN_PAYLOADS = Object.freeze({
  basenames: Object.freeze([
    'GPEGA.EXE', 'GP.EXE', 'MUSIC.BIN', 'VOICES.BIN', 'START.SND', 'JEMMEX.EXE', 'JEMM386.EXE',
    'JLOAD.EXE', 'QPIEMU.DLL', 'KERNEL.SYS', 'COMMAND.COM', 'IO.SYS', 'MSDOS.SYS',
  ]),
  basenamePatterns: Object.freeze([/\.pwx$/i]),
  pathPatterns: Object.freeze([/grand.?prix/i]),
});

/** Exact sizes of DOS floppy images. */
export const FLOPPY_SIZES = Object.freeze([
  163840, 184320, 327680, 368640, 737280, 1228800, 1474560, 2949120,
]);

/** DOS text folders: `.SYS` and `.BAT` files are allowed under them when they are text. */
const DOS_TEXT_DIRS = ['env/86box/dos/', 'release/'];
const DOS_TEXT_EXTENSIONS = ['.sys', '.bat'];
const GITLINK_MODE = '160000';
const CONECTIX = Buffer.from('conectix', 'latin1');
const USTAR = Buffer.from('ustar', 'latin1');
const NO_BYTES = Buffer.alloc(0);
const UNRESOLVED_RANGE = /unknown revision|bad revision|Invalid revision range/;

const isTextByte = (b) => b === 0x09 || b === 0x0a || b === 0x0d || b === 0x1a || (b >= 0x20 && b <= 0x7e);
const isPlainText = (buf) => buf.every(isTextByte);

/** True when `bytes` occur at `offset` in `buf`. */
const bytesAt = (buf, offset, bytes) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

function magicHits({ size, head = NO_BYTES, tail = NO_BYTES }) {
  const hits = [];
  if (bytesAt(head, 0, [0x4d, 0x5a])) hits.push('MZ header: DOS or Windows executable');
  if (bytesAt(head, 0, [0x5a, 0x4d])) hits.push('ZM header: DOS executable');
  if (bytesAt(head, 0, [0x50, 0x4b, 0x03, 0x04])) hits.push('PK\\x03\\x04 header: zip archive');
  if (bytesAt(head, 0, [0x50, 0x4b, 0x05, 0x06])) hits.push('PK\\x05\\x06 header: empty zip archive');
  if (bytesAt(head, 0, [0x50, 0x4b, 0x07, 0x08])) hits.push('PK\\x07\\x08 header: spanned zip archive');
  if (bytesAt(head, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) hits.push('7z signature: 7z archive');
  if (bytesAt(head, 0, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) hits.push('Rar! signature: RAR archive');
  if (bytesAt(head, 0, [0x1f, 0x8b])) hits.push('gzip header: gzip archive');
  if (bytesAt(head, 257, USTAR)) hits.push('ustar at offset 257: tar archive');
  if (size >= EDGE_BYTES && bytesAt(head, 510, [0x55, 0xaa])) {
    hits.push('0x55 0xAA at offset 510: boot sector or disk image');
  }
  if (bytesAt(head, 0, CONECTIX)) hits.push('conectix at offset 0: VHD');
  if (size >= EDGE_BYTES && bytesAt(tail, 0, CONECTIX)) hits.push('conectix at size-512: VHD footer');
  return hits;
}

function sizeHits(size) {
  const reasons = [];
  if (size > SIZE_LIMIT_BYTES) reasons.push('over the 1 MiB limit');
  if (FLOPPY_SIZES.includes(size)) reasons.push('an exact DOS floppy image size');
  return reasons.length ? [`${size} bytes: ${reasons.join(' and ')}`] : [];
}

function ruleHits(entry) {
  const p = entry.path.replace(/\\/g, '/');
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : '';
  const head = entry.head ?? NO_BYTES;
  const tail = entry.tail ?? NO_BYTES;
  const bootText =
    DOS_TEXT_DIRS.some((dir) => p.startsWith(dir)) &&
    DOS_TEXT_EXTENSIONS.includes(ext) &&
    entry.size <= TEXT_EXEMPT_LIMIT_BYTES &&
    isPlainText(head) &&
    isPlainText(tail);

  const hits = [];
  if (PAYLOAD_EXTENSIONS.includes(ext) && !bootText) {
    hits.push(['extension', `${ext} is a payload file type`]);
  }
  for (const detail of sizeHits(entry.size)) hits.push(['size', detail]);
  if (
    KNOWN_PAYLOADS.basenames.includes(base.toUpperCase()) ||
    KNOWN_PAYLOADS.basenamePatterns.some((re) => re.test(base))
  ) {
    hits.push(['name', `${base} is a known payload name`]);
  }
  if (KNOWN_PAYLOADS.pathPatterns.some((re) => re.test(p))) {
    hits.push(['name', 'path matches a known game name']);
  }
  for (const detail of magicHits({ size: entry.size, head, tail })) hits.push(['magic', detail]);
  return hits;
}

/**
 * Applies the payload rules to `{ path, size, head, tail, commit? }` entries. `head` and `tail`
 * are the first and last 512 bytes. `commit` defaults to 'worktree'. Pure: no I/O.
 */
export function scanEntries(entries) {
  const findings = [];
  for (const entry of entries) {
    const commit = entry.commit ?? 'worktree';
    for (const [rule, detail] of ruleHits(entry)) {
      findings.push({ path: entry.path, commit, rule, detail });
    }
  }
  return findings;
}

const firstLine = (text) =>
  (text ?? '').trim().split('\n')[0].replace(/^fatal:\s*/, '').replace(/\.$/, '');

function gitSpawnError(err) {
  if (err.code === 'ENOENT') {
    return new CliError('git was not found on PATH', { hint: 'Install git and make sure it is on PATH.' });
  }
  return err;
}

/** Runs git with an argument array and optional stdin. Output is returned as a Buffer. */
function git(root, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.stdin.on('error', () => {});
    child.on('error', (e) => reject(gitSpawnError(e)));
    child.on('close', (code) =>
      resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }),
    );
    child.stdin.end(input);
  });
}

async function gitOk(root, args, input) {
  const { code, stdout, stderr } = await git(root, args, input);
  if (code !== 0) throw new Error(`git ${args[0]} failed: ${stderr.trim() || `exit code ${code}`}`);
  return stdout;
}

/** Splits NUL-terminated git output into raw Buffers, so names that are not UTF-8 stay intact. */
function splitZ(buf) {
  const parts = [];
  let start = 0;
  for (let i = buf.indexOf(0); i >= 0; i = buf.indexOf(0, start)) {
    if (i > start) parts.push(buf.subarray(start, i));
    start = i + 1;
  }
  if (start < buf.length) parts.push(buf.subarray(start));
  return parts;
}

async function readAt(handle, position, length) {
  const buf = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buf, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buf.subarray(0, filled);
}

async function readEdges(file, size) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const length = Math.min(EDGE_BYTES, size);
    return {
      head: await readAt(handle, 0, length),
      tail: await readAt(handle, size - length, length),
    };
  } finally {
    await handle.close();
  }
}

/**
 * Every tracked file and every untracked-but-not-ignored file on disk. A file that vanished
 * between listing and reading is reported in `vanished`, never skipped silently.
 */
async function collectWorktree(root) {
  const tracked = splitZ(await gitOk(root, ['ls-files', '-z']));
  const untracked = splitZ(await gitOk(root, ['ls-files', '-z', '--others', '--exclude-standard']));
  const names = new Map();
  for (const name of [...tracked, ...untracked]) names.set(name.toString('latin1'), name);

  const entries = [];
  const vanished = [];
  for (const rel of names.values()) {
    const display = rel.toString('utf8');
    const abs = Buffer.concat([Buffer.from(`${root}${path.sep}`), rel]);
    try {
      const stat = await fs.promises.lstat(abs);
      if (stat.isSymbolicLink()) {
        entries.push({ path: display, size: stat.size, head: NO_BYTES, tail: NO_BYTES });
      } else if (stat.isFile()) {
        entries.push({ path: display, size: stat.size, ...(await readEdges(abs, stat.size)) });
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      vanished.push(display);
    }
  }
  return { entries, vanished };
}

/** Blob ids of the index: every staged file, including conflict stages. */
async function collectIndex(root) {
  const records = [];
  for (const token of splitZ(await gitOk(root, ['ls-files', '-s', '-z']))) {
    const tab = token.indexOf(0x09);
    const [mode, blob] = token.subarray(0, tab).toString('utf8').split(' ');
    if (mode === GITLINK_MODE) continue;
    records.push({ path: token.subarray(tab + 1).toString('utf8'), blob });
  }
  return records;
}

/**
 * Added and changed files in every commit of `range`, merges included. One `diff-tree --stdin`
 * process reads all the commits. A token starting with ':' is a record and the token after it is
 * its path. Any other token is the commit that the records below it belong to.
 */
async function collectHistory(root, range) {
  if (range.startsWith('-')) {
    throw new CliError(`'${range}' is not a revision range`, { hint: 'Use a range such as origin/main..HEAD.' });
  }
  let shas;
  try {
    const out = await gitOk(root, ['rev-list', range, '--']);
    shas = out.toString('utf8').split('\n').filter(Boolean);
  } catch (err) {
    if (UNRESOLVED_RANGE.test(err.message)) {
      return { resolved: false, reason: firstLine(err.message), commits: [], records: [] };
    }
    throw err;
  }
  if (shas.length === 0) return { resolved: true, reason: null, commits: [], records: [] };

  const diff = await gitOk(
    root,
    ['diff-tree', '-m', '--stdin', '--root', '-r', '-z', '--no-renames', '--diff-filter=d'],
    `${shas.join('\n')}\n`,
  );
  const tokens = splitZ(diff);
  const records = [];
  const seen = new Set();
  let commit = '';
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i].toString('utf8');
    if (token[0] !== ':') {
      commit = token;
      continue;
    }
    const [, mode, , blob] = token.slice(1).split(' ');
    const file = tokens[i + 1];
    i += 1;
    if (!file || mode === GITLINK_MODE) continue;
    const filePath = file.toString('utf8');
    const key = `${commit}|${filePath}|${blob}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({ commit, path: filePath, blob });
  }
  return { resolved: true, reason: null, commits: shas, records };
}

/**
 * Reads size and edge bytes for many blobs through one `git cat-file --batch` process. The
 * output is parsed as a stream, so a large blob is never held in memory.
 */
function readBlobEdges(root, ids) {
  if (ids.length === 0) return Promise.resolve({ blobs: new Map(), missing: [] });
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const blobs = new Map();
    const missing = [];
    let stderr = '';
    let pending = NO_BYTES;
    let current = null;
    let failure = null;

    const finish = () => {
      blobs.set(current.sha, {
        size: current.size,
        head: Buffer.concat(current.head),
        tail: current.tail,
      });
      current = null;
    };

    const addBytes = (slice) => {
      if (current.headLength < EDGE_BYTES) {
        const part = Buffer.from(slice.subarray(0, EDGE_BYTES - current.headLength));
        current.head.push(part);
        current.headLength += part.length;
      }
      const joined = Buffer.concat([current.tail, slice]);
      current.tail = Buffer.from(joined.subarray(Math.max(0, joined.length - EDGE_BYTES)));
    };

    const consume = (buf) => {
      let at = 0;
      for (;;) {
        if (current === null) {
          const nl = buf.indexOf(0x0a, at);
          if (nl < 0) break;
          const fields = buf.toString('utf8', at, nl).split(' ');
          at = nl + 1;
          if (fields[1] === 'missing') {
            missing.push(fields[0]);
          } else if (fields.length === 3) {
            const size = Number(fields[2]);
            current = {
              sha: fields[0],
              size,
              remaining: size,
              head: [],
              headLength: 0,
              tail: NO_BYTES,
            };
          } else {
            throw new Error(`unexpected git cat-file output: ${fields.join(' ')}`);
          }
        } else if (current.remaining > 0) {
          const take = Math.min(current.remaining, buf.length - at);
          if (take === 0) break;
          addBytes(buf.subarray(at, at + take));
          at += take;
          current.remaining -= take;
        } else {
          if (buf.length - at < 1) break;
          at += 1;
          finish();
        }
      }
      return buf.subarray(at);
    };

    child.stdout.on('data', (chunk) => {
      if (failure) return;
      try {
        pending = consume(Buffer.concat([pending, chunk]));
      } catch (err) {
        failure = err;
        child.kill();
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdin.on('error', () => {});
    child.on('error', (err) => reject(gitSpawnError(err)));
    child.on('close', (code) => {
      if (failure) return reject(failure);
      if (code !== 0) return reject(new Error(stderr.trim() || `git cat-file exited ${code}`));
      if (current !== null || pending.length > 0) {
        return reject(new Error('git cat-file output ended early'));
      }
      resolve({ blobs, missing });
    });
    child.stdin.end(`${ids.join('\n')}\n`);
  });
}

/**
 * Scans the working tree, the index and the commits in `range` for payloads. An unresolvable
 * range is not an error: it is reported in `warnings` and history is not scanned. Files that
 * vanish during the scan are counted in `skipped` and reported in `warnings`.
 */
export async function checkRepo({ root, range }) {
  const worktree = await collectWorktree(root);
  const index = await collectIndex(root);
  const history = await collectHistory(root, range);
  const ids = [...new Set([...index.map((r) => r.blob), ...history.records.map((r) => r.blob)])];
  const { blobs, missing } = await readBlobEdges(root, ids);

  const toEntry = (record, commit) => {
    const blob = blobs.get(record.blob);
    return blob ? { path: record.path, commit, size: blob.size, head: blob.head, tail: blob.tail } : null;
  };
  const indexSeen = new Set();
  const indexEntries = index
    .filter((r) => {
      const key = `${r.path}|${r.blob}`;
      if (indexSeen.has(key)) return false;
      indexSeen.add(key);
      return true;
    })
    .map((r) => toEntry(r, 'index'))
    .filter(Boolean);
  const historyEntries = history.records.map((r) => toEntry(r, r.commit)).filter(Boolean);

  const entries = [...worktree.entries, ...indexEntries, ...historyEntries];
  const findings = scanEntries(entries);

  const warnings = [];
  if (!history.resolved) {
    warnings.push(`cannot resolve range '${range}' (${history.reason}); history NOT scanned`);
  }
  if (worktree.vanished.length > 0) {
    const sample = worktree.vanished.slice(0, 3).join(', ');
    warnings.push(`${worktree.vanished.length} file(s) vanished during the scan and were not scanned: ${sample}`);
  }
  if (missing.length > 0) {
    warnings.push(`${missing.length} object(s) missing from the repository; those files were not scanned`);
  }

  return {
    data: {
      scanned: entries.length,
      commits: history.commits.length,
      findings,
      rangeResolved: history.resolved,
      skipped: worktree.vanished.length,
    },
    warnings,
  };
}
