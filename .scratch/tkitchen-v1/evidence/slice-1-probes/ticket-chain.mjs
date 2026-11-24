import fs from 'node:fs/promises';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const adapter = 'file:///F:/MyWork/tkitchen/src/infrastructure/lock-file.ts';
const COMMIT = '77252202917945757d0b8d5bece3647c69d61c27';

if (process.argv[2] === 'worker') {
  const home = process.argv[3];
  const { FileLock } = await import(adapter);
  const lock = new FileLock(home);
  try {
    const result = await lock.acquire();
    process.send({ type: 'result', pid: process.pid, result });
  } catch (e) {
    process.send({ type: 'result', pid: process.pid, result: 'threw', code: e.code ?? String(e), message: String(e.message ?? e).slice(0, 200) });
  }
  await once(process, 'message');
  process.exit(0);
} else {
  const guardTimer = setTimeout(() => { console.error('probe timeout'); process.exit(3); }, 60000);
  function start(home) {
    const child = fork(fileURLToPath(import.meta.url), ['worker', home], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    child.stderr.on('data', (b) => process.stderr.write(b));
    const queue = []; const waiters = [];
    child.on('message', (m) => { if (waiters.length) waiters.shift()(m); else queue.push(m); });
    return { child, next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r)) };
  }
  async function readOrNull(p) { try { return await fs.readFile(p, 'utf8'); } catch { return null; } }
  function deadPid() {
    const d = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
    return Number(d.stdout);
  }
  async function tryAcquire(home) {
    const w = start(home);
    const res = await w.next();
    w.child.send('stop');
    await once(w.child, 'exit').catch(() => undefined);
    return { pid: w.child.pid, ...res };
  }
  async function scenario(depth) {
    const home = await fs.mkdtemp(join(tmpdir(), 'qa07r4-chain-'));
    try {
      const dead = deadPid();
      await fs.writeFile(join(home, 'kitchen.lock'), JSON.stringify({ pid: dead, startedAt: new Date().toISOString() }));
      let path = join(home, 'kitchen.lock.takeover');
      await fs.writeFile(path, JSON.stringify({ pid: dead, key: 'planted' }));
      let written = 0; let fabricateError = null;
      for (let i = 0; i < depth; i++) {
        path = path + '.recover-' + dead;
        try {
          await fs.writeFile(path, String(dead));
          written++;
        } catch (e) {
          fabricateError = e.code ?? String(e);
          break;
        }
      }
      const deepestComponent = basename(path).length;
      const first = await tryAcquire(home);
      const lockAfterFirst = await readOrNull(join(home, 'kitchen.lock'));
      let second = null;
      if (first.result !== 'acquired') second = await tryAcquire(home);
      const filesLeft = (await fs.readdir(home)).sort();
      return { depthRequested: depth, ticketsWritten: written, fabricateError, deepestComponentChars: deepestComponent, first, lockAfterFirst, second, filesLeftCount: filesLeft.length, filesLeft: filesLeft.slice(0, 4) };
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  }
  const results = [];
  results.push(await scenario(5));
  results.push(await scenario(30));
  clearTimeout(guardTimer);
  console.log(JSON.stringify({ commit: COMMIT, results }, null, 2));
}
