// The game-profile skill's scripts: trace.mjs on a made-up REBEEPD log and profile, code.mjs on
// made-up programs in a game zip (an EXEPACK one among them). No game files are involved.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { writeZip } from '../lib/zip.mjs';
import { makeTempDir, removeDir } from './helpers.mjs';

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude',
  'skills', 'game-profile', 'scripts');

function run(script, args, env = {}) {
  const r = spawnSync(process.execPath, [path.join(scripts, script), ...args],
    { encoding: 'utf8', timeout: 30000, env: { ...process.env, ...env } });
  if (r.error) throw r.error;
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const W = '61=2C 43=B6 42=52 42=09 61=2D 42=52 42=09 61=2F';
const LOG = [
  '# ReBeep x.y.z trace: 6 records kept of 9 offered (capacity 1024)',
  '# kind: ...',
  '# hex: ...',
  `0009 0000 1000 rule    00>01 2F 1 02 0952 17 ${W}`,
  `0009 0000 1000 noteon  00>00 2F 1 02 0952 17 ${W}`,
  '0020 0012 1000 noteoff 00>00 2E 2 02 0952 17 42=52 42=09 61=2F 61=2E 61=2E 61=2E 61=2E 61=2E',
  '0028 0013 1000 noteon  00>00 2F 1 02 0952 17 61=2E 61=2E 61=2E 61=2E 42=52 42=09 61=2F 61=2F',
  '0030 0024 1000 change  00>00 2F 1 02 0400 17 61=2F 61=2F 61=2F 61=2F 61=2F 61=2F 42=00 42=04',
  '0031 0024 1000 effect  00>03 2F 1 02 0400 17 61=2F 61=2F 61=2F 61=2F 61=2F 42=00 42=04 61=2F',
  '0032 0025 1000 effect  00>03 2F 1 02 0401 17 61=2F 61=2F 61=2F 61=2F 42=00 42=04 61=2F 42=01',
].join('\r\n');
const RBG = [
  '[PROFILE]', 'FORMAT=1', 'DEFAULT=FALLBK',
  '[RULE]', 'ID=PLAY', 'NAME=Play', 'STEP=CTRL B6h', 'STEP=NOTE 0952h 8', 'PATCH=PLAYP',
  '[RULE]', 'NAME=Never', '; a comment', 'STEP=NOTE 1000h', 'PATCH=OTHER',
  '[EFFECT]', 'NAME=Zap', 'WHILE=PLAY', 'PITCH=0400h 8', 'PATCH=ZAP',
].join('\r\n');

function withLog(fn) {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, 'RBTRACE.TXT'), LOG);
    fs.writeFileSync(path.join(dir, 'T.RBG'), RBG);
    for (const p of ['FALLBK', 'PLAYP', 'OTHER', 'ZAP']) fs.writeFileSync(path.join(dir, `${p}.RBP`), '');
    fn(path.join(dir, 'RBTRACE.TXT'), path.join(dir, 'T.RBG'), dir);
  } finally {
    removeDir(dir);
  }
}

test('trace.mjs parts: each control word, the note after it and the rule it fired', () => withLog((log, rbg) => {
  const r = run('trace.mjs', ['parts', log, '--rbg', rbg]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /6 records kept of 9 offered/);
  assert.match(r.out, /The buffer filled/);
  assert.match(r.out, /control words written to 43h, with the note that followed: 1\n/);
  assert.match(r.out, /43h=B6h {2}then a note at 0952h \(500 Hz\), rule 0 PLAY "Play" fired/);
  assert.match(r.out, /note starts, most often: 0952h \(500 Hz\) x2/);
  assert.match(r.out, /control word values: B6h x1\n/);
  assert.match(r.out, /pitch jumps, most often: 0400h \(1165 Hz\) x1/);
}));

test('trace.mjs hits: names from the .RBG, runs collapsed, and what never fired', () => withLog((log, rbg) => {
  const r = run('trace.mjs', ['hits', log, '--rbg', rbg]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /rule 0 PLAY "Play" -> PLAYP\n/);
  assert.match(r.out, /effect 0 "Zap" -> ZAP {2}x2/);
  assert.match(r.out, /never fired: rule 1 "Never"/);
  assert.doesNotMatch(r.out, /changed since/);
  assert.doesNotMatch(r.out, /dropped at load/);
}));

test('trace.mjs hits: an effect whose patch is missing is dropped, and the next takes its number', () => withLog((log, rbg, dir) => {
  const two = RBG.replace('[EFFECT]', '[EFFECT]\r\nNAME=Gone\r\nPITCH=0200h\r\nPATCH=GONE\r\n[EFFECT]');
  fs.writeFileSync(rbg, two);
  // GONE still takes a slot (3), so ReBeep logs Zap, now effect 0, with ZAP's slot 4.
  fs.writeFileSync(log, LOG.replaceAll('effect  00>03', 'effect  00>04'));
  const r = run('trace.mjs', ['hits', log, '--rbg', rbg]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /effect 0 "Zap" -> ZAP {2}x2/);
  assert.doesNotMatch(r.out, /changed since/);
  assert.match(r.out, /dropped at load, no patch beside the \.RBG: effect "Gone" \(GONE\.RBP\)/);
  assert.ok(fs.existsSync(path.join(dir, 'ZAP.RBP')));
}));

