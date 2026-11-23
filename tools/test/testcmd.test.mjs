import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { interpreterPrograms, parseResults, studioPrograms, toolTestFiles } from '../lib/suites.mjs';
import { repoLayout } from '../lib/paths.mjs';
import { makeTempDir, removeDir, runRebeep } from './helpers.mjs';

/** A fake NASM: copies the source to `-o`, and answers `-v`. */
const FAKE_NASM = `import fs from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '-v') {
  console.log('NASM version 3.02 (fake)');
  process.exit(0);
}
fs.copyFileSync(args[args.length - 1], args[args.indexOf('-o') + 1]);
`;

/**
 * A fake DOSBox-X: logs its arguments, then copies FAKE_DOSBOX_RESULT_FILE into the mounted
 * folder as RESULT.TXT, which is what a DOS program would have written.
 */
const FAKE_DOSBOX = `import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_DOSBOX_LOG, JSON.stringify(args) + '\\n');
const mount = args.find((a) => a.startsWith('MOUNT C '));
const dir = mount.slice('MOUNT C '.length).replace(/^"|"$/g, '');
if (process.env.FAKE_DOSBOX_LISTING) {
  const factory = path.join(dir, 'FACTORY');
  fs.writeFileSync(process.env.FAKE_DOSBOX_LISTING, fs.existsSync(factory) ? fs.readdirSync(factory).join(',') : 'none');
}
if (process.env.FAKE_DOSBOX_RESULT_FILE) fs.copyFileSync(process.env.FAKE_DOSBOX_RESULT_FILE, path.join(dir, 'RESULT.TXT'));
`;

/** A fake wcl: logs its arguments, can fail, and writes the `-fe=` path as the output (wcl runs in the output's folder). */
const FAKE_WCL = `import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_WCL_LOG, JSON.stringify(args) + '\\n');
if (process.env.FAKE_WCL_FAIL) {
  console.error(process.env.FAKE_WCL_FAIL);
  process.exit(1);
}
fs.writeFileSync(args.find((a) => a.startsWith('-fe=')).slice(4), 'MZ fake exe');
`;

describe('parseResults', () => {
  test('reads PASS and FAIL lines with CRLF or LF, and the final DONE count', () => {
    const text = 'PASS add\r\nFAIL sub: expected 3, got 4\nnoise here\nPASS mul\nDONE 3\r\n';
    assert.deepEqual(parseResults(text), {
      passed: ['add', 'mul'],
      failed: [{ name: 'sub', detail: 'expected 3, got 4' }],
      done: 3,
    });
  });

  test('DONE counts only as the last line', () => {
    assert.equal(parseResults('PASS a\nDONE 1\nPASS b\n').done, null);
  });

  test('a FAIL line without a detail gets an empty one', () => {
    assert.deepEqual(parseResults('FAIL div\n'), { passed: [], failed: [{ name: 'div', detail: '' }], done: null });
  });

  test('any line starting with FAIL, in any case, is a failure; an empty name is (unnamed)', () => {
    assert.deepEqual(parseResults('fail: expected 3\nFAIL\n').failed, [
      { name: '(unnamed)', detail: 'expected 3' },
      { name: '(unnamed)', detail: '' },
    ]);
  });

  test('empty text and lines that are not results give no results', () => {
    assert.deepEqual(parseResults(''), { passed: [], failed: [], done: null });
    assert.deepEqual(parseResults('pass lower\nHello\n'), { passed: [], failed: [], done: null });
  });
});

