import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { createLog } from './log.mjs';
import { NameError, layout, repoLayout, repoRoot, resolveHome } from './paths.mjs';

/** The only verbs a command may use. Extend `tools/AGENTS.md` in the same change. */
export const VERBS = [
  'list',
  'show',
  'status',
  'check',
  'setup',
  'create',
  'add',
  'remove',
  'fetch',
  'verify',
  'run',
  'snapshot',
  'reset',
  'deploy',
  'clean',
  'bump',
];

const RESERVED_OPTIONS = ['json', 'home', 'verbose', 'help', 'version', 'yes', 'preview'];

const YES_OPTION = {
  name: 'yes',
  type: 'boolean',
  description: 'Skip the confirmation prompt',
};
const PREVIEW_OPTION = {
  name: 'preview',
  type: 'boolean',
  description: 'Show what would change, and change nothing',
};

const GLOBAL_OPTIONS = [
  { flag: '--json', description: 'Print one JSON envelope on stdout' },
  { flag: '--home <path>', description: 'Home folder (default: $REBEEP_HOME, then ~/.rebeep)' },
  { flag: '--verbose', description: 'Print debug output' },
  { flag: '-h, --help', description: 'Show help' },
  { flag: '--version', description: 'Print the version', rootOnly: true },
];

const OPTION_PLACEMENT = "Global options go anywhere; a verb's own options go after the verb.";
const ROOT_USAGE = 'rebeep <noun> <verb> [args] [options]';

/** A failure the user should see as a message, with the exit code to use. */
export class CliError extends Error {
  constructor(message, { code = 1, hint, data } = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.hint = hint;
    this.data = data;
  }
}

/** Bad usage: unknown noun, verb or option, missing or extra arguments. Exit code 2. */
export class UsageError extends CliError {
  constructor(message, { hint, data, usage } = {}) {
    super(message, { code: 2, hint, data });
    this.name = 'UsageError';
    this.usage = usage;
  }
}

/**
 * Returns a `run` for a verb whose behaviour has not been written yet. The names default to
 * the `ctx` the verb is run with.
 */
export function notImplemented(noun, verb) {
  return async (ctx) => {
    throw new CliError(`rebeep ${noun ?? ctx?.noun} ${verb ?? ctx?.verb} is not implemented yet`, {
      code: 1,
    });
  };
}

const verbArgs = (verb) => verb.args ?? [];
const verbOptions = (verb) => verb.options ?? [];
const allOptions = (verb) => [
  ...verbOptions(verb),
  ...(verb.destructive ? [YES_OPTION, PREVIEW_OPTION] : []),
];

/**
 * Throws if the noun list breaks the grammar: a verb outside `VERBS`, a missing summary or
 * `run`, a duplicate noun, verb, argument or option name, a required argument after an
 * optional one, an option that reuses a reserved name, a malformed `short`, or a `default`
 * outside `choices`.
 */
export function validateRegistry(nouns) {
  if (!Array.isArray(nouns) || nouns.length === 0) throw new Error('no nouns registered');
  const nounNames = new Set();
  for (const noun of nouns) {
    if (!noun.name) throw new Error('a noun has no name');
    if (!noun.summary) throw new Error(`noun '${noun.name}' has no summary`);
    if (nounNames.has(noun.name)) throw new Error(`duplicate noun '${noun.name}'`);
    nounNames.add(noun.name);
    if (!Array.isArray(noun.verbs) || noun.verbs.length === 0) {
      throw new Error(`noun '${noun.name}' has no verbs`);
    }
    const verbNames = new Set();
    for (const verb of noun.verbs) {
      const id = `${noun.name} ${verb.name}`;
      if (!VERBS.includes(verb.name)) {
        throw new Error(`'${id}': '${verb.name}' is not in the verb vocabulary`);
      }
      if (!verb.summary) throw new Error(`'${id}' has no summary`);
      if (typeof verb.run !== 'function') throw new Error(`'${id}' has no run function`);
      if (verbNames.has(verb.name)) throw new Error(`duplicate verb '${id}'`);
      verbNames.add(verb.name);

      const argNames = new Set();
      let sawOptional = false;
      for (const arg of verbArgs(verb)) {
        if (!arg.name) throw new Error(`'${id}' has an argument with no name`);
        if (argNames.has(arg.name)) throw new Error(`'${id}' repeats argument '${arg.name}'`);
        argNames.add(arg.name);
        if (arg.required && sawOptional) {
          throw new Error(`'${id}': required argument '${arg.name}' follows an optional one`);
        }
        if (!arg.required) sawOptional = true;
      }

      const optionNames = new Set();
      const shorts = new Set(['h']);
      for (const opt of verbOptions(verb)) {
        if (!opt.name) throw new Error(`'${id}' has an option with no name`);
        if (RESERVED_OPTIONS.includes(opt.name) || optionNames.has(opt.name)) {
          throw new Error(`'${id}': option '--${opt.name}' collides with another option`);
        }
        optionNames.add(opt.name);
        if (opt.type !== 'boolean' && opt.type !== 'string') {
          throw new Error(`'${id}': option '--${opt.name}' needs type 'boolean' or 'string'`);
        }
        if (opt.choices && opt.type !== 'string') {
          throw new Error(`'${id}': only string option '--${opt.name}' can have choices`);
        }
        if (opt.default !== undefined && opt.choices && !opt.choices.includes(opt.default)) {
          throw new Error(`'${id}': default of '--${opt.name}' is not one of its choices`);
        }
        if (opt.short !== undefined) {
          if (typeof opt.short !== 'string' || !/^[A-Za-z]$/.test(opt.short)) {
            throw new Error(`'${id}': short of '--${opt.name}' must be one letter`);
          }
          if (shorts.has(opt.short)) throw new Error(`'${id}': short '-${opt.short}' is taken`);
          shorts.add(opt.short);
        }
      }
    }
  }
}

