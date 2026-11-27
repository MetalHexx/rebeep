import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError, UsageError } from '../lib/cli.mjs';
import { assemble, resolveBinary, runProcess, runTool } from '../lib/nasm.mjs';
import { evaluateResults, interpreterPrograms, RESULT_FILE, studioPrograms, toolTestFiles, vmProbes } from '../lib/suites.mjs';
import { compileExe, resolveWatcom } from '../lib/watcom.mjs';
import { compareScreens, dumpToCells, parseScr } from '../lib/screens.mjs';
import { loadDataFiles, readPackageVersion } from './build.mjs';
import { runVmSuite } from './vmtest.mjs';

const TOOLS_GLOB = 'tools/test/**/*.test.mjs';
const DOS_NAME = /^[A-Z0-9_]{1,8}$/;
const DOSBOX_TIME_LIMIT_S = 60;
const DOSBOX_TIMEOUT_MS = 120_000;
/** Without `--jobs`, the most programs the DOS suites build and run at once; fewer on a CPU with fewer cores. */
const DEFAULT_JOBS_MAX = 4;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const OPL2_MARKER = /^\s*\/\*\s*SUITE:\s*OPL2\s*\*\//;
/** A first line of `SUITE: MACHINES` runs the program once under each of `DISPLAY_MACHINES` (its argument is the machine's name), and not under the default machine. */
const MACHINES_MARKER = /^\s*\/\*\s*SUITE:\s*MACHINES\s*\*\//;
/** The factory patches' data-file folder, staged at the same place beside the test programs. */
const FACTORY_DEPLOY = 'REBEEP/FACTORY/PATCHES';
/** The data-file folder whose files sit beside RBSTUDIO.EXE, as they do beside the installed program. */
const PROGRAM_DEPLOY = 'REBEEP';
const SCREEN_FILE = /^([a-z0-9-]+)\.(vga|mono)\.scr$/;
/** RBSTUDIO's exit code for a /DUMP of a screen it does not draw (no other /DUMP path exits with it). */
const UNKNOWN_SCREEN_CODE = 4;
/** The file DUMPS.BAT appends a dump's name to when RBSTUDIO does not draw its screen. */
const UNKNOWN_FILE = 'PENDING.TXT';
/**
 * The DOSBox-X machines the whole dump set runs under after the default one: the blink-off path differs on a CGA, an
 * EGA and a VGA, so the attributes must match under each (`-set "dosbox machine=<name>"`).
 */
const DISPLAY_MACHINES = ['cga', 'ega', 'vgaonly'];
const SHOWN_DIFFERENCES = 5;

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

/** `--jobs`: how many programs the DOS suites build and run at once. */
function jobCount(value) {
  if (value === undefined) return Math.min(DEFAULT_JOBS_MAX, os.availableParallelism());
  if (!/^[1-9]\d*$/.test(value)) throw new UsageError(`--jobs must be a whole number from 1 up (got '${value}')`);
  return Number(value);
}

/**
 * `fn` over `items`, at most `jobs` at a time, with the results in the items' order. After a failure nothing more is
 * started; what is running finishes, and the failure of the earliest item is thrown.
 */
async function mapPool(items, jobs, fn) {
  const results = new Array(items.length);
  const failures = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length && failures.length === 0) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (err) {
        failures.push({ index, err });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, worker));
  if (failures.length > 0) throw failures.sort((a, b) => a.index - b.index)[0].err;
  return results;
}

/** A test program's DOS name (`T_ADD` for `t_add.asm`). */
function dosName(file) {
  const name = path.parse(file).name.toUpperCase();
  if (!DOS_NAME.test(name)) throw new CliError(`${file}: DOS program names must be 8 characters or fewer`);
  return name;
}

