import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import nouns from '../commands/index.mjs';
import { CliError, VERBS, notImplemented, runCli, validateRegistry } from '../lib/cli.mjs';
import { createLog } from '../lib/log.mjs';
import { repoRoot } from '../lib/paths.mjs';
import { captureStreams, runRebeep } from './helpers.mjs';

const NOUN_NAMES = ['env', 'tool', 'media', 'vm', 'disk', 'build', 'test', 'release', 'repo'];
const ROOT_SYNOPSIS = 'Usage: rebeep <noun> <verb> [args] [options]';

async function drive(argv, { registry = nouns, tty = false, input, env = {}, cwd } = {}) {
  const s = captureStreams();
  s.stdin.isTTY = tty;
  if (input !== undefined) s.stdin.write(input);
  const code = await runCli(argv, {
    nouns: registry,
    stdout: s.stdout,
    stderr: s.stderr,
    stdin: s.stdin,
    env,
    cwd,
  });
  return { code, stdout: s.out(), stderr: s.err() };
}

function fakeNouns(seen = []) {
  return [
    {
      name: 'thing',
      summary: 'A fake thing',
      verbs: [
        {
          name: 'list',
          summary: 'List things',
          args: [{ name: 'which', required: false, description: 'Which one' }],
          options: [
            { name: 'size', type: 'string', choices: ['s', 'l'], default: 's', description: 'Size' },
            { name: 'loud', type: 'boolean', short: 'l', description: 'Loud' },
          ],
          run: async (ctx) => {
            seen.push(ctx);
            return { items: [1, 2], nested: { a: 'b' } };
          },
        },
        {
          name: 'show',
          summary: 'Show it',
          run: async () => 'plain text',
          render: (data, log) => log.info(`rendered:${data}`),
        },
        {
          name: 'remove',
          summary: 'Remove it',
          destructive: true,
          args: [{ name: 'id', required: true, description: 'Id' }],
          run: async (ctx) => {
            seen.push(ctx);
            if (ctx.preview) return { preview: true };
            return { removed: await ctx.confirm('Remove it?') };
          },
        },
        {
          name: 'check',
          summary: 'Fails',
          run: async () => {
            throw new CliError('boom', { code: 1, hint: 'try again' });
          },
        },
        {
          name: 'verify',
          summary: 'Fails with a custom code',
          run: async () => {
            throw new CliError('mismatch', { code: 3, data: { file: 'x' } });
          },
        },
        {
          name: 'fetch',
          summary: 'Crashes',
          run: async () => {
            throw new TypeError('kaboom');
          },
        },
        {
          name: 'status',
          summary: 'Talks through every log method',
          run: async ({ log }) => {
            log.info('say-info');
            log.step('say-step');
            log.ok('say-ok');
            log.warn('say-warn');
            log.debug('say-debug');
            log.table([{ a: 'x', b: 'y' }], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]);
            log.raw('say-raw');
            return { done: true };
          },
        },
        {
          name: 'add',
          summary: 'Throws null',
          run: async () => {
            throw null;
          },
        },
        {
          name: 'create',
          summary: 'Throws a string',
          run: async () => {
            throw 'string failure';
          },
        },
        {
          name: 'deploy',
          summary: 'Throws a plain object',
          run: async () => {
            throw { message: 'object failure' };
          },
        },
        {
          name: 'setup',
          summary: 'Asks paths for a bad name',
          run: async ({ paths }) => paths.vm('..'),
        },
      ],
    },
  ];
}

