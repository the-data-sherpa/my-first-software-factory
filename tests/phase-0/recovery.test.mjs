import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { until, startWorker, results, assertOneInput } from './helpers.mjs';

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'factory-phase0-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
const executions = async (path) => (await readFile(join(path, 'executions.log'), 'utf8')).trim().split('\n').length;

test('manual run survives SIGKILL during a model request, with one admitted input', { timeout: 30_000 }, async (t) => {
  const path = await directory(t);
  const first = await startWorker(t, path, 'model-crash');
  await until(() => first.events.has('model-request'), Boolean);
  const before = await first.snapshot();
  await first.stop();
  await writeFile(join(path, 'release'), 'resume');
  const second = await startWorker(t, path, 'model-crash');
  const done = await second.done();
  assert.equal(done.submission.id, before.submission.id);
  assertOneInput(done);
  assert.match(JSON.stringify(done.view.entries), /Phase 0 complete/);
});

test('a declared replay-safe tool reruns after SIGKILL', { timeout: 30_000 }, async (t) => {
  const path = await directory(t);
  const first = await startWorker(t, path, 'safe');
  await until(() => first.events.has('executing'), Boolean);
  const before = await first.snapshot();
  assert.equal(await executions(path), 1);
  await first.stop();
  await writeFile(join(path, 'release'), 'resume');
  const second = await startWorker(t, path, 'safe');
  const done = await second.done();
  assert.equal(done.submission.id, before.submission.id);
  assert.equal(await executions(path), 2, 'safe does not mean exactly once');
  assert.equal(results(done).length, 1);
  assertOneInput(done);
});

test('an unsafe mid-call effect is not replayed and gets an interrupted result', { timeout: 30_000 }, async (t) => {
  const path = await directory(t);
  const first = await startWorker(t, path, 'unsafe');
  await until(() => first.events.has('executing'), Boolean);
  const before = await first.snapshot();
  await first.stop();
  await writeFile(join(path, 'release'), 'resume');
  const second = await startWorker(t, path, 'unsafe');
  const done = await second.done();
  assert.equal(done.submission.id, before.submission.id);
  assert.equal(await executions(path), 1);
  const [result] = results(done);
  assert.equal(result.model[0].isError, true);
  assert.ok(result.data.diagnostics.some((diagnostic) => diagnostic.code === 'interrupted'));
  assertOneInput(done);
});

for (const decision of ['approved', 'rejected']) {
  test(`pending approval survives SIGKILL and records ${decision}`, { timeout: 30_000 }, async (t) => {
    const path = await directory(t);
    const first = await startWorker(t, path, 'approval');
    const before = await until(first.snapshot, (state) => Object.keys(state.approvals?.items ?? {}).length === 1);
    const [pending] = Object.values(before.approvals.items);
    assert.equal(pending.status, 'pending');
    assert.equal(before.approvals.effects, 0);
    await first.stop();
    const second = await startWorker(t, path, 'approval');
    const after = await second.request('reconnect');
    assert.deepEqual(after.approvals, before.approvals);
    assert.equal(after.submission.id, before.submission.id);
    assert.equal(after.submission.status, 'placed');
    await assert.rejects(second.request('decide', { decision: 'invalid' }), /Invalid decision/);
    await second.request('decide', { decision });
    const done = await second.done();
    const items = Object.values(done.approvals.items);
    assert.equal(items.length, 1);
    assert.equal(items[0].taskId, pending.taskId);
    assert.equal(items[0].status, decision);
    assert.equal(items[0].approver, 'phase0-test-human');
    assert.ok(Number.isFinite(Date.parse(items[0].decidedAt)));
    assert.equal(done.approvals.effects, decision === 'approved' ? 1 : 0);
    await assert.rejects(second.request('decide', { decision }), /No pending proposal/);
    assertOneInput(done);
  });
}