/** SDL's dummy video and audio drivers: DOSBox-X opens no window and plays nothing, on every host. */
function dosboxEnv(ctx) {
  return { ...ctx.env, SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy' };
}

/**
 * Runs `command` headless in DOSBox-X with `dir` as C:. `opl2` switches the emulated Sound Blaster from the default OPL3
 * to OPL2; `machine` sets the emulated display adapter (cga, ega, vgaonly; the default is DOSBox-X's own). With
 * `stream`, DOSBox-X's output is forwarded as it arrives (never with `--json`).
 */
function runDosbox(ctx, dosbox, dir, command, { opl2 = false, machine = null, stream = true } = {}) {
  return runTool(dosbox, [
    // Each setting is one argument, section and key separated by a space: DOSBox-X ignores the
    // comma form and a section and key passed as two arguments.
    '-set',
    'mixer nosound=true', // unlike -silent, keeps the Sound Blaster and its OPL emulated
    '-set',
    'cpu cycles=max', // the tests wait for nothing real, so the emulated CPU runs as fast as the host can
    ...(opl2 ? ['-set', 'sblaster oplmode=opl2'] : []),
    ...(machine ? ['-set', `dosbox machine=${machine}`] : []),
    '-fastlaunch', // no BIOS logo or welcome banner
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
    command,
  ], { env: dosboxEnv(ctx), echo: stream && !ctx.json, timeoutMs: DOSBOX_TIMEOUT_MS });
}

/** Prints what DOSBox-X said in a failed run that did not stream it, so that jobs don't interleave. */
function printUnstreamed(ctx, run, { stream = true }) {
  if (stream || ctx.json) return;
  process.stdout.write(run.stdout);
  process.stderr.write(run.stderr);
}

/** Runs `command` with its output redirected to RESULT.TXT, and judges that. `options` are `runDosbox`'s. */
async function runDosProgram(ctx, dosbox, dir, name, command, options = {}) {
  const resultFile = path.join(dir, RESULT_FILE);
  fs.rmSync(resultFile, { force: true });
  const run = await runDosbox(ctx, dosbox, dir, `${command} > ${RESULT_FILE}`, options);

  const result = programResult(name, run, resultFile);
  if (!result.ok) printUnstreamed(ctx, run, options);
  for (const failure of result.failed) {
    ctx.log.error(`${name}: ${failure.name}: ${failure.detail}`);
  }
  if (result.problem) ctx.log.error(`${name}: ${result.problem}`);
  return result;
}

/**
 * Assembles each `tests/interpreter/T_*.ASM` into its own folder, then runs them in DOSBox-X, `jobs` at a time.
 */
async function runInterpreter(ctx, repo, { jobs }) {
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
  fs.rmSync(out, { recursive: true, force: true });

  const built = await mapPool(programs, jobs, async (file) => {
    const name = dosName(file);
    const folder = path.join(out, name);
    fs.mkdirSync(folder, { recursive: true });
    stageFactory(repo, folder);
    ctx.log.step(`Assembling ${name}.COM`);
    await assemble(nasm, {
      version,
      includes: [dir, repo.src, path.join(repo.src, 'include')],
      listing: path.join(folder, `${name}.LST`),
      output: path.join(folder, `${name}.COM`),
      source: path.join(dir, file),
    });
    return { name, folder };
  });

  const results = await mapPool(built, jobs, ({ name, folder }) => {
    ctx.log.step(`Running ${name}.COM in DOSBox-X`);
    return runDosProgram(ctx, dosbox, folder, name, `${name}.COM`, { stream: jobs === 1 });
  });
  return { suite: 'interpreter', ok: results.every((r) => r.ok), programs: results };
}

/** Stages the shipped factory patches as `FACTORY\PATCHES\` in `out`, so a test program reads what players get. */
function stageFactory(repo, out) {
  const folder = path.join(out, 'FACTORY', 'PATCHES');
  fs.mkdirSync(folder, { recursive: true });
  for (const file of loadDataFiles(repo)) {
    if (file.deploy === FACTORY_DEPLOY) fs.copyFileSync(file.from, path.join(folder, file.name));
  }
}

/** Copies the data files deployed to `REBEEP` (the art) into `out`, beside the program there. */
function stageProgramData(repo, out) {
  for (const file of loadDataFiles(repo)) {
    if (file.deploy === PROGRAM_DEPLOY) fs.copyFileSync(file.from, path.join(out, file.name));
  }
}

/** The reference screens in tests/screens: `{ file, screen, view }`, sorted. */
function referenceScreens(repo) {
  const dir = path.join(repo.tests, 'screens');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .sort()
    .flatMap((file) => {
      const match = SCREEN_FILE.exec(file);
      return match ? [{ file: path.join(dir, file), screen: match[1], view: match[2] }] : [];
    });
}

const describeCell = (cell) => `'${cell.ch}' fg ${cell.fg.toString(16).toUpperCase()} bg ${cell.bg.toString(16).toUpperCase()}`;

/** wcl's warnings, one log line each. */
function warnCompiler(ctx, name, stderr) {
  for (const line of stderr.split(/\r?\n/).filter((l) => l.trim())) ctx.log.warn(`wcl (${name}): ${line.trim()}`);
}

/**
 * Builds the screen check: compiles RBSTUDIO.EXE as `build run` does, once, into `screens/`, then gives the default
 * machine and each of `DISPLAY_MACHINES` a folder there with a copy of the program, its art, the factory patches and one
 * batch file that dumps every reference screen in one DOSBox-X start (`/DUMP:<screen>`, with `/VIEW:MONO` for the mono
 * views). Returns one group of runs a machine. A screen the program does not draw exits with `UNKNOWN_SCREEN_CODE` and
 * writes nothing: that reference fails the run.
 */
async function buildScreens(ctx, repo, { watcom, dosbox, version, out, references, stream }) {
  ctx.log.step('Compiling RBSTUDIO.EXE for the screen check');
  const studioDir = path.join(repo.src, 'studio');
  const sources = fs
    .readdirSync(studioDir)
    .filter((n) => /\.c$/i.test(n))
    .sort()
    .map((n) => path.join(studioDir, n));
  const screensDir = path.join(out, 'screens');
  const program = path.join(screensDir, 'RBSTUDIO.EXE');
  // No include folder, as in `build run`: the source folder's dos.h would shadow <dos.h>.
  const stderr = await compileExe(watcom, {
    version,
    sources,
    includes: [],
    output: program,
    objDir: path.join(screensDir, 'obj'),
    mapFile: path.join(screensDir, 'RBSTUDIO.MAP'),
  });
  warnCompiler(ctx, 'RBSTUDIO', stderr);

  const dumps = references.map((ref, i) => ({ ...ref, dump: `D${String(i).padStart(2, '0')}` }));
  const batch = dumps.flatMap((d) => [
    `RBSTUDIO /DUMP:${d.screen}${d.view === 'mono' ? ' /VIEW:MONO' : ''} /O:${d.dump}.DMP`,
    `IF ERRORLEVEL ${UNKNOWN_SCREEN_CODE} IF NOT ERRORLEVEL ${UNKNOWN_SCREEN_CODE + 1} ECHO ${d.dump}>>${UNKNOWN_FILE}`,
  ]);
  return [null, ...DISPLAY_MACHINES].map((machine) => {
    const folder = path.join(screensDir, machine ?? 'default');
    stageFactory(repo, folder);
    stageProgramData(repo, folder);
    fs.copyFileSync(program, path.join(folder, 'RBSTUDIO.EXE'));
    fs.writeFileSync(path.join(folder, 'DUMPS.BAT'), `${batch.join('\r\n')}\r\n`);
    return async () => [await runDumpSet(ctx, { dosbox, folder, dumps, machine, stream })];
  });
}

/** One run of DUMPS.BAT in `folder` under `machine` (null for the default), judged against the references. */
async function runDumpSet(ctx, { dosbox, folder, dumps, machine, stream }) {
  ctx.log.step(`Dumping ${dumps.length} reference screens in DOSBox-X${machine ? ` (machine ${machine})` : ''}`);
  const run = await runDosbox(ctx, dosbox, folder, 'DUMPS.BAT', { machine, stream });
  const result = { program: machine ? `SCREENS (${machine})` : 'SCREENS', passed: [], failed: [] };
  const where = machine ? ` (machine ${machine})` : '';
  if (run.timedOut || run.elapsedMs >= (DOSBOX_TIME_LIMIT_S - 1) * 1000) {
    printUnstreamed(ctx, run, { stream });
    ctx.log.error(`screens${where}: timed out`);
    return { ...result, ok: false, problem: 'timed out' };
  }
  const unknownPath = path.join(folder, UNKNOWN_FILE);
  const unknown = new Set(
    fs.existsSync(unknownPath) ? fs.readFileSync(unknownPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [],
  );

  for (const d of dumps) {
    const name = `${d.screen}.${d.view}`;
    const dumpPath = path.join(folder, `${d.dump}.DMP`);
    if (unknown.has(d.dump)) {
      result.failed.push({ name, detail: 'RBSTUDIO does not draw this screen' });
      continue;
    }
    if (!fs.existsSync(dumpPath)) {
      result.failed.push({ name, detail: 'RBSTUDIO wrote no dump' });
      continue;
    }
    try {
      const diffs = compareScreens(parseScr(fs.readFileSync(d.file, 'utf8')), dumpToCells(fs.readFileSync(dumpPath)));
      if (diffs.length === 0) {
        result.passed.push(name);
        continue;
      }
      const shown = diffs
        .slice(0, SHOWN_DIFFERENCES)
        .map((x) => `row ${x.row} col ${x.col} ${x.what}: want ${describeCell(x.want)}, got ${describeCell(x.got)}`);
      const more = diffs.length > shown.length ? `; ${diffs.length - shown.length} more` : '';
      result.failed.push({ name, detail: `${diffs.length} cells differ: ${shown.join('; ')}${more}` });
    } catch (err) {
      result.failed.push({ name, detail: err.message });
    }
  }
  if (result.failed.length > 0) printUnstreamed(ctx, run, { stream });
  for (const failure of result.failed) ctx.log.error(`screen ${failure.name}${where}: ${failure.detail}`);
  return { ...result, ok: result.failed.length === 0 };
}

/**
 * A studio test program's runs, in order: under each of `DISPLAY_MACHINES` for a `SUITE: MACHINES` program; otherwise
 * once, and again with an OPL2 card and the argument `/OPL2` for a `SUITE: OPL2` one.
 */
function programRuns(name, firstLine) {
  if (MACHINES_MARKER.test(firstLine)) {
    return DISPLAY_MACHINES.map((machine) => ({ label: `${name} (${machine})`, command: `${name}.EXE ${machine}`, machine }));
  }
  const runs = [{ label: name, command: `${name}.EXE` }];
  if (OPL2_MARKER.test(firstLine)) runs.push({ label: `${name} (OPL2)`, command: `${name}.EXE /OPL2`, opl2: true });
  return runs;
}

/**
 * Compiles one `tests/studio/T_*.C` with testlib and the studio `modules` into its own folder, through the same wrapper
 * and flags as `build run`. Returns its runs as one group, so they happen in turn.
 */
async function buildProgram(ctx, repo, { watcom, dosbox, version, out, modules, file, stream }) {
  const dir = path.join(repo.tests, 'studio');
  const name = dosName(file);
  const folder = path.join(out, name);
  stageFactory(repo, folder);
  ctx.log.step(`Compiling ${name}.EXE`);
  const stderr = await compileExe(watcom, {
    version,
    sources: [path.join(dir, file), path.join(dir, 'testlib.c'), ...modules],
    includes: [dir],
    output: path.join(folder, `${name}.EXE`),
    objDir: path.join(folder, 'obj'),
    mapFile: path.join(folder, `${name}.MAP`),
  });
  warnCompiler(ctx, name, stderr);

  const [firstLine] = fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/, 1);
  return [
    async () => {
      const results = [];
      for (const { label, command, ...options } of programRuns(name, firstLine)) {
        ctx.log.step(`Running ${command} in DOSBox-X${options.machine ? ` (machine ${options.machine})` : ''}`);
        results.push(await runDosProgram(ctx, dosbox, folder, label, command, { ...options, stream }));
      }
      return results;
    },
  ];
}

/**
 * Compiles every test program and the screen check, then runs them in DOSBox-X, `jobs` at a time. The results come in
 * program order, the screen check's last.
 */
async function runStudio(ctx, repo, { jobs }) {
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

  const studioDir = path.join(repo.src, 'studio');
  const modules = fs
    .readdirSync(studioDir)
    .filter((n) => /\.c$/i.test(n) && n.toLowerCase() !== 'main.c')
    .sort()
    .map((n) => path.join(studioDir, n));

  const shared = { watcom, dosbox, version, out, stream: jobs === 1 };
  const builds = programs.map((file) => () => buildProgram(ctx, repo, { ...shared, modules, file }));
  const references = referenceScreens(repo);
  if (references.length > 0) builds.push(() => buildScreens(ctx, repo, { ...shared, references }));

  // Everything is built before anything runs, so a compile error stops the suite before DOSBox-X starts.
  const groups = (await mapPool(builds, jobs, (build) => build())).flat();
  const results = (await mapPool(groups, jobs, (run) => run())).flat();
  return { suite: 'studio', ok: results.every((r) => r.ok), programs: results };
}

async function runSuite(ctx, repo, suite, { jobs }) {
  ctx.log.step(`Running the ${suite} suite`);
  let result;
  if (suite === 'tools') {
    result = await runTools(ctx, repo);
  } else if (suite === 'vm') {
    result = await runVmSuite(ctx, repo, { probe: ctx.opts.probe, skipBuild: ctx.opts['skip-build'] });
  } else if (suite === 'studio') {
    result = await runStudio(ctx, repo, { jobs });
  } else {
    result = await runInterpreter(ctx, repo, { jobs });
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
        {
          name: 'jobs',
          type: 'string',
          valueName: 'n',
          description: `interpreter and studio suites: how many programs to build and run at once (default: the CPU's cores, up to ${DEFAULT_JOBS_MAX}; 1 streams DOSBox-X's output)`,
        },
      ],
      destructive: false,
      examples: [
        'rebeep test run',
        'rebeep test run --suite tools',
        'rebeep test run --suite studio --jobs 1',
        'rebeep test run --suite vm --probe P_SMOKE',
      ],
      run: async (ctx) => {
        if ((ctx.opts.probe !== undefined || ctx.opts['skip-build']) && ctx.opts.suite !== 'vm') {
          throw new CliError('--probe and --skip-build only apply to --suite vm');
        }
        if (ctx.opts.jobs !== undefined && ['tools', 'vm'].includes(ctx.opts.suite)) {
          throw new UsageError('--jobs only applies to the interpreter and studio suites');
        }
        const jobs = jobCount(ctx.opts.jobs);
        const suites = ctx.opts.suite === 'all' ? ['tools', 'interpreter', 'studio'] : [ctx.opts.suite];
        if (ctx.env.NODE_TEST_CONTEXT && suites.includes('tools')) {
          throw new CliError('the tools suite cannot run inside a node test (recursion guard)', {
            hint: 'Run `rebeep test run --suite interpreter` or `--suite studio` from here, or the tools suite from a shell.',
          });
        }
        const results = [];
        for (const suite of suites) results.push(await runSuite(ctx, ctx.repo, suite, { jobs }));
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
