import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../lib/cli.mjs';
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
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const OPL2_MARKER = /^\s*\/\*\s*SUITE:\s*OPL2\s*\*\//;
/** A first line of `SUITE: MACHINES` runs the program once under each of `DISPLAY_MACHINES` (its argument is the machine's name), and not under the default machine. */
const MACHINES_MARKER = /^\s*\/\*\s*SUITE:\s*MACHINES\s*\*\//;
/** The data-file folder that studio tests can read as FACTORY\, staged beside the programs. */
const FACTORY_DEPLOY = 'REBEEP/FACTORY';
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

function dosboxEnv(ctx) {
  return process.platform === 'linux'
    ? { ...ctx.env, SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy' }
    : ctx.env;
}

/**
 * Runs `command` headless in DOSBox-X with `dir` as C:. `opl2` switches the emulated Sound Blaster from the default OPL3
 * to OPL2; `machine` sets the emulated display adapter (cga, ega, vgaonly; the default is DOSBox-X's own).
 */
function runDosbox(ctx, dosbox, dir, command, { opl2 = false, machine = null } = {}) {
  return runTool(dosbox, [
    // Each setting is one argument, section and key separated by a space: DOSBox-X ignores the
    // comma form and a section and key passed as two arguments.
    '-set',
    'mixer nosound=true', // unlike -silent, keeps the Sound Blaster and its OPL emulated
    ...(opl2 ? ['-set', 'sblaster oplmode=opl2'] : []),
    ...(machine ? ['-set', `dosbox machine=${machine}`] : []),
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
  ], { env: dosboxEnv(ctx), echo: !ctx.json, timeoutMs: DOSBOX_TIMEOUT_MS });
}

/** Runs `command` with its output redirected to RESULT.TXT, and judges that. */
async function runDosProgram(ctx, dosbox, dir, name, command, { opl2 = false, machine = null } = {}) {
  const resultFile = path.join(dir, RESULT_FILE);
  fs.rmSync(resultFile, { force: true });
  const run = await runDosbox(ctx, dosbox, dir, `${command} > ${RESULT_FILE}`, { opl2, machine });

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
  stageFactory(repo, out);

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

/** Copies the data files deployed to `REBEEP` (the art) beside the programs in `out`. */
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

/**
 * Compiles RBSTUDIO.EXE as `build run` does, writes one batch file that dumps every reference screen in one DOSBox-X
 * start (`/DUMP:<screen>`, with `/VIEW:MONO` for the mono views), and compares each dump with its `.scr` file. The set runs
 * under DOSBox-X's default machine and again under each of `DISPLAY_MACHINES`. A screen the program does not draw exits
 * with `UNKNOWN_SCREEN_CODE` and writes nothing: that reference fails the run. Returns one result per run, or null with
 * no references.
 */
async function runScreens(ctx, repo, { watcom, dosbox, version, out }) {
  const references = referenceScreens(repo);
  if (references.length === 0) return null;

  ctx.log.step('Compiling RBSTUDIO.EXE for the screen check');
  const studioDir = path.join(repo.src, 'studio');
  const sources = fs
    .readdirSync(studioDir)
    .filter((n) => /\.c$/i.test(n))
    .sort()
    .map((n) => path.join(studioDir, n));
  // No include folder, as in `build run`: the source folder's dos.h would shadow <dos.h>.
  const stderr = await compileExe(watcom, {
    version,
    sources,
    includes: [],
    output: path.join(out, 'RBSTUDIO.EXE'),
    objDir: path.join(out, 'obj', 'RBSTUDIO'),
    mapFile: path.join(out, 'RBSTUDIO.MAP'),
  });
  for (const line of stderr.split(/\r?\n/).filter((l) => l.trim())) ctx.log.warn(`wcl (RBSTUDIO): ${line.trim()}`);
  stageProgramData(repo, out);

  const dumps = references.map((ref, i) => ({ ...ref, dump: `D${String(i).padStart(2, '0')}` }));
  const batch = dumps.flatMap((d) => [
    `RBSTUDIO /DUMP:${d.screen}${d.view === 'mono' ? ' /VIEW:MONO' : ''} /O:${d.dump}.DMP`,
    `IF ERRORLEVEL ${UNKNOWN_SCREEN_CODE} IF NOT ERRORLEVEL ${UNKNOWN_SCREEN_CODE + 1} ECHO ${d.dump}>>${UNKNOWN_FILE}`,
  ]);
  fs.writeFileSync(path.join(out, 'DUMPS.BAT'), `${batch.join('\r\n')}\r\n`);

  const results = [];
  for (const machine of [null, ...DISPLAY_MACHINES]) {
    results.push(await runDumpSet(ctx, { dosbox, out, dumps, machine }));
  }
  return results;
}

/** One run of DUMPS.BAT under `machine` (null for the default), judged against the references. */
async function runDumpSet(ctx, { dosbox, out, dumps, machine }) {
  for (const name of [UNKNOWN_FILE, ...dumps.map((d) => `${d.dump}.DMP`)]) fs.rmSync(path.join(out, name), { force: true });

  ctx.log.step(`Dumping ${dumps.length} reference screens in DOSBox-X${machine ? ` (machine ${machine})` : ''}`);
  const run = await runDosbox(ctx, dosbox, out, 'DUMPS.BAT', { machine });
  const result = { program: machine ? `SCREENS (${machine})` : 'SCREENS', passed: [], failed: [] };
  if (run.timedOut || run.elapsedMs >= (DOSBOX_TIME_LIMIT_S - 1) * 1000) {
    return { ...result, ok: false, problem: 'timed out' };
  }
  const unknownPath = path.join(out, UNKNOWN_FILE);
  const unknown = new Set(
    fs.existsSync(unknownPath) ? fs.readFileSync(unknownPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [],
  );

  for (const d of dumps) {
    const name = `${d.screen}.${d.view}`;
    const dumpPath = path.join(out, `${d.dump}.DMP`);
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
  const where = machine ? ` (machine ${machine})` : '';
  for (const failure of result.failed) ctx.log.error(`screen ${failure.name}${where}: ${failure.detail}`);
  return { ...result, ok: result.failed.length === 0 };
}

/**
 * Compiles each `tests/studio/T_*.C` with testlib and every studio module except `main.c`, through
 * the same wrapper and flags as `build run`, and runs it in DOSBox-X. A program whose first line is
 * a `SUITE: OPL2` comment runs again with an OPL2 card and the argument `/OPL2`. Last comes the screen check, run under
 * each display machine.
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

    const [firstLine] = fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/, 1);
    if (MACHINES_MARKER.test(firstLine)) {
      for (const machine of DISPLAY_MACHINES) {
        ctx.log.step(`Running ${name}.EXE ${machine} in DOSBox-X (machine ${machine})`);
        results.push(await runDosProgram(ctx, dosbox, out, `${name} (${machine})`, `${name}.EXE ${machine}`, { machine }));
      }
      continue;
    }
    ctx.log.step(`Running ${name}.EXE in DOSBox-X`);
    results.push(await runDosProgram(ctx, dosbox, out, name, `${name}.EXE`));
    if (OPL2_MARKER.test(firstLine)) {
      ctx.log.step(`Running ${name}.EXE /OPL2 in DOSBox-X`);
      results.push(await runDosProgram(ctx, dosbox, out, `${name} (OPL2)`, `${name}.EXE /OPL2`, { opl2: true }));
    }
  }
  const screens = await runScreens(ctx, repo, { watcom, dosbox, version, out });
  if (screens) results.push(...screens);
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
            hint: 'Run `rebeep test run --suite interpreter` or `--suite studio` from here, or the tools suite from a shell.',
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
