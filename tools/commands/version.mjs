import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../lib/cli.mjs';
import { writeAtomic } from '../lib/fsx.mjs';
import {
  changelogEntries,
  checkVersions,
  compareSemver,
  newestDated,
  nextVersion,
  parseSemver,
  readChangelog,
  readVersion,
  releaseChangelog,
  today,
} from '../lib/version.mjs';

const TAG_PREFIX = 'v';

function versionShow(ctx) {
  const version = readVersion(ctx.repo);
  const md = readChangelog(ctx.repo);
  const entries = md === null ? [] : changelogEntries(md);
  const own = entries.find((e) => e.date && e.version === version);
  const unreleased = entries.find((e) => e.version === 'Unreleased');
  return {
    version,
    tag: `${TAG_PREFIX}${version}`,
    dated: Boolean(own),
    date: own?.date ?? null,
    unreleasedLines: unreleased ? unreleased.body.split('\n').filter((l) => l.trim() !== '').length : 0,
  };
}

function versionCheck(ctx) {
  const problems = checkVersions(ctx.repo, { release: ctx.opts.release, tag: ctx.opts.tag });
  if (problems.length) {
    throw new CliError(`${problems.length} version problem(s):\n  - ${problems.join('\n  - ')}`, {
      data: { problems },
    });
  }
  return { version: readVersion(ctx.repo), problems };
}

async function versionBump(ctx) {
  const { repo } = ctx;
  const current = readVersion(repo);
  const md = readChangelog(repo);
  if (md === null) throw new CliError('CHANGELOG.md is missing');
  const entries = changelogEntries(md);
  const newest = newestDated(entries);
  const currentDated = entries.some((e) => e.date && e.version === current);

  const next = nextVersion(current, ctx.args.target, { allowEqual: !currentDated });
  if (newest && compareSemver(next, newest.version) <= 0) {
    throw new CliError(`${next} is not newer than the newest dated changelog entry ${newest.version}`);
  }
  const date = today();
  const { text, moved } = releaseChangelog(md, next, date);
  const plan = { from: current, to: next, tag: `${TAG_PREFIX}${next}`, date, movedLines: moved };

  if (ctx.preview) return { preview: true, ...plan };
  if (!(await ctx.confirm(`Bump ${current} to ${next} and date the changelog entry ${date}?`))) {
    return { cancelled: true, ...plan };
  }

  const pkgFile = path.join(repo.root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  pkg.version = next;
  writeAtomic(path.join(repo.root, 'CHANGELOG.md'), (tmp) => fs.writeFileSync(tmp, text));
  writeAtomic(pkgFile, (tmp) => fs.writeFileSync(tmp, `${JSON.stringify(pkg, null, 2)}\n`));

  const problems = checkVersions(repo);
  if (problems.length) {
    throw new CliError(`bumped to ${next}, but the version check fails:\n  - ${problems.join('\n  - ')}`, {
      data: { problems },
    });
  }
  return plan;
}

export default {
  name: 'version',
  summary: 'The package version and its changelog',
  verbs: [
    {
      name: 'show',
      summary: 'Show the package version and whether the changelog has dated it',
      args: [],
      options: [],
      destructive: false,
      examples: ['rebeep version show', 'rebeep version show --json'],
      run: versionShow,
    },
    {
      name: 'check',
      summary: 'Check package.json, CHANGELOG.md and the tree agree on the version',
      description:
        'Fails listing every problem. --release also needs a dated, non-empty entry for the version; --tag must equal v plus the version.',
      args: [],
      options: [
        { name: 'release', type: 'boolean', description: 'Also require a dated changelog entry with a body' },
        { name: 'tag', type: 'string', valueName: 'vX.Y.Z', description: 'Require this tag to match the version' },
      ],
      destructive: false,
      examples: ['rebeep version check', 'rebeep version check --release --tag v1.2.3'],
      run: versionCheck,
      render: (data, log) => log.ok(`version ${data.version} is consistent`),
    },
    {
      name: 'bump',
      summary: 'Date the [Unreleased] changelog entry as a new version and write package.json',
      description:
        'Moves the [Unreleased] body under a dated heading. Never commits, tags or pushes. An exact X.Y.Z equal to the current version is the first release, allowed while it has no dated entry.',
      args: [
        {
          name: 'target',
          required: true,
          description: 'major, minor, patch or an exact X.Y.Z',
        },
      ],
      options: [],
      destructive: true,
      examples: ['rebeep version bump minor --preview', 'rebeep version bump 0.1.0 --yes'],
      run: versionBump,
      render: (data, log) => {
        if (data.cancelled) return log.warn('cancelled');
        const what = data.preview ? 'would bump' : 'bumped';
        log.ok(`${what} ${data.from} to ${data.to} (${data.date}, ${data.movedLines} changelog lines moved)`);
      },
    },
  ],
};
