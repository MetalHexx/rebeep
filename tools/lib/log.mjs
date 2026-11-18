const CODES = { green: 32, yellow: 33, red: 31, dim: 2 };

/**
 * Builds the logger commands write through. In JSON mode stdout is reserved for the one
 * envelope, so everything that would go to stdout goes to stderr instead.
 */
export function createLog({
  json = false,
  verbose = false,
  stdout = process.stdout,
  stderr = process.stderr,
  color,
  env = process.env,
} = {}) {
  const out = json ? stderr : stdout;
  const colorOn = (stream) =>
    color !== false && stream.isTTY === true && (env.NO_COLOR === undefined || env.NO_COLOR === '');
  const paint = (stream, name, text) =>
    colorOn(stream) ? `\x1b[${CODES[name]}m${text}\x1b[0m` : text;
  const write = (stream, text) => {
    stream.write(text.endsWith('\n') ? text : `${text}\n`);
  };

  const info = (message) => write(out, String(message));
  const step = (message) => write(out, `${paint(out, 'dim', '==>')} ${message}`);
  const ok = (message) => write(out, `${paint(out, 'green', 'ok:')} ${message}`);
  const warn = (message) => write(stderr, `${paint(stderr, 'yellow', 'warning:')} ${message}`);
  const error = (message) => write(stderr, `${paint(stderr, 'red', 'error:')} ${message}`);
  const debug = (message) => {
    if (verbose) write(stderr, `${paint(stderr, 'dim', 'debug:')} ${message}`);
  };

  /** Writes aligned plain-text columns. `columns` is `[{ key, label }]`. */
  const table = (rows, columns) => {
    const cell = (row, key) => String(row[key] ?? '');
    const widths = columns.map((c) =>
      Math.max(c.label.length, ...rows.map((row) => cell(row, c.key).length)),
    );
    const line = (values) =>
      values
        .map((v, i) => v.padEnd(widths[i]))
        .join('  ')
        .trimEnd();
    write(out, line(columns.map((c) => c.label)));
    for (const row of rows) write(out, line(columns.map((c) => cell(row, c.key))));
  };

  /** Writes text as given, adding a final newline only if it is missing. */
  const raw = (text) => write(out, String(text));

  return { info, step, ok, warn, error, debug, table, raw };
}
