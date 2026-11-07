import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, chmod, readdir, rm } from 'node:fs/promises';
import { startForeground, ownedProcesses, runOwnedScope } from '../fixtures/containment-harness.mjs';
import { fileURLToPath } from 'node:url';
import { waitForCleanup } from '../../src/containment-process-fixtures.mjs';

async function removeFixture(root) {
  async function writable(path) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await writable(`${path}/${entry.name}`);
  }
  await writable(root); await rm(root, { recursive: true, force: true });
}
async function startup(t, stage) {
  const root = await mkdtemp(join(tmpdir(), 'factory-dependencies-'));
  const harness = await startForeground(t, ['dependencies-diagnose', `startup-${stage}`, root]);
  t.after(async () => {
    await harness.dispose();
    await removeFixture(root);
  });
  return { ...harness, root };
}
for (const stage of ['proof', 'target']) {
  test(`${stage}: owner abort at a stopped preparation startup joins namespace death and pipe closure`, async (t) => {
    const h = await startup(t, stage);
    const ready = await h.ready();
    process.kill(ready.backendIdentity.pid, 'SIGUSR1');
    let terminal;
    try { terminal = await h.bounded(h.finished, 3000); }
    catch (error) {
      t.diagnostic(JSON.stringify({ unit: h.unit, ready, observation: JSON.parse(await readFile(`${h.root}/startup-observation.json`, 'utf8')) }));
      throw error;
    }
    assert.equal(terminal.code, 0, JSON.stringify(terminal));
    const result = JSON.parse(terminal.stdout.trim().split('\n')[1]);
    assert.equal(result.cancelled, 'DEPENDENCIES_ABORTED');
    assert.equal(result.failure.code, 'DEPENDENCIES_ABORTED');
    assert.equal(result.closed, true);
    assert.equal(result.ownerReleased, true);
    assert.deepEqual(result.survivors, []);
    assert.deepEqual(await waitForCleanup(ready.observed), []);
    assert.deepEqual(await ownedProcesses(h.unit), []);
  });
  for (const owner of ['backend', 'launcher']) {
    test(`${stage}: ${owner} death at startup drains the actual foreground preparation scope`, async (t) => {
      const h = await startup(t, stage); const ready = await h.ready();
      process.kill(owner === 'backend' ? ready.backendIdentity.pid : h.child.pid, 'SIGKILL');
      const terminal = await h.bounded(h.finished, 3000);
      assert.notEqual(terminal.code, 0);
      assert.deepEqual(await waitForCleanup([ready.backendIdentity, ...ready.observed]), []);
      assert.deepEqual(await ownedProcesses(h.unit), []);
    });
  }
  test(`${stage}: outer bwrap exit starts namespace drainage without waiting for output close`, async (t) => {
    const h = await startup(t, stage); const ready = await h.ready();
    process.kill(ready.observed[0].pid, 'SIGKILL');
    const terminal = await h.bounded(h.finished, 3000);
    assert.equal(terminal.code, 0, JSON.stringify(terminal));
    const result = JSON.parse(terminal.stdout.trim().split('\n')[1]);
    assert.equal(result.cancelled, 'DEPENDENCIES_INSTALL_FAILED');
    assert.equal(result.closed, true);
    assert.equal(result.ownerReleased, true);
    assert.deepEqual(result.survivors, []);
    assert.deepEqual(await ownedProcesses(h.unit), []);
  });
}
for (const stage of ['proof', 'target']) for (const trigger of ['timeout', 'output']) {
  test(`${stage}: injected ${trigger} at startup preserves the limit reason and drains before release`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'factory-dependencies-'));
    t.after(() => removeFixture(root));
    const worker = fileURLToPath(new URL('../fixtures/dependency-limit-fault.mjs', import.meta.url));
    const terminal = await runOwnedScope(t, [worker, root, stage, trigger], { timeout: 10000 });
    assert.equal(terminal.code, 0, terminal.stderr);
    assert.deepEqual(JSON.parse(terminal.stdout), { code: trigger === 'timeout' ? 'DEPENDENCIES_TIMEOUT' : 'DEPENDENCIES_OUTPUT_LIMIT',
      survivors: [], closed: true, ownerReleased: true });
  });
}
test('owner preparation startup cancellation sweeps both sandbox stages before and after the info handoff', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-dependencies-'));
  t.after(() => removeFixture(root));
  const worker = fileURLToPath(new URL('../fixtures/dependency-timing-loop.mjs', import.meta.url));
  const terminal = await runOwnedScope(t, [worker, root], { timeout: 30000 });
  assert.equal(terminal.code, 0, terminal.stderr);
  const { results } = JSON.parse(terminal.stdout);
  assert.equal(results.length, 16);
  assert.ok(results.every((result) => result.reason === 'DEPENDENCIES_ABORTED' && result.survivors.length === 0));
});
for (const owner of ['standalone', 'application', 'application-persistence']) {
  test(`${owner}: failed namespace and scope drainage retains live ownership and the DRAIN_FAILED fence`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'factory-dependencies-'));
    t.after(() => removeFixture(root));
    const worker = fileURLToPath(new URL('../fixtures/dependency-drain-fault.mjs', import.meta.url));
    const terminal = await runOwnedScope(t, [worker, root, owner], { timeout: 10000 });
    assert.equal(terminal.code, 0, terminal.stderr);
    const result = JSON.parse(terminal.stdout);
    assert.equal(result.failure.code, 'DRAIN_FAILED');
    assert.equal(result.ownerRetained, true); assert.equal(result.executionFenced, true);
    assert.deepEqual(result.scopeKills, [terminal.unit]);
    if (owner.startsWith('application')) { assert.equal(result.status, 'interrupted'); assert.equal(result.reason, 'drain_failed'); }
    if (owner === 'application-persistence') assert.equal(result.failureRecordUnavailable, true);
  });
}
test('preparation harness timeout before ready drains its announced exact scope', async (t) => {
  const h = await startup(t, 'proof');
  await assert.rejects(h.bounded(h.finished, 1), /exceeded 1ms/);
  assert.deepEqual(await ownedProcesses(h.unit), []);
});
test('preparation harness timeout drains a stopped launcher and its stopped namespace', async (t) => {
  const h = await startup(t, 'target'); const ready = await h.ready();
  process.kill(h.child.pid, 'SIGSTOP');
  await assert.rejects(h.bounded(h.finished, 10), /exceeded 10ms/);
  assert.deepEqual(await waitForCleanup([ready.backendIdentity, ...ready.observed]), []);
  assert.deepEqual(await ownedProcesses(h.unit), []);
});
