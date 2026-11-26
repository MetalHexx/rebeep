// The reference-screen check: parses the `.scr` files in tests/screens, reads a 4000-byte text-screen dump
// (what `RBSTUDIO /DUMP:<screen>` writes) into the same shape, and compares them cell by cell.
//
// A `.scr` file (UTF-8, LF): line 1 `# ReBeep reference screen: <screen>, <view>`, line 2 `# <sample state>`,
// line 3 `glyphs`, 25 rows of 80 characters, `fg`, 25 rows of 80 upper-case hex digits, `bg`, 25 more.
// Two cells match when they have the same glyph and background, and the same foreground unless the glyph is a space.

export const COLS = 80;
export const ROWS = 25;

// One CP437 byte to the character the IBM VGA font draws for it: bytes 0-31 are the smiley-and-arrows set, 127 is
// the house, byte 0 is a space (the reference files write it as one).
const CP437 = Array.from(
  ' ☺☻♥♦♣♠•◘○◙♂♀♪♫☼' +
    '►◄↕‼¶§▬↨↑↓→←∟↔▲▼' +
    ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂' +
    'ÇüéâäàåçêëèïîìÄÅ' +
    'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
    'áíóúñÑªº¿⌐¬½¼¡«»' +
    '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
    '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
    '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
    'αßΓπΣσµτΦΘΩδ∞φε∩' +
    '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ',
);
const CP437_SET = new Set(CP437);

const GLYPHS_AT = 3;
const FG_AT = 29;
const BG_AT = 55;
const LINE_COUNT = 80;

/** Parses the text of a `.scr` file into `{ glyphs: string[25], fg: number[25][80], bg: number[25][80] }`. Throws on a bad format. */
export function parseScr(text) {
  if (text.includes('\r')) throw new Error('a .scr file uses LF line ends, found CR');
  if (!text.endsWith('\n')) throw new Error('the last line must end with a line feed');
  const lines = text.slice(0, -1).split('\n');
  if (lines.length !== LINE_COUNT) throw new Error(`expected ${LINE_COUNT} lines, found ${lines.length}`);
  if (!lines[0].startsWith('# ReBeep reference screen: ')) throw new Error('line 1 must start "# ReBeep reference screen: "');
  if (!lines[1].startsWith('# ')) throw new Error('line 2 must start "# "');
  for (const [at, name] of [[GLYPHS_AT - 1, 'glyphs'], [FG_AT - 1, 'fg'], [BG_AT - 1, 'bg']]) {
    if (lines[at] !== name) throw new Error(`line ${at + 1} must be "${name}"`);
  }

  const glyphs = [];
  const fg = [];
  const bg = [];
  for (let row = 0; row < ROWS; row++) {
    const glyphLine = lines[GLYPHS_AT + row];
    const cells = Array.from(glyphLine);
    if (cells.length !== COLS) throw new Error(`line ${GLYPHS_AT + row + 1}: ${cells.length} glyphs, expected ${COLS}`);
    const bad = cells.find((c) => !CP437_SET.has(c));
    if (bad !== undefined) throw new Error(`line ${GLYPHS_AT + row + 1}: U+${bad.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} is not a CP437 glyph`);
    glyphs.push(glyphLine);
    fg.push(parseHexRow(lines[FG_AT + row], FG_AT + row + 1));
    bg.push(parseHexRow(lines[BG_AT + row], BG_AT + row + 1));
  }
  return { glyphs, fg, bg };
}

function parseHexRow(line, lineNo) {
  if (!/^[0-9A-F]{80}$/.test(line)) throw new Error(`line ${lineNo}: expected 80 upper-case hex digits`);
  return Array.from(line, (c) => parseInt(c, 16));
}

/** Reads a 4000-byte text-screen dump (character, attribute for each cell, row by row; blink off) into the `.scr` shape. */
export function dumpToCells(buf) {
  if (buf.length !== COLS * ROWS * 2) throw new Error(`a screen dump is ${COLS * ROWS * 2} bytes, got ${buf.length}`);
  const glyphs = [];
  const fg = [];
  const bg = [];
  for (let row = 0; row < ROWS; row++) {
    let glyphRow = '';
    const fgRow = [];
    const bgRow = [];
    for (let col = 0; col < COLS; col++) {
      const at = (row * COLS + col) * 2;
      const attr = buf[at + 1];
      glyphRow += CP437[buf[at]];
      fgRow.push(attr & 0x0f);
      bgRow.push(attr >> 4);
    }
    glyphs.push(glyphRow);
    fg.push(fgRow);
    bg.push(bgRow);
  }
  return { glyphs, fg, bg };
}

/**
 * The cells where `got` differs from `want` by the compare rule, in row order, one entry per cell:
 * `{ row, col, want: { ch, fg, bg }, got: { ch, fg, bg }, what }` with `what` the first of 'glyph', 'bg', 'fg' that differs.
 */
export function compareScreens(want, got) {
  const cell = (screen, row, col) => ({
    ch: Array.from(screen.glyphs[row])[col],
    fg: screen.fg[row][col],
    bg: screen.bg[row][col],
  });
  const differences = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const w = cell(want, row, col);
      const g = cell(got, row, col);
      let what = null;
      if (w.ch !== g.ch) what = 'glyph';
      else if (w.bg !== g.bg) what = 'bg';
      else if (w.ch !== ' ' && w.fg !== g.fg) what = 'fg';
      if (what) differences.push({ row, col, want: w, got: g, what });
    }
  }
  return differences;
}
