#!/usr/bin/env node
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`rebeep needs Node 22 or newer (found ${process.versions.node})`);
  process.exit(1);
}

const { runCli } = await import('./lib/cli.mjs');
const { default: nouns } = await import('./commands/index.mjs');

process.exitCode = await runCli(process.argv.slice(2), { nouns });