describe('registry', () => {
  test('the real registry is valid and in the documented order', () => {
    validateRegistry(nouns);
    assert.deepEqual(
      nouns.map((n) => n.name),
      NOUN_NAMES,
    );
    for (const noun of nouns) {
      assert.ok(noun.summary, noun.name);
      for (const verb of noun.verbs) {
        assert.ok(verb.summary, `${noun.name} ${verb.name}`);
        assert.ok(VERBS.includes(verb.name), `${noun.name} ${verb.name}`);
      }
    }
  });

  test('validateRegistry rejects a verb outside the vocabulary', () => {
    const bad = [{ name: 'n', summary: 's', verbs: [{ name: 'frobnicate', summary: 's', run() {} }] }];
    assert.throws(() => validateRegistry(bad), /vocabulary/);
  });

  test('validateRegistry rejects missing summaries and colliding names', () => {
    const verb = (over = {}) => ({ name: 'list', summary: 's', run() {}, ...over });
    assert.throws(() => validateRegistry([{ name: 'n', verbs: [verb()] }]), /summary/);
    assert.throws(
      () => validateRegistry([{ name: 'n', summary: 's', verbs: [verb({ summary: '' })] }]),
      /summary/,
    );
    assert.throws(
      () => validateRegistry([{ name: 'n', summary: 's', verbs: [verb(), verb()] }]),
      /duplicate verb/,
    );
    assert.throws(
      () =>
        validateRegistry([
          { name: 'n', summary: 's', verbs: [verb()] },
          { name: 'n', summary: 's', verbs: [verb()] },
        ]),
      /duplicate noun/,
    );
    assert.throws(
      () =>
        validateRegistry([
          {
            name: 'n',
            summary: 's',
            verbs: [verb({ options: [{ name: 'json', type: 'boolean' }] })],
          },
        ]),
      /collides/,
    );
  });

  test('validateRegistry checks option shorts, defaults and argument order', () => {
    const withOptions = (...options) => [
      { name: 'n', summary: 's', verbs: [{ name: 'list', summary: 's', run() {}, options }] },
    ];
    const string = { name: 'size', type: 'string', choices: ['s', 'l'] };
    validateRegistry(withOptions({ ...string, short: 'z', default: 's' }));
    assert.throws(() => validateRegistry(withOptions({ ...string, short: 'zz' })), /one letter/);
    assert.throws(() => validateRegistry(withOptions({ ...string, short: '-' })), /one letter/);
    assert.throws(() => validateRegistry(withOptions({ ...string, short: 'h' })), /taken/);
    assert.throws(() => validateRegistry(withOptions({ ...string, default: 'xl' })), /choices/);
    assert.throws(
      () => validateRegistry(withOptions({ name: 'flag', type: 'boolean', choices: ['a'] })),
      /choices/,
    );
    const args = [{ name: 'a' }, { name: 'b', required: true }];
    assert.throws(
      () =>
        validateRegistry([{ name: 'n', summary: 's', verbs: [{ name: 'list', summary: 's', run() {}, args }] }]),
      /follows an optional/,
    );
  });
});