function formatColumns(rows) {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`.trimEnd());
}

function argSynopsis(verb) {
  return verbArgs(verb)
    .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
    .join(' ');
}

function verbSynopsis(noun, verb) {
  const args = argSynopsis(verb);
  return `rebeep ${noun.name} ${verb.name}${args ? ` ${args}` : ''} [options]`;
}

function optionFlag(opt) {
  const short = opt.short ? `-${opt.short}, ` : '';
  const value = opt.type === 'string' ? ` <${opt.valueName ?? 'value'}>` : '';
  return `${short}--${opt.name}${value}`;
}

function optionDescription(opt) {
  const notes = [];
  if (opt.choices) notes.push(`one of: ${opt.choices.join(', ')}`);
  if (opt.default !== undefined) notes.push(`default: ${opt.default}`);
  return notes.length ? `${opt.description ?? ''} (${notes.join('; ')})`.trim() : opt.description ?? '';
}

function globalOptionRows({ root }) {
  return GLOBAL_OPTIONS.filter((g) => root || !g.rootOnly).map((g) => [g.flag, g.description]);
}

export function renderRootHelp(nouns) {
  return [
    'rebeep: the ReBeep development environment',
    '',
    'Usage: rebeep <noun> <verb> [args] [options]',
    OPTION_PLACEMENT,
    '',
    'Nouns:',
    ...formatColumns(nouns.map((n) => [n.name, n.summary])),
    '',
    'Global options:',
    ...formatColumns(globalOptionRows({ root: true })),
    '',
    'Run `rebeep <noun>` to list its verbs.',
  ].join('\n');
}

export function renderNounHelp(noun) {
  return [
    `rebeep ${noun.name}: ${noun.summary}`,
    '',
    `Usage: rebeep ${noun.name} <verb> [args] [options]`,
    OPTION_PLACEMENT,
    '',
    'Verbs:',
    ...formatColumns(
      noun.verbs.map((v) => [[v.name, argSynopsis(v)].filter(Boolean).join(' '), v.summary]),
    ),
    '',
    `Run \`rebeep ${noun.name} <verb> --help\` for a verb's arguments and options.`,
  ].join('\n');
}

export function renderVerbHelp(noun, verb) {
  const lines = [`Usage: ${verbSynopsis(noun, verb)}`, '', verb.summary];
  if (verb.description) lines.push('', verb.description);
  if (verbArgs(verb).length) {
    lines.push(
      '',
      'Arguments:',
      ...formatColumns(
        verbArgs(verb).map((a) => [
          a.required ? `<${a.name}>` : `[${a.name}]`,
          a.description ?? '',
        ]),
      ),
    );
  }
  const options = allOptions(verb);
  if (options.length) {
    lines.push(
      '',
      'Options:',
      ...formatColumns(options.map((o) => [optionFlag(o), optionDescription(o)])),
    );
  }
  lines.push('', 'Global options:', ...formatColumns(globalOptionRows({ root: false })));
  if (verb.examples?.length) {
    lines.push('', 'Examples:', ...verb.examples.map((e) => `  ${e}`));
  }
  return lines.join('\n');
}

const isContainer = (v) => v !== null && typeof v === 'object';
const scalar = (v) => (v === null ? 'null' : String(v));

function valueLines(value, depth) {
  const pad = '  '.repeat(depth);
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      isContainer(item) ? [`${pad}-`, ...valueLines(item, depth + 1)] : [`${pad}- ${scalar(item)}`],
    );
  }
  return Object.entries(value).flatMap(([key, item]) => {
    if (!isContainer(item)) return [`${pad}${key}: ${scalar(item)}`];
    if (Object.keys(item).length === 0) return [`${pad}${key}: (none)`];
    return [`${pad}${key}:`, ...valueLines(item, depth + 1)];
  });
}

