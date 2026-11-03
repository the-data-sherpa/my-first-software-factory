// Controlled-fixture instrumentation only. Installed bwrap, source snapshots,
// namespace verification and actual executor/check code remain in use.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const scenario = process.argv[3];
const originalSpawn = childProcess.spawn;
const originalExec = childProcess.execFile;
const originalKill = process.kill;
const ready = Promise.withResolvers();
let count = 0; let sandbox; let deny = false;
const scopeKills = [];
const cgroup = (await readFile('/proc/self/cgroup', 'utf8')).trim().slice(3);
const unit = cgroup.split('/').at(-1);
assert.match(unit, /^factory-contained-[a-f0-9-]{36}\.scope$/);
childProcess.spawn = (command, args, options) => {
  const target = scenario === 'tool-startup-drain' ? args.at(-1) === 'boundary' : args.includes('/work/node_modules/vitest/vitest.mjs');
  if (command !== '/usr/bin/bwrap' || !target || ++count !== 2) return originalSpawn(command, args, options);
  const child = originalSpawn(command, args, options);
  child.stdio[4].end = () => child.stdio[4];
  let text = '';
  child.stdio[5].on('data', data => { text += data; });
  child.stdio[5].on('end', () => {
    (async () => {
      sandbox = JSON.parse(text)['child-pid'];
      assert.equal((await readFile(`/proc/${sandbox}/cgroup`, 'utf8')).trim(), `0::${cgroup}`);
      originalKill(sandbox, 'SIGSTOP'); deny = true; ready.resolve();
    })().catch(ready.reject);
  });
  return child;
};
childProcess.execFile = (command, args, ...tail) => {
  if (deny && command === '/usr/bin/systemctl' && args.includes('kill')) {
    assert.equal(args.at(-1), unit); scopeKills.push(unit);
    queueMicrotask(() => tail.at(-1)(Object.assign(new Error('Controlled manager refusal'), { code: 'EPERM' })));
    return {};
  }
  return originalExec(command, args, ...tail);
};
const injected = childProcess.execFile;
injected[promisify.custom] = (...args) => new Promise((resolve, reject) => {
  injected(...args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
});
process.kill = (pid, signal) => {
  if (deny && pid === sandbox && signal === 'SIGKILL') throw Object.assign(new Error('Controlled namespace refusal'), { code: 'EPERM' });
  return originalKill(pid, signal);
};
syncBuiltinESMExports();
globalThis.executorDrainFixture = { ready: ready.promise, scopeKills };
await import('./executor-worker.mjs');
