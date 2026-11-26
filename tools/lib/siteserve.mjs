import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { CliError } from './cli.mjs';
import { buildSite } from './site.mjs';
import { DEV_CSS, DEV_JS, previewHtml } from './sitedev.mjs';

export const DEFAULT_PORT = 8086;
const HOST = '127.0.0.1';
const BASE = '/rebeep/';
const DEV = `${BASE}__dev/`;
const PREVIEW = `${DEV}preview`;
const PREVIEW_HTML = previewHtml(BASE);
const DEBOUNCE_MS = 150;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
};

const INJECTION = `<link rel="stylesheet" href="${DEV}dev.css">\n<script src="${DEV}dev.js" defer></script>\n`;

/** Adds the dev client just before the first `</head>`; html without one is returned as is. */
const inject = (html) => html.replace(/<\/head>/i, (closing) => `${INJECTION}${closing}`);

function send(req, res, status, type, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const notFound = (req, res) => send(req, res, 404, MIME['.txt'], 'not found');

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Content-Length': 0, 'Cache-Control': 'no-store' });
  res.end();
}

/** Maps a `/rebeep/...` request path to a file under `root`, or null when it would leave `root`. */
function resolveInside(root, requestPath) {
  let relative;
  try {
    relative = decodeURIComponent(requestPath.slice(BASE.length));
  } catch {
    return null;
  }
  if (relative.includes('\0')) return null;
  const target = path.resolve(root, relative);
  return target === root || target.startsWith(root + path.sep) ? target : null;
}

const statOrNull = (file) => fs.promises.stat(file).catch(() => null);

function listenError(err, port) {
  const hint = 'Stop whatever is using it, or pick another port with --port <n>.';
  if (err?.code === 'EADDRINUSE') return new CliError(`port ${port} is already in use`, { hint });
  if (err?.code === 'EACCES') return new CliError(`not allowed to listen on port ${port}`, { hint });
  return err;
}

/**
 * Builds the page, then serves `build/site/` at `http://127.0.0.1:<port>/rebeep/` (127.0.0.1 only)
 * and rebuilds on every change under `site/`, telling open pages to reload over Server-Sent Events.
 * The dev client is injected into served HTML only. `__dev/preview` shows the page at desktop, tablet
 * and phone widths side by side; it is generated in memory, never part of the build. `release` is
 * stamped on every rebuild; a failed rebuild is logged and the last good build keeps being served.
 * Port 0 picks a free one. Resolves to `{ url, previewUrl, port, out, stamped, close }`; `close()`
 * stops the watcher, the open event streams and the server. Throws a `CliError` when the build
 * fails or the port is taken.
 */
export async function startSiteServer({ repo, release = null, port = DEFAULT_PORT, log, debounceMs = DEBOUNCE_MS }) {
  const root = path.resolve(repo.siteBuild);
  const built = buildSite({ repo, release, out: root });

  const clients = new Set();

  function events(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  async function serveFile(req, res, requestPath) {
    let target = resolveInside(root, requestPath);
    if (!target) return notFound(req, res);
    let stat = await statOrNull(target);
    if (stat?.isDirectory()) {
      if (!requestPath.endsWith('/')) return redirect(res, `${requestPath}/`);
      target = path.join(target, 'index.html');
      stat = await statOrNull(target);
    }
    if (!stat?.isFile()) return notFound(req, res);
    const extension = path.extname(target).toLowerCase();
    const body = await fs.promises.readFile(target);
    const served = extension === '.html' ? inject(body.toString('utf8')) : body;
    return send(req, res, 200, MIME[extension] ?? 'application/octet-stream', served);
  }

  async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(req, res, 405, MIME['.txt'], 'method not allowed', { Allow: 'GET, HEAD' });
    }
    const requestPath = (req.url ?? '/').split(/[?#]/)[0];
    if (requestPath === '/' || requestPath === BASE.slice(0, -1)) return redirect(res, BASE);
    if (!requestPath.startsWith(BASE)) return notFound(req, res);
    if (requestPath.startsWith(DEV)) {
      if (requestPath === `${DEV}events`) return events(req, res);
      if (requestPath === `${DEV}dev.js`) return send(req, res, 200, MIME['.js'], DEV_JS);
      if (requestPath === `${DEV}dev.css`) return send(req, res, 200, MIME['.css'], DEV_CSS);
      if (requestPath === PREVIEW) return send(req, res, 200, MIME['.html'], PREVIEW_HTML);
      return notFound(req, res);
    }
    return serveFile(req, res, requestPath);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log.error(`${req.method} ${req.url}: ${err.message}`);
      if (res.headersSent) res.destroy();
      else send(req, res, 500, MIME['.txt'], 'server error');
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  }).catch((err) => {
    throw listenError(err, port);
  });
  server.on('error', (err) => log.error(`server error: ${err.message}`));

  function rebuild() {
    try {
      buildSite({ repo, release, out: root });
    } catch (err) {
      log.error(`rebuild failed, still serving the last good build: ${err.message}`);
      return;
    }
    log.ok('rebuilt, reloading the page');
    for (const res of clients) res.write('event: reload\ndata: reload\n\n');
  }

  let timer = null;
  let watcher;
  try {
    watcher = fs.watch(repo.site, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(rebuild, debounceMs);
    });
  } catch (err) {
    await new Promise((resolve) => server.close(resolve));
    throw new CliError(`cannot watch ${repo.site}: ${err.message}`);
  }
  watcher.on('error', (err) => log.warn(`watching ${repo.site} failed: ${err.message}`));

  let closing = null;
  const close = () => {
    closing ??= (async () => {
      clearTimeout(timer);
      watcher.close();
      for (const res of clients) res.end();
      clients.clear();
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    })();
    return closing;
  };

  const boundPort = server.address().port;
  const origin = `http://${HOST}:${boundPort}`;
  return { url: `${origin}${BASE}`, previewUrl: `${origin}${PREVIEW}`, port: boundPort, out: built.out, stamped: built.stamped, close };
}
