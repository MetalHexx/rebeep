import { CliError } from '../lib/cli.mjs';
import { checkRepo } from '../lib/guard.mjs';

const FINDING_COLUMNS = [
  { key: 'path', label: 'path' },
  { key: 'where', label: 'where' },
  { key: 'rule', label: 'rule' },
  { key: 'detail', label: 'detail' },
];

export default {
  name: 'repo',
  summary: 'Repo hygiene',
  verbs: [
    {
      name: 'check',
      summary: 'Fail if payloads are tracked or committed',
      description: 'Looks for DOS images, ROMs, emulator binaries, game files and archives in the working tree, the index and the commits of the range.',
      args: [],
      options: [
        {
          name: 'range',
          type: 'string',
          valueName: 'rev-range',
          default: 'origin/main..HEAD',
          description: 'Commits to inspect',
        },
        {
          name: 'strict',
          type: 'boolean',
          description: 'Fail when the range cannot be resolved, so history is not scanned',
        },
      ],
      destructive: false,
      examples: ['rebeep repo check', 'rebeep repo check --range main..HEAD --strict'],
      run: async (ctx) => {
        const range = ctx.opts.range;
        const { data, warnings } = await checkRepo({ root: ctx.repo.root, range });
        for (const warning of warnings) ctx.log.warn(warning);
        if (data.findings.length > 0) {
          if (!ctx.json) {
            ctx.log.table(
              data.findings.map((f) => ({
                path: f.path,
                where: f.commit === 'worktree' || f.commit === 'index' ? f.commit : f.commit.slice(0, 12),
                rule: f.rule,
                detail: f.detail,
              })),
              FINDING_COLUMNS,
            );
          }
          throw new CliError(`${data.findings.length} payload finding(s)`, {
            hint: 'Remove the files from the working tree and the index and, for a commit in the range, rewrite the commit before pushing.',
            data,
          });
        }
        if (ctx.opts.strict && !data.rangeResolved) {
          throw new CliError(`range '${range}' did not resolve, so history was NOT scanned`, {
            hint: 'Fix the range, or run without --strict to scan only the working tree and index.',
            data,
          });
        }
        return data;
      },
      render: (data, log) => {
        if (!data.rangeResolved) {
          log.warn(
            `working tree and index are clean, but history NOT scanned (${data.scanned} entries, range did not resolve)`,
          );
          return;
        }
        log.ok(`No payloads found (${data.scanned} files and blobs, ${data.commits} commits)`);
      },
    },
  ],
};
