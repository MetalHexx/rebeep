import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { compareScreens, dumpToCells, parseScr } from '../lib/screens.mjs';
import { repoLayout } from '../lib/paths.mjs';
import { makeTempDir, removeDir, runRebeep } from './helpers.mjs';

const hexRow = (digit) => digit.repeat(80);

/** The text of a valid .scr: `glyph` in every cell, `fg` and `bg` hex digits everywhere. */
function scrText({ glyph = ' ', fg = '7', bg = '0' } = {}) {
  return [
    '# ReBeep reference screen: test, vga',
    '# a test state',
    'glyphs',
    ...Array(25).fill(glyph.repeat(80)),
    'fg',
    ...Array(25).fill(hexRow(fg)),
    'bg',
    ...Array(25).fill(hexRow(bg)),
    '',
  ].join('\n');
}

/** A dump of 4000 bytes: every cell `ch` with attribute `attr`. */
function dump(ch, attr) {
  const buf = Buffer.alloc(4000);
  for (let i = 0; i < 2000; i++) {
    buf[i * 2] = ch;
    buf[i * 2 + 1] = attr;
  }
  return buf;
}

describe('parseScr', () => {
  test('reads glyph, foreground and background grids', () => {
    const screen = parseScr(scrText({ glyph: 'x', fg: 'A', bg: '2' }));
    assert.equal(screen.glyphs.length, 25);
    assert.equal(screen.glyphs[24], 'x'.repeat(80));
    assert.equal(screen.fg[3][79], 10);
    assert.equal(screen.bg[0][0], 2);
  });

  test('every reference screen in tests/screens parses', () => {
    const dir = path.join(repoLayout().root, 'tests', 'screens');
    const files = fs.readdirSync(dir).filter((n) => n.endsWith('.scr'));
    assert.ok(files.length > 0);
    for (const file of files) parseScr(fs.readFileSync(path.join(dir, file), 'utf8'));
  });

  test('refuses each format error', () => {
    const good = scrText();
    const lines = good.split('\n');
    const withLine = (n, text) => lines.map((l, i) => (i === n - 1 ? text : l)).join('\n');
    assert.throws(() => parseScr(good.replaceAll('\n', '\r\n')), /CR/);
    assert.throws(() => parseScr(good.slice(0, -1)), /line feed/);
    assert.throws(() => parseScr(`${good}extra\n`), /expected 80 lines/);
    assert.throws(() => parseScr(withLine(1, '# something else')), /line 1/);
    assert.throws(() => parseScr(withLine(2, 'no hash')), /line 2/);
    assert.throws(() => parseScr(withLine(3, 'glyph')), /"glyphs"/);
    assert.throws(() => parseScr(withLine(29, 'FG')), /"fg"/);
    assert.throws(() => parseScr(withLine(55, 'bg ')), /"bg"/);
    assert.throws(() => parseScr(withLine(10, ' '.repeat(79))), /line 10: 79 glyphs/);
    assert.throws(() => parseScr(withLine(10, 'x'.repeat(81))), /line 10: 81 glyphs, expected 80/);
    assert.throws(() => parseScr(withLine(10, 'x'.repeat(79) + '中')), /line 10: U\+4E2D is not a CP437/);
    assert.throws(() => parseScr(withLine(30, hexRow('a'))), /line 30: expected 80 upper-case hex/);
    assert.throws(() => parseScr(withLine(54, hexRow('G'))), /line 54/);
    assert.throws(() => parseScr(withLine(80, '0'.repeat(79))), /line 80/);
  });
});

describe('dumpToCells', () => {
  test('maps CP437 bytes the way the references write them', () => {
    const buf = dump(0x20, 0x07);
    buf[0] = 0x00;
    buf[2] = 0xc9; // double top-left corner
    buf[4] = 0x10; // the menu marker
    buf[6] = 0x7f; // the house
    buf[8] = 0xfb; // the check mark
    buf[10] = 0x01; // smiley
    const { glyphs } = dumpToCells(buf);
    assert.equal(Array.from(glyphs[0]).slice(0, 6).join(''), ' ╔►⌂√☺');
  });

  test('splits the attribute into foreground and a bright background', () => {
    const buf = dump(0x41, 0x1f);
    buf[1] = 0xe4; // yellow background (bit 7 is the bright bit, blink is off), red foreground
    const { fg, bg } = dumpToCells(buf);
    assert.equal(fg[0][0], 4);
    assert.equal(bg[0][0], 14);
    assert.equal(fg[0][1], 15);
    assert.equal(bg[0][1], 1);
  });

  test('refuses a dump that is not 4000 bytes', () => {
    assert.throws(() => dumpToCells(Buffer.alloc(3999)), /4000 bytes/);
  });
});

