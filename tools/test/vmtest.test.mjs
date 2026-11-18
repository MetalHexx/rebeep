import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { evaluateResults, parseResults, vmProbes } from '../commands/test.mjs';
import { deliveryFor } from '../commands/disk.mjs';
import { readImage, toCrlf } from '../lib/fat.mjs';
import { repoLayout } from '../lib/paths.mjs';
import { composeProbeDelivery, parseProbeHeader } from '../lib/vmtest.mjs';
import { alive, seedEnv, waitFor, writeFile } from './vmenv.mjs';

const VM = 'mirror-freedos';
const REAL_ENV = repoLayout().env;

describe('parseProbeHeader', () => {
  test('defaults: mirror-freedos, 150 seconds, no floppy, no reset', () => {
    assert.deepEqual(parseProbeHeader('@ECHO OFF\r\nREM VM-TIMEOUT: 5\r\n'), {
      vm: VM,
      timeout: 150,
      floppy: null,
      reset: false,
    });
  });

  test('reads every directive from the leading REM lines, and fills in {version}', () => {
    const text = [
      'REM Some notes',
      'rem vm: mirror-freedos',
      'REM VM-TIMEOUT: 30',
      'REM VM-FLOPPY: build/release/rebeep-{version}.img',
      'REM VM-RESET',
      '@ECHO OFF',
      'REM VM-TIMEOUT: 1',
    ].join('\r\n');
    assert.deepEqual(parseProbeHeader(text, { version: '1.2.3' }), {
      vm: VM,
      timeout: 30,
      floppy: 'build/release/rebeep-1.2.3.img',
      reset: true,
    });
  });

  test('rejects another VM, a bad timeout, and a floppy outside the repo', () => {
    assert.throws(() => parseProbeHeader('REM VM: mirror-msdos\r\n'), /only on mirror-freedos/);
    assert.throws(() => parseProbeHeader('REM VM-TIMEOUT: soon\r\n'), /VM-TIMEOUT/);
    assert.throws(() => parseProbeHeader('REM VM-TIMEOUT: 0\r\n'), /VM-TIMEOUT/);
    assert.throws(() => parseProbeHeader('REM VM-FLOPPY: ../x.img\r\n'), /inside the repo/);
  });
});

describe('result evaluation', () => {
  test('a bare DONE passes only when bare DONE is allowed; a counted DONE must match', () => {
    const text = 'PASS a\r\nnote 12 ms\r\nPASS b\r\nDONE\r\n';
    assert.equal(parseResults(text).done, 'bare');
    assert.deepEqual(evaluateResults(text, { bareDone: true }), { ok: true, problem: null, passed: ['a', 'b'], failed: [] });
    assert.match(evaluateResults(text).problem, /no final DONE/);

    assert.equal(evaluateResults('PASS a\nPASS b\nDONE 2\n', { bareDone: true }).ok, true);
    assert.match(evaluateResults('PASS a\nPASS b\nDONE 3\n', { bareDone: true }).problem, /DONE 3 but 2/);
    assert.equal(evaluateResults('PASS a\nPASS b\nDONE 2\n').ok, true);
  });

  test('a FAIL line, no results, or a missing DONE fail the probe', () => {
    assert.equal(evaluateResults('PASS a\nFAIL b: broke\nDONE\n', { bareDone: true }).ok, false);
    assert.match(evaluateResults('DONE\n', { bareDone: true }).problem, /no results/);
    assert.match(evaluateResults('PASS a\n', { bareDone: true }).problem, /no final DONE/);
  });
});

