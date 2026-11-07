import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runOwnedScope } from '../fixtures/containment-harness.mjs';
import { fileURLToPath } from 'node:url';
import { mkdtemp, chmod, readdir, rm } from 'node:fs/promises';
import { openFactory, inspectHistory } from '../../src/factory.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';

const fixtureRoots = new WeakMap();
async function cleanup(path) {
  await chmod(path, 0o700);
  for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await cleanup(`${path}/${entry.name}`);
  await rm(path, { recursive: true, force: true });
}
function retainedTest(name, options, body) {
  return test(name, options, async t => {
    const roots = []; fixtureRoots.set(t, roots);
    let passed = false;
    try { await body(t); passed = true; }
    finally {
      if (passed && !t.signal.aborted && roots.every(root => root.drained)) {
        for (const { path } of roots) await cleanup(path);
      } else for (const { path } of roots) t.diagnostic(`Retained fixture: ${path}`);
    }
  });
}
async function scoped(t, scenario = 'prepare') {
  const root = await mkdtemp(join(tmpdir(), 'factory-dependencies-'));
  const owned = { path: root, drained: false }; fixtureRoots.get(t).push(owned);
  const worker = fileURLToPath(new URL(scenario.startsWith('registry-')
    ? './dependency-registry-application-worker.mjs' : './dependency-application-worker.mjs', import.meta.url));
  const terminal = await runOwnedScope(t, [worker, root, scenario], { timeout: 30000, environment: { PATH: '/usr/bin:/bin', HOME: root } });
  owned.drained = true;
  if (scenario.startsWith('crash-')) assert.notEqual(terminal.code, 0, 'The disposable worker must crash at its checkpoint.');
  else assert.equal(terminal.code, 0, terminal.stderr);
  return JSON.parse(terminal.stdout);
}

retainedTest('explicit owner registry authorization is saved before locked fetching and installation', { timeout: 40_000 }, async (t) => {
  const { prepared, requests } = await scoped(t, 'registry-authorized');
  assert.equal(prepared.dependencies.registry, true);
  assert.equal(prepared.dependencies.receipt.acquisition.archives.length, 2);
  assert.equal(prepared.counters.modelAttempts, 0);
  assert.equal(prepared.outcome.reviewReady, false);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.method === 'GET' && request.authorization === undefined));
});

retainedTest('registry dependencies never turn ordinary offline owner preparation into fetch authorization', { timeout: 40_000 }, async (t) => {
  const { prepared, requests } = await scoped(t, 'registry-no-authorization');
  assert.equal(prepared.status, 'failed');
  assert.equal(prepared.dependencies.registry, false);
  assert.equal(prepared.dependencies.intent, undefined);
  assert.deepEqual(requests, []);
});

retainedTest('a later explicit controlled run reuses a matching bundle without fetching and persists its own check budget', { timeout: 40_000 }, async (t) => {
  const { prepared, requests, reuse } = await scoped(t, 'registry-reuse');
  assert.equal(requests.length, 2);
  assert.equal(reuse.check.passed, true);
  assert.equal(reuse.check.dependencyIntentId, prepared.dependencies.intent.id);
  assert.equal(JSON.parse(reuse.check.output).value, 'transitive registry fixture');
  assert.equal(reuse.run.counters.toolRounds, 2);
  assert.equal(reuse.run.counters.modelAttempts, 1); // Explicit tool-free model fixture, never a live request.
  assert.equal(reuse.run.outcome.reviewReady, false);
  assert.equal(prepared.counters.toolRounds, 0);
  assert.equal(prepared.counters.modelAttempts, 0);
});

retainedTest('application stop aborts and drains a stalled registry body without another fetch or a renewed budget', { timeout: 40_000 }, async (t) => {
  const { prepared, requests } = await scoped(t, 'registry-stop-fetch');
  assert.equal(prepared.status, 'stopped');
  assert.equal(prepared.outcome.reason, 'operator_stop');
  assert.equal(prepared.dependencies.failure.code, 'DEPENDENCIES_ABORTED');
  assert.equal(prepared.counters.modelAttempts, 0);
  assert.equal(prepared.counters.toolRounds, 0);
  assert.equal(requests.length, 1);
});