describe('help', () => {
  test('root help lists all 8 nouns, for no args, --help and -h', async () => {
    for (const argv of [[], ['--help'], ['-h']]) {
      const r = await drive(argv);
      assert.equal(r.code, 0, argv.join(' '));
      for (const name of NOUN_NAMES) assert.match(r.stdout, new RegExp(`^  ${name} {2,}\\S`, 'm'));
      assert.match(r.stdout, /Run `rebeep <noun>` to list its verbs\./);
    }
  });

  test('root and noun help state where options go', async () => {
    for (const argv of [[], ['vm']]) {
      const r = await drive(argv);
      assert.match(r.stdout, /Global options go anywhere; a verb's own options go after the verb\./);
    }
  });

  test('noun help lists the verbs with their argument synopsis', () => {
    const r = runRebeep(['vm']);
    assert.equal(r.code, 0);
    for (const verb of ['list', 'show', 'create', 'run', 'snapshot', 'reset']) {
      assert.match(r.stdout, new RegExp(`^  ${verb}\\b`, 'm'));
    }
    assert.match(r.stdout, /^ {2}run <vm> {2,}Start a VM/m);
  });

  test('verb help shows synopsis, arguments and options', () => {
    const r = runRebeep(['vm', 'run', '--help']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Usage: rebeep vm run <vm> \[options\]/);
    assert.match(r.stdout, /<vm>/);
    assert.match(r.stdout, /--install/);
    assert.match(r.stdout, /--json/);
  });

  test('verb help shows choices, defaults and value names', async () => {
    const r = await drive(['test', 'run', '--help']);
    assert.match(r.stdout, /--suite <name>/);
    assert.match(r.stdout, /one of: tools, interpreter, vm, all; default: all/);
  });

  test('exactly the destructive verbs list --yes and --preview', async () => {
    const expected = ['env clean', 'env reset', 'media remove', 'vm create', 'vm reset', 'vm snapshot'];
    const found = [];
    for (const noun of nouns) {
      for (const verb of noun.verbs) {
        const r = await drive([noun.name, verb.name, '--help']);
        const hasYes = /^ {2}--yes\b/m.test(r.stdout);
        const hasPreview = /^ {2}--preview\b/m.test(r.stdout);
        assert.equal(hasYes, hasPreview, `${noun.name} ${verb.name}`);
        if (hasYes) found.push(`${noun.name} ${verb.name}`);
      }
    }
    assert.deepEqual(found.sort(), expected);
  });

  test('every verb answers --help with exit 0 and its own synopsis', async () => {
    for (const noun of nouns) {
      for (const verb of noun.verbs) {
        const r = await drive([noun.name, verb.name, '--help']);
        assert.equal(r.code, 0, `${noun.name} ${verb.name}`);
        assert.match(r.stdout, new RegExp(`Usage: rebeep ${noun.name} ${verb.name}\\b`));
        assert.match(r.stdout, /Examples:/);
        assert.doesNotMatch(r.stdout, /--version/);
      }
    }
  });

  test('--json wraps help in an envelope', async () => {
    const r = await drive(['vm', '--help', '--json']);
    assert.equal(r.code, 0);
    const env = JSON.parse(r.stdout);
    assert.equal(env.ok, true);
    assert.match(env.data.help, /rebeep vm/);
  });
});

describe('usage errors (exit 2)', () => {
  const VM_SYNOPSIS = 'Usage: rebeep vm <verb> [args] [options]';
  const cases = [
    [['nope'], /unknown noun 'nope'/, ROOT_SYNOPSIS],
    [['vm', 'nope'], /unknown verb 'nope'/, VM_SYNOPSIS],
    [['vm', 'list', '--bogus'], /bogus/, 'Usage: rebeep vm list [options]'],
    [['vm', 'create'], /missing argument <vm>/, 'Usage: rebeep vm create <vm> [options]'],
    [['vm', 'list', 'extra'], /unexpected argument 'extra'/, 'Usage: rebeep vm list [options]'],
    [['test', 'run', '--suite', 'nope'], /one of: tools, interpreter, vm, all/, 'Usage: rebeep test run [options]'],
    [['vm', 'run', 'x', '--preview'], /preview/, 'Usage: rebeep vm run <vm> [options]'],
    [['--bogus'], /unknown option '--bogus'/, ROOT_SYNOPSIS],
    [['vm', '--bogus'], /unknown option '--bogus'/, VM_SYNOPSIS],
    [['--home'], /--home needs a folder path/, ROOT_SYNOPSIS],
    [['vm', 'list', '--home'], /--home needs a folder path/, ROOT_SYNOPSIS],
    [['--home', '--json', 'vm'], /--home needs a folder path/, ROOT_SYNOPSIS],
    [['--home', '', 'vm'], /--home needs a folder path/, ROOT_SYNOPSIS],
    [['vm', 'list', '--version'], /version/, 'Usage: rebeep vm list [options]'],
  ];
  for (const [argv, pattern, synopsis] of cases) {
    test(`rebeep ${argv.join(' ')}`, async () => {
      const r = await drive(argv);
      assert.equal(r.code, 2);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, pattern);
      assert.ok(r.stderr.includes(synopsis), `${synopsis}\n${r.stderr}`);
      assert.match(r.stderr, /^hint: /m);
    });
  }

  test('a verb option before the verb says it must come after', async () => {
    const r = await drive(['test', '--suite', 'tools', 'run']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /option '--suite' must come after the verb/);
    assert.match(r.stderr, /a verb's own options go after the verb/);
    const short = await drive(['--yes', 'vm', 'reset', 'x']);
    assert.equal(short.code, 2);
    assert.match(short.stderr, /option '--yes' must come after the verb/);
  });

  test('global options still work before and after the verb', async () => {
    const seen = [];
    const registry = fakeNouns(seen);
    for (const argv of [
      ['--json', '--verbose', 'thing', 'list'],
      ['thing', '--json', 'list', '--verbose'],
      ['thing', 'list', '--json', '--verbose'],
    ]) {
      const r = await drive(argv, { registry });
      assert.equal(r.code, 0, argv.join(' '));
      assert.equal(JSON.parse(r.stdout).ok, true);
    }
    assert.equal(seen.length, 3);
    assert.ok(seen.every((ctx) => ctx.json && ctx.verbose));
  });

  test('--help wins over an unknown option after the verb', async () => {
    const r = await drive(['vm', 'list', '--bogus', '--help']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Usage: rebeep vm list \[options\]/);
    assert.equal(r.stderr, '');
  });

  test('--json is not a flag after --', async () => {
    const seen = [];
    const r = await drive(['thing', 'list', '--', '--json'], { registry: fakeNouns(seen) });
    assert.equal(r.code, 0);
    assert.equal(seen[0].json, false);
    assert.deepEqual(seen[0].args, { which: '--json' });
    assert.match(r.stdout, /^items:/);
  });
});

describe('--json', () => {
  test('a failing verb gives one failure envelope and exit 1', () => {
    const missing = path.join(os.tmpdir(), 'rebeep-no-such-folder-' + process.pid);
    const r = runRebeep(['media', 'add', 'msdos622', missing, '--json']);
    assert.equal(r.code, 1);
    const env = JSON.parse(r.stdout);
    assert.equal(env.ok, false);
    assert.equal(env.error.code, 1);
    assert.ok(env.error.message.length > 0);
  });

  test('usage errors are envelopes with code 2', async () => {
    const r = await drive(['vm', 'nope', '--json']);
    assert.equal(r.code, 2);
    const env = JSON.parse(r.stdout);
    assert.equal(env.ok, false);
    assert.equal(env.error.code, 2);
  });

  test('success prints exactly the envelope, one line', async () => {
    const r = await drive(['thing', 'list', '--json'], { registry: fakeNouns() });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, `${JSON.stringify({ ok: true, data: { items: [1, 2], nested: { a: 'b' } } })}\n`);
  });

  test('log output goes to stderr and stdout holds only the envelope', async () => {
    const r = await drive(['thing', 'status', '--json', '--verbose'], { registry: fakeNouns() });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, `${JSON.stringify({ ok: true, data: { done: true } })}\n`);
    for (const text of ['say-info', 'say-step', 'say-ok', 'say-warn', 'say-debug', 'say-raw', 'A  B']) {
      assert.ok(r.stderr.includes(text), `${text} missing from stderr`);
    }
  });

  test('without --json, info-level output goes to stdout and warnings to stderr', async () => {
    const r = await drive(['thing', 'status'], { registry: fakeNouns() });
    assert.equal(r.code, 0);
    for (const text of ['say-info', 'say-step', 'say-ok', 'say-raw', 'A  B']) {
      assert.ok(r.stdout.includes(text), `${text} missing from stdout`);
    }
    assert.match(r.stderr, /warning: say-warn/);
    assert.doesNotMatch(r.stderr, /say-debug/);
  });

  test('CliError data and hint reach the envelope', async () => {
    const r = await drive(['thing', 'verify', '--json'], { registry: fakeNouns() });
    assert.equal(r.code, 3);
    assert.deepEqual(JSON.parse(r.stdout), {
      ok: false,
      error: { message: 'mismatch', code: 3 },
      data: { file: 'x' },
    });
    const hinted = await drive(['thing', 'check', '--json'], { registry: fakeNouns() });
    assert.equal(JSON.parse(hinted.stdout).error.hint, 'try again');
  });
});

