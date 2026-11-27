import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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
 * A fake DOSBox-X: prints a line naming its command, appends one line to FAKE_DOSBOX_LOG (its arguments, the SDL drivers
 * it got and the files under FACTORY in the folder mounted as C:), then copies FAKE_DOSBOX_RESULT_FILE into that folder as
 * RESULT.TXT, which is what a DOS program would have written. With FAKE_DOSBOX_GATE, a run of the program FAKE_DOSBOX_HOLD
 * names finishes only after a run of another program has; if none does in 15 s, it writes no result. With
 * FAKE_DOSBOX_EVENTS it appends "start <command>" and "end <command>" there, FAKE_DOSBOX_DELAY ms or more apart.
 */
const FAKE_DOSBOX = `import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const command = args[args.length - 1];
const mount = args.find((a) => a.startsWith('MOUNT C '));
const dir = mount.slice('MOUNT C '.length).replace(/^"|"$/g, '');
const { FAKE_DOSBOX_GATE: gate, FAKE_DOSBOX_HOLD: hold } = process.env;
const held = Boolean(gate) && command.startsWith(hold + ' ');
const { FAKE_DOSBOX_EVENTS: events, FAKE_DOSBOX_DELAY: delay } = process.env;
const event = (what) => events && fs.appendFileSync(events, what + ' ' + command.split(' > ')[0] + '\\n');
event('start');
if (delay) await new Promise((r) => setTimeout(r, Number(delay)));
let result = process.env.FAKE_DOSBOX_RESULT_FILE;
if (held) {
  const until = Date.now() + 15000;
  while (!fs.existsSync(gate) && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
  if (!fs.existsSync(gate)) result = '';
}
console.log('dosbox ran ' + command);
const root = path.join(dir, 'FACTORY');
const factory = fs.existsSync(root)
  ? fs.readdirSync(root, { recursive: true }).filter((n) => fs.statSync(path.join(root, n)).isFile())
  : [];
fs.appendFileSync(process.env.FAKE_DOSBOX_LOG, JSON.stringify({
  args,
  drivers: [process.env.SDL_VIDEODRIVER, process.env.SDL_AUDIODRIVER],
  factory: factory.map((n) => n.split(path.sep).join('/')).sort().join(','),
}) + '\\n');
if (result) fs.copyFileSync(result, path.join(dir, 'RESULT.TXT'));
if (gate && !held) fs.writeFileSync(gate, '');
event('end');
`;

/** A repo's factory defaults for the fake suites, one patch and one profile, and what a test program finds of them. */
const FACTORY_SOURCES = {
  'factory/patches/ORGAN.RBP': 'REBEEP/FACTORY/PATCHES',
  'factory/profiles/DEMO/DEMO.RBG': 'REBEEP/FACTORY/PROFILES/DEMO',
};
const FACTORY_STAGED = 'PATCHES/ORGAN.RBP,PROFILES/DEMO/DEMO.RBG';
const factoryFiles = Object.entries(FACTORY_SOURCES).map(([source, deploy]) => ({ source, deploy }));
const putFactory = (root) => {
  for (const source of Object.keys(FACTORY_SOURCES)) {
    const file = path.join(root, 'src', source);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `contents of ${path.basename(file)}`);
  }
};

/** The JSON lines a fake tool appended to `file`; none when it never ran. */
const logLines = (file) =>
  fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

/** The logged DOSBox-X call that ran `command` (`T_ADD.COM`, `T_ALPHA.EXE /OPL2`). */
const callOf = (calls, command) => {
  const found = calls.find((c) => c.args.includes(`${command} > RESULT.TXT`));
  assert.ok(found, `no DOSBox-X run of ${command}`);
  return found;
};

const textLines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);

/** The most DOSBox-X runs going at once, from the fake's start and end lines. */
const mostAtOnce = (events) => {
  let running = 0;
  return Math.max(...events.map((line) => (running += line.startsWith('start ') ? 1 : -1)));
};