retainedTest('crashed dependency preparation inspects passively and cannot release admission without a completed artifact receipt', { timeout: 40_000 }, async (t) => {
  for (const scenario of ['crash-intent', 'crash-receipt']) {
    const { stateDir, runId } = await scoped(t, scenario);
    const retained = await inspectHistory({ stateDir, runId });
    assert.equal(retained.status, 'interrupted');
    assert.equal(retained.operation, 'dependency-preparation');
    assert.equal(retained.dependencies.artifactStatus, scenario === 'crash-intent' ? 'not-prepared' : 'prepared');
    const factory = await openFactory({ stateDir, project: retained.project, workspace: { admit: admitWorkspace, prepare: prepareWorkspace } });
    try {
      assert.deepEqual(await factory.inspectRun(runId), retained);
      await assert.rejects(factory.startRun({ requestId: 'cannot-wake', brief: retained.brief.text }), { code: 'RUN_ACTIVE' });
      if (scenario === 'crash-intent') {
        await assert.rejects(factory.stopRun(runId), { code: 'DEPENDENCIES_RECOVERY_REQUIRED' });
        await assert.rejects(factory.replaceRun(runId, { requestId: 'cannot-replace', review: 'No completed preparation receipt exists.' }), { code: 'DEPENDENCIES_RECOVERY_REQUIRED' });
        assert.equal((await factory.inspectRun(runId)).status, 'interrupted');
      } else {
        const stopped = await factory.stopRun(runId);
        assert.equal(stopped.status, 'stopped');
        assert.equal(stopped.deadlineAt, retained.deadlineAt);
        assert.deepEqual(stopped.counters, retained.counters);
        assert.equal(stopped.dependencies.receipt.status, 'prepared');
      }
    } finally { await factory.close(); }
  }
});

retainedTest('stop, shutdown and the original deadline cancel and drain owner preparation without model work or renewed budgets', { timeout: 40_000 }, async (t) => {
  for (const scenario of ['stop', 'shutdown', 'deadline']) {
    const { stopped, survivors, observedCount } = await scoped(t, scenario);
    assert.equal(stopped.status, scenario === 'deadline' ? 'failed' : 'stopped');
    assert.equal(stopped.outcome.reason, scenario === 'deadline' ? 'RUN_DEADLINE' : scenario === 'shutdown' ? 'backend_shutdown' : 'operator_stop');
    assert.equal(stopped.dependencies.status, 'failed');
    assert.equal(stopped.dependencies.failure.code, 'DEPENDENCIES_ABORTED');
    assert.equal(stopped.counters.modelAttempts, 0);
    assert.equal(stopped.counters.toolRounds, 0);
    assert.ok(observedCount >= 2);
    assert.deepEqual(survivors, []);
  }
});

retainedTest('run tools accept only a verified bundle and charge fixed read-only checks to the supplied original budget', { timeout: 40_000 }, async (t) => {
  const { prepared, checks } = await scoped(t, 'tools');
  assert.equal(checks.verification.probe.readOnlyBundle, true);
  for (const check of [checks.vitest, checks.lint]) {
    assert.equal(check.passed, true);
    assert.equal(check.dependencyIntentId, prepared.dependencies.intent.id);
    assert.equal(check.reviewReady, false);
    assert.deepEqual(Object.values(JSON.parse(check.output).writes), ['EROFS', 'EROFS', 'EROFS']);
    assert.equal(JSON.parse(check.output).network, 'EPERM');
  }
  assert.equal(checks.budget.deadlineAt, prepared.deadlineAt);
  assert.equal(checks.budget.counters.modelAttempts, 0);
  assert.equal(checks.budget.counters.toolRounds, 4);
  assert.ok(checks.budget.reservations.every((item) => item.state === 'settled'));
});

retainedTest('application inspection reports a stale bundle and repeated owner preparation cannot claim success or reinstall it', { timeout: 40_000 }, async (t) => {
  const { prepared } = await scoped(t, 'stale');
  assert.equal(prepared.dependencies.receipt.status, 'prepared');
  assert.equal(prepared.counters.modelAttempts, 0);
});

retainedTest('explicit application preparation saves intent before effects and retains a bundle without resetting the run or executing an agent', { timeout: 40_000 }, async (t) => {
  const { prepared, intentSavedBeforeEffects } = await scoped(t);
  assert.equal(intentSavedBeforeEffects, true);
  assert.equal(prepared.status, 'blocked');
  assert.equal(prepared.outcome.reason, 'MODEL_NOT_READY');
  assert.equal(prepared.outcome.reviewReady, false);
  assert.equal(prepared.counters.modelAttempts, 0);
  assert.equal(prepared.counters.toolRounds, 0);
  assert.equal(prepared.dependencies.receipt.suppression.positive.length, 6);
  assert.equal(prepared.dependencies.receipt.suppression.suppressed.length, 0);
  assert.equal(prepared.dependencies.receipt.frozenLockfile, true);
});
