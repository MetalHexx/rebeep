import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  EDGE_BYTES,
  FLOPPY_SIZES,
  KNOWN_PAYLOADS,
  PAYLOAD_EXTENSIONS,
  SIZE_LIMIT_BYTES,
  scanEntries,
} from '../lib/guard.mjs';
import { makeTempDir, removeDir, runRebeep } from './helpers.mjs';

const TEXT = 'export const x = 1;\n';

function entry(file, { size = TEXT.length, head = TEXT, tail = TEXT, commit } = {}) {
  return {
    path: file,
    size,
    head: Buffer.from(head, 'latin1'),
    tail: Buffer.from(tail, 'latin1'),
    ...(commit ? { commit } : {}),
  };
}

const rulesOf = (entries) => scanEntries(entries).map((f) => f.rule);

describe('scanEntries: extensions', () => {
  test('flags every payload extension in any case', () => {
    for (const ext of PAYLOAD_EXTENSIONS) {
      const findings = scanEntries([entry(`dist/disk${ext.toUpperCase()}`)]);
      assert.deepEqual(
        findings.map((f) => f.rule),
        ['extension'],
        ext,
      );
    }
  });

  test('allows DOS boot text under env/86box/dos/', () => {
    const entries = [entry('env/86box/dos/CONFIG.SYS'), entry('env/86box/dos/AUTOEXEC.BAT')];
    assert.deepEqual(scanEntries(entries), []);
  });

  test('flags a binary .SYS under env/86box/dos/ (HIMEM.SYS with NUL bytes)', () => {
    const binary = '\u0000\u0001ÿ\u0010MZ';
    assert.deepEqual(rulesOf([entry('env/86box/dos/HIMEM.SYS', { head: binary, tail: binary })]), ['extension']);
  });

  test('flags a text .SYS over 64 KiB under env/86box/dos/', () => {
    const size = 64 * 1024 + 1;
    assert.deepEqual(rulesOf([entry('env/86box/dos/CONFIG.SYS', { size })]), ['extension']);
  });

  test('keeps flagging other payloads and system files under env/86box/dos/', () => {
    assert.deepEqual(rulesOf([entry('env/86box/dos/DRIVER.EXE')]), ['extension']);
    assert.deepEqual(rulesOf([entry('env/86box/dos/IO.SYS')]), ['name']);
  });

  test('allows text .SYS and .BAT under release/', () => {
    const entries = [entry('release/SAMPLES/MSDOS/CONFIG.SYS'), entry('release/SAMPLES/FREEDOS/FDAUTO.BAT')];
    assert.deepEqual(scanEntries(entries), []);
  });

  test('flags a binary .SYS under release/', () => {
    const binary = '\u0000\u0001ÿ\u0010MZ';
    assert.deepEqual(rulesOf([entry('release/SAMPLES/MSDOS/CONFIG.SYS', { head: binary, tail: binary })]), ['extension']);
  });

  test('flags a text .SYS over 64 KiB under release/', () => {
    const size = 64 * 1024 + 1;
    assert.deepEqual(rulesOf([entry('release/SAMPLES/MSDOS/CONFIG.SYS', { size })]), ['extension']);
  });

  test('keeps flagging executables under release/, and text .SYS outside the DOS folders', () => {
    assert.deepEqual(rulesOf([entry('release/REBEEP.COM')]), ['extension']);
    assert.deepEqual(rulesOf([entry('docs/CONFIG.SYS')]), ['extension']);
  });
});

describe('scanEntries: size', () => {
  test('flags a file over 1 MiB and passes one at the limit', () => {
    assert.deepEqual(rulesOf([entry('notes.txt', { size: SIZE_LIMIT_BYTES + 1 })]), ['size']);
    assert.deepEqual(rulesOf([entry('notes.txt', { size: SIZE_LIMIT_BYTES })]), []);
  });

  test('flags each exact DOS floppy image size', () => {
    for (const size of FLOPPY_SIZES) {
      assert.deepEqual(rulesOf([entry('notes.txt', { size })]), ['size'], String(size));
    }
  });
});

