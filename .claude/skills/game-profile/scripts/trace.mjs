#!/usr/bin/env node
// Reads a REBEEPD log (RBTRACE.TXT) for the game-profile skill. Node built-ins only.
//
//   node trace.mjs parts <log> [--rbg <NAME.RBG>]
//       Per dump: each control word the game wrote and the note that followed it, the counts that
//       start notes and the jumps most often, and how many profile records there are.
//   node trace.mjs near <log> <count> [<t>] [--rbg <NAME.RBG>]
//       Every note start (NOTE) and pitch jump (CHANGE) within t of count (default a 32nd of it,
//       about half a semitone), with the rule that matched last, grouped. Shows whether a count is
//       unique to one part. That rule carries into the next dump while REBEEPD stays loaded.
//   node trace.mjs hits <log> [--rbg <NAME.RBG>]
//       The profile's rule, fallbk and effect records in order, named from the .RBG, and the rules
//       and effects that never fired. An effect whose patch isn't beside the .RBG is dropped at
//       load, so the effects after it are numbered as ReBeep numbers them.
//
// A count is written as in a profile: 0952h is hex, 2386 decimal. Record fields are in
// .claude/skills/rebeep-dev/references/trace.md.
import fs from 'node:fs';
import path from 'node:path';

const PIT_HZ = 1193182;
const TICKS_PER_SEC = 18.2065;

const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
const hz = (count) => Math.round(PIT_HZ / (count || 65536));
const pitch = (count) => `${hex4(count)}h (${hz(count)} Hz)`;

function fail(message) {
  console.error(`trace.mjs: ${message}`);
  process.exit(2);
}

function parseCount(text) {
  const hexMatch = /^([0-9a-f]+)h$/i.exec(text);
  if (hexMatch) return parseInt(hexMatch[1], 16);
  if (/^\d+$/.test(text)) return parseInt(text, 10);
  return fail(`'${text}' is not a count: write hex with a trailing h, as in a profile (0952h)`);
}

/** The dumps in a log: each `{ kept, offered, recs }`, a record's seq unwrapped past FFFFh. */
function readLog(file) {
  const dumps = [];
  let lastSeq = 0;
  let wraps = 0;
  for (const line of fs.readFileSync(file, 'latin1').split(/\r?\n/)) {
    const head = /^# .*: (\d+) records kept of (\d+) offered/.exec(line);
    if (head) {
      dumps.push({ kept: +head[1], offered: +head[2], recs: [] });
      lastSeq = 0;
      wraps = 0;
      continue;
    }
    if (!line.trim() || line.startsWith('#') || !dumps.length) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 10 || !f[4].includes('>')) continue;
    let seq = parseInt(f[0], 16);
    if (seq + 0x8000 < lastSeq) wraps++;
    lastSeq = seq;
    seq += wraps * 0x10000;
    const [before, after] = f[4].split('>').map((v) => parseInt(v, 16));
    const writes = f.slice(10).map((w) => {
      const [port, value] = w.split('=').map((v) => parseInt(v, 16));
      return { port, value };
    });
    const kind = f[3] === 'pitch' ? 'change' : f[3]; // an older REBEEPD's name for a jump
    dumps.at(-1).recs.push({ seq, tick: parseInt(f[1], 16), kind, before, after,
      div: parseInt(f[8], 16), writes });
  }
  if (!dumps.length) fail(`${file} has no dump: is it an RBTRACE.TXT?`);
  return dumps;
}

/** The rules, effects and patch slots of a .RBG, read as ReBeep numbers them (from 0). */
function readProfile(file) {
  const rules = [];
  const effects = [];
  const slots = [];
  const slotOf = (name) => {
    const upper = name.toUpperCase();
    if (!slots.includes(upper)) slots.push(upper);
    return slots.indexOf(upper);
  };
  let section = null;
  let current = null;
  for (const raw of fs.readFileSync(file, 'latin1').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const head = /^\[([^\]]+)\]$/.exec(line);
    if (head) {
      section = head[1].trim().toUpperCase();
      current = {};
      if (section === 'RULE') rules.push(current);
      if (section === 'EFFECT') effects.push(current);
      continue;
    }
    const pair = /^([^=]+)=(.*)$/.exec(line);
    if (!pair || !current) continue;
    const key = pair[1].trim().toUpperCase();
    const value = pair[2].trim();
    if (key === 'NAME' || key === 'ID') current[key.toLowerCase()] = value;
    const names = (key === 'PATCH' && (section === 'RULE' || section === 'EFFECT')) ||
      (key === 'DEFAULT' && section === 'PROFILE');
    if (names) {
      current.slot = slotOf(value);
      current.patch = value.toUpperCase();
    }
  }
  // ReBeep drops an effect whose patch fails to load, and numbers the rest without it.
  const present = new Set(fs.readdirSync(path.dirname(path.resolve(file))).map((n) => n.toUpperCase()));
  const dropped = effects.filter((e) => e.patch && !present.has(`${e.patch}.RBP`));
  return { rules, effects: effects.filter((e) => !dropped.includes(e)), dropped, slots };
}

