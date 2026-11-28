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

/** ReBeep's `get_word`: decimal digits, or hex digits and a trailing H, from 1 to 65535. */
const validCount = (text) => {
  if (!/^(?:\d+|[0-9a-f]+h)$/i.test(text)) return false;
  const value = parseInt(text, /h$/i.test(text) ? 16 : 10);
  return value >= 1 && value <= 65535;
};

/**
 * What is wrong with a profile's size and `[SOUND]` sections, as messages: more than 4,096 bytes; a patch
 * it plays (`DEFAULT=`, and `PATCH=` in a rule or effect) with other than one `[SOUND]`; a `[SOUND]` for
 * a patch it doesn't play; a `NAME=` that isn't 1-14 characters or a `DESCRIPTION=` over 53; a `PITCH=`
 * that isn't a count.
 */
function soundProblems(bytes) {
  const problems = [];
  if (bytes.length > 4096) problems.push(`${bytes.length} bytes is over 4,096`);
  const played = new Set();
  const sounds = [];
  let section = null;
  for (const raw of bytes.toString('latin1').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const head = /^\[([^\]]*)\]$/.exec(line);
    if (head) {
      section = head[1].trim().toUpperCase();
      if (section === 'SOUND') sounds.push({});
      continue;
    }
    const pair = /^([^=]*)=(.*)$/.exec(line);
    if (!pair) continue;
    const key = pair[1].trim().toUpperCase();
    const value = pair[2].trim();
    if (key === 'PATCH' && (section === 'RULE' || section === 'EFFECT')) played.add(value.toUpperCase());
    if (key === 'DEFAULT' && section === 'PROFILE') played.add(value.toUpperCase());
    if (section === 'SOUND') sounds.at(-1)[key] = value;
  }
  for (const patch of played) {
    const count = sounds.filter((s) => s.PATCH?.toUpperCase() === patch).length;
    if (count !== 1) problems.push(`${patch} has ${count} [SOUND], wanted 1`);
  }
  for (const sound of sounds) {
    const patch = sound.PATCH?.toUpperCase();
    if (!played.has(patch)) problems.push(`[SOUND] ${patch} is not a patch it plays`);
    if (!sound.NAME || sound.NAME.length > 14) problems.push(`${patch}: NAME=${sound.NAME ?? ''} is not 1-14 characters`);
    if (sound.DESCRIPTION === undefined || sound.DESCRIPTION.length > 53) {
      problems.push(`${patch}: DESCRIPTION=${sound.DESCRIPTION ?? ''} is not at most 53 characters`);
    }
    if (sound.PITCH !== undefined && !validCount(sound.PITCH)) problems.push(`${patch}: PITCH=${sound.PITCH} is not a count`);
  }
  return problems;
}

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

  for (const name of profiles) {
    test(`profile ${name} is under 4,096 bytes and describes each sound it plays in a [SOUND]`, () => {
      const file = path.join(FACTORY, 'profiles', name, `${name}.RBG`);
      assert.deepEqual(soundProblems(fs.readFileSync(file)), []);
    });
  }

  test('the [SOUND] checks catch a missing, an extra, a long-named and a badly pitched [SOUND]', () => {
    const head = ['[PROFILE]', 'DEFAULT=ONE', '[RULE]', 'PATCH=TWO'];
    const sound = (patch, ...extra) => ['[SOUND]', `PATCH=${patch}`, 'NAME=n', 'DESCRIPTION=d', ...extra];
    const problems = (...parts) => soundProblems(Buffer.from(parts.flat().join('\r\n'), 'latin1')).join('; ');
    assert.equal(problems(head, sound('one', 'PITCH=0Ah'), sound('Two', 'PITCH=65535')), '');
    assert.match(problems(head, sound('ONE')), /TWO has 0 \[SOUND\]/);
    assert.match(problems(head, sound('ONE'), sound('TWO'), sound('THREE')), /THREE is not a patch it plays/);
    assert.match(problems(head, sound('ONE'), sound('TWO'), sound('ONE')), /ONE has 2 \[SOUND\]/);
    const other = (...keys) => ['[SOUND]', 'PATCH=TWO', ...keys];
    assert.match(problems(head, sound('ONE'), other('NAME=Fifteen chars!!', 'DESCRIPTION=d')), /NAME/);
    assert.match(problems(head, sound('ONE'), other('NAME=n', `DESCRIPTION=${'d'.repeat(54)}`)), /DESCRIPTION/);
    for (const pitch of ['0', '0000h', '10000h', '65536', '12G', '', 'H']) {
      assert.match(problems(head, sound('ONE', `PITCH=${pitch}`), sound('TWO')), /PITCH/, `PITCH=${pitch}`);
    }
    for (const pitch of ['1', '0000c22eH', '65535', 'ffffh']) {
      assert.equal(problems(head, sound('ONE', `PITCH=${pitch}`), sound('TWO')), '', `PITCH=${pitch}`);
    }
    assert.match(soundProblems(Buffer.alloc(4097, 0x3b)).join(), /4,096/);
  });

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