test('trace.mjs: [SOUND] sections take no patch slot, wherever they sit in the .RBG', () => withLog((log, rbg) => {
  const sounds = ['ZAP', 'OTHER', 'PLAYP', 'FALLBK']
    .flatMap((patch) => ['[SOUND]', `PATCH=${patch}`, `NAME=${patch}`, 'DESCRIPTION=Plays somewhere', 'PITCH=0952h']);
  const plain = ['parts', 'hits', 'near'].map((verb) =>
    run('trace.mjs', verb === 'near' ? [verb, log, '0400h', '8', '--rbg', rbg] : [verb, log, '--rbg', rbg]));
  fs.writeFileSync(rbg, [...sounds, RBG, ...sounds].join('\r\n'));
  const withSounds = ['parts', 'hits', 'near'].map((verb) =>
    run('trace.mjs', verb === 'near' ? [verb, log, '0400h', '8', '--rbg', rbg] : [verb, log, '--rbg', rbg]));
  for (const r of [...plain, ...withSounds]) assert.equal(r.code, 0, r.err);
  assert.deepEqual(withSounds, plain);
  assert.match(withSounds[1].out, /rule 0 PLAY "Play" -> PLAYP\n/);
}));

test('trace.mjs near: an older log\'s pitch records, and the rule carried into the next dump', () => withLog((log, rbg) => {
  const next = [
    '# ReBeep x.y.z trace: 1 records kept of 1 offered (capacity 1024)',
    '0040 0030 1000 pitch   00>00 2F 1 02 0402 17 61=2F 61=2F 61=2F 61=2F 61=2F 61=2F 42=02 42=04',
  ].join('\r\n');
  fs.appendFileSync(log, `\r\n${next}\r\n`);
  const r = run('trace.mjs', ['near', log, '0400h', '8', '--rbg', rbg]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /=== dump 2[^\n]*\n {2}from the dump before: rule 0 PLAY "Play"\n/);
  assert.match(r.out, /CHANGE 0402h \(1163 Hz\) {2}after -, while rule 0 PLAY "Play"/);
  const reloaded = fs.readFileSync(log, 'latin1').replace('0040 0030', '0001 0030');
  fs.writeFileSync(log, reloaded);
  assert.match(run('trace.mjs', ['near', log, '0400h', '8']).out, /0402h \(1163 Hz\) {2}after -, while no rule yet/);
}));

test('trace.mjs near: how each tone came, and what had matched', () => withLog((log, rbg) => {
  const r = run('trace.mjs', ['near', log, '0400h', '8', '--rbg', rbg]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /CHANGE 0400h \(1165 Hz\) {2}after noteon, while rule 0 PLAY "Play"/);
  assert.match(r.out, /CHANGE while rule 0 PLAY "Play": 1, 0400h to 0400h/);
  assert.equal(run('trace.mjs', ['near', log, '0x400']).code, 2);
  assert.equal(run('trace.mjs', ['parts']).code, 2);
}));

/**
 * A tiny EXEPACK program: its code, then one fill command that unpacks it to 64 bytes. `short`
 * gives the older 16-byte header, which has no skip length.
 */
function exepacked(short = false) {
  const code = Buffer.from([0xb0, 0xb6, 0xe6, 0x43, 0xb0, 0x00, 0xe6, 0x42, 0xe6, 0x42, 0xe4, 0x61,
    0x0c, 0x03, 0xe6, 0x61, ...Array(12).fill(0x90)]);
  const fill = 64 - 28;
  const packed = Buffer.concat([code, Buffer.from([0x90, fill & 0xff, fill >> 8, 0xb1])]);
  const header = Buffer.alloc(short ? 16 : 18);
  header.writeUInt16LE(4, 12); // the unpacked length in paragraphs
  if (!short) header.writeUInt16LE(1, 14); // no skip
  header.write('RB', short ? 14 : 16, 'latin1');
  const image = Buffer.concat([packed, header, Buffer.alloc(short ? 16 : 14)]);
  const mz = Buffer.alloc(32);
  mz.write('MZ', 0, 'latin1');
  mz.writeUInt16LE(96, 2);
  mz.writeUInt16LE(1, 4);
  mz.writeUInt16LE(2, 8); // 2 paragraphs of header
  mz.writeUInt16LE(0x12, 0x14);
  mz.writeUInt16LE(2, 0x16); // CS: the EXEPACK header at 32
  return Buffer.concat([mz, image]);
}