function label(profile, kind, number) {
  if (!profile) return `${kind} ${number}`;
  const list = kind === 'effect' ? profile.effects : profile.rules;
  const item = list[number];
  if (!item) return `${kind} ${number} (not in the .RBG)`;
  const name = item.name ? ` "${item.name}"` : '';
  const id = item.id ? ` ${item.id}` : '';
  return `${kind} ${number}${id}${name}`;
}

function patchName(profile, slot) {
  return profile && profile.slots[slot] ? profile.slots[slot] : `slot ${slot}`;
}

const isProfileRecord = (r) => r.kind === 'rule' || r.kind === 'fallbk' || r.kind === 'effect';

function headline(dump, n) {
  console.log(`\n=== dump ${n + 1}: ${dump.kept} records kept of ${dump.offered} offered`);
  if (dump.offered > dump.kept) {
    console.log('  The buffer filled, so the later records were lost. Shorter runs keep more.');
  }
}

function secondsFrom(dump) {
  const t0 = dump.recs.length ? dump.recs[0].tick : 0;
  return (r) => `${(((r.tick - t0) & 0xffff) / TICKS_PER_SEC).toFixed(1).padStart(6)}s`;
}

function tally(values, top) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, top)
    .map(([v, c]) => `${pitch(v)} x${c}`).join(', ') || 'none';
}

function parts(dumps, profile) {
  dumps.forEach((dump, n) => {
    headline(dump, n);
    const at = secondsFrom(dump);
    const seen = new Set();
    const controls = [];
    dump.recs.forEach((r, i) => {
      r.writes.forEach((w, k) => {
        const index = r.seq - (r.writes.length - 1) + k;
        if (w.port !== 0x43 || seen.has(index)) return;
        seen.add(index);
        controls.push({ value: w.value, index, rec: i });
      });
    });
    console.log(`  control words written to 43h, with the note that followed: ${controls.length}`);
    for (const c of controls.slice(0, 40)) {
      const rest = dump.recs.slice(c.rec);
      const note = rest.find((r) => r.kind === 'noteon');
      const fired = note && rest.find((r) => (r.kind === 'rule' || r.kind === 'fallbk') && r.seq <= note.seq);
      const then = note ? `then a note at ${pitch(note.div)}` : 'no note after it';
      const tag = fired ? `, ${label(profile, 'rule', fired.before)} fired` : '';
      const byte = c.value.toString(16).toUpperCase().padStart(2, '0');
      console.log(`    ${at(dump.recs[c.rec])}  43h=${byte}h  ${then}${tag}`);
    }
    if (controls.length > 40) console.log(`    ... and ${controls.length - 40} more`);
    if (controls.length) {
      const byValue = new Map();
      for (const c of controls) byValue.set(c.value, (byValue.get(c.value) || 0) + 1);
      console.log(`  control word values: ${[...byValue].map(([v, k]) =>
        `${v.toString(16).toUpperCase().padStart(2, '0')}h x${k}`).join(', ')}`);
    }
    const recs = dump.recs;
    console.log(`  note starts, most often: ${tally(recs.filter((r) => r.kind === 'noteon').map((r) => r.div), 10)}`);
    console.log(`  pitch jumps, most often: ${tally(recs.filter((r) => r.kind === 'change').map((r) => r.div), 6)}`);
    const steps = recs.filter((r) => r.kind === 'step61' || r.kind === 'steppit').length;
    if (steps) console.log(`  speaker steps: ${steps} (sound ReBeep can't play as a note; no profile matches it)`);
    const prof = recs.filter(isProfileRecord).length;
    if (prof) console.log(`  profile records: ${prof} (see hits)`);
  });
}