describe('createLog', () => {
  function logWith(options = {}) {
    const s = captureStreams();
    if (options.tty) {
      s.stdout.isTTY = true;
      s.stderr.isTTY = true;
    }
    const { tty: _tty, ...rest } = options;
    const log = createLog({ stdout: s.stdout, stderr: s.stderr, env: {}, ...rest });
    return { log, s };
  }
  const speak = (log) => {
    log.info('i');
    log.step('s');
    log.ok('o');
    log.table([{ a: 't' }], [{ key: 'a', label: 'A' }]);
    log.raw('r');
    log.warn('w');
    log.error('e');
  };

  test('routes info, step, ok, table and raw to stdout; warn and error to stderr', () => {
    const { log, s } = logWith();
    speak(log);
    assert.equal(s.out(), 'i\n==> s\nok: o\nA\nt\nr\n');
    assert.equal(s.err(), 'warning: w\nerror: e\n');
  });

  test('json mode sends everything to stderr', () => {
    const { log, s } = logWith({ json: true });
    speak(log);
    assert.equal(s.out(), '');
    assert.equal(s.err(), 'i\n==> s\nok: o\nA\nt\nr\nwarning: w\nerror: e\n');
  });

  test('debug prints to stderr only with verbose', () => {
    const quiet = logWith();
    quiet.log.debug('d');
    assert.equal(quiet.s.out() + quiet.s.err(), '');
    const loud = logWith({ verbose: true });
    loud.log.debug('d');
    assert.equal(loud.s.out(), '');
    assert.equal(loud.s.err(), 'debug: d\n');
  });

  test('table aligns columns and leaves no trailing spaces', () => {
    const { log, s } = logWith();
    log.table(
      [
        { name: 'a', state: 'running', note: undefined },
        { name: 'longer', state: 'off', note: 'x' },
      ],
      [
        { key: 'name', label: 'NAME' },
        { key: 'state', label: 'STATE' },
        { key: 'note', label: 'NOTE' },
      ],
    );
    assert.equal(
      s.out(),
      ['NAME    STATE    NOTE', 'a       running', 'longer  off      x', ''].join('\n'),
    );
  });

  test('raw adds a final newline only when missing', () => {
    const { log, s } = logWith();
    log.raw('one');
    log.raw('two\n');
    assert.equal(s.out(), 'one\ntwo\n');
  });

  test('color is used only on a TTY, without NO_COLOR, and unless color is false', () => {
    const ESC = '\x1b[';
    const colored = logWith({ tty: true });
    colored.log.ok('o');
    colored.log.warn('w');
    colored.log.error('e');
    assert.ok(colored.s.out().includes(ESC));
    assert.ok(colored.s.err().includes(ESC));

    const plain = [
      logWith(),
      logWith({ tty: true, env: { NO_COLOR: '1' } }),
      logWith({ tty: true, color: false }),
    ];
    for (const { log, s } of plain) {
      log.ok('o');
      log.warn('w');
      log.error('e');
      assert.ok(!s.out().includes(ESC) && !s.err().includes(ESC));
    }
    const emptyNoColor = logWith({ tty: true, env: { NO_COLOR: '' } });
    emptyNoColor.log.ok('o');
    assert.ok(emptyNoColor.s.out().includes(ESC));
  });

  test('in json mode color follows stderr, not stdout', () => {
    const s = captureStreams();
    s.stdout.isTTY = true;
    const log = createLog({ json: true, stdout: s.stdout, stderr: s.stderr, env: {} });
    log.ok('o');
    assert.ok(!s.err().includes('\x1b['));
  });
});

