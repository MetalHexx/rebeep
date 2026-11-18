import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { repoLayout } from '../lib/paths.mjs';
import { makeTempDir, removeDir, runRebeep } from './helpers.mjs';

const SOURCE = 'start: db "fake nasm source", 13, 10\n';

const DEFAULT_TARGETS = {
  targets: [{ name: 'REBEEP.COM', source: 'rebeep.asm', format: 'bin', deploy: 'REBEEP' }],
};

/** A fake NASM: logs its arguments, answers `-v`, can warn or fail, and copies the source to `-o`. */
const FAKE_NASM = `import fs from 'node:fs';
const args = process.argv.slice(2);
if (process.env.FAKE_NASM_LOG) fs.appendFileSync(process.env.FAKE_NASM_LOG, JSON.stringify(args) + '\\n');
if (args[0] === '-v') {
  console.log('NASM version 3.02 (fake)');
  process.exit(0);
}
if (process.env.FAKE_NASM_FAIL) {
  console.error(process.env.FAKE_NASM_FAIL);
  process.exit(1);
}
if (process.env.FAKE_NASM_WARN) console.error(process.env.FAKE_NASM_WARN);
fs.copyFileSync(args[args.length - 1], args[args.indexOf('-o') + 1]);
`;

function makeRepo({ targets = DEFAULT_TARGETS, source = SOURCE, version = '0.1.0' } = {}) {
  const root = makeTempDir('rebeep-build-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'rebeep', version }));
  fs.mkdirSync(path.join(root, 'src', 'include'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'targets.json'), JSON.stringify(targets, null, 2));
  fs.writeFileSync(path.join(root, 'src', 'rebeep.asm'), source);
  return root;
}

/** Real NASM on PATH, or null. Used only for the optional real-assembler check. */
function nasmOnPath() {
  try {
    const found = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['nasm'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return found.split(/\r?\n/).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

describe('build run and build clean', () => {
  let fakeDir;
  let script;
  let logCount = 0;

  before(() => {
    fakeDir = makeTempDir('rebeep-fake-nasm-');
    script = path.join(fakeDir, 'fake-nasm.mjs');
    fs.writeFileSync(script, FAKE_NASM);
  });

  after(() => removeDir(fakeDir));

  const newLog = () => path.join(fakeDir, `calls-${++logCount}.log`);
  const readCalls = (log) =>
    fs.existsSync(log)
      ? fs
          .readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .filter((args) => args[0] !== '-v')
      : [];

  const fakeEnv = (root, log, extra = {}) => ({
    REBEEP_REPO_ROOT: root,
    REBEEP_NASM: process.execPath,
    REBEEP_NASM_PREFIX_ARGS: JSON.stringify([script]),
    FAKE_NASM_LOG: log,
    ...extra,
  });

  const run = (root, args, { log = newLog(), env = {} } = {}) => ({
    log,
    result: runRebeep(args, { env: fakeEnv(root, log, env) }),
  });

  test('passes NASM the format, include folders, version define, listing and output', () => {
    const root = makeRepo();
    const { log, result } = run(root, ['build', 'run']);
    assert.equal(result.code, 0, result.stderr);

    const src = path.join(root, 'src');
    const calls = readCalls(log);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [
      '-f',
      'bin',
      '-I',
      `${src}${path.sep}`,
      '-I',
      `${path.join(src, 'include')}${path.sep}`,
      '-DREBEEP_VERSION="0.1.0"',
      '-DREBEEP_VER_MAJOR=0',
      '-DREBEEP_VER_MINOR=1',
      '-DREBEEP_VER_PATCH=0',
      '-l',
      path.join(root, 'build', 'REBEEP.LST'),
      '-o',
      path.join(root, 'build', 'REBEEP.COM'),
      path.join(src, 'rebeep.asm'),
    ]);
    removeDir(root);
  });

  test('writes build.json and the output, with its size and hash', () => {
    const root = makeRepo();
    const { result } = run(root, ['build', 'run']);
    assert.equal(result.code, 0, result.stderr);

    const built = JSON.parse(fs.readFileSync(path.join(root, 'build', 'build.json'), 'utf8'));
    const output = fs.readFileSync(path.join(root, 'build', 'REBEEP.COM'));
    assert.equal(output.toString(), SOURCE);
    assert.equal(built.nasm.version, '3.02');
    assert.equal(built.nasm.bin, process.execPath);
    assert.ok(!Number.isNaN(Date.parse(built.builtAt)));
    assert.deepEqual(built.targets, [
      { name: 'REBEEP.COM', size: output.length, sha256: sha256(output), deploy: 'REBEEP', autoload: false },
    ]);
    removeDir(root);
  });

  test('splits the version into numeric defines, ignoring a pre-release suffix', () => {
    const root = makeRepo({ version: '12.3.45-beta.1' });
    const { log, result } = run(root, ['build', 'run']);
    assert.equal(result.code, 0, result.stderr);
    const [args] = readCalls(log);
    assert.ok(args.includes('-DREBEEP_VERSION="12.3.45-beta.1"'));
    assert.deepEqual(
      args.filter((a) => a.startsWith('-DREBEEP_VER_')),
      ['-DREBEEP_VER_MAJOR=12', '-DREBEEP_VER_MINOR=3', '-DREBEEP_VER_PATCH=45'],
    );
    removeDir(root);
  });

  test('a version that is not major.minor.patch fails before NASM runs', () => {
    const root = makeRepo({ version: 'next' });
    const { log, result } = run(root, ['build', 'run']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /major.minor.patch/);
    assert.deepEqual(readCalls(log), []);
    removeDir(root);
  });

  test('records autoload in build.json, and rejects a value that is not a boolean', () => {
    const root = makeRepo({
      targets: { targets: [{ name: 'REBEEP.COM', source: 'rebeep.asm', format: 'bin', deploy: 'REBEEP', autoload: true }] },
    });
    assert.equal(run(root, ['build', 'run']).result.code, 0);
    const built = JSON.parse(fs.readFileSync(path.join(root, 'build', 'build.json'), 'utf8'));
    assert.equal(built.targets[0].autoload, true);
    removeDir(root);

    for (const autoload of ['yes', 1, null]) {
      const bad = makeRepo({
        targets: { targets: [{ name: 'REBEEP.COM', source: 'rebeep.asm', format: 'bin', autoload }] },
      });
      const { log, result } = run(bad, ['build', 'run']);
      assert.equal(result.code, 1, String(autoload));
      assert.match(result.stderr, /autoload must be true or false/);
      assert.deepEqual(readCalls(log), [], String(autoload));
      removeDir(bad);
    }
  });

  test("a NASM failure is a CliError that carries NASM's message and removes the old build.json", () => {
    const root = makeRepo();
    assert.equal(run(root, ['build', 'run']).result.code, 0);
    assert.ok(fs.existsSync(path.join(root, 'build', 'build.json')));

    const { result } = run(root, ['build', 'run'], {
      env: { FAKE_NASM_FAIL: 'rebeep.asm:2: error: fake syntax failure' },
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /fake syntax failure/);
    assert.equal(fs.existsSync(path.join(root, 'build', 'build.json')), false);
    removeDir(root);
  });

  test("NASM's stderr on success is logged as warnings", () => {
    const root = makeRepo();
    const { result } = run(root, ['build', 'run'], { env: { FAKE_NASM_WARN: 'fake: deprecated directive' } });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /warning: nasm \(REBEEP\.COM\): fake: deprecated directive/);
    removeDir(root);
  });

  test('a target name that is not 8.3 upper case fails before NASM runs', () => {
    for (const name of ['rebeep.com', 'LONGNAMES.COM', 'X.COMM']) {
      const root = makeRepo({
        targets: { targets: [{ name, source: 'rebeep.asm', format: 'bin' }] },
      });
      const { log, result } = run(root, ['build', 'run']);
      assert.equal(result.code, 1, name);
      assert.match(result.stderr, new RegExp(name.replace('.', '\\.')));
      assert.deepEqual(readCalls(log), [], name);
      removeDir(root);
    }
  });

  test('a target with root "tests" resolves its source there and searches its own folder first', () => {
    const root = makeRepo({
      targets: {
        targets: [{ name: 'EXER.COM', source: 'exerciser/exer.asm', root: 'tests', format: 'bin' }],
      },
    });
    fs.mkdirSync(path.join(root, 'tests', 'exerciser'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tests', 'exerciser', 'exer.asm'), SOURCE);
    const { log, result } = run(root, ['build', 'run']);
    assert.equal(result.code, 0, result.stderr);

    const [args] = readCalls(log);
    const dirs = args.flatMap((a, i) => (a === '-I' ? [args[i + 1]] : []));
    assert.deepEqual(dirs, [
      `${path.join(root, 'tests', 'exerciser')}${path.sep}`,
      `${path.join(root, 'src')}${path.sep}`,
      `${path.join(root, 'src', 'include')}${path.sep}`,
    ]);
    assert.equal(args[args.length - 1], path.join(root, 'tests', 'exerciser', 'exer.asm'));
    removeDir(root);
  });

  test('a bad root, or a source that escapes its root, fails before NASM runs', () => {
    const bad = [
      { root: 'build', source: 'rebeep.asm' },
      { root: 'tests', source: '../src/rebeep.asm' },
      { root: 'tests', source: path.resolve('rebeep.asm') },
    ];
    for (const extra of bad) {
      const root = makeRepo({
        targets: { targets: [{ name: 'REBEEP.COM', format: 'bin', ...extra }] },
      });
      const { log, result } = run(root, ['build', 'run']);
      assert.equal(result.code, 1, JSON.stringify(extra));
      assert.match(result.stderr, /root|source/, JSON.stringify(extra));
      assert.deepEqual(readCalls(log), [], JSON.stringify(extra));
      removeDir(root);
    }
  });

  test('a malformed REBEEP_NASM_PREFIX_ARGS is a clear error', () => {
    const root = makeRepo();
    for (const bad of ['not json', '{"a":1}', '[1]']) {
      const result = runRebeep(['build', 'run'], {
        env: { REBEEP_REPO_ROOT: root, REBEEP_NASM: process.execPath, REBEEP_NASM_PREFIX_ARGS: bad },
      });
      assert.equal(result.code, 1, bad);
      assert.match(result.stderr, /REBEEP_NASM_PREFIX_ARGS must be a JSON array of strings/);
    }
    removeDir(root);
  });

  test('--deploy runs disk deploy through the registry, renders it, and returns its result', () => {
    const root = makeRepo();
    const home = makeTempDir('rebeep-home-');
    try {
      const log = newLog();
      const human = runRebeep(['build', 'run', '--deploy'], {
        env: fakeEnv(root, log, { REBEEP_HOME: home }),
      });
      assert.equal(human.code, 0, human.stderr);
      assert.match(human.stdout + human.stderr, /nothing to deploy/);

      const json = runRebeep(['build', 'run', '--deploy', '--json'], {
        env: fakeEnv(root, newLog(), { REBEEP_HOME: home }),
      });
      assert.equal(json.code, 0, json.stderr);
      assert.deepEqual(JSON.parse(json.stdout).data.deployed, { deployed: [], warnings: [] });
      assert.ok(fs.existsSync(path.join(root, 'build', 'build.json')));
    } finally {
      removeDir(home);
      removeDir(root);
    }
  });

  test('build clean removes build/ and succeeds when it is already gone', () => {
    const root = makeRepo();
    run(root, ['build', 'run']);
    const env = { REBEEP_REPO_ROOT: root };
    const first = runRebeep(['build', 'clean'], { env });
    assert.equal(first.code, 0, first.stderr);
    assert.equal(fs.existsSync(path.join(root, 'build')), false);
    const second = runRebeep(['build', 'clean'], { env });
    assert.equal(second.code, 0, second.stderr);
    removeDir(root);
  });

  test('assembles the real src/rebeep.asm, and stops with a message when the version is not defined', {
    skip: process.env.REBEEP_TEST_REAL_HOME || nasmOnPath() ? false : 'no real NASM (set REBEEP_TEST_REAL_HOME or put nasm on PATH)',
  }, () => {
    const root = makeRepo({ source: fs.readFileSync(path.join(repoLayout().src, 'rebeep.asm')) });
    fs.cpSync(repoLayout().src, path.join(root, 'src'), { recursive: true, filter: (file) => !file.endsWith('targets.json') });
    fs.mkdirSync(path.join(root, 'env', '86box'), { recursive: true });
    fs.copyFileSync(repoLayout().manifest, path.join(root, 'env', '86box', 'manifest.json'));
    const env = process.env.REBEEP_TEST_REAL_HOME
      ? { REBEEP_REPO_ROOT: root, REBEEP_HOME: process.env.REBEEP_TEST_REAL_HOME, REBEEP_NASM: '', REBEEP_NASM_PREFIX_ARGS: '' }
      : { REBEEP_REPO_ROOT: root, REBEEP_NASM: nasmOnPath(), REBEEP_NASM_PREFIX_ARGS: '' };
    const result = runRebeep(['build', 'run'], { env });
    assert.equal(result.code, 0, result.stderr);
    const output = fs.readFileSync(path.join(root, 'build', 'REBEEP.COM'));
    assert.ok(output.length > 1000, 'the TSR is more than a stub');

    const { nasm } = JSON.parse(fs.readFileSync(path.join(root, 'build', 'build.json'), 'utf8'));
    const bare = spawnSync(
      nasm.bin,
      ['-f', 'bin', '-I', `${path.join(root, 'src')}${path.sep}`, '-I', `${path.join(root, 'src', 'include')}${path.sep}`,
        '-o', path.join(root, 'build', 'BARE.COM'), path.join(root, 'src', 'rebeep.asm')],
      { encoding: 'utf8' },
    );
    assert.notEqual(bare.status, 0);
    assert.match(bare.stderr, /REBEEP_VERSION is not defined/);
    removeDir(root);
  });
});