test('a committed approval survives SIGKILL before its fake effect', { timeout: 30_000 }, async (t) => {
  const path = await directory(t);
  const first = await startWorker(t, path, 'approval-after-decision');
  await until(first.snapshot, (state) => Object.keys(state.approvals?.items ?? {}).length === 1);
  await first.request('decide', { decision: 'approved' });
  await until(() => first.events.has('decision-observed'), Boolean);
  const before = await first.snapshot();
  assert.equal(before.approvals.effects, 0);
  assert.equal(Object.values(before.approvals.items)[0].status, 'approved');
  await first.stop();
  await writeFile(join(path, 'release'), 'resume');
  const second = await startWorker(t, path, 'approval-after-decision');
  const done = await second.done();
  assert.deepEqual(done.approvals.items, before.approvals.items);
  assert.equal(done.approvals.effects, 1);
  assert.equal(done.submission.id, before.submission.id);
  assertOneInput(done);
  await second.stop();
  const third = await startWorker(t, path, 'approval-after-decision');
  assert.deepEqual((await third.done()).approvals, done.approvals);
});

test('exhausted model retries end visibly and reusing the request ID does not retry', { timeout: 30_000 }, async (t) => {
  const path = await directory(t);
  let originalId;
  for (let attempt = 0; attempt < 3; attempt++) {
    const worker = await startWorker(t, path, 'model-crash');
    await until(() => worker.events.has('model-request'), Boolean);
    const state = await worker.snapshot();
    originalId ??= state.submission.id;
    assert.equal(state.submission.id, originalId);
    await worker.stop();
  }
  const worker = await startWorker(t, path, 'model-crash');
  const failed = await until(worker.snapshot, (state) => state.submission.status === 'unanswered');
  assert.equal(failed.submission.reason, 'interrupted');
  assert.equal(failed.view.docs['pi.live'].runFailure.reason, 'interrupted');
  assert.ok(failed.reports.some((report) => report.kind === 'task_interrupted'));
  assertOneInput(failed);
  await worker.stop();
  await writeFile(join(path, 'release'), 'could complete if a request were sent');
  const again = await startWorker(t, path, 'model-crash');
  await again.request('idle');
  const state = await again.snapshot();
  assert.equal(state.submission.id, originalId);
  assert.equal(state.submission.status, 'unanswered');
  assert.equal((await readFile(join(path, 'model-requests.log'), 'utf8')).trim().split('\n').length, 3);
  assert.equal(again.events.has('model-request'), false);
  assert.equal(state.view.docs['pi.live'].run, undefined);
  assert.doesNotMatch(JSON.stringify(state.view.entries), /Phase 0 complete/);
  assertOneInput(state);
});

test('default restart limit ends an approval wrapper on the fifth crash and refuses a stale decision', { timeout: 30_000 }, async (t) => {
  const path = await directory(t);
  let originalId;
  for (let attempt = 0; attempt < 5; attempt++) {
    const worker = await startWorker(t, path, 'approval');
    // Prove the parent tool resumed, not merely that its old proposal document loaded.
    await until(() => worker.events.has('approval-waiting'), Boolean);
    const state = await worker.snapshot();
    originalId ??= state.submission.id;
    assert.equal(state.submission.id, originalId);
    assert.equal(state.submission.status, 'placed');
    assert.equal(Object.values(state.approvals.items)[0].status, 'pending');
    await worker.stop();
  }
  const worker = await startWorker(t, path, 'approval');
  const state = await worker.done();
  await worker.request('idle');
  assert.equal(state.submission.id, originalId);
  assert.ok(state.reports.some((report) => report.reason === 'restart_limit'));
  assert.ok(results(state).some((entry) => entry.data.diagnostics.some((diagnostic) => diagnostic.code === 'restart_limit')));
  assert.equal(Object.values(state.approvals.items)[0].status, 'pending');
  assert.equal(state.approvals.effects, 0);
  await assert.rejects(worker.request('decide', { decision: 'approved' }), /Approval task is no longer active/);
  assert.equal((await worker.snapshot()).approvals.effects, 0);
  assertOneInput(state);
});

test('beforeTool blocks a forbidden bash command before execution', { timeout: 30_000 }, async (t) => {
  const path = await directory(t);
  const worker = await startWorker(t, path, 'blocked');
  const done = await worker.done();
  const [result] = results(done);
  assert.equal(result.model[0].isError, true);
  assert.ok(result.data.diagnostics.some((diagnostic) => diagnostic.code === 'blocked'));
  await assert.rejects(access(join(path, 'shell-executions.log')), { code: 'ENOENT' });
});
