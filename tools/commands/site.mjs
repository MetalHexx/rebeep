import { UsageError } from '../lib/cli.mjs';
import { buildSite, githubApi, readLatestRelease, readRepoSlug, requireSite } from '../lib/site.mjs';
import { DEFAULT_PORT, startSiteServer } from '../lib/siteserve.mjs';

const OFFLINE_OPTION = {
  name: 'offline',
  type: 'boolean',
  description: 'Skip the release lookup, so the page keeps its plain latest-release link',
};

/**
 * Looks up the latest release once. A failed lookup is a warning, never a failure: the result is
 * then `{ release: null, fallback: reason }` and the page keeps its plain latest-release link.
 */
async function lookupRelease(ctx) {
  if (ctx.opts.offline) return { release: null, fallback: 'offline' };
  const slug = readRepoSlug(ctx.repo);
  const { apiBase, token } = githubApi(ctx.env);
  ctx.log.step(`Reading the latest release of ${slug}`);
  const found = await readLatestRelease({ slug, apiBase, token });
  if (found.fallback) {
    ctx.log.warn(`the page keeps its plain latest-release link: ${found.fallback}`);
  }
  return { release: found.release ?? null, fallback: found.fallback ?? null };
}

const stampData = ({ out, stamped }, { release, fallback }) => ({
  out,
  stamped,
  tag: release?.tag ?? null,
  date: release?.date ?? null,
  fallback,
});

async function siteCreate(ctx) {
  requireSite(ctx.repo);
  const lookup = await lookupRelease(ctx);
  const built = buildSite({ repo: ctx.repo, release: lookup.release });
  return stampData(built, lookup);
}

const stampSummary = (data) =>
  data.stamped ? `stamped ${data.tag}, ${data.date}` : `not stamped, fallback link kept (${data.fallback})`;

function parsePort(value) {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
    throw new UsageError(`--port must be a whole number from 1 to 65535 (got '${value}')`, {
      hint: 'For example: --port 8086',
    });
  }
  return port;
}

/** Resolves on Ctrl+C (or a termination signal). */
function untilInterrupted() {
  return new Promise((resolve) => {
    const signals = ['SIGINT', 'SIGTERM'];
    const stop = () => {
      for (const signal of signals) process.off(signal, stop);
      resolve();
    };
    for (const signal of signals) process.on(signal, stop);
  });
}

async function siteRun(ctx) {
  const port = parsePort(ctx.opts.port);
  requireSite(ctx.repo);
  const lookup = await lookupRelease(ctx);
  const server = await startSiteServer({ repo: ctx.repo, release: lookup.release, port, log: ctx.log });
  try {
    ctx.log.ok(`built ${server.out} (${stampSummary(stampData(server, lookup))})`);
    ctx.log.info(`Serving ${server.url} (Ctrl+C to stop)`);
    await untilInterrupted();
  } finally {
    await server.close();
  }
  return { url: server.url, ...stampData(server, lookup) };
}

export default {
  name: 'site',
  summary: 'The ReBeep product page',
  verbs: [
    {
      name: 'create',
      summary: 'Build the page into build/site/',
      description:
        'Copies site/ to build/site/ and stamps the latest GitHub release (version, date, download links) into the page. When the lookup fails the page keeps its plain latest-release link, with a warning.',
      args: [],
      options: [OFFLINE_OPTION],
      destructive: false,
      examples: ['rebeep site create', 'rebeep site create --offline'],
      run: siteCreate,
      render: (data, log) => log.ok(`built ${data.out} (${stampSummary(data)})`),
    },
    {
      name: 'run',
      summary: 'Preview the page locally, rebuilding and reloading on every save',
      description:
        'Builds the page, serves it at http://127.0.0.1:<port>/rebeep/ (this machine only), and rebuilds and reloads open pages whenever a file under site/ changes. The release is looked up once, at start-up. Stop it with Ctrl+C.',
      args: [],
      options: [
        {
          name: 'port',
          type: 'string',
          valueName: 'n',
          default: String(DEFAULT_PORT),
          description: 'Port to listen on',
        },
        OFFLINE_OPTION,
      ],
      destructive: false,
      examples: ['rebeep site run', 'rebeep site run --port 9000 --offline'],
      run: siteRun,
      render: (_data, log) => log.info('Preview stopped'),
    },
  ],
};