function near(dumps, count, t, profile) {
  console.log(`Note starts and pitch jumps within ${t} of ${pitch(count)}: ` +
    `${pitch(Math.min(count + t, 0xffff))} to ${pitch(Math.max(count - t, 0))}`);
  let state = 'no rule yet';
  let lastSeq = -1;
  dumps.forEach((dump, n) => {
    headline(dump, n);
    const at = secondsFrom(dump);
    // The game's write count runs on while REBEEPD stays loaded, and so does the rule state.
    if (dump.recs.length && dump.recs[0].seq < lastSeq) state = 'no rule yet';
    if (dump.recs.length) lastSeq = dump.recs.at(-1).seq;
    if (state !== 'no rule yet') console.log(`  from the dump before: ${state}`);
    const hits = [];
    dump.recs.forEach((r, i) => {
      if (r.kind === 'rule' || r.kind === 'fallbk') state = label(profile, 'rule', r.before);
      if (r.kind !== 'noteon' && r.kind !== 'change') return;
      if (Math.abs(r.div - count) > t) return;
      const prev = dump.recs[i - 1];
      hits.push({ r, how: r.kind === 'noteon' ? 'NOTE' : 'CHANGE', state, prev: prev ? prev.kind : '-' });
    });
    if (!hits.length) {
      console.log('  none');
      return;
    }
    for (const h of hits.slice(0, 30)) {
      console.log(`    ${at(h.r)}  ${h.how.padEnd(6)} ${pitch(h.r.div)}  after ${h.prev}, while ${h.state}`);
    }
    if (hits.length > 30) console.log(`    ... and ${hits.length - 30} more`);
    const groups = new Map();
    for (const h of hits) {
      const key = `${h.how} while ${h.state}`;
      const g = groups.get(key) || { n: 0, lo: 0xffff, hi: 0 };
      g.n++;
      g.lo = Math.min(g.lo, h.r.div);
      g.hi = Math.max(g.hi, h.r.div);
      groups.set(key, g);
    }
    console.log('  by kind and state:');
    for (const [key, g] of groups) console.log(`    ${key}: ${g.n}, ${hex4(g.lo)}h to ${hex4(g.hi)}h`);
  });
}

function hits(dumps, profile) {
  const fired = { rule: new Set(), effect: new Set() };
  dumps.forEach((dump, n) => {
    headline(dump, n);
    const at = secondsFrom(dump);
    const recs = dump.recs.filter(isProfileRecord);
    if (!recs.length) console.log('  no profile record: no rule completed and no effect took a tone');
    let i = 0;
    while (i < recs.length) {
      const r = recs[i];
      let j = i + 1;
      while (j < recs.length && recs[j].kind === r.kind && recs[j].before === r.before &&
        recs[j].after === r.after) j++;
      const kind = r.kind === 'effect' ? 'effect' : 'rule';
      fired[kind].add(r.before);
      const what = r.kind === 'fallbk' ? `${label(profile, 'rule', r.before)} (catch-all)` : label(profile, kind, r.before);
      const want = profile && (kind === 'effect' ? profile.effects : profile.rules)[r.before];
      const odd = want && want.slot !== r.after ? '  (the .RBG names another patch: changed since?)' : '';
      const times = j - i > 1 ? `  x${j - i}` : '';
      console.log(`    ${at(r)}  ${what} -> ${patchName(profile, r.after)}${times}${odd}`);
      i = j;
    }
  });
  if (!profile) return;
  const never = (kind, list) => list.map((_, k) => k).filter((k) => !fired[kind].has(k))
    .map((k) => label(profile, kind, k));
  const rules = never('rule', profile.rules);
  const effects = never('effect', profile.effects);
  console.log(`\nnever fired: ${[...rules, ...effects].join(', ') || 'none'}`);
  if (profile.dropped.length) {
    console.log(`dropped at load, no patch beside the .RBG: ${profile.dropped
      .map((e) => `effect${e.name ? ` "${e.name}"` : ''} (${e.patch}.RBP)`).join(', ')}`);
  }
}

function main(argv) {
  const args = [...argv];
  let profile = null;
  const r = args.indexOf('--rbg');
  if (r >= 0) {
    if (!args[r + 1]) fail('--rbg needs a .RBG file');
    profile = readProfile(args[r + 1]);
    args.splice(r, 2);
  }
  const [command, log, ...rest] = args;
  if (!command || !log || !['parts', 'near', 'hits'].includes(command)) {
    fail('usage: trace.mjs parts|near|hits <RBTRACE.TXT> [near: <count> [<t>]] [--rbg <NAME.RBG>]');
  }
  if (!fs.existsSync(log)) fail(`${log} not found`);
  const dumps = readLog(log);
  if (command === 'parts') parts(dumps, profile);
  if (command === 'hits') hits(dumps, profile);
  if (command === 'near') {
    if (!rest[0]) fail('near needs a count, such as 0952h');
    const count = parseCount(rest[0]);
    near(dumps, count, rest[1] ? parseCount(rest[1]) : Math.max(1, count >> 5), profile);
  }
}

main(process.argv.slice(2));
