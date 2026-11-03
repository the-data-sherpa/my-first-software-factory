import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, startDiagnostic, ownedProcesses, runOwnedScope } from '../fixtures/containment-harness.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { waitForCleanup } from '../../src/containment-process-fixtures.mjs';

test('handled check drainage failure remains fenced through mandatory close', async (t) => {
  const root = await mkdtemp('/tmp/factory-containment-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const worker = fileURLToPath(new URL('../fixtures/containment-drain-fault.mjs', import.meta.url));
  const terminal = await runOwnedScope(t, [worker, root], { timeout: 10000 });
  assert.equal(terminal.code, 0, terminal.stderr);
  assert.deepEqual(JSON.parse(terminal.stdout), { closeFenced: true, scopeKills: [terminal.unit] });
});

test('startup cancellation drains the namespace before returning at every fixed timing offset', async (t) => {
  const result = await diagnose(t, 'cleanup-startup', 3000);
  assert.equal(result.results.length, 40);
  for (const check of result.results) {
    assert.equal(check.reason, 'aborted');
    assert.deepEqual(check.survivors, []);
  }
});

for (const [mode, signal] of [['abort', 'SIGUSR1'], ['close', 'SIGUSR2']]) {
  test(`${mode} at the startup gate drains a namespace whose parent-death setup is stopped`, async (t) => {
    const harness = await startDiagnostic(t, 'startup-stop');
    const ready = await harness.ready();
    process.kill(ready.backendIdentity.pid, signal);
    const terminal = await harness.bounded(harness.finished, 3000);
    assert.equal(terminal.code, 0, terminal.stderr);
    assert.equal(JSON.parse(terminal.stdout.trim().split('\n')[1]).reason, 'aborted');
    assert.deepEqual(await waitForCleanup(ready.observed), []);
  });
}

test('launcher SIGKILL removes the backend and detached namespace descendants', async (t) => {
  const harness = await startDiagnostic(t, 'crash');
  const ready = await harness.ready();
  harness.child.kill('SIGKILL');
  await harness.exited;
  assert.deepEqual(await waitForCleanup([ready.backendIdentity, ...ready.observed]), []);
  assert.deepEqual(await ownedProcesses(harness.unit), []);
});

for (const owner of ['backend', 'launcher']) {
  test(`${owner} SIGKILL at the startup gate removes a stopped namespace before command dispatch`, async (t) => {
    const harness = await startDiagnostic(t, 'startup-stop');
    const ready = await harness.ready();
    process.kill(owner === 'backend' ? ready.backendIdentity.pid : harness.child.pid, 'SIGKILL');
    const terminal = await harness.bounded(harness.finished, 3000);
    assert.notEqual(terminal.code, 0);
    assert.deepEqual(await waitForCleanup([ready.backendIdentity, ...ready.observed]), []);
    assert.deepEqual(await ownedProcesses(harness.unit), []);
  });
}

test('a harness timeout before a ready receipt still drains the exact announced scope', async (t) => {
  const harness = await startDiagnostic(t, 'startup-stop');
  await assert.rejects(harness.bounded(harness.finished, 1), /exceeded 1ms/);
  assert.deepEqual(await ownedProcesses(harness.unit), []);
});

test('a harness timeout cleans its exact owned scope even when the launcher cannot handle a signal', async (t) => {
  const harness = await startDiagnostic(t, 'crash');
  const ready = await harness.ready();
  process.kill(harness.child.pid, 'SIGSTOP');
  await assert.rejects(harness.bounded(harness.finished, 10), /exceeded 10ms/);
  assert.deepEqual(await waitForCleanup([ready.backendIdentity, ...ready.observed]), []);
  assert.deepEqual(await ownedProcesses(harness.unit), []);
});