describe('compareScreens', () => {
  const base = () => dumpToCells(dump(0x41, 0x1f));

  test('equal screens have no differences', () => {
    assert.deepEqual(compareScreens(base(), base()), []);
  });

  test('reports a glyph difference with both cells', () => {
    const got = base();
    got.glyphs[2] = `${got.glyphs[2].slice(0, 5)}B${got.glyphs[2].slice(6)}`;
    assert.deepEqual(compareScreens(base(), got), [
      { row: 2, col: 5, want: { ch: 'A', fg: 15, bg: 1 }, got: { ch: 'B', fg: 15, bg: 1 }, what: 'glyph' },
    ]);
  });

  test('reports foreground and background differences', () => {
    const got = base();
    got.fg[0][0] = 3;
    got.bg[1][1] = 9;
    const diffs = compareScreens(base(), got);
    assert.deepEqual(
      diffs.map((d) => [d.row, d.col, d.what]),
      [[0, 0, 'fg'], [1, 1, 'bg']],
    );
  });

  test('a space compares its background only', () => {
    const want = dumpToCells(dump(0x20, 0x17));
    const got = dumpToCells(dump(0x20, 0x17));
    got.fg[4][4] = 12;
    assert.deepEqual(compareScreens(want, got), []);
    got.bg[4][4] = 12;
    assert.deepEqual(compareScreens(want, got).map((d) => d.what), ['bg']);
  });

  test('a glyph difference is reported once, not again as a colour', () => {
    const want = base();
    const got = base();
    got.glyphs[0] = `Z${got.glyphs[0].slice(1)}`;
    got.fg[0][0] = 0;
    got.bg[0][0] = 0;
    assert.deepEqual(compareScreens(want, got).map((d) => d.what), ['glyph']);
  });
});

/** A fake wcl that writes the `-fe=` output. */
const FAKE_WCL = `import fs from 'node:fs';
const args = process.argv.slice(2);
fs.writeFileSync(args.find((a) => a.startsWith('-fe=')).slice(4), 'MZ fake exe');
`;

/**
 * A fake DOSBox-X that plays RBSTUDIO for DUMPS.BAT: for each /DUMP line it writes the /O: file as a screen of 'A' on
 * attribute 1F (or one 'B' cell different), or records the screen as unknown (exit code 4, no file) in PENDING.TXT.
 */
const FAKE_DOSBOX = `import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const mount = args.find((a) => a.startsWith('MOUNT C '));
const dir = mount.slice('MOUNT C '.length).replace(/^"|"$/g, '');
if (args.includes('T_ALPHA.EXE > RESULT.TXT')) {
  fs.writeFileSync(path.join(dir, 'RESULT.TXT'), 'PASS one' + String.fromCharCode(10) + 'DONE 1' + String.fromCharCode(10));
  process.exit(0);
}
const behaviour = JSON.parse(process.env.FAKE_DUMPS);
const batch = fs.readFileSync(path.join(dir, 'DUMPS.BAT'), 'utf8').split(String.fromCharCode(10)).map((l) => l.trim());
for (const line of batch.filter((l) => l.startsWith('RBSTUDIO'))) {
  const screen = line.split('/DUMP:')[1].split(' ')[0];
  const out = line.split('/O:')[1].split(' ')[0];
  const how = behaviour[screen];
  if (how === 'pending') {
    fs.appendFileSync(path.join(dir, 'PENDING.TXT'), out.split('.')[0] + String.fromCharCode(13, 10));
    continue;
  }
  const buf = Buffer.alloc(4000);
  for (let i = 0; i < 2000; i++) { buf[i * 2] = 0x41; buf[i * 2 + 1] = 0x1f; }
  if (how === 'differ') buf[2 * 83] = 0x42;
  if (how !== 'missing') fs.writeFileSync(path.join(dir, out), buf);
}
`;

