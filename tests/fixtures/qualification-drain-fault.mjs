// Process-local OS-boundary fault. Install before loading containment's promisified
// manager adapter. The exact-owned harness drains the still-live namespace afterward.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
const original = childProcess.execFile; const kill = process.kill;
let deny = false; let sandbox;
export const scopeKills = [];
export function install() {
  childProcess.execFile = (command, args, ...tail) => {
    if (deny && command === '/usr/bin/systemctl' && args.includes('kill')) {
      scopeKills.push(args.at(-1));
      queueMicrotask(() => tail.at(-1)(Object.assign(new Error('Controlled scope refusal'), { code: 'EPERM' })));
      return {};
    }
    return original(command, args, ...tail);
  };
  const injected = childProcess.execFile;
  injected[promisify.custom] = (...args) => new Promise((resolve, reject) => {
    injected(...args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
  });
  process.kill = (pid, signal) => {
    if (deny && sandbox?.pid === pid && signal === 'SIGKILL') throw Object.assign(new Error('Controlled namespace refusal'), { code: 'EPERM' });
    return kill(pid, signal);
  };
  syncBuiltinESMExports();
}
export async function refuseDrain(directory, controller) {
  const { processIdentity, livingProcesses } = await import('../../src/containment-process-fixtures.mjs');
  for (let i = 0; i < 1000; i++) {
    for (const name of await readdir(directory)) {
      try {
        const started = JSON.parse(await readFile(`${directory}/${name}/started.json`, 'utf8'));
        if (started.name !== 'selected-regression') continue;
        const launch = JSON.parse(await readFile(`${directory}/${name}/launch.json`, 'utf8'));
        sandbox = await processIdentity(launch.sandbox.pid);
        assert.equal(sandbox.startTime, launch.sandbox.startTime);
        assert.match(await readFile(`/proc/${sandbox.pid}/status`, 'utf8'), /^NSpid:\s+\d+\s+1$/m);
        deny = true; controller.abort();
        return async () => assert.equal((await livingProcesses([sandbox])).length, 1);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await delay(5);
  }
  throw new Error('No owned selected-regression namespace observed');
}