describe('scanEntries: known names', () => {
  test('flags each known payload basename in any case', () => {
    for (const name of KNOWN_PAYLOADS.basenames) {
      const rules = rulesOf([entry(`a/${name.toLowerCase()}`)]);
      assert.ok(rules.includes('name'), name);
    }
  });

  test('flags PWX files and any path matching grand prix', () => {
    assert.deepEqual(rulesOf([entry('music/track.pwx')]), ['name']);
    assert.deepEqual(rulesOf([entry('games/GRAND_PRIX/readme.md')]), ['name']);
    assert.deepEqual(rulesOf([entry('games/grandprix/readme.md')]), ['name']);
  });
});

describe('scanEntries: magic bytes', () => {
  const headOf = (bytes) => Buffer.from(bytes).toString('latin1');

  test('flags executable headers: MZ and ZM', () => {
    assert.deepEqual(rulesOf([entry('tool.txt', { head: 'MZ\u0090\u0000' })]), ['magic']);
    assert.deepEqual(rulesOf([entry('tool.txt', { head: 'ZM\u0090\u0000' })]), ['magic']);
  });

  test('flags zip headers: local file, empty archive and spanned archive', () => {
    for (const sig of [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]]) {
      assert.deepEqual(rulesOf([entry('pack.txt', { head: headOf(sig) })]), ['magic'], sig.join(' '));
    }
  });

  test('flags 7z, RAR and gzip headers', () => {
    assert.deepEqual(rulesOf([entry('a.txt', { head: headOf([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) })]), ['magic']);
    assert.deepEqual(rulesOf([entry('a.txt', { head: 'Rar!\u001a\u0007\u0000' })]), ['magic']);
    assert.deepEqual(rulesOf([entry('a.txt', { head: headOf([0x1f, 0x8b, 0x08]) })]), ['magic']);
  });

  test('flags a tar ustar marker at offset 257', () => {
    const head = Buffer.alloc(EDGE_BYTES);
    head.write('ustar', 257, 'latin1');
    assert.deepEqual(rulesOf([entry('a.txt', { size: 4096, head: head.toString('latin1') })]), ['magic']);
  });

  test('flags a boot signature at offset 510 in a file of at least 512 bytes', () => {
    const sector = Buffer.alloc(EDGE_BYTES);
    sector[510] = 0x55;
    sector[511] = 0xaa;
    const head = sector.toString('latin1');
    assert.deepEqual(rulesOf([entry('disk.dat', { size: 4096, head })]), ['magic']);
  });

  test('ignores a boot signature in a file smaller than 512 bytes', () => {
    const sector = Buffer.alloc(EDGE_BYTES);
    sector[510] = 0x55;
    sector[511] = 0xaa;
    const head = sector.toString('latin1');
    assert.deepEqual(rulesOf([entry('tiny.dat', { size: 100, head })]), []);
  });

  test('flags a VHD conectix header at offset 0 and footer at size-512', () => {
    assert.deepEqual(rulesOf([entry('a.dat', { head: 'conectix' + '\u0000'.repeat(8) })]), ['magic']);
    const footer = 'conectix' + '\u0000'.repeat(EDGE_BYTES - 8);
    assert.deepEqual(rulesOf([entry('b.dat', { size: 8192, tail: footer })]), ['magic']);
  });
});

describe('scanEntries: ordinary source', () => {
  test('passes .mjs, .md, .asm and .json files', () => {
    const entries = ['a.mjs', 'README.md', 'src/rebeep.asm', 'src/targets.json'].map((f) => entry(f));
    assert.deepEqual(scanEntries(entries), []);
  });

  test('reports the commit of each finding, or worktree', () => {
    const [sha] = scanEntries([entry('disk.img', { commit: 'abc123' })]).map((f) => f.commit);
    assert.equal(sha, 'abc123');
    const [tree] = scanEntries([entry('disk.img')]).map((f) => f.commit);
    assert.equal(tree, 'worktree');
  });
});

/** Git inside a throwaway repo. GIT_* variables from a hook would point it at another repo. */
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const gitIn = (cwd, input, ...args) =>
  execFileSync('git', args, { cwd, env: cleanEnv, encoding: 'utf8', input }).trim();