describe('running verbs', () => {
  test('args, option defaults and global flags reach ctx', async () => {
    const seen = [];
    const r = await drive(['thing', 'list', 'one', '--verbose'], { registry: fakeNouns(seen) });
    assert.equal(r.code, 0);
    const [ctx] = seen;
    assert.equal(ctx.noun, 'thing');
    assert.equal(ctx.verb, 'list');
    assert.deepEqual(ctx.args, { which: 'one' });
    assert.deepEqual(ctx.opts, { size: 's', loud: false });
    assert.equal(ctx.verbose, true);
    assert.equal(ctx.json, false);
    assert.equal(ctx.preview, false);
    assert.equal(ctx.yes, false);
  });

  test('after the verb, args and options interleave and short flags work', async () => {
    const seen = [];
    await drive(['thing', 'list', '--size', 'l', 'one', '-l'], { registry: fakeNouns(seen) });
    assert.deepEqual(seen[0].args, { which: 'one' });
    assert.deepEqual(seen[0].opts, { size: 'l', loud: true });
    await drive(['--json', 'thing', 'list', '--size=l'], { registry: fakeNouns(seen) });
    assert.equal(seen[1].opts.size, 'l');
    assert.deepEqual(seen[1].args, {});
  });

  test('--home reaches ctx.paths.home, resolved against cwd', async () => {
    const seen = [];
    const cwd = path.resolve(path.sep, 'work');
    await drive(['thing', 'list', '--home', 'h'], { registry: fakeNouns(seen), cwd });
    assert.equal(seen[0].paths.home, path.join(cwd, 'h'));
    assert.equal(seen[0].paths.vm('a').cImg, path.join(cwd, 'h', 'vms', 'a', 'c.img'));
    await drive(['thing', 'list'], {
      registry: fakeNouns(seen),
      env: { REBEEP_HOME: path.resolve(path.sep, 'e') },
    });
    assert.equal(seen[1].paths.home, path.resolve(path.sep, 'e'));
    assert.equal(seen[1].repo.root, repoRoot());
    await drive(['thing', 'list'], { registry: fakeNouns(seen), env: { REBEEP_HOME: 'rel' }, cwd });
    assert.equal(seen[2].paths.home, path.join(cwd, 'rel'));
  });

  test('render runs without --json; the default renderer prints key/value text', async () => {
    const rendered = await drive(['thing', 'show'], { registry: fakeNouns() });
    assert.equal(rendered.stdout, 'rendered:plain text\n');
    const json = await drive(['thing', 'show', '--json'], { registry: fakeNouns() });
    assert.doesNotMatch(json.stdout, /rendered/);
    const plain = await drive(['thing', 'list'], { registry: fakeNouns() });
    assert.equal(plain.stdout, 'items:\n  - 1\n  - 2\nnested:\n  a: b\n');
  });

  test('CliError prints message and hint on stderr with its exit code', async () => {
    const r = await drive(['thing', 'check'], { registry: fakeNouns() });
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /error: boom/);
    assert.match(r.stderr, /hint: try again/);
    assert.equal((await drive(['thing', 'verify'], { registry: fakeNouns() })).code, 3);
  });

  test('unexpected errors exit 1 and show the stack only with --verbose', async () => {
    const quiet = await drive(['thing', 'fetch'], { registry: fakeNouns() });
    assert.equal(quiet.code, 1);
    assert.match(quiet.stderr, /kaboom/);
    assert.doesNotMatch(quiet.stderr, /\n\s+at /);
    const loud = await drive(['thing', 'fetch', '--verbose'], { registry: fakeNouns() });
    assert.match(loud.stderr, /\n\s+at /);
  });

  test('non-Error throws still resolve to exit 1 with a message', async () => {
    for (const [verb, message] of [
      ['add', 'unknown error'],
      ['create', 'string failure'],
      ['deploy', 'object failure'],
    ]) {
      const human = await drive(['thing', verb], { registry: fakeNouns() });
      assert.equal(human.code, 1, verb);
      assert.ok(human.stderr.includes(message), human.stderr);
      const json = await drive(['thing', verb, '--json'], { registry: fakeNouns() });
      assert.equal(json.code, 1, verb);
      assert.equal(JSON.parse(json.stdout).error.message, message);
    }
  });

  test('a bad VM name from paths is a usage failure, exit 2', async () => {
    const r = await drive(['thing', 'setup', '--json'], { registry: fakeNouns() });
    assert.equal(r.code, 2);
    const env = JSON.parse(r.stdout);
    assert.equal(env.error.code, 2);
    assert.match(env.error.message, /invalid vm name/);
  });
});

