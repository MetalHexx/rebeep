import fs from 'node:fs';
import path from 'node:path';
import { CliError, UsageError } from './cli.mjs';

const ROUTES = ['blank', 'build', 'clone'];

/** Profile names: every folder under `env/86box/profiles/` that holds a `profile.json`, sorted. */
export function listProfiles(repo) {
  let entries;
  try {
    entries = fs.readdirSync(repo.profiles, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(repo.profiles, e.name, 'profile.json')))
    .map((e) => e.name)
    .sort();
}

/** Path of a profile's 86Box config template. */
export function templatePath(repo, name) {
  return path.join(repo.profiles, name, '86box.cfg.tmpl');
}

function bad(name, message) {
  return new CliError(`profile ${name}: ${message}`);
}

function checkGeometry(name, where, geometry) {
  for (const key of ['cylinders', 'heads', 'sectorsPerTrack']) {
    if (!Number.isInteger(geometry?.[key]) || geometry[key] < 1) {
      throw bad(name, `${where}.${key} must be a positive integer`);
    }
  }
}

const isStringList = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s !== '');

function validate(name, p) {
  if (p === null || typeof p !== 'object') throw bad(name, 'must be an object');
  if (p.name !== name) throw bad(name, `'name' is ${JSON.stringify(p.name)}, expected ${JSON.stringify(name)}`);
  if (typeof p.description !== 'string') throw bad(name, "missing 'description'");
  if (typeof p.dos !== 'string' || !p.dos) throw bad(name, "missing 'dos'");

  const { c, d } = p;
  if (!ROUTES.includes(c?.route)) throw bad(name, `c.route must be one of: ${ROUTES.join(', ')}`);
  checkGeometry(name, 'c.geometry', c.geometry);
  if (c.route === 'build' && typeof c.builder !== 'string') throw bad(name, "c.builder is required for the 'build' route");
  if (c.route === 'clone' && typeof c.from !== 'string') throw bad(name, "c.from is required for the 'clone' route");

  checkGeometry(name, 'd.geometry', d?.geometry);
  if (!Number.isInteger(d.clusterSize)) throw bad(name, 'd.clusterSize must be an integer');
  if (typeof d.label !== 'string') throw bad(name, "missing 'd.label'");

  const { install } = p;
  if (install !== undefined) {
    const byMedia = typeof install?.media === 'string' && isStringList(install.floppies) && install.floppies.length > 0;
    const byTool =
      typeof install?.tool === 'string' &&
      (install.folder === undefined || (typeof install.folder === 'string' && install.folder !== '')) &&
      (install.floppies === undefined || (isStringList(install.floppies) && install.floppies.length > 0));
    if (!byMedia && !byTool) throw bad(name, "install needs { media, floppies } or { tool, folder?, floppies? }");
  }
  if (!isStringList(p.tools)) throw bad(name, "'tools' must be a list of names");
  if (!isStringList(p.roms)) throw bad(name, "'roms' must be a list of paths");
  return p;
}

/**
 * Reads and validates one profile. An unknown name is a usage error that lists the valid names.
 * Checking the name against the folder list also keeps it from ever reaching a path.
 */
export function loadProfile(repo, name) {
  const names = listProfiles(repo);
  if (!names.includes(name)) {
    throw new UsageError(`unknown VM '${name}'`, { hint: `Valid VMs: ${names.join(', ')}` });
  }
  const file = path.join(repo.profiles, name, 'profile.json');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new CliError(`cannot read ${file}: ${err.message}`);
  }
  return validate(name, parsed);
}
