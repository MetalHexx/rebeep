/**
 * What ships as a factory default, in the real repo: every file under src/factory/ is wired into
 * targets.json at the matching place, every profile is whole, and INSTALL.BAT puts each folder in
 * place. A new patch or profile that isn't wired up fails here, as does a patch or profile, the
 * lab's included, with a line too long for a DOS screen.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadDataFiles } from '../commands/build.mjs';
import { repoLayout } from '../lib/paths.mjs';

const repo = repoLayout();
const FACTORY = path.join(repo.src, 'factory');
const PROFILE_NAME = /^(?=.*[A-Z_-])[A-Z0-9_-]{1,8}$/;

const entries = (dir) => fs.readdirSync(dir, { withFileTypes: true });
const profiles = entries(path.join(FACTORY, 'profiles')).map((e) => e.name).sort();

/** Each shipped folder under src/factory/, as `{ dir, dos }`: `patches` is `PATCHES` on the player's disk. */
const folders = [
  { dir: path.join(FACTORY, 'patches'), dos: 'PATCHES' },
  ...profiles.map((name) => ({ dir: path.join(FACTORY, 'profiles', name), dos: `PROFILES\\${name}` })),
];

describe('factory defaults', () => {
  test('src/factory holds patches/ and profiles/<NAME>/, nothing else', () => {
    assert.deepEqual(entries(FACTORY).map((e) => e.name).sort(), ['patches', 'profiles']);
    assert.ok(profiles.length > 0);
    for (const name of profiles) assert.match(name, PROFILE_NAME, `profile folder ${name}`);
    for (const { dir, dos } of folders) {
      for (const entry of entries(dir)) assert.ok(entry.isFile(), `${dos}\\${entry.name} is not a file`);
    }
  });

  test('every file is in targets.json, deployed to the same place under REBEEP/FACTORY', () => {
    const listed = loadDataFiles(repo)
      .filter((f) => f.source.startsWith('factory/') || f.deploy.startsWith('REBEEP/FACTORY'))
      .map((f) => `${f.source} -> ${f.deploy}`)
      .sort();
    const wanted = folders
      .flatMap(({ dir, dos }) =>
        entries(dir).map((e) => {
          const source = path.relative(repo.src, path.join(dir, e.name)).replaceAll('\\', '/');
          return `${source} -> REBEEP/FACTORY/${dos.replaceAll('\\', '/')}`;
        }))
      .sort();
    assert.deepEqual(listed, wanted);
  });

  for (const name of profiles) {
    test(`profile ${name} has its ${name}.RBG, and every patch it names beside it`, () => {
      const dir = path.join(FACTORY, 'profiles', name);
      const files = entries(dir).map((e) => e.name);
      assert.ok(files.includes(`${name}.RBG`), `${name}.RBG is missing`);
      const named = new Set(
        fs.readFileSync(path.join(dir, `${name}.RBG`), 'latin1')
          .split(/\r?\n/)
          .map((line) => /^\s*(?:PATCH|DEFAULT)\s*=\s*(\S+)\s*$/i.exec(line)?.[1].toUpperCase())
          .filter(Boolean),
      );
      assert.ok(named.size > 0, 'the profile names no patch');
      const wanted = [`${name}.RBG`, ...[...named].map((patch) => `${patch}.RBP`)].sort();
      assert.deepEqual(files.sort(), wanted, 'a named patch is missing, or a file is not used');
    });
  }

  const installLines = () => fs.readFileSync(path.join(repo.root, 'release', 'INSTALL.BAT'), 'latin1').split(/\r?\n/);

  test('INSTALL.BAT fits the package and DOS, and its labels differ', () => {
    // 80 columns as written; 127 characters as run, for an install folder of up to 42, as in 0.2.
    const lines = installLines();
    for (const line of lines) {
      assert.ok(line.length <= 80, `over 80 columns: ${line}`);
      if (!/\bECHO\b/.test(line)) {
        assert.ok(line.replaceAll('%RBDIR%', 'D'.repeat(42)).length <= 126, `too long once the folder is in: ${line}`);
      }
    }
    // MS-DOS reads only a label's first 8 characters.
    const labels = lines.filter((l) => l.startsWith(':')).map((l) => l.slice(1, 9).toUpperCase());
    assert.deepEqual(labels, [...new Set(labels)], 'two labels read the same');
    for (const line of lines) {
      const to = /\bGOTO (\S+)/.exec(line)?.[1].slice(0, 8).toUpperCase();
      if (to) assert.ok(labels.includes(to), `no label for: ${line}`);
    }
  });

  test('every line of a patch or profile, the lab ones too, fits a DOS screen: 78 columns', () => {
    const files = [FACTORY, repo.labPatches, repo.labProfiles]
      .filter((dir) => fs.existsSync(dir))
      .flatMap((dir) => fs.readdirSync(dir, { recursive: true }).map((name) => path.join(dir, name)))
      .filter((file) => /\.rb[pg]$/i.test(file));
    assert.ok(files.length > 0);
    const long = files.flatMap((file) =>
      fs.readFileSync(file, 'latin1').split(/\r?\n/).flatMap((line, i) =>
        (line.length > 78 ? [`${path.relative(repo.root, file)}:${i + 1} is ${line.length}`] : [])));
    assert.deepEqual(long, []);
  });

  test('INSTALL.BAT makes, clears and copies each folder', () => {
    const lines = installLines();
    const at = (what, match) => {
      const index = lines.findIndex(match);
      assert.ok(index >= 0, `INSTALL.BAT has no line that ${what}`);
      return index;
    };
    for (const { dir, dos } of folders) {
      const target = `%RBDIR%\\FACTORY\\${dos}`;
      const parts = dos.split('\\');
      const made = ['', ...parts.map((_, i) => `\\${parts.slice(0, i + 1).join('\\')}`)].map((below) => {
        const folder = `%RBDIR%\\FACTORY${below}`;
        return at(`makes ${folder}`, (l) => l === `MD ${folder}` || l.endsWith(` MD ${folder}`));
      });
      assert.deepEqual(made, [...made].sort((a, b) => a - b), `${target}: a folder is made before its parent`);
      const cleared = at(`clears ${target}`, (l) => l.includes(`${target}\\*.RB`) && /\bDEL\b/.test(l));
      const prefix = `COPY FACTORY\\${dos}\\*.`;
      const copied = at(`copies ${target}`, (l) => l.startsWith(prefix) && l.endsWith(` ${target}`));
      assert.ok(made.at(-1) < cleared && cleared < copied, `${target}: make it, clear it, then copy`);
      const mask = lines[copied].slice(prefix.length).split(' ')[0];
      const extension = new RegExp(`^${mask.replaceAll('?', '.')}$`);
      for (const entry of entries(dir)) {
        assert.match(entry.name.split('.')[1], extension, `${dos}\\${entry.name} is not copied by *.${mask}`);
      }
    }
  });
});
