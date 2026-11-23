// Runs a DOS program in a visible DOSBox-X window, types scripted keys into it (DOSBox-X's AUTOTYPE), saves PNGs of the
// window at set times, and ends DOSBox-X by its own process id. Windows only (the capture is PowerShell and user32).
//
//   node drive.mjs --dir <folder> --keys "space enter down" --shots 12,20 [--program RBSTUDIO] [--args "/VIEW:MONO"]
//                  [--wait 5] [--pace 2] [--limit 90] [--out <folder>]
//
// --dir      the folder mounted as C: (the program and the data files it reads)
// --keys     AUTOTYPE button names, space separated (`AUTOTYPE -list` in DOSBox-X lists them)
// --shots    seconds after launch, comma separated; one PNG each, named shot-<seconds>.png in --out
// --wait     seconds before the first key (counted from DOSBox-X's launch: its own start-up takes about 3 s of it)
// --pace     seconds between keys
// --limit    DOSBox-X's own time limit in seconds, so a stuck run still ends
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { program: 'RBSTUDIO', args: '', wait: '5', pace: '2', limit: '90', keys: '', shots: '' };
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]?.replace(/^--/, '');
    if (!(name in opts) && name !== 'dir' && name !== 'out') throw new Error(`unknown option ${argv[i]}`);
    if (argv[i + 1] === undefined) throw new Error(`${argv[i]} needs a value`);
    opts[name] = argv[i + 1];
  }
  if (!opts.dir) throw new Error('--dir is required');
  return opts;
}

/** REBEEP_DOSBOX, else the newest dosbox-x.exe under the environment's tools folder. */
function findDosbox() {
  if (process.env.REBEEP_DOSBOX) return process.env.REBEEP_DOSBOX;
  const home = process.env.REBEEP_HOME || path.join(os.homedir(), '.rebeep');
  const root = path.join(home, 'tools', 'dosbox-x');
  const versions = fs.existsSync(root) ? fs.readdirSync(root).sort().reverse() : [];
  for (const version of versions) {
    const exe = path.join(root, version, 'bin', 'x64', 'Release', 'dosbox-x.exe');
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error('DOSBox-X not found: run `rebeep env setup` or set REBEEP_DOSBOX to its absolute path');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (process.platform !== 'win32') throw new Error('drive.mjs captures the window with PowerShell: Windows only');
  const opts = parseArgs(process.argv.slice(2));
  const dir = path.resolve(opts.dir);
  const out = path.resolve(opts.out || path.join(os.tmpdir(), 'rebeep-drive'));
  fs.mkdirSync(out, { recursive: true });
  const shots = opts.shots.split(',').filter(Boolean).map(Number);

  const commands = [`MOUNT C "${dir}"`, 'C:'];
  if (opts.keys) commands.push(`AUTOTYPE -w ${opts.wait} -p ${opts.pace} ${opts.keys}`);
  commands.push(`${opts.program} ${opts.args}`.trim());
  const args = ['-set', 'mixer nosound=true', '-nomenu', '-time-limit', opts.limit, ...commands.flatMap((c) => ['-c', c])];

  const child = spawn(findDosbox(), args, { stdio: 'ignore' });
  const start = Date.now();
  try {
    for (const seconds of shots) {
      await sleep(Math.max(0, start + seconds * 1000 - Date.now()));
      const file = path.join(out, `shot-${seconds}.png`);
      const ps = spawnSync(
        'powershell',
        ['-NoProfile', '-File', path.join(here, 'window-shot.ps1'), '-ProcId', String(child.pid), '-Out', file],
        { encoding: 'utf8' },
      );
      console.log(ps.status === 0 ? file : `no screenshot at ${seconds}s: ${(ps.stderr || ps.stdout).trim()}`);
    }
  } finally {
    try {
      process.kill(child.pid);
    } catch {
      // DOSBox-X already ended (its time limit, or the program quit).
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