/** Human output for a verb that has no `render`. */
function renderDefault(data, log) {
  if (data === null || data === undefined) return;
  if (typeof data === 'string') return log.raw(data);
  if (!isContainer(data)) return log.raw(String(data));
  const lines = valueLines(data, 0);
  if (lines.length) log.raw(lines.join('\n'));
}

/** Turns a `parseArgs` failure into a usage error; anything else is a bug and is rethrown. */
function usageFrom(err, usage, hint) {
  if (typeof err?.code !== 'string' || !err.code.startsWith('ERR_PARSE_ARGS_')) throw err;
  const message = err.message.split('\n')[0].split('. To specify')[0];
  return new UsageError(message, { usage, hint });
}

const GLOBAL_PARSE_OPTIONS = {
  json: { type: 'boolean' },
  home: { type: 'string' },
  verbose: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
};

/**
 * Reads the global options and the noun and verb words. Global options may sit anywhere; any
 * other option before the verb is a usage error, because a verb's options go after the verb.
 */
function scanArgs(argv, nouns) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: GLOBAL_PARSE_OPTIONS,
      allowPositionals: true,
      strict: false,
      tokens: true,
    });
  } catch (err) {
    throw usageFrom(err, ROOT_USAGE, 'Run `rebeep --help` for usage.');
  }

  const globals = { json: false, verbose: false, help: false, version: false, home: undefined };
  const words = [];
  const isVerbOption = (token) =>
    nouns.some((n) =>
      n.verbs.some((v) =>
        allOptions(v).some((o) => o.name === token.name || (o.short && o.short === token.name)),
      ),
    );

  for (const token of parsed.tokens) {
    if (token.kind === 'positional') {
      words.push(token.value);
      continue;
    }
    if (token.kind !== 'option') continue;
    const beforeVerb = words.length < 2;
    switch (token.name) {
      case 'json':
      case 'verbose':
      case 'help':
        globals[token.name] = true;
        break;
      case 'version':
        if (beforeVerb) globals.version = true;
        break;
      case 'home': {
        const value = token.value;
        const missing =
          typeof value !== 'string' || value === '' || (!token.inlineValue && value.startsWith('-'));
        if (missing) {
          throw new UsageError('--home needs a folder path', {
            usage: ROOT_USAGE,
            hint: 'Run `rebeep --help` for usage.',
          });
        }
        globals.home = value;
        break;
      }
      default:
        if (beforeVerb) {
          const noun = words.length ? nouns.find((n) => n.name === words[0]) : undefined;
          throw new UsageError(
            isVerbOption(token)
              ? `option '${token.rawName}' must come after the verb`
              : `unknown option '${token.rawName}'`,
            {
              usage: noun ? `rebeep ${noun.name} <verb> [args] [options]` : ROOT_USAGE,
              hint: OPTION_PLACEMENT,
            },
          );
        }
    }
  }
  return { globals, words };
}

function parseVerb(argv, noun, verb) {
  const { version: _version, ...options } = GLOBAL_PARSE_OPTIONS;
  for (const opt of allOptions(verb)) {
    options[opt.name] = opt.short ? { type: opt.type, short: opt.short } : { type: opt.type };
  }
  const usage = verbSynopsis(noun, verb);
  const hint = `Run \`rebeep ${noun.name} ${verb.name} --help\` for usage.`;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (err) {
    throw usageFrom(err, usage, hint);
  }

  const positionals = parsed.positionals.slice(2);
  const specs = verbArgs(verb);
  const args = {};
  specs.forEach((spec, i) => {
    if (positionals[i] !== undefined) args[spec.name] = positionals[i];
    else if (spec.required) throw new UsageError(`missing argument <${spec.name}>`, { usage, hint });
  });
  if (positionals.length > specs.length) {
    throw new UsageError(`unexpected argument '${positionals[specs.length]}'`, { usage, hint });
  }

  const opts = {};
  for (const opt of verbOptions(verb)) {
    const value = parsed.values[opt.name];
    if (opt.type === 'boolean') {
      opts[opt.name] = value ?? false;
    } else {
      if (value !== undefined && opt.choices && !opt.choices.includes(value)) {
        throw new UsageError(
          `--${opt.name} must be one of: ${opt.choices.join(', ')} (got '${value}')`,
          { usage, hint },
        );
      }
      opts[opt.name] = value ?? opt.default;
    }
  }
  return { args, opts, values: parsed.values };
}