describe('test run --suite studio: the screen check, with fake Open Watcom and DOSBox-X', () => {
  const run = (behaviour, { required = false } = {}) => {
    const fakes = makeTempDir('rebeep-screens-fakes-');
    const root = makeTempDir('rebeep-screens-');
    try {
      const put = (rel, text) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
      };
      fs.writeFileSync(path.join(fakes, 'fake-wcl.mjs'), FAKE_WCL);
      fs.writeFileSync(path.join(fakes, 'fake-dosbox.mjs'), FAKE_DOSBOX);
      put('package.json', JSON.stringify({ name: 'x', version: '0.1.0' }));
      put('tests/studio/T_ALPHA.C', 'int main(void) { return 0; }\n');
      put('tests/studio/testlib.c', '/* library */\n');
      put('src/studio/main.c', '/* module */\n');
      put('src/studio/video.c', '/* module */\n');
      put('src/studio/data/SPLASH.ANS', 'art');
      put('src/targets.json', JSON.stringify({ targets: [], files: [{ source: 'studio/data/SPLASH.ANS', deploy: 'REBEEP' }] }));
      put('tests/screens/demo.vga.scr', scrText({ glyph: 'A', fg: 'F', bg: '1' }));
      put('tests/screens/demo.mono.scr', scrText({ glyph: 'A', fg: 'F', bg: '1' }));
      put('tests/screens/later.vga.scr', scrText());
      if (required) put('tests/screens/menu.vga.scr', scrText());
      const result = runRebeep(['test', 'run', '--suite', 'studio', '--json'], {
        env: {
          REBEEP_REPO_ROOT: root,
          REBEEP_WATCOM: process.execPath,
          REBEEP_WATCOM_PREFIX_ARGS: JSON.stringify([path.join(fakes, 'fake-wcl.mjs')]),
          REBEEP_DOSBOX: process.execPath,
          REBEEP_DOSBOX_PREFIX_ARGS: JSON.stringify([path.join(fakes, 'fake-dosbox.mjs')]),
          FAKE_DUMPS: JSON.stringify(behaviour),
        },
      });
      const out = path.join(root, 'build', 'studio-tests');
      return { result, staged: fs.existsSync(path.join(out, 'SPLASH.ANS')), batch: fs.readFileSync(path.join(out, 'DUMPS.BAT'), 'utf8') };
    } finally {
      removeDir(fakes);
      removeDir(root);
    }
  };
  const screensOf = (result) => JSON.parse(result.stdout).data?.suites?.[0].programs.find((p) => p.program === 'SCREENS')
    ?? JSON.parse(result.stdout).error?.data?.suites?.[0].programs.find((p) => p.program === 'SCREENS');

  test('matching dumps pass, an unknown screen is pending and does not fail the run, and the art is staged', () => {
    const { result, staged, batch } = run({ demo: 'match', later: 'pending' });
    assert.equal(result.code, 0, result.stderr);
    const screens = screensOf(result);
    assert.deepEqual(screens.passed, ['demo.mono', 'demo.vga']);
    assert.deepEqual(screens.pending, ['later.vga']);
    assert.ok(staged, 'SPLASH.ANS sits beside RBSTUDIO.EXE');
    assert.match(batch, /RBSTUDIO \/DUMP:demo \/VIEW:MONO \/O:D00\.DMP/);
    assert.match(batch, /RBSTUDIO \/DUMP:demo \/O:D01\.DMP/);
  });

  test('a differing cell fails the run and names the cell', () => {
    const { result } = run({ demo: 'differ', later: 'pending' });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /screen demo\.vga: 1 cells differ: row 1 col 3 glyph: want 'A' fg F bg 1, got 'B' fg F bg 1/);
  });

  test('a pending reference for a screen the program already draws fails the run', () => {
    const { result } = run({ demo: 'match', later: 'pending', menu: 'pending' }, { required: true });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /screen menu\.vga: RBSTUDIO does not draw this screen/);
    assert.deepEqual(screensOf(result).pending, ['later.vga']);
  });

  test('a screen that wrote no dump and was not pending fails', () => {
    const { result } = run({ demo: 'missing', later: 'pending' });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /screen demo\.vga: RBSTUDIO wrote no dump/);
  });
});