const programNames = (stdout) => {
  const parsed = JSON.parse(stdout);
  return (parsed.data ?? parsed.error.data).suites[0].programs.map((p) => p.program);
};

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

  test('--jobs is refused for the tools and vm suites, and for anything but a whole number from 1 up', () => {
    const root = makeTempDir('rebeep-jobs-tests-');
    dirs.push(root);
    const run = (...args) => runRebeep(['test', 'run', ...args], { env: { REBEEP_REPO_ROOT: root } });
    for (const suite of ['tools', 'vm']) {
      const result = run('--suite', suite, '--jobs', '2');
      assert.equal(result.code, 2, suite);
      assert.match(result.stderr, /--jobs only applies to the interpreter and studio suites/, suite);
    }
    for (const value of ['0', 'two', '1.5', '', '04']) {
      const result = run('--suite', 'interpreter', `--jobs=${value}`);
      assert.equal(result.code, 2, value);
      assert.match(result.stderr, /--jobs must be a whole number from 1 up/, value);
    }
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
    fs.writeFileSync(path.join(root, 'tests', 'interpreter', 't_sub.asm'), 'org 100h\n');
    putFactory(root);
    fs.writeFileSync(path.join(root, 'src', 'targets.json'), JSON.stringify({ targets: [], files: factoryFiles }));
  });

  after(() => {
    removeDir(fakes);
    removeDir(base);
  });

  const runInterp = (results, args = [], extraEnv = {}) => {
    const resultFile = path.join(fakes, `result-${++logCount}.txt`);
    const log = path.join(fakes, `dosbox-${logCount}.log`);
    fs.writeFileSync(resultFile, results);
    const result = runRebeep(['test', 'run', '--suite', 'interpreter', ...args], {
      env: {
        REBEEP_REPO_ROOT: root,
        REBEEP_NASM: process.execPath,
        REBEEP_NASM_PREFIX_ARGS: JSON.stringify([path.join(fakes, 'fake-nasm.mjs')]),
        REBEEP_DOSBOX: process.execPath,
        REBEEP_DOSBOX_PREFIX_ARGS: JSON.stringify([path.join(fakes, 'fake-dosbox.mjs')]),
        FAKE_DOSBOX_RESULT_FILE: resultFile,
        FAKE_DOSBOX_LOG: log,
        ...extraEnv,
      },
    });
    return { result, calls: logLines(log) };
  };

  test('each program runs in its own folder, mounted quoted on a path with a space, and passes when all cases pass', () => {
    const { result, calls } = runInterp('PASS add\r\nPASS sub\r\nDONE 2\r\n');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /interpreter tests passed/);
    assert.equal(calls.length, 2);
    for (const name of ['T_ADD', 'T_SUB']) {
      const folder = path.join(root, 'build', 'tests', name);
      const call = callOf(calls, `${name}.COM`);
      assert.ok(call.args.includes(`MOUNT C "${folder}"`), JSON.stringify(call.args));
      assert.ok(fs.existsSync(path.join(folder, `${name}.COM`)), name);
    }
  });

  test('stages the factory patches and profiles under FACTORY beside each program', () => {
    const { result, calls } = runInterp('PASS add\nDONE 1\n');
    assert.equal(result.code, 0, result.stderr);
    for (const call of calls) assert.equal(call.factory, FACTORY_STAGED);
    for (const name of ['T_ADD', 'T_SUB']) {
      const file = path.join(root, 'build', 'tests', name, 'FACTORY', 'PROFILES', 'DEMO', 'DEMO.RBG');
      assert.equal(fs.readFileSync(file, 'utf8'), 'contents of DEMO.RBG');
    }
  });

  test('every run is headless on any host, starts fast and runs at full speed', () => {
    const { result, calls } = runInterp('PASS add\nDONE 1\n', [], { SDL_VIDEODRIVER: 'windows', SDL_AUDIODRIVER: 'directsound' });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(calls.length, 2);
    for (const { args, drivers } of calls) {
      assert.deepEqual(drivers, ['dummy', 'dummy']);
      assert.ok(args.includes('-fastlaunch'));
      assert.equal(args[args.indexOf('cpu cycles=max') - 1], '-set', 'one argument after -set');
    }
  });

  test('--jobs 4 runs programs at once and reports them in their order, whichever finishes first', () => {
    const gate = path.join(fakes, 'interp-gate');
    const { result } = runInterp('PASS add\nDONE 1\n', ['--jobs', '4', '--json'], {
      FAKE_DOSBOX_GATE: gate,
      FAKE_DOSBOX_HOLD: 'T_ADD.COM',
    });
    assert.equal(result.code, 0, result.stdout);
    assert.deepEqual(programNames(result.stdout), ['T_ADD', 'T_SUB']);
  });

  test('no more programs run at once than --jobs says, and no more than 4 without it', () => {
    const extra = [1, 2, 3, 4].map((n) => path.join(root, 'tests', 'interpreter', `t_more${n}.asm`));
    for (const file of extra) fs.writeFileSync(file, 'org 100h\n');
    try {
      const cases = [[['--jobs', '1'], 1], [[], Math.min(4, os.availableParallelism())]];
      for (const [i, [args, most]] of cases.entries()) {
        const events = path.join(fakes, `events-jobs-${i}.log`);
        const { result } = runInterp('PASS add\nDONE 1\n', args, { FAKE_DOSBOX_EVENTS: events, FAKE_DOSBOX_DELAY: '300' });
        assert.equal(result.code, 0, result.stderr);
        assert.equal(textLines(events).length, 12, 'six programs ran');
        const peak = mostAtOnce(textLines(events));
        assert.ok(peak <= most, `${args.join(' ') || 'by default'}: ${peak} at once, over ${most}`);
      }
    } finally {
      for (const file of extra) fs.rmSync(file);
    }
  });

  test("--jobs 1 streams DOSBox-X's output; above 1 only a failed run's is printed", () => {
    const streamed = runInterp('PASS add\nDONE 1\n', ['--jobs', '1']);
    assert.equal(streamed.result.code, 0, streamed.result.stderr);
    assert.match(streamed.result.stdout, /dosbox ran T_ADD\.COM/);

    const quiet = runInterp('PASS add\nDONE 1\n', ['--jobs', '2']);
    assert.equal(quiet.result.code, 0, quiet.result.stderr);
    assert.doesNotMatch(quiet.result.stdout, /dosbox ran/);

    const failed = runInterp('FAIL add: no\nDONE 1\n', ['--jobs', '2']);
    assert.equal(failed.result.code, 1);
    assert.match(failed.result.stdout, /dosbox ran T_ADD\.COM/);
    assert.match(failed.result.stdout, /dosbox ran T_SUB\.COM/);
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
    putFactory(root);
    put('src/studio/data/SPLASH.ANS', 'art');
    put(
      'src/targets.json',
      JSON.stringify({ targets: [], files: [{ source: 'studio/data/SPLASH.ANS', deploy: 'REBEEP' }, ...factoryFiles] }),
    );
  });

  after(() => {
    removeDir(fakes);
    removeDir(base);
  });

  /** Runs the suite; `results` is the RESULT.TXT the fake DOSBox-X writes, or null for none. */
  const runStudio = (results, extraEnv = {}, args = []) => {
    const n = ++logCount;
    const resultFile = path.join(fakes, `result-${n}.txt`);
    fs.writeFileSync(resultFile, results ?? '');
    const dosboxLog = path.join(fakes, `dosbox-${n}.log`);
    const wclLog = path.join(fakes, `wcl-${n}.log`);
    const result = runRebeep(['test', 'run', '--suite', 'studio', ...args], {
      env: {
        REBEEP_REPO_ROOT: root,
        REBEEP_WATCOM: process.execPath,
        REBEEP_WATCOM_PREFIX_ARGS: JSON.stringify([path.join(fakes, 'fake-wcl.mjs')]),
        REBEEP_DOSBOX: process.execPath,
        REBEEP_DOSBOX_PREFIX_ARGS: JSON.stringify([path.join(fakes, 'fake-dosbox.mjs')]),
        FAKE_DOSBOX_RESULT_FILE: results === null ? '' : resultFile,
        FAKE_DOSBOX_LOG: dosboxLog,
        FAKE_WCL_LOG: wclLog,
        ...extraEnv,
      },
    });
    return { result, calls: logLines(dosboxLog), wcl: logLines(wclLog) };
  };

  test('compiles each program with testlib and the modules but main.c into its own folder, and passes', () => {
    const { result, wcl, calls } = runStudio('PASS one\nDONE 1\n');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /studio tests passed/);

    assert.equal(wcl.length, 2);
    for (const args of wcl) {
      for (const flag of ['-bt=dos', '-mm', '-0']) assert.ok(args.includes(flag), flag);
      assert.ok(args.includes(`-i=${path.join('..', '..', '..', 'tests', 'studio')}`), 'tests/studio is on the include path');
      assert.ok(args.some((a) => a.endsWith('testlib.c')));
      assert.ok(args.some((a) => a.endsWith('video.c')) && args.some((a) => a.endsWith('dos.c')));
      assert.ok(!args.some((a) => a.endsWith('main.c')), 'main.c is not linked into a test');
      assert.ok(!args.some((a) => a.includes(root)), 'no absolute repo path reaches wcl');
    }
    for (const name of ['T_ALPHA', 'T_BETA']) {
      const args = wcl.find((a) => a.includes(`-fe=${name}.EXE`));
      assert.ok(args?.some((a) => a.endsWith(`${name}.C`)), name);
      const folder = path.join(root, 'build', 'studio-tests', name);
      for (const file of [`${name}.EXE`, path.join('gen', 'version.h')]) {
        assert.ok(fs.existsSync(path.join(folder, file)), `${name}: ${file}`);
      }
    }
    for (const call of calls) assert.equal(call.factory, FACTORY_STAGED, 'only the factory files are staged');
  });

  test('a SUITE: OPL2 program runs a second time as an OPL2 card with /OPL2; others run once', () => {
    const events = path.join(fakes, 'events-in-turn.log');
    const { calls } = runStudio(
      'PASS one\nDONE 1\n',
      { FAKE_DOSBOX_EVENTS: events, FAKE_DOSBOX_DELAY: '300' },
      ['--jobs', '4'],
    );
    const out = path.join(root, 'build', 'studio-tests');
    assert.equal(calls.length, 3);
    const alphaDefault = callOf(calls, 'T_ALPHA.EXE');
    const alphaOpl2 = callOf(calls, 'T_ALPHA.EXE /OPL2');
    const beta = callOf(calls, 'T_BETA.EXE');
    const order = textLines(events);
    assert.ok(order.indexOf('end T_ALPHA.EXE') < order.indexOf('start T_ALPHA.EXE /OPL2'), "one program's runs are in turn");
    for (const call of [alphaDefault, alphaOpl2]) assert.ok(call.args.includes(`MOUNT C "${path.join(out, 'T_ALPHA')}"`));
    assert.ok(beta.args.includes(`MOUNT C "${path.join(out, 'T_BETA')}"`));
    assert.ok(!alphaDefault.args.includes('sblaster oplmode=opl2'));
    assert.ok(alphaOpl2.args.includes('sblaster oplmode=opl2'), 'one argument: DOSBox-X ignores the comma form');
    assert.ok(beta.args.includes('mixer nosound=true') && beta.args.includes('-exit'));
    for (const call of calls) {
      assert.ok(call.args.includes('-fastlaunch') && call.args.includes('cpu cycles=max'));
      assert.deepEqual(call.drivers, ['dummy', 'dummy']);
    }
  });

  test('--jobs 4 reports the programs in their order, whichever finishes first', () => {
    const gate = path.join(fakes, 'studio-gate');
    const { result } = runStudio(
      'PASS one\nDONE 1\n',
      { FAKE_DOSBOX_GATE: gate, FAKE_DOSBOX_HOLD: 'T_ALPHA.EXE' },
      ['--jobs', '4', '--json'],
    );
    assert.equal(result.code, 0, result.stdout);
    assert.deepEqual(programNames(result.stdout), ['T_ALPHA', 'T_ALPHA (OPL2)', 'T_BETA']);
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

  test('a compile error stops the suite with the compiler message: nothing more is built or run', () => {
    const failing = { FAKE_WCL_FAIL: 'T_ALPHA.C(3): Error! E1009' };
    const { result, calls, wcl } = runStudio('PASS one\nDONE 1\n', failing, ['--jobs', '1']);
    assert.equal(wcl.length, 1, 'T_BETA is not compiled once T_ALPHA failed');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /wcl failed building T_ALPHA\.EXE/);
    assert.match(result.stderr, /E1009/);
    assert.deepEqual(calls, []);
  });
});