/** Anything can be thrown; make it an `Error` so a failure always maps to an exit code. */
function asError(thrown) {
  if (thrown instanceof Error) return thrown;
  if (typeof thrown === 'string' && thrown) return new Error(thrown);
  if (typeof thrown?.message === 'string' && thrown.message) return new Error(thrown.message);
  return new Error('unknown error');
}

function packageVersion() {
  const file = path.join(repoRoot(), 'package.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

function makeConfirm({ noun, verb, yes, stdin, stderr }) {
  return async (question) => {
    if (yes) return true;
    if (!stdin.isTTY) {
      throw new UsageError(`${noun} ${verb} needs --yes when not run interactively`, {
        hint: 'Run with --preview to see what it would change.',
      });
    }
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: stdin, output: stderr });
      let answered = false;
      rl.on('close', () => {
        if (!answered) resolve(false);
      });
      rl.question(`${question} [y/N] `, (answer) => {
        answered = true;
        rl.close();
        resolve(/^y(es)?$/i.test(answer.trim()));
      });
    });
  };
}

/**
 * Runs one `rebeep` invocation against the given noun registry and resolves to the exit code
 * (0 success, 1 failure, 2 bad usage). All I/O goes through the injected streams.
 */
export async function runCli(
  argv,
  {
    nouns,
    stdout = process.stdout,
    stderr = process.stderr,
    stdin = process.stdin,
    env = process.env,
    cwd = process.cwd(),
  } = {},
) {
  let json = false;
  let verbose = false;
  let log = createLog({ json, verbose, stdout, stderr, env });

  const showHelp = (text) => {
    stdout.write(json ? `${JSON.stringify({ ok: true, data: { help: text } })}\n` : `${text}\n`);
    return 0;
  };

  const fail = (thrown) => {
    const err = asError(thrown);
    const known = err instanceof CliError || err instanceof NameError;
    const code = err instanceof NameError ? 2 : known && Number.isInteger(err.code) ? err.code : 1;
    if (json) {
      const envelope = { ok: false, error: { message: err.message, code, hint: err.hint } };
      if (err.data !== undefined) envelope.data = err.data;
      stdout.write(`${JSON.stringify(envelope)}\n`);
    } else {
      log.error(err.message);
      if (err.usage) stderr.write(`Usage: ${err.usage}\n`);
      if (err.hint) stderr.write(`hint: ${err.hint}\n`);
    }
    if (!known && verbose && err.stack) stderr.write(`${err.stack}\n`);
    return code;
  };

  try {
    validateRegistry(nouns);
    const { globals, words } = scanArgs(argv, nouns);
    json = globals.json;
    verbose = globals.verbose;
    log = createLog({ json, verbose, stdout, stderr, env });

    if (globals.version) {
      const version = packageVersion();
      stdout.write(json ? `${JSON.stringify({ ok: true, data: { version } })}\n` : `${version}\n`);
      return 0;
    }

    const [nounName, verbName] = words;
    if (nounName === undefined) return showHelp(renderRootHelp(nouns));

    const noun = nouns.find((n) => n.name === nounName);
    if (!noun) {
      throw new UsageError(`unknown noun '${nounName}'`, {
        usage: ROOT_USAGE,
        hint: 'Run `rebeep --help` to list the nouns.',
      });
    }
    if (verbName === undefined) return showHelp(renderNounHelp(noun));

    const verb = noun.verbs.find((v) => v.name === verbName);
    if (!verb) {
      throw new UsageError(`unknown verb '${verbName}' for '${noun.name}'`, {
        usage: `rebeep ${noun.name} <verb> [args] [options]`,
        hint: `Run \`rebeep ${noun.name}\` to list its verbs.`,
      });
    }
    if (globals.help) return showHelp(renderVerbHelp(noun, verb));

    const { args, opts, values } = parseVerb(argv, noun, verb);
    const yes = Boolean(values.yes);
    const ctx = {
      noun: noun.name,
      verb: verb.name,
      args,
      opts,
      json,
      verbose,
      preview: Boolean(verb.destructive && values.preview),
      yes,
      confirm: makeConfirm({ noun: noun.name, verb: verb.name, yes, stdin, stderr }),
      paths: layout(resolveHome({ home: globals.home, env, cwd })),
      repo: repoLayout(env.REBEEP_REPO_ROOT ? path.resolve(cwd, env.REBEEP_REPO_ROOT) : undefined),
      log,
      env,
    };

    const data = await verb.run(ctx);
    if (json) {
      stdout.write(`${JSON.stringify({ ok: true, data: data ?? null })}\n`);
    } else if (verb.render) {
      await verb.render(data, log);
    } else {
      renderDefault(data, log);
    }
    return 0;
  } catch (err) {
    return fail(err);
  }
}
