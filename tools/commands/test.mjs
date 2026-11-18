import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../lib/cli.mjs';
import { assemble, resolveBinary, runProcess, runTool } from '../lib/nasm.mjs';
import { evaluateResults, interpreterPrograms, RESULT_FILE, toolTestFiles, vmProbes } from '../lib/suites.mjs';
import { readPackageVersion } from './build.mjs';
import { runVmSuite } from './vmtest.mjs';

const TOOLS_GLOB = 'tools/test/**/*.test.mjs';
const DOS_NAME = /^[A-Z0-9_]{1,8}$/;
const DOSBOX_TIME_LIMIT_S = 60;
const DOSBOX_TIMEOUT_MS = 120_000;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

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
  const dosboxEnv =
    process.platform === 'linux'
      ? { ...ctx.env, SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy' }
      : ctx.env;

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

    const resultFile = path.join(out, RESULT_FILE);
    fs.rmSync(resultFile, { force: true });
    ctx.log.step(`Running ${name}.COM in DOSBox-X`);
    const run = await runTool(dosbox, [
      '-set',
      'mixer,nosound=true', // unlike -silent, keeps the Sound Blaster and its OPL emulated
      '-exit',
      '-nogui',
      '-nomenu',
      '-time-limit',
      String(DOSBOX_TIME_LIMIT_S),
      '-c',
      `MOUNT C "${out}"`,
      '-c',
      'C:',
      '-c',
      `${name}.COM > ${RESULT_FILE}`,
    ], { env: dosboxEnv, echo: !ctx.json, timeoutMs: DOSBOX_TIMEOUT_MS });

    const result = programResult(name, run, resultFile);
    for (const failure of result.failed) {
      ctx.log.error(`${name}: ${failure.name}: ${failure.detail}`);
    }
    if (result.problem) ctx.log.error(`${name}: ${result.problem}`);
    results.push(result);
  }
  return { suite: 'interpreter', ok: results.every((r) => r.ok), programs: results };
}

async function runSuite(ctx, repo, suite) {
  ctx.log.step(`Running the ${suite} suite`);
  let result;
  if (suite === 'tools') {
    result = await runTools(ctx, repo);
  } else if (suite === 'vm') {
    result = await runVmSuite(ctx, repo, { probe: ctx.opts.probe, skipBuild: ctx.opts['skip-build'] });
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
              suite: 'vm',
              files: vm,
              runs: 'boots mirror-freedos in 86Box for each P_*.BAT in tests/vm (not part of all)',
            },
            { suite: 'all', files: tools + interpreter, runs: 'tools, then interpreter' },
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
          choices: ['tools', 'interpreter', 'vm', 'all'],
          default: 'all',
          description: 'Which suite to run (all is tools and interpreter; vm opens 86Box and is run on its own)',
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
        const suites = ctx.opts.suite === 'all' ? ['tools', 'interpreter'] : [ctx.opts.suite];
        if (ctx.env.NODE_TEST_CONTEXT && suites.includes('tools')) {
          throw new CliError('the tools suite cannot run inside a node test (recursion guard)', {
            hint: 'Run `rebeep test run --suite interpreter` from here, or the tools suite from a shell.',
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