describe('probe D: composition', () => {
  let s;
  let tests;
  beforeEach(() => {
    s = seedEnv('rebeep-vmtest-');
    tests = path.join(s.tmp, 'tests');
  });
  afterEach(() => s.cleanup());

  test('replaces only ENV/BOOT.BAT with the CRLF probe and adds tests/vm under TESTS/', () => {
    writeFile(path.join(tests, 'vm', 'P_ONE.BAT'), 'REM one\nECHO hi\n');
    writeFile(path.join(tests, 'vm', 'NOTES.TXT'), 'a\nb\n');
    writeFile(path.join(tests, 'vm', 'DATA.BIN'), Buffer.from([1, 10, 2]));
    const ctx = { paths: s.paths, repo: { ...repoLayout(), tests }, env: s.env };
    const probe = Buffer.from('REM probe\nECHO probe\n');

    const normal = deliveryFor(ctx, [VM]);
    const composed = composeProbeDelivery(ctx, VM, probe);
    const byPath = (c) => new Map(c.files.map((f) => [f.path, f]));
    const before = byPath(normal);
    const after = byPath(composed);

    assert.deepEqual(after.get('ENV/BOOT.BAT').bytes, toCrlf(probe));
    assert.equal(after.get('ENV/BOOT.BAT').size, toCrlf(probe).length);
    assert.deepEqual(after.get('TESTS/P_ONE.BAT').bytes, Buffer.from('REM one\r\nECHO hi\r\n'));
    assert.deepEqual(after.get('TESTS/NOTES.TXT').bytes, Buffer.from('a\r\nb\r\n'));
    assert.deepEqual(after.get('TESTS/DATA.BIN').bytes, Buffer.from([1, 10, 2]));
    assert.ok(composed.dirs.includes('TESTS'));

    for (const [p, file] of before) {
      if (p !== 'ENV/BOOT.BAT') assert.equal(after.get(p)?.size, file.size, `${p} is unchanged`);
    }
    const added = [...after.keys()].filter((p) => !before.has(p));
    assert.deepEqual(added.sort(), ['TESTS/DATA.BIN', 'TESTS/NOTES.TXT', 'TESTS/P_ONE.BAT']);
    assert.deepEqual(composed.warnings, normal.warnings);
  });
});