describe('test list', () => {
  test('lists each suite with its runner and the test files it counts', () => {
    const result = runRebeep(['test', 'list', '--json']);
    assert.equal(result.code, 0, result.stderr);
    const { suites } = JSON.parse(result.stdout).data;
    const tools = suites.find((s) => s.suite === 'tools');
    assert.equal(tools.files, toolTestFiles(repoLayout().root).length);
    assert.equal(
      suites.find((s) => s.suite === 'interpreter').files,
      interpreterPrograms(repoLayout().root).length,
    );
    assert.equal(suites.find((s) => s.suite === 'studio').files, studioPrograms(repoLayout().root).length);
    assert.ok(studioPrograms(repoLayout().root).includes('T_SMOKE.C'));
    assert.match(tools.runs, /node --test/);
    assert.deepEqual(
      suites.map((s) => s.suite),
      ['tools', 'interpreter', 'studio', 'vm', 'all'],
    );
  });

  test('prints a table in human output', () => {
    const result = runRebeep(['test', 'list']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^suite\s+files\s+runs/m);
    assert.match(result.stdout, /^tools\s/m);
  });
});

describe('test run', () => {
  const dirs = [];
  after(() => {
    for (const dir of dirs) removeDir(dir);
  });

  test('--suite interpreter succeeds with "no tests yet" when tests/interpreter has no test programs', () => {
    const root = makeTempDir('rebeep-tests-');
    dirs.push(root);
    fs.mkdirSync(path.join(root, 'tests', 'interpreter'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tests', 'interpreter', '.gitkeep'), '');
    const env = { REBEEP_REPO_ROOT: root };

    const human = runRebeep(['test', 'run', '--suite', 'interpreter'], { env });
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /no tests yet/);

    const json = runRebeep(['test', 'run', '--suite', 'interpreter', '--json'], { env });
    assert.equal(json.code, 0, json.stderr);
    const { suites } = JSON.parse(json.stdout).data;
    assert.deepEqual(suites, [{ suite: 'interpreter', ok: true, programs: [] }]);
  });

  test('--suite studio succeeds with "no tests yet" when tests/studio has no test programs', () => {
    const root = makeTempDir('rebeep-studio-none-');
    dirs.push(root);
    fs.mkdirSync(path.join(root, 'tests', 'studio'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tests', 'studio', 'testlib.c'), '/* not a test */\n');
    const env = { REBEEP_REPO_ROOT: root };

    const human = runRebeep(['test', 'run', '--suite', 'studio'], { env });
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /no tests yet/);

    const json = runRebeep(['test', 'run', '--suite', 'studio', '--json'], { env });
    assert.deepEqual(JSON.parse(json.stdout).data.suites, [{ suite: 'studio', ok: true, programs: [] }]);
  });

  test('the tools suite and all are refused inside a node test (recursion guard)', () => {
    const root = makeTempDir('rebeep-guard-tests-');
    dirs.push(root);
    for (const suite of ['tools', 'all']) {
      const result = runRebeep(['test', 'run', '--suite', suite], {
        env: { NODE_TEST_CONTEXT: 'child-v8', REBEEP_REPO_ROOT: root },
      });
      assert.equal(result.code, 1, suite);
      assert.match(result.stderr, /recursion guard/, suite);
    }
  });
});

describe('test run --suite interpreter, with fake NASM and DOSBox-X', () => {
  let fakes;
  let base;
  let root;
  let logCount = 0;

  before(() => {
    fakes = makeTempDir('rebeep-fakes-');
    fs.writeFileSync(path.join(fakes, 'fake-nasm.mjs'), FAKE_NASM);
    fs.writeFileSync(path.join(fakes, 'fake-dosbox.mjs'), FAKE_DOSBOX);
    // A folder with a space in its name, so the MOUNT argument must be quoted to work.
    base = makeTempDir('rebeep-interp-');
    root = path.join(base, 'repo with space');
    fs.mkdirSync(path.join(root, 'tests', 'interpreter'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'include'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', version: '0.1.0' }));
    fs.writeFileSync(path.join(root, 'tests', 'interpreter', 't_add.asm'), 'org 100h\n');
  });

  after(() => {
    removeDir(fakes);
    removeDir(base);
  });

  const runInterp = (results, args = ['test', 'run', '--suite', 'interpreter']) => {
    const resultFile = path.join(fakes, `result-${++logCount}.txt`);
    const log = path.join(fakes, `dosbox-${logCount}.log`);
    fs.writeFileSync(resultFile, results);
    const result = runRebeep(args, {
      env: {
        REBEEP_REPO_ROOT: root,
        REBEEP_NASM: process.execPath,
        REBEEP_NASM_PREFIX_ARGS: JSON.stringify([path.join(fakes, 'fake-nasm.mjs')]),
        REBEEP_DOSBOX: process.execPath,
        REBEEP_DOSBOX_PREFIX_ARGS: JSON.stringify([path.join(fakes, 'fake-dosbox.mjs')]),
        FAKE_DOSBOX_RESULT_FILE: resultFile,
        FAKE_DOSBOX_LOG: log,
      },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    return { result, calls };
  };

  test('runs DOSBox-X with a quoted MOUNT on a folder with a space, and passes when all cases pass', () => {
    const { result, calls } = runInterp('PASS add\r\nPASS sub\r\nDONE 2\r\n');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /interpreter tests passed/);
    const out = path.join(root, 'build', 'tests');
    assert.ok(calls[0].includes(`MOUNT C "${out}"`), JSON.stringify(calls[0]));
    assert.ok(calls[0].includes('T_ADD.COM > RESULT.TXT'));
  });

  test('a FAIL line fails the run and names an unnamed case', () => {
    const { result } = runInterp('PASS add\nfail: expected 3\nDONE 2\n');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /T_ADD: \(unnamed\): expected 3/);
  });

  test('a program with no final DONE line fails, even with PASS lines', () => {
    const { result } = runInterp('PASS add\n');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no final DONE line/);
  });
});

describe('test run --suite studio, with fake Open Watcom and DOSBox-X', () => {
  let fakes;
  let base;
  let root;
  let logCount = 0;

  before(() => {
    fakes = makeTempDir('rebeep-studio-fakes-');
    fs.writeFileSync(path.join(fakes, 'fake-wcl.mjs'), FAKE_WCL);
    fs.writeFileSync(path.join(fakes, 'fake-dosbox.mjs'), FAKE_DOSBOX);
    base = makeTempDir('rebeep-studio-');
    root = path.join(base, 'repo with space');
    const put = (rel, text) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    };
    put('package.json', JSON.stringify({ name: 'x', version: '0.1.0' }));
    put('tests/studio/T_ALPHA.C', '/* SUITE: OPL2 */\nint main(void) { return 0; }\n');
    put('tests/studio/T_BETA.C', '/* no suite marker */\nint main(void) { return 0; }\n');
    put('tests/studio/testlib.c', '/* library */\n');
    put('tests/studio/testlib.h', '/* header */\n');
    for (const name of ['video.c', 'main.c', 'dos.c']) put(`src/studio/${name}`, '/* module */\n');
    put('src/studio/data/FACTORY/ORGAN.RBP', 'patch');
    put('src/studio/data/SPLASH.ANS', 'art');
    put(
      'src/targets.json',
      JSON.stringify({
        targets: [],
        files: [
          { source: 'studio/data/SPLASH.ANS', deploy: 'REBEEP' },
          { source: 'studio/data/FACTORY/ORGAN.RBP', deploy: 'REBEEP/FACTORY' },
        ],
      }),
    );
  });

  after(() => {
    removeDir(fakes);
    removeDir(base);
  });

  /** Runs the suite; `results` is the RESULT.TXT the fake DOSBox-X writes, or null for none. */
  const runStudio = (results, extraEnv = {}) => {
    const n = ++logCount;
    const resultFile = path.join(fakes, `result-${n}.txt`);
    fs.writeFileSync(resultFile, results ?? '');
    const dosboxLog = path.join(fakes, `dosbox-${n}.log`);
    const wclLog = path.join(fakes, `wcl-${n}.log`);
    const listing = path.join(fakes, `listing-${n}.txt`);
    const result = runRebeep(['test', 'run', '--suite', 'studio'], {
      env: {
        REBEEP_REPO_ROOT: root,
        REBEEP_WATCOM: process.execPath,
        REBEEP_WATCOM_PREFIX_ARGS: JSON.stringify([path.join(fakes, 'fake-wcl.mjs')]),
        REBEEP_DOSBOX: process.execPath,
        REBEEP_DOSBOX_PREFIX_ARGS: JSON.stringify([path.join(fakes, 'fake-dosbox.mjs')]),
        FAKE_DOSBOX_RESULT_FILE: results === null ? '' : resultFile,
        FAKE_DOSBOX_LOG: dosboxLog,
        FAKE_DOSBOX_LISTING: listing,
        FAKE_WCL_LOG: wclLog,
        ...extraEnv,
      },
    });
    const lines = (file) =>
      fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    return {
      result,
      dosbox: lines(dosboxLog),
      wcl: lines(wclLog),
      factory: fs.existsSync(listing) ? fs.readFileSync(listing, 'utf8') : null,
    };
  };

  test('compiles each program with testlib and the modules but main.c, stages FACTORY, and passes', () => {
    const { result, wcl, factory } = runStudio('PASS one\nDONE 1\n');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /studio tests passed/);

    assert.equal(wcl.length, 2);
    const [alpha, beta] = wcl;
    for (const args of wcl) {
      for (const flag of ['-bt=dos', '-mm', '-0']) assert.ok(args.includes(flag), flag);
      assert.ok(args.includes(`-i=${path.join('..', '..', 'tests', 'studio')}`), 'tests/studio is on the include path');
      assert.ok(args.some((a) => a.endsWith('testlib.c')));
      assert.ok(args.some((a) => a.endsWith('video.c')) && args.some((a) => a.endsWith('dos.c')));
      assert.ok(!args.some((a) => a.endsWith('main.c')), 'main.c is not linked into a test');
      assert.ok(!args.some((a) => a.includes(root)), 'no absolute repo path reaches wcl');
    }
    assert.ok(alpha.includes('-fe=T_ALPHA.EXE') && alpha.some((a) => a.endsWith('T_ALPHA.C')));
    assert.ok(beta.includes('-fe=T_BETA.EXE'));
    assert.equal(factory, 'ORGAN.RBP', 'only the REBEEP/FACTORY data files are staged');
  });

  test('a SUITE: OPL2 program runs a second time as an OPL2 card with /OPL2; others run once', () => {
    const { dosbox } = runStudio('PASS one\nDONE 1\n');
    const out = path.join(root, 'build', 'studio-tests');
    assert.equal(dosbox.length, 3);
    const [alphaDefault, alphaOpl2, beta] = dosbox;
    assert.ok(alphaDefault.includes(`MOUNT C "${out}"`));
    assert.ok(alphaDefault.includes('T_ALPHA.EXE > RESULT.TXT'));
    assert.ok(!alphaDefault.includes('sblaster,oplmode=opl2'));
    assert.ok(alphaOpl2.includes('sblaster,oplmode=opl2'));
    assert.ok(alphaOpl2.includes('T_ALPHA.EXE /OPL2 > RESULT.TXT'));
    assert.ok(beta.includes('T_BETA.EXE > RESULT.TXT'));
    assert.ok(beta.includes('mixer,nosound=true') && beta.includes('-exit'));
  });

  test('a FAIL line fails the suite and names the program and case; the OPL2 run is judged on its own', () => {
    const { result } = runStudio('PASS one\nFAIL two: got 3, want 4\nDONE 2\n');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /T_ALPHA: two: got 3, want 4/);
    assert.match(result.stderr, /T_ALPHA \(OPL2\): two: got 3, want 4/);
    assert.match(result.stderr, /studio tests failed/);
  });

  test('a program that wrote no RESULT.TXT fails', () => {
    const { result } = runStudio(null);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /T_BETA: no RESULT\.TXT written/);
  });

  test('a compile error stops the suite with the compiler message', () => {
    const { result, dosbox } = runStudio('PASS one\nDONE 1\n', { FAKE_WCL_FAIL: 'T_ALPHA.C(3): Error! E1009' });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /wcl failed building T_ALPHA\.EXE/);
    assert.match(result.stderr, /E1009/);
    assert.deepEqual(dosbox, []);
  });
});
