// Stand-in for 86Box in tests. Records its arguments and working folder to the JSON file named by
// FAKE86BOX_OUT, then sleeps until it is killed (60 seconds at most).
import fs from 'node:fs';
import os from 'node:os';

const out = process.env.FAKE86BOX_OUT;
if (out) {
  fs.writeFileSync(out, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), pid: process.pid }));
}
// Do not keep the VM folder locked (Windows) once it has been recorded.
process.chdir(os.tmpdir());
setTimeout(() => {}, 60000);