describe('test run --suite vm (fake 86Box)', () => {
  let s;
  let root;
  const probes = (files) => {
    for (const [name, text] of Object.entries(files)) writeFile(path.join(root, 'tests', 'vm', name), text);
  };
  const resultFile = (text) => {
    const file = path.join(s.tmp, 'result.txt');
    fs.writeFileSync(file, text);
    s.env.FAKE86BOX_RESULT_FILE = file;
  };
  const run = (...extra) => s.json('test', 'run', '--suite', 'vm', '--skip-build', ...extra);
  const dImage = () => readImage(fs.readFileSync(s.paths.vm(VM).dImg));
  const programs = (r) => (r.envelope.data.suites ?? [r.envelope.data]).flatMap((x) => x.programs ?? []);

  beforeEach(() => {
    s = seedEnv('rebeep-vmrun-');
    root = path.join(s.tmp, 'repo');
    fs.cpSync(REAL_ENV, path.join(root, 'env', '86box'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    s.env.REBEEP_REPO_ROOT = root;
    const builder = path.join(s.tmp, 'builder.mjs');
    fs.writeFileSync(builder, 'export async function buildFreedosC() {\n  return { image: Buffer.from("c") };\n}\n');
    s.env.REBEEP_FREEDOS_BUILDER = builder;
    const created = s.rebeep('vm', 'create', VM);
    assert.equal(created.code, 0, created.stderr);
  });
  afterEach(() => s.cleanup());

  test('a probe that writes RESULT.TXT and exits passes, keeps every line, and leaves the normal D: behind', () => {
    probes({ 'P_OK.BAT': 'REM VM: mirror-freedos\r\nECHO probe\r\n' });
    resultFile('PASS one\r\nbench 123 ms\r\nPASS two\r\nDONE\r\n');
    const r = run();
    assert.equal(r.code, 0, r.stderr);
    const [probe] = programs(r);
    assert.equal(probe.program, 'P_OK');
    assert.equal(probe.ok, true);
    assert.deepEqual(probe.passed, ['one', 'two']);
    assert.deepEqual(probe.lines, ['PASS one', 'bench 123 ms', 'PASS two', 'DONE']);

    const image = dImage();
    assert.equal(image.exists('RESULT.TXT'), false);
    assert.equal(image.exists('TESTS'), false);
    const normalBoot = toCrlf(fs.readFileSync(path.join(root, 'env', '86box', 'dos', 'common', 'BOOT.BAT')));
    assert.deepEqual(image.readFile('ENV/BOOT.BAT'), normalBoot);
    assert.equal(fs.existsSync(s.paths.vm(VM).pid), false);
  });

  test('a FAIL line fails the run with exit 1 and the probe in the error data', () => {
    probes({ 'P_BAD.BAT': 'REM x\r\n' });
    resultFile('PASS one\r\nFAIL two: broke\r\nDONE\r\n');
    const r = run('--probe', 'p_bad');
    assert.equal(r.code, 1);
    const [probe] = programs(r);
    assert.equal(probe.ok, false);
    assert.deepEqual(probe.failed, [{ name: 'two', detail: 'broke' }]);
  });

  test('a probe that never powers off is killed at its timeout, fails, and the normal D: is restored', async () => {
    probes({ 'P_HANG.BAT': 'REM VM-TIMEOUT: 1\r\nECHO hang\r\n' });
    const r = run();
    assert.equal(r.code, 1);
    const [probe] = programs(r);
    assert.equal(probe.ok, false);
    assert.equal(probe.problem, 'timed out');

    const { pid } = await s.fakeRecord();
    await waitFor(() => !alive(pid), { what: 'the hung fake to be killed' });
    assert.equal(fs.existsSync(s.paths.vm(VM).pid), false);
    assert.equal(dImage().exists('TESTS'), false);
  });

  test('a probe that exits without RESULT.TXT fails', () => {
    probes({ 'P_NONE.BAT': 'REM x\r\n' });
    s.env.FAKE86BOX_RESULT_FILE = path.join(s.tmp, 'no-such-result.txt');
    const r = run();
    assert.equal(r.code, 1);
    assert.match(programs(r)[0].problem, /no RESULT.TXT written/);
  });

  test('every probe runs in name order when none is named', () => {
    probes({ 'P_B.BAT': 'REM b\r\n', 'P_A.BAT': 'REM a\r\n', 'NOT_ONE.BAT': 'REM c\r\n' });
    assert.deepEqual(vmProbes(root), ['P_A.BAT', 'P_B.BAT']);
    resultFile('PASS x\r\nDONE\r\n');
    const r = run();
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(programs(r).map((p) => p.program), ['P_A', 'P_B']);
  });

  test('a non-FreeDOS VM, an unknown probe, a missing floppy and VM-RESET without a baseline are CliErrors', () => {
    probes({
      'P_MSDOS.BAT': 'REM VM: mirror-msdos\r\n',
      'P_FLOP.BAT': 'REM VM-FLOPPY: build/release/none-{version}.img\r\n',
      'P_RESET.BAT': 'REM VM-RESET\r\n',
    });
    const msdos = run('--probe', 'P_MSDOS');
    assert.equal(msdos.code, 1);
    assert.match(msdos.envelope.error.message, /only on mirror-freedos/);

    const unknown = run('--probe', 'P_NOPE');
    assert.equal(unknown.code, 1);
    assert.match(unknown.envelope.error.message, /no probe named/);

    const floppy = run('--probe', 'P_FLOP');
    assert.equal(floppy.code, 1);
    assert.match(floppy.envelope.error.message, /none-1\.2\.3\.img/);
    assert.match(floppy.envelope.error.hint, /rebeep release create/);

    const reset = run('--probe', 'P_RESET');
    assert.equal(reset.code, 1);
    assert.match(reset.envelope.error.message, /no baseline/);
    assert.equal(dImage().exists('TESTS'), false);
  });

  test('--probe and --skip-build are refused for other suites', () => {
    const r = s.json('test', 'run', '--suite', 'interpreter', '--probe', 'P_X');
    assert.equal(r.code, 1);
    assert.match(r.envelope.error.message, /only apply to --suite vm/);
  });
});
