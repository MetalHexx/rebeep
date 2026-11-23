import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../lib/cli.mjs';
import { assemble, resolveBinary, runProcess, runTool } from '../lib/nasm.mjs';
import { evaluateResults, interpreterPrograms, RESULT_FILE, studioPrograms, toolTestFiles, vmProbes } from '../lib/suites.mjs';
import { compileExe, resolveWatcom } from '../lib/watcom.mjs';
import { loadDataFiles, readPackageVersion } from './build.mjs';
import { runVmSuite } from './vmtest.mjs';

const TOOLS_GLOB = 'tools/test/**/*.test.mjs';
const DOS_NAME = /^[A-Z0-9_]{1,8}$/;
const DOSBOX_TIME_LIMIT_S = 60;
const DOSBOX_TIMEOUT_MS = 120_000;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const OPL2_MARKER = /^\s*\/\*\s*SUITE:\s*OPL2\s*\*\//;
/** The data-file folder that studio tests can read as FACTORY\, staged beside the programs. */
const FACTORY_DEPLOY = 'REBEEP/FACTORY';

/** Pulls the `tests`, `pass` and `fail` totals from Node's test summary. */
function tapCounts(output) {
  const counts = {};
  for (const m of output.matchAll(/^(?:#|ℹ)\s+(tests|pass|fail)\s+(\d+)\s*$/gm)) {
    counts[m[1]] = Number(m[2]);
  }
  return counts;
}

async function runTools(ctx, repo) {
  const run = await runProcess(process.execPath, ['--test', TOOLS_GLOB], {
    cwd: repo.root,
    env: ctx.env,
    echo: !ctx.json,
  });
  const counts = tapCounts(`${run.stdout}\n${run.stderr}`.replace(ANSI, ''));
  const ranNone = !counts.tests;
  return {
    suite: 'tools',
    ok: run.code === 0 && !ranNone,
    exitCode: run.code,
    problem: ranNone ? 'no tests ran' : null,
    ...counts,
  };
}

function programResult(name, run, resultFile) {
  const base = { program: name, passed: [], failed: [] };
  if (run.timedOut || run.elapsedMs >= (DOSBOX_TIME_LIMIT_S - 1) * 1000) {
    return { ...base, ok: false, problem: 'timed out' };
  }
  if (!fs.existsSync(resultFile)) {
    return { ...base, ok: false, problem: `no ${RESULT_FILE} written` };
  }
  return { program: name, ...evaluateResults(fs.readFileSync(resultFile, 'utf8')) };
}

function dosboxEnv(ctx) {
  return process.platform === 'linux'
    ? { ...ctx.env, SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy' }
    : ctx.env;
}

/**
 * Runs `command` headless in DOSBox-X with `dir` as C:, its output redirected to RESULT.TXT, and
 * judges it. `opl2` switches the emulated Sound Blaster from the default OPL3 to OPL2.
 */
async function runDosProgram(ctx, dosbox, dir, name, command, { opl2 = false } = {}) {
  const resultFile = path.join(dir, RESULT_FILE);
  fs.rmSync(resultFile, { force: true });
  const run = await runTool(dosbox, [
    '-set',
    'mixer,nosound=true', // unlike -silent, keeps the Sound Blaster and its OPL emulated
    ...(opl2 ? ['-set', 'sblaster,oplmode=opl2'] : []),
    '-exit',
    '-nogui',
    '-nomenu',
    '-time-limit',
    String(DOSBOX_TIME_LIMIT_S),
    '-c',
    `MOUNT C "${dir}"`,
    '-c',
    'C:',
    '-c',
    `${command} > ${RESULT_FILE}`,
  ], { env: dosboxEnv(ctx), echo: !ctx.json, timeoutMs: DOSBOX_TIMEOUT_MS });

  const result = programResult(name, run, resultFile);
  for (const failure of result.failed) {
    ctx.log.error(`${name}: ${failure.name}: ${failure.detail}`);
  }
  if (result.problem) ctx.log.error(`${name}: ${result.problem}`);
  return result;
}

async function runInterpreter(ctx, repo) {
  const dir = path.join(repo.tests, 'interpreter');
  const programs = interpreterPrograms(repo.root);
  if (programs.length === 0) {
    ctx.log.info('interpreter: no tests yet');
    return { suite: 'interpreter', ok: true, programs: [] };
  }

  const nasm = await resolveBinary(ctx, 'nasm', 'REBEEP_NASM');
  const dosbox = await resolveBinary(ctx, 'dosbox-x', 'REBEEP_DOSBOX');
  const version = readPackageVersion(repo);
  const out = path.join(repo.build, 'tests');
  fs.mkdirSync(out, { recursive: true });

  const results = [];
  for (const file of programs) {
    const name = file.slice(0, -'.asm'.length).toUpperCase();
    if (!DOS_NAME.test(name)) {
      throw new CliError(`${file}: DOS program names must be 8 characters or fewer`);
    }
    ctx.log.step(`Assembling ${name}.COM`);
    await assemble(nasm, {
      version,
      includes: [dir, repo.src, path.join(repo.src, 'include')],
      listing: path.join(out, `${name}.LST`),
      output: path.join(out, `${name}.COM`),
      source: path.join(dir, file),
    });

    ctx.log.step(`Running ${name}.COM in DOSBox-X`);
    results.push(await runDosProgram(ctx, dosbox, out, name, `${name}.COM`));
  }
  return { suite: 'interpreter', ok: results.every((r) => r.ok), programs: results };
}

/** Stages the shipped factory patches as `FACTORY\` in `out`, so a test program reads what players get. */
function stageFactory(repo, out) {
  const folder = path.join(out, 'FACTORY');
  fs.mkdirSync(folder, { recursive: true });
  for (const file of loadDataFiles(repo)) {
    if (file.deploy === FACTORY_DEPLOY) fs.copyFileSync(file.from, path.join(folder, file.name));
  }
}

/**
 * Compiles each `tests/studio/T_*.C` with testlib and every studio module except `main.c`, through
 * the same wrapper and flags as `build run`, and runs it in DOSBox-X. A program whose first line is
 * a `SUITE: OPL2` comment runs again with an OPL2 card and the argument `/OPL2`.
 */
async function runStudio(ctx, repo) {
  const dir = path.join(repo.tests, 'studio');
  const programs = studioPrograms(repo.root);
  if (programs.length === 0) {
    ctx.log.info('studio: no tests yet');
    return { suite: 'studio', ok: true, programs: [] };
  }

  const watcom = await resolveWatcom(ctx);
  const dosbox = await resolveBinary(ctx, 'dosbox-x', 'REBEEP_DOSBOX');
  const version = readPackageVersion(repo);
  const out = path.join(repo.build, 'studio-tests');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  stageFactory(repo, out);

  const studioDir = path.join(repo.src, 'studio');
  const modules = fs
    .readdirSync(studioDir)
    .filter((n) => /\.c$/i.test(n) && n.toLowerCase() !== 'main.c')
    .sort()
    .map((n) => path.join(studioDir, n));

  const results = [];
  for (const file of programs) {
    const name = file.slice(0, -'.C'.length).toUpperCase();
    if (!DOS_NAME.test(name)) {
      throw new CliError(`${file}: DOS program names must be 8 characters or fewer`);
    }
    ctx.log.step(`Compiling ${name}.EXE`);
    const stderr = await compileExe(watcom, {
      version,
      sources: [path.join(dir, file), path.join(dir, 'testlib.c'), ...modules],
      includes: [dir],
      output: path.join(out, `${name}.EXE`),
      objDir: path.join(out, 'obj', name),
      mapFile: path.join(out, `${name}.MAP`),
    });
    for (const line of stderr.split(/\r?\n/).filter((l) => l.trim())) {
      ctx.log.warn(`wcl (${name}): ${line.trim()}`);
    }

    ctx.log.step(`Running ${name}.EXE in DOSBox-X`);
    results.push(await runDosProgram(ctx, dosbox, out, name, `${name}.EXE`));
    const [firstLine] = fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/, 1);
    if (OPL2_MARKER.test(firstLine)) {
      ctx.log.step(`Running ${name}.EXE /OPL2 in DOSBox-X`);
      results.push(await runDosProgram(ctx, dosbox, out, `${name} (OPL2)`, `${name}.EXE /OPL2`, { opl2: true }));
    }
  }
  return { suite: 'studio', ok: results.every((r) => r.ok), programs: results };
}

async function runSuite(ctx, repo, suite) {
  ctx.log.step(`Running the ${suite} suite`);
  let result;
  if (suite === 'tools') {
    result = await runTools(ctx, repo);
  } else if (suite === 'vm') {
    result = await runVmSuite(ctx, repo, { probe: ctx.opts.probe, skipBuild: ctx.opts['skip-build'] });
  } else if (suite === 'studio') {
    result = await runStudio(ctx, repo);
  } else {
    result = await runInterpreter(ctx, repo);
  }
  if (result.ok) ctx.log.ok(`${suite} tests passed`);
  else ctx.log.error(`${suite} tests failed${result.problem ? `: ${result.problem}` : ''}`);
  return result;
}

export default {
  name: 'test',
  summary: 'Run the test suites',
  verbs: [
    {
      name: 'list',
      summary: 'List the test suites',
      args: [],
      options: [],
      destructive: false,
      examples: ['rebeep test list'],
      run: async (ctx) => {
        const tools = toolTestFiles(ctx.repo.root).length;
        const interpreter = interpreterPrograms(ctx.repo.root).length;
        const studio = studioPrograms(ctx.repo.root).length;
        const vm = vmProbes(ctx.repo.root).length;
        return {
          suites: [
            { suite: 'tools', files: tools, runs: `node --test "${TOOLS_GLOB}"` },
            {
              suite: 'interpreter',
              files: interpreter,
              runs: 'DOSBox-X runs each T_*.ASM in tests/interpreter',
            },
            {
              suite: 'studio',
              files: studio,
              runs: 'compiles each T_*.C in tests/studio with the studio modules and runs it in DOSBox-X',
            },
            {
              suite: 'vm',
              files: vm,
              runs: 'boots mirror-freedos in 86Box for each P_*.BAT in tests/vm (not part of all)',
            },
            { suite: 'all', files: tools + interpreter + studio, runs: 'tools, interpreter, then studio' },
          ],
        };
      },
      render: (data, log) =>
        log.table(data.suites, [
          { key: 'suite', label: 'suite' },
          { key: 'files', label: 'files' },
          { key: 'runs', label: 'runs' },
        ]),
    },
    {
      name: 'run',
      summary: 'Run a test suite',
      args: [],
      options: [
        {
          name: 'suite',
          type: 'string',
          valueName: 'name',
          choices: ['tools', 'interpreter', 'studio', 'vm', 'all'],
          default: 'all',
          description: 'Which suite to run (all is tools, interpreter and studio; vm opens 86Box and is run on its own)',
        },
        {
          name: 'probe',
          type: 'string',
          valueName: 'name',
          description: 'vm suite only: run just this probe, such as P_SMOKE',
        },
        {
          name: 'skip-build',
          type: 'boolean',
          description: 'vm suite only: do not run build first',
        },
      ],
      destructive: false,
      examples: ['rebeep test run', 'rebeep test run --suite tools', 'rebeep test run --suite vm --probe P_SMOKE'],
      run: async (ctx) => {
        if ((ctx.opts.probe !== undefined || ctx.opts['skip-build']) && ctx.opts.suite !== 'vm') {
          throw new CliError('--probe and --skip-build only apply to --suite vm');
        }
        const suites = ctx.opts.suite === 'all' ? ['tools', 'interpreter', 'studio'] : [ctx.opts.suite];
        if (ctx.env.NODE_TEST_CONTEXT && suites.includes('tools')) {
          throw new CliError('the tools suite cannot run inside a node test (recursion guard)', {
            hint: 'Run `rebeep test run --suite interpreter` or `--suite studio` from here,or the tools suite from a shell.',
          });
        }
        const results = [];
        for (const suite of suites) results.push(await runSuite(ctx, ctx.repo, suite));
        const failed = results.filter((r) => !r.ok).map((r) => r.suite);
        if (failed.length > 0) {
          throw new CliError(`test suite failed: ${failed.join(', ')}`, { data: { suites: results } });
        }
        return { suites: results };
      },
      // Results are printed during the run, so the summary is not repeated here.
      render: () => {},
    },
  ],
};