function withGame(fn) {
  const home = makeTempDir('rebeep-home-');
  try {
    const games = path.join(home, 'media', 'games');
    fs.mkdirSync(games, { recursive: true });
    const date = new Date(2000, 0, 1);
    fs.writeFileSync(path.join(games, 'TG.zip'), writeZip([
      { name: 'TG/PROG.EXE', bytes: exepacked(), date },
      { name: 'TG/OLD.EXE', bytes: exepacked(true), date },
      { name: 'TG/SOUND.DRV', bytes: Buffer.from([0x90, 0xe6, 0x61]), date },
      { name: 'TG/BEEP.COM', bytes: Buffer.from([0xba, 0x61, 0x00, 0xec]), date },
      { name: 'TG/DATA/TUNE.BIN', bytes: Buffer.from([0x52, 0x09, 0x00, 0x52, 0x09]), date },
    ]));
    fn({ REBEEP_HOME: home });
  } finally {
    removeDir(home);
  }
}

test('code.mjs: lists, unpacks EXEPACK in memory and finds the speaker code', () => withGame((env) => {
  const list = run('code.mjs', ['--game', 'tg', '--list'], env);
  assert.equal(list.code, 0, list.err);
  assert.match(list.out, /PROG\.EXE/);
  assert.match(list.out, /DATA\/TUNE\.BIN/);
  const r = run('code.mjs', ['--game', 'TG', '--file', 'prog.exe'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /packed with EXEPACK, unpacked in memory to 64 bytes/);
  assert.match(r.out, /OUT 43h,AL: a control word: 1\n {2}00002 {2}MOV AL,B6h: 43h=B6h \(channel 2, mode 3\)/);
  assert.match(r.out, /OUT 42h,AL[^\n]*: 2\n {2}00006\n {2}00008/);
  assert.match(r.out, /IN AL,61h[^\n]*: 1\n {2}0000A/);
  assert.match(r.out, /OUT 61h,AL[^\n]*: 1\n {2}0000E/);
  const old = run('code.mjs', ['--game', 'TG', '--file', 'OLD.EXE'], env);
  assert.match(old.out, /packed with EXEPACK, unpacked in memory to 64 bytes/);
  assert.match(old.out, /00002 {2}MOV AL,B6h: 43h=B6h/);
}));

test('code.mjs --dis: a failed ndisasm leaves nothing of the game behind', () => withGame((env) => {
  const temp = makeTempDir('rebeep-tmp-');
  try {
    const tmp = { ...env, TEMP: temp, TMP: temp, TMPDIR: temp, REBEEP_NDISASM: path.join(temp, 'none', 'ndisasm') };
    const r = run('code.mjs', ['--game', 'TG', '--file', 'PROG.EXE', '--dis', '0'], tmp);
    assert.equal(r.code, 2);
    assert.match(r.err, /could not run ndisasm/);
    assert.deepEqual(fs.readdirSync(temp), []);
    assert.equal(run('code.mjs', ['--game', 'TG', '--file', 'PROG.EXE', '--dis', '0', '--lines', 'x'], tmp).code, 2);
    assert.equal(run('code.mjs', ['--game', 'TG', '--file', 'PROG.EXE', '--dis', '40'], tmp).code, 2);
    assert.deepEqual(fs.readdirSync(temp), []);
  } finally {
    removeDir(temp);
  }
}));

test('code.mjs: a .COM, a data file, a byte search and the refusals', () => withGame((env) => {
  const com = run('code.mjs', ['--game', 'TG', '--file', 'BEEP.COM'], env);
  assert.match(com.out, /a \.COM program/);
  assert.match(com.out, /MOV DX,61h[^\n]*: 1\n {2}00000/);
  const data = run('code.mjs', ['--game', 'TG', '--file', 'DATA/TUNE.BIN', '--find', '52 09', '--find', '09 ?? 52'], env);
  assert.equal(data.code, 0, data.err);
  assert.match(data.out, /not an MZ or \.COM program/);
  assert.doesNotMatch(data.out, /Candidates/);
  const drv = run('code.mjs', ['--game', 'TG', '--file', 'SOUND.DRV', '--scan'], env);
  assert.match(drv.out, /OUT 61h,AL[^\n]*: 1\n {2}00001/);
  assert.match(data.out, /"52 09": 00000 00003/);
  assert.match(data.out, /"09 \?\? 52": 00001/);
  assert.equal(run('code.mjs', ['--game', 'NONE', '--list'], env).code, 2);
  assert.equal(run('code.mjs', ['--game', 'TG', '--file', 'NONE.EXE'], env).code, 2);
  assert.equal(run('code.mjs', ['--game', 'TG', '--file', 'TUNE.BIN', '--find', 'XYZ'], env).code, 2);
}));
