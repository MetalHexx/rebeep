import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { UsageError } from '../lib/cli.mjs';
import { listProfiles, loadProfile, templatePath } from '../lib/profiles.mjs';
import { repoLayout } from '../lib/paths.mjs';
import { globalCfgText, geometryParams, renderTemplate, renderVmCfg } from '../lib/vmcfg.mjs';

const repo = repoLayout();

describe('renderTemplate', () => {
  test('replaces placeholders', () => {
    assert.equal(renderTemplate('a = {{X}}\nb = {{Y}}\n', { X: '1', Y: 'two' }), 'a = 1\nb = two\n');
  });

  test('keeps a block only when its variable is truthy, and drops the marker lines', () => {
    const text = 'before\n{{#D}}\nd = {{D}}\n{{/D}}\nafter\n';
    assert.equal(renderTemplate(text, { D: 'd.img' }), 'before\nd = d.img\nafter\n');
    assert.equal(renderTemplate(text, {}), 'before\nafter\n');
    assert.equal(renderTemplate(text, { D: '' }), 'before\nafter\n');
  });

  test('handles CRLF templates', () => {
    assert.equal(renderTemplate('{{#A}}\r\nx\r\n{{/A}}\r\ny\r\n', { A: '1' }), 'x\r\ny\r\n');
  });

  test('an unknown placeholder, an unclosed block and a stray close all throw', () => {
    assert.throws(() => renderTemplate('x = {{NOPE}}\n', {}), /unknown placeholder \{\{NOPE\}\}/);
    assert.throws(() => renderTemplate('{{#A}}\nx\n', { A: '1' }), /never closed/);
    assert.throws(() => renderTemplate('x\n{{/A}}\n', {}), /unexpected/);
    assert.throws(() => renderTemplate('{{#A}} inline\n{{/A}}\n', { A: '1' }), /malformed/);
  });

  test('a placeholder inside a skipped block is not required', () => {
    assert.equal(renderTemplate('{{#A}}\nx = {{MISSING}}\n{{/A}}\n', {}), '');
  });
});

describe('geometryParams', () => {
  test('orders sectors, heads, cylinders, write-protect, bus', () => {
    assert.equal(geometryParams({ cylinders: 260, heads: 16, sectorsPerTrack: 63 }), '63, 16, 260, 0, ide');
  });
});

describe('the real profile templates', () => {
  const names = listProfiles(repo);

  test('all three profiles are found and load', () => {
    assert.deepEqual(names, ['mirror-freedos', 'mirror-msdos', 'slow-386sx']);
    for (const name of names) assert.equal(loadProfile(repo, name).name, name);
  });

  for (const name of names) {
    const profile = loadProfile(repo, name);
    const template = fs.readFileSync(templatePath(repo, name), 'utf8');

    test(`${name}: normal mode attaches C: and D: and no floppy image`, () => {
      const cfg = renderVmCfg(profile, template, {});
      assert.match(cfg, /^hdd_01_parameters = 63, 16, 260, 0, ide$/m);
      assert.match(cfg, /^hdd_01_fn = c\.img$/m);
      const d = profile.d.geometry;
      assert.match(cfg, new RegExp(`^hdd_02_parameters = 63, 16, ${d.cylinders}, 0, ide$`, 'm'));
      // slow-386sx's BIOS shares one user disk type between both drives, so D: matches C: there.
      assert.equal(d.cylinders, name === 'slow-386sx' ? 260 : 130);
      assert.match(cfg, /^hdd_02_fn = d\.img$/m);
      assert.doesNotMatch(cfg, /fdd_01_fn/);
      assert.doesNotMatch(cfg, /\{\{|\}\}/);
    });

    test(`${name}: install mode attaches the first floppy and no D:`, () => {
      const cfg = renderVmCfg(profile, template, { install: true, floppy: 'DISK1.IMA' });
      assert.match(cfg, /^fdd_01_fn = floppy\/DISK1\.IMA$/m);
      assert.match(cfg, /^hdd_01_fn = c\.img$/m);
      assert.doesNotMatch(cfg, /hdd_02/);
      assert.doesNotMatch(cfg, /\\/, 'paths use forward slashes');
    });
  }

  test('install mode without a floppy is an error', () => {
    const profile = loadProfile(repo, 'mirror-msdos');
    assert.throws(() => renderVmCfg(profile, 'x\n', { install: true }), /first floppy/);
  });

  test('a template that sets uuid or cpu_override is rejected; a comment is fine', () => {
    const profile = loadProfile(repo, 'mirror-msdos');
    assert.throws(() => renderVmCfg(profile, 'uuid = abc\n', {}), /uuid/);
    assert.throws(() => renderVmCfg(profile, '[Machine]\n  cpu_override = 1\n', {}), /cpu_override/);
    assert.doesNotThrow(() => renderVmCfg(profile, '# never set uuid = x\n; cpu_override = 1\n', {}));
  });
});

describe('profiles', () => {
  test('an unknown name is a usage error listing the valid names', () => {
    assert.throws(
      () => loadProfile(repo, '../etc'),
      (err) => err instanceof UsageError && /mirror-msdos/.test(err.hint),
    );
  });
});

describe('globalCfgText', () => {
  test('disables the VM manager and the prompts', () => {
    const text = globalCfgText();
    assert.match(text, /^\[Emulator\]$/m);
    for (const key of ['vmm_disabled = 1', 'confirm_exit = 0', 'confirm_reset = 0', 'confirm_save = 0']) {
      assert.ok(text.includes(key), key);
    }
  });
});
