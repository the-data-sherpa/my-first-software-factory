// Process-local signal/manager refusal. Exercise the real check/close interface;
// the owning harness removes only this fixture's exact scope after the assertions.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root = process.argv[2];
const execFile = childProcess.execFile; const kill = process.kill;
let deny = false; let sandbox; let observed = []; const scopeKills = [];
childProcess.execFile = (command, args, ...tail) => {
  if (deny && command === '/usr/bin/systemctl' && args.includes('kill')) {
    scopeKills.push(args.at(-1));
    queueMicrotask(() => tail.at(-1)(Object.assign(new Error('Injected manager refusal'), { code: 'EPERM' })));
    return {};
  }
  return execFile(command, args, ...tail);
};
const injectedExecFile = childProcess.execFile;
injectedExecFile[promisify.custom] = (...args) => new Promise((resolve, reject) => {
  injectedExecFile(...args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
});
syncBuiltinESMExports();
const { createContainmentFixture, verifyContainmentEnvelope } = await import('../../src/containment.mjs');
const { observeDescendants, livingProcesses, waitForCleanup } = await import('../../src/containment-process-fixtures.mjs');
await mkdir(`${root}/work`, { mode: 0o700 }); await mkdir(`${root}/receipts`, { mode: 0o700 });
await writeFile(`${root}/work/source.txt`, 'controlled fixture');
const tools = await createContainmentFixture({ worktree: `${root}/work`, receiptDirectory: `${root}/receipts` });
process.kill = (pid, signal) => {
  if (deny && pid === sandbox.pid && signal === 'SIGKILL') throw Object.assign(new Error('Injected namespace signal refusal'), { code: 'EPERM' });
  return kill(pid, signal);
};
try {
  const controller = new AbortController();
  const checking = tools.check('hang', { signal: controller.signal }); checking.catch(() => {});
  observed = await observeDescendants(tools.envelope);
  for (const identity of observed) {
    if (/^NSpid:\s+\d+\s+1$/m.test(await readFile(`/proc/${identity.pid}/status`, 'utf8'))) sandbox = identity;
  }
  assert.ok(sandbox);
  deny = true; controller.abort();
  await assert.rejects(checking, { code: 'DRAIN_FAILED' });
  assert.equal((await livingProcesses([sandbox])).length, 1);
  await assert.rejects(verifyContainmentEnvelope(), { code: 'CONTAINMENT_REQUIRED' });
  // An executor may handle a tool failure. Mandatory finalization must still fail.
  await assert.rejects(tools.close(), { code: 'DRAIN_FAILED' });
  await assert.rejects(tools.close(), { code: 'DRAIN_FAILED' });
  assert.deepEqual(scopeKills, [tools.envelope.unit]);
  console.log(JSON.stringify({ closeFenced: true, scopeKills }));
} finally {
  deny = false; process.kill = kill; childProcess.execFile = execFile; syncBuiltinESMExports();
  for (const identity of [...observed].reverse()) {
    if ((await livingProcesses([identity])).length) kill(identity.pid, 'SIGKILL');
    assert.deepEqual(await waitForCleanup([identity]), []);
  }
  await tools.close().catch(() => {});
}
