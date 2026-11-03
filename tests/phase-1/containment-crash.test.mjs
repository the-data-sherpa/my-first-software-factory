import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, access } from 'node:fs/promises';
import { startDiagnostic } from '../fixtures/containment-harness.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { processIdentity, waitForCleanup } from '../../src/containment-process-fixtures.mjs';
import { inspectContainedChecks } from '../../src/containment.mjs';

const exec = promisify(execFile);
async function start(t, scenario) {
  const harness = await startDiagnostic(t, scenario);
  return { directory: harness.directory, ready: await harness.ready(), finished: harness.finished };
}
async function interruptedReceipt(directory, name) {
  const checks = await readdir(`${directory}/receipts`);
  for (const check of checks) {
    const started = JSON.parse(await readFile(`${directory}/receipts/${check}/started.json`, 'utf8'));
    if (started.name !== name) continue;
    await assert.rejects(access(`${directory}/receipts/${check}/result.json`), { code: 'ENOENT' });
    await access(`${directory}/receipts/${check}/source/source.txt`);
    return started;
  }
  assert.fail('Missing retained start receipt');
}

test('backend SIGKILL removes direct bwrap children and escaped descendants without replay', { timeout: 15000 }, async (t) => {
  const { directory, ready, finished } = await start(t, 'crash');
  assert.ok(ready.observed.length >= 5);
  const current = await processIdentity(ready.backendIdentity.pid);
  assert.equal(current.startTime, ready.backendIdentity.startTime);
  process.kill(current.pid, 'SIGKILL'); // Only the exact backend created by this test.
  const terminal = await finished;
  assert.notEqual(terminal.code, 0);
  assert.deepEqual(await waitForCleanup(ready.observed), []);
  const retained = await interruptedReceipt(directory, 'hang');
  assert.equal(retained.backendPid, ready.backendIdentity.pid);
  const checks = await inspectContainedChecks(`${directory}/receipts`);
  assert.equal(checks.find((check) => check.name === 'hang').status, 'interrupted');
  await delay(100);
  assert.deepEqual(await inspectContainedChecks(`${directory}/receipts`), checks);
  await interruptedReceipt(directory, 'hang'); // Inspection never creates a result or wakes execution.
});

test('a scoped OOM kills the disposable backend and leaves passive interrupted evidence', { timeout: 15000 }, async (t) => {
  const { directory, ready, finished } = await start(t, 'memory');
  assert.equal(ready.envelope.memoryBytes, 201326592);
  assert.equal(ready.envelope.swapBytes, 0);
  assert.equal(ready.envelope.tasks, 48);
  const terminal = await finished;
  assert.notEqual(terminal.code, 0);
  const { stdout } = await exec('/usr/bin/systemctl', ['--user', 'show', ready.envelope.unit, '--property=Result,MemoryPeak']);
  assert.match(stdout, /^Result=oom-kill$/m);
  await interruptedReceipt(directory, 'memory');
  assert.equal((await inspectContainedChecks(`${directory}/receipts`)).find((check) => check.name === 'memory').status, 'interrupted');
  assert.deepEqual(await waitForCleanup([ready.backendIdentity]), []);
});