describe('repo check, end to end', () => {
  const dirs = [];
  const newRepo = () => {
    const dir = makeTempDir('rebeep-guard-');
    dirs.push(dir);
    gitIn(dir, undefined, 'init', '-q');
    gitIn(dir, undefined, 'config', 'user.name', 'Fixture');
    gitIn(dir, undefined, 'config', 'user.email', 'fixture@example.invalid');
    gitIn(dir, undefined, 'config', 'commit.gpgsign', 'false');
    return dir;
  };
  const commitAll = (dir, message) => {
    gitIn(dir, undefined, 'add', '-A');
    gitIn(dir, undefined, 'commit', '-q', '-m', message);
    return gitIn(dir, undefined, 'rev-parse', 'HEAD');
  };
  const check = (dir, ...args) =>
    runRebeep(['repo', 'check', '--json', ...args], { cwd: dir, env: { REBEEP_REPO_ROOT: dir } });
  const findingsOf = (result) => JSON.parse(result.stdout).data.findings;

  after(() => {
    for (const dir of dirs) removeDir(dir);
  });

  describe('shared history: payload added, removed, and a 1 MiB file with a VHD footer', () => {
    let repo;
    let firstSha;
    let addSha;
    let removeSha;
    let bigSha;

    before(() => {
      repo = newRepo();
      fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
      firstSha = commitAll(repo, 'clean');

      fs.writeFileSync(path.join(repo, 'disk.img'), 'x'.repeat(64));
      addSha = commitAll(repo, 'add image');

      fs.rmSync(path.join(repo, 'disk.img'));
      removeSha = commitAll(repo, 'remove image');

      const big = Buffer.alloc(SIZE_LIMIT_BYTES + 1);
      big.write('conectix', big.length - EDGE_BYTES, 'latin1');
      fs.writeFileSync(path.join(repo, 'big.dat'), big);
      bigSha = commitAll(repo, 'add big file');

      fs.rmSync(path.join(repo, 'big.dat'));
      commitAll(repo, 'remove big file');
    });

    test('fails on the commit that added a payload, with the range <first>..HEAD', () => {
      const result = check(repo, '--range', `${firstSha}..HEAD`);
      assert.equal(result.code, 1);
      const findings = findingsOf(result);
      assert.ok(
        findings.some((f) => f.path === 'disk.img' && f.commit === addSha && f.rule === 'extension'),
      );
      const big = findings.filter((f) => f.path === 'big.dat' && f.commit === bigSha).map((f) => f.rule);
      assert.deepEqual(big.sort(), ['magic', 'size']);
      assert.ok(!findings.some((f) => f.commit === removeSha));
    });

    test('passes a clean range', () => {
      const result = check(repo, '--range', `${addSha}..${removeSha}`);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout).data.findings, []);
    });
  });

  test('a file that is only in a merge commit is found, attributed to the merge', () => {
    const repo = newRepo();
    fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n');
    const base = commitAll(repo, 'base');
    gitIn(repo, undefined, 'checkout', '-q', '-b', 'side');
    fs.writeFileSync(path.join(repo, 'side.txt'), 'side\n');
    commitAll(repo, 'side');
    gitIn(repo, undefined, 'checkout', '-q', '-');
    fs.writeFileSync(path.join(repo, 'main.txt'), 'main\n');
    commitAll(repo, 'main');
    gitIn(repo, undefined, 'merge', '-q', '--no-commit', '--no-ff', 'side');
    fs.writeFileSync(path.join(repo, 'disk.img'), 'x'.repeat(64));
    const mergeSha = commitAll(repo, 'merge with a payload');

    const result = check(repo, '--range', `${base}..HEAD`);
    assert.equal(result.code, 1, result.stderr);
    const history = findingsOf(result).filter((f) => f.commit !== 'worktree' && f.commit !== 'index');
    assert.deepEqual(
      history.map((f) => [f.path, f.commit]),
      [['disk.img', mergeSha]],
    );
  });

  test('a symlink replaced by an MZ file (type change) is found in the commit that changed it', () => {
    const repo = newRepo();
    const linkBlob = gitIn(repo, 'target', 'hash-object', '-w', '--stdin');
    gitIn(repo, undefined, 'update-index', '--add', '--cacheinfo', `120000,${linkBlob},link`);
    gitIn(repo, undefined, 'commit', '-q', '-m', 'symlink');
    const base = gitIn(repo, undefined, 'rev-parse', 'HEAD~0');
    const mz = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(600, 1)]);
    const mzBlob = gitIn(repo, mz, 'hash-object', '-w', '--stdin');
    gitIn(repo, undefined, 'update-index', '--add', '--cacheinfo', `100644,${mzBlob},link`);
    fs.writeFileSync(path.join(repo, 'link'), mz);
    gitIn(repo, undefined, 'commit', '-q', '-m', 'replace the link with an executable');
    const changedSha = gitIn(repo, undefined, 'rev-parse', 'HEAD');

    const result = check(repo, '--range', `${base}..HEAD`);
    assert.equal(result.code, 1, result.stderr);
    assert.ok(
      findingsOf(result).some((f) => f.path === 'link' && f.commit === changedSha && f.rule === 'magic'),
    );
    removeDir(repo);
  });

  test('a payload that is staged but deleted from disk is found in the index', () => {
    const repo = newRepo();
    fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n');
    commitAll(repo, 'base');
    fs.writeFileSync(path.join(repo, 'disk.img'), 'x');
    gitIn(repo, undefined, 'add', 'disk.img');
    fs.rmSync(path.join(repo, 'disk.img'));

    const result = check(repo, '--range', 'HEAD..HEAD');
    assert.equal(result.code, 1, result.stderr);
    assert.ok(findingsOf(result).some((f) => f.path === 'disk.img' && f.commit === 'index'));
    removeDir(repo);
  });

  test('a tracked file that vanishes during the scan is counted and warned about', () => {
    const repo = newRepo();
    fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n');
    commitAll(repo, 'base');
    fs.rmSync(path.join(repo, 'README.md'));

    const result = check(repo, '--range', 'HEAD..HEAD');
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).data.skipped, 1);
    assert.match(result.stderr, /vanished during the scan/);
    removeDir(repo);
  });

  describe('an unresolvable range, with a decoy file named like the default range', () => {
    let repo;

    before(() => {
      repo = newRepo();
      fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n');
      commitAll(repo, 'base');
      fs.writeFileSync(path.join(repo, 'disk.img'), 'x');
      commitAll(repo, 'add image');
      fs.rmSync(path.join(repo, 'disk.img'));
      commitAll(repo, 'remove image');
      fs.mkdirSync(path.join(repo, 'origin'));
      fs.writeFileSync(path.join(repo, 'origin', 'main..HEAD'), 'decoy\n');
    });

    test('without --strict it warns that history was NOT scanned and does not claim a clean history', () => {
      const result = runRebeep(['repo', 'check'], { cwd: repo, env: { REBEEP_REPO_ROOT: repo } });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stderr, /history NOT scanned/);
      assert.doesNotMatch(result.stdout + result.stderr, /No payloads found/);
    });

    test('with --strict it fails, so CI cannot pass without scanning history', () => {
      const result = runRebeep(['repo', 'check', '--strict'], { cwd: repo, env: { REBEEP_REPO_ROOT: repo } });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /history was NOT scanned/);
    });

    test('the decoy file does not make the range resolve', () => {
      const result = check(repo);
      assert.equal(JSON.parse(result.stdout).data.rangeResolved, false);
    });
  });

  test('a range that starts with an option is refused', () => {
    const repo = newRepo();
    fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n');
    commitAll(repo, 'base');
    const result = runRebeep(['repo', 'check', '--range=--all'], { env: { REBEEP_REPO_ROOT: repo } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /is not a revision range/);
    removeDir(repo);
  });

  test('a folder that is not a git repository fails', () => {
    const dir = makeTempDir('rebeep-notgit-');
    try {
      const result = runRebeep(['repo', 'check'], { env: { REBEEP_REPO_ROOT: dir } });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /not a git repository/);
    } finally {
      removeDir(dir);
    }
  });

  test('a missing git is a clear error, not a crash', () => {
    const repo = newRepo();
    const result = runRebeep(['repo', 'check'], { env: { REBEEP_REPO_ROOT: repo, PATH: '' } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /git was not found on PATH/);
  });
});