describe('stubs', () => {
  test('notImplemented names its noun and verb, from arguments or from ctx', async () => {
    await assert.rejects(notImplemented('vm', 'run')(), (err) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.code, 1);
      assert.equal(err.message, 'rebeep vm run is not implemented yet');
      return true;
    });
    await assert.rejects(
      notImplemented()({ noun: 'disk', verb: 'deploy' }),
      /rebeep disk deploy is not implemented yet/,
    );
  });
});

describe('destructive verbs', () => {
  test('without --yes on a non-TTY, confirm exits 2 with a hint', async () => {
    const r = await drive(['thing', 'remove', '7'], { registry: fakeNouns() });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /thing remove needs --yes when not run interactively/);
    assert.match(r.stderr, /--preview/);
  });

  test('--yes confirms', async () => {
    const seen = [];
    const r = await drive(['thing', 'remove', '7', '--yes', '--json'], { registry: fakeNouns(seen) });
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.stdout).data, { removed: true });
    assert.equal(seen[0].yes, true);
  });

  test('--preview reaches ctx.preview', async () => {
    const seen = [];
    const r = await drive(['thing', 'remove', '7', '--preview', '--json'], { registry: fakeNouns(seen) });
    assert.equal(r.code, 0);
    assert.equal(seen[0].preview, true);
    assert.deepEqual(JSON.parse(r.stdout).data, { preview: true });
  });

  test('on a TTY, y, Y and yes confirm; n and an empty answer decline', async () => {
    for (const [input, removed] of [
      ['y\n', true],
      ['Y\n', true],
      ['yes\n', true],
      ['n\n', false],
      ['\n', false],
      ['maybe\n', false],
    ]) {
      const r = await drive(['thing', 'remove', '7', '--json'], {
        registry: fakeNouns(),
        tty: true,
        input,
      });
      assert.deepEqual(JSON.parse(r.stdout).data, { removed }, JSON.stringify(input));
      assert.match(r.stderr, /Remove it\? \[y\/N\]/);
    }
  });

  test('on a TTY, closed input declines', async () => {
    const s = captureStreams();
    s.stdin.isTTY = true;
    s.stdin.end();
    const code = await runCli(['thing', 'remove', '7', '--json'], {
      nouns: fakeNouns(),
      stdout: s.stdout,
      stderr: s.stderr,
      stdin: s.stdin,
      env: {},
    });
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(s.out()).data, { removed: false });
  });
});

describe('--version', () => {
  test('prints the package.json version', () => {
    const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot(), 'package.json'), 'utf8'));
    const r = runRebeep(['--version']);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), version);
  });
});
