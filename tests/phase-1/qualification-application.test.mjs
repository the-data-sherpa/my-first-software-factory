import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFactory, inspectHistory } from '../../src/factory.mjs';
import { fixture } from './workspace-fixture.mjs';
import { runOwnedScope } from '../fixtures/containment-harness.mjs';
import { until } from '../phase-0/helpers.mjs';
import { composed, workspace, brief, dependencyRunId, scope, descriptor, binding, fabricatedQualified, writeState, receiptFor }
  from './qualification-application-fixture.mjs';

const terminal = run => !['admitted', 'running'].includes(run.status);

async function setup(t, execution) {
  const f = await fixture(t);
  const factory = await openFactory({ stateDir: f.stateDir, project: f.project, workspace, execution });
  t.after(() => factory.close().catch(() => {}));
  return { ...f, factory };
}
async function finish(t, run) {
  const execution = composed({ run });
  const f = await setup(t, execution);
  const admitted = await f.factory.startRun({ requestId: 'qualify', brief, dependencyRunId, scope });
  const done = await until(() => f.factory.inspectRun(admitted.id), terminal);
  return { ...f, execution, admitted, done };
}

test('legacy repository executors remain module-only without qualification state or callbacks', async t => {
  let seen;
  const execution = { ...composed({ run: input => receiptFor(input, { status: 'draft-produced', runId: input.runId, reviewReady: false }) }) };
  delete execution.qualifiesDrafts;
  const original = execution.start;
  execution.start = input => { seen = input; return original(input); };
  const f = await setup(t, execution);
  const admitted = await f.factory.startRun({ requestId: 'legacy', brief, dependencyRunId, scope });
  assert.equal(admitted.qualification, undefined);
  const done = await until(() => f.factory.inspectRun(admitted.id), terminal);
  assert.equal(seen.saveQualification, undefined);
  assert.equal(done.status, 'completed');
  assert.deepEqual(done.outcome, { kind: 'draft-produced', reviewReady: false, reason: 'QUALIFICATION_REQUIRED' });
  for (const key of ['qualification', 'qualificationEvidence', 'workItem']) assert.equal(done[key], undefined);
});

test('qualification opt-in requires an explicit boolean on a repository-executor adapter', async t => {
  const f = await fixture(t);
  const base = composed({ run() {} });
  for (const execution of [{ ...base, mode: 'admission-only' }, { ...base, qualifiesDrafts: 'true' }, { ...base, qualifiesDrafts: 1 }]) {
    await assert.rejects(openFactory({ stateDir: f.stateDir, project: f.project, workspace, execution }), { code: 'INVALID_EXECUTION' });
  }
  const reopened = await openFactory({ stateDir: f.stateDir, project: f.project, workspace, execution: { ...base, qualifiesDrafts: false } });
  await reopened.close(); // A refused opt-in kept no backend ownership.
});

test('opted-in runs start with an immutable pending snapshot and validate every detached update', async t => {
  const states = [];
  const { done, admitted, execution } = await finish(t, async input => {
    const id = input.runId;
    assert.equal(typeof input.saveQualification, 'function');
    assert.deepEqual(input.run.qualification, { version: 1, runId: id, kind: 'controlled-fixture', status: 'pending', reviewReady: false });
    const checking = { version: 1, runId: id, kind: 'controlled-fixture', status: 'checking', reviewReady: false, stage: 'intent', checks: [] };
    const refused = [
      { ...checking, version: 2 }, { ...checking, runId: 'run_00000000-0000-0000-0000-000000000099' }, { ...checking, kind: 'owner' },
      { ...checking, reviewReady: true }, { ...checking, status: 'approved' }, { ...checking, status: 'qualified' },
      { ...checking, descriptor: descriptor(id, { scope: { writePaths: ['convex/syncHelpers.ts', 'other.ts'] } }) },
      { ...checking, descriptor: descriptor(id, { admissionBinding: { ...binding(id), forged: true } }) },
      { ...checking, descriptor: descriptor(id, { runId: 'run_00000000-0000-0000-0000-000000000099' }) },
      { ...checking, stage: 'complete', status: 'qualified', verdict: { status: 'blocked', runId: id, kind: 'controlled-fixture', reviewReady: false } },
      [checking], null,
    ];
    for (const state of refused) assert.throws(() => input.saveQualification(state), { code: 'QUALIFICATION_CONFLICT' }, JSON.stringify(state));
    const accepted = { ...checking, descriptor: descriptor(id) };
    assert.equal(input.saveQualification(accepted), undefined, 'The projection callback is synchronous.');
    accepted.status = 'qualified'; // The application keeps a detached copy.
    states.push(accepted);
    assert.throws(() => input.saveQualification({ ...checking, descriptor: descriptor(id, { draft: { sourceDigest: '0'.repeat(64), artifactDirectory: 'executor' } }) }),
      { code: 'QUALIFICATION_CONFLICT' });
    const blocked = { ...checking, descriptor: descriptor(id), stage: 'complete', status: 'blocked', reason: 'REGRESSION_UNVERIFIED',
      verdict: { status: 'blocked', reason: 'REGRESSION_UNVERIFIED', runId: id, kind: 'controlled-fixture', reviewReady: false } };
    input.saveQualification(blocked);
    // A recorded failure cannot be rewritten as a success.
    assert.throws(() => input.saveQualification({ ...blocked, status: 'qualified', verdict: { status: 'qualified', runId: id, kind: 'controlled-fixture', reviewReady: false } }),
      { code: 'QUALIFICATION_CONFLICT' });
    return receiptFor(input, blocked.verdict);
  });
  assert.equal(admitted.qualification.status, 'pending');
  assert.equal(execution.inputs.length, 1);
  assert.equal(done.status, 'blocked');
  assert.deepEqual(done.outcome, { kind: 'blocked', reviewReady: false, reason: 'REGRESSION_UNVERIFIED' });
  assert.equal(done.qualification.status, 'blocked');
  assert.equal(done.workItem, undefined);
  assert.equal(states.length, 1);
});

for (const [name, plan, expected] of [
  ['a nominal qualified receipt without persisted qualification', input =>
    receiptFor(input, { status: 'qualified', runId: input.runId, kind: 'controlled-fixture', reviewReady: false }), ['failed', 'QUALIFICATION_UNVERIFIED']],
  ['an executor draft that skipped qualification', input =>
    receiptFor(input, { status: 'draft-produced', runId: input.runId, reviewReady: false }), ['failed', 'QUALIFICATION_MISSING']],
  ['a receipt that disagrees with the persisted verdict', input => {
    const state = { ...fabricatedQualified(input.runId), status: 'blocked', reason: 'REGRESSION_UNVERIFIED' };
    state.verdict = { status: 'blocked', reason: 'REGRESSION_UNVERIFIED', runId: input.runId, kind: 'controlled-fixture', reviewReady: false };
    input.saveQualification(state);
    return receiptFor(input, { status: 'qualified', runId: input.runId, kind: 'controlled-fixture', reviewReady: false });
  }, ['failed', 'QUALIFICATION_UNVERIFIED']],
  ['a receipt that claims controlled readiness', input => {
    input.saveQualification(fabricatedQualified(input.runId));
    return receiptFor(input, { status: 'qualified', runId: input.runId, kind: 'controlled-fixture', reviewReady: true });
  }, ['failed', 'QUALIFICATION_UNVERIFIED']],
  ['a receipt that overrides the qualification kind', input => {
    input.saveQualification(fabricatedQualified(input.runId));
    return receiptFor(input, { status: 'qualified', runId: input.runId, kind: 'owner', reviewReady: false });
  }, ['failed', 'QUALIFICATION_UNVERIFIED']],
  ['an incomplete qualification without a verdict', input => {
    input.saveQualification({ version: 1, runId: input.runId, kind: 'controlled-fixture', status: 'checking', reviewReady: false, stage: 'capture' });
    return receiptFor(input, { status: 'qualified', runId: input.runId, kind: 'controlled-fixture', reviewReady: false });
  }, ['failed', 'QUALIFICATION_UNVERIFIED']],
  ['a matching fabricated verdict without descriptor or checks, even with a matching private state file', async input => {
    const state = fabricatedQualified(input.runId, { withDescriptor: false });
    await writeState(input.directory, state);
    input.saveQualification(state);
    return receiptFor(input, state.verdict);
  }, ['blocked', 'QUALIFICATION_INVALIDATED']],
  ['a matching fabricated verdict with descriptor and checks but no retained artifacts', async input => {
    const state = fabricatedQualified(input.runId);
    await writeState(input.directory, state);
    input.saveQualification(state);
    return receiptFor(input, state.verdict);
  }, ['blocked', 'QUALIFICATION_INVALIDATED']],
]) {
  test(`the application refuses ${name}`, async t => {
    const { done, factory, stateDir, admitted } = await finish(t, plan);
    assert.equal(done.status, expected[0], JSON.stringify(done.outcome));
    assert.deepEqual(done.outcome, { kind: expected[0], reviewReady: false, reason: expected[1] });
    assert.equal(done.workItem, undefined);
    assert.notEqual(done.qualificationEvidence?.artifactStatus, 'verified');
    assert.ok(!(done.qualification.checks ?? []).some(check => 'output' in check), 'Inspection omits retained check logs.');
    const [listed] = await factory.listRuns();
    assert.deepEqual(listed.qualification, done.qualification);
    assert.equal(listed.qualificationEvidence.status, 'unverified', 'Listing never hashes artifacts or reports current evidence.');
    await factory.close();
    assert.deepEqual(await inspectHistory({ stateDir, runId: admitted.id }), done, 'Offline inspection matches and is passive.');
  });
}

test('a qualifier limit verdict keeps its exact reason and reports a budget-limited outcome', async t => {
  const { done } = await finish(t, input => {
    const verdict = { status: 'blocked', reason: 'TOOL_ROUND_LIMIT', runId: input.runId, kind: 'controlled-fixture', reviewReady: false };
    input.saveQualification({ version: 1, runId: input.runId, kind: 'controlled-fixture', status: 'blocked', reviewReady: false,
      stage: 'complete', checks: [], artifacts: { directory: 'qualification', patch: null, complete: false }, verdict });
    return receiptFor(input, verdict);
  });
  assert.equal(done.status, 'blocked');
  assert.deepEqual(done.outcome, { kind: 'budget-limited', reviewReady: false, reason: 'TOOL_ROUND_LIMIT' });
  assert.equal(done.workItem, undefined);
});

test('an executor outcome without qualification shows qualification as not started', async t => {
  const { done } = await finish(t, input => receiptFor(input, { status: 'no-change', runId: input.runId, reviewReady: false }));
  assert.deepEqual(done.outcome, { kind: 'no-change', reviewReady: false, reason: 'NO_CHANGE' });
  assert.equal(done.qualification.status, 'pending');
  assert.equal(done.qualificationEvidence.status, 'not-started');
  assert.equal(done.qualificationEvidence.artifactStatus, 'missing');
  assert.equal(done.workItem, undefined);
});

test('a claimed qualification directory without recorded state projects as interrupted, not invalid or repaired', async t => {
  const { done } = await finish(t, async input => {
    await mkdir(join(input.directory, 'qualification'), { mode: 0o700 });
    return receiptFor(input, { status: 'interrupted', reason: 'DRAIN_FAILED_REPORTED', runId: input.runId, reviewReady: false });
  });
  assert.equal(done.status, 'interrupted');
  assert.equal(done.qualification.status, 'pending');
  assert.equal(done.qualificationEvidence.status, 'interrupted');
  assert.equal(done.qualificationEvidence.artifactStatus, 'incomplete');
  assert.equal(done.workItem, undefined);
});

test('a stop fence outranks a persisted qualified verdict and creates no Work item', async t => {
  const execution = composed({ async run(input, { stopped }) {
    input.saveQualification(fabricatedQualified(input.runId));
    await stopped;
    return receiptFor(input, fabricatedQualified(input.runId).verdict);
  } });
  const f = await setup(t, execution);
  const admitted = await f.factory.startRun({ requestId: 'stop', brief, dependencyRunId, scope });
  await until(() => f.factory.inspectRun(admitted.id), run => run.qualification.stage === 'complete');
  const stopped = await f.factory.stopRun(admitted.id);
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(stopped.outcome, { kind: 'stopped', reviewReady: false, reason: 'operator_stop' });
  assert.equal((await f.factory.inspectRun(admitted.id)).workItem, undefined);
});

test('a qualification drain failure stays fenced and never finalizes a Work item', async t => {
  const execution = composed({
    run: input => { input.saveQualification(fabricatedQualified(input.runId)); return receiptFor(input, fabricatedQualified(input.runId).verdict); },
    async close() { throw Object.assign(new Error('Controlled drain refusal'), { code: 'DRAIN_FAILED' }); },
  });
  const f = await fixture(t);
  const factory = await openFactory({ stateDir: f.stateDir, project: f.project, workspace, execution });
  const admitted = await factory.startRun({ requestId: 'drain', brief, dependencyRunId, scope });
  const run = await until(() => factory.inspectRun(admitted.id), current => current.status === 'interrupted');
  assert.deepEqual(run.outcome, { kind: 'uncertain', reviewReady: false, reason: 'drain_failed' });
  assert.equal(run.workItem, undefined);
  await assert.rejects(factory.startRun({ requestId: 'overlap', brief, dependencyRunId, scope }), { code: 'RUN_ACTIVE' });
  await assert.rejects(factory.resumeRun(admitted.id, { review: 'Reviewed controlled fixture.' }), { code: 'UNSAFE_RESUME' });
  await assert.rejects(factory.close(), { code: 'DRAIN_FAILED' });
  await assert.rejects(openFactory({ stateDir: f.stateDir, project: f.project }), { code: 'BACKEND_OWNED' });
});

test('process death after a qualified verdict but before finalization stays interrupted on passive reopen', async t => {
  const root = await mkdtemp('/tmp/factory-qualification-application-');
  let drained = false;
  try {
    const result = await runOwnedScope(t, [fileURLToPath(new URL('./qualification-application-worker.mjs', import.meta.url)), root, 'crash']);
    drained = true;
    assert.notEqual(result.code, 0);
    const { stateDir, project, runId } = JSON.parse(await readFile(join(root, 'application-input.json'), 'utf8'));
    const first = await inspectHistory({ stateDir, runId });
    assert.equal(first.status, 'interrupted');
    assert.deepEqual(first.outcome, { kind: 'uncertain', reviewReady: false, reason: 'executor_reconciliation_required' });
    assert.equal(first.qualification.verdict.status, 'qualified', 'The retained verdict remains visible as evidence.');
    assert.equal(first.workItem, undefined);
    assert.notEqual(first.qualificationEvidence.artifactStatus, 'verified');
    assert.deepEqual(await inspectHistory({ stateDir, runId }), first, 'Repeated passive inspection changes nothing.');
    const resumed = composed({ run() { assert.fail('Passive reopen cannot dispatch work.'); } });
    const factory = await openFactory({ stateDir, project, workspace: { admit() { assert.fail('No source admission'); }, prepare() { assert.fail('No preparation'); } }, execution: resumed });
    try {
      const reopened = await factory.inspectRun(runId);
      assert.equal(reopened.status, 'interrupted');
      assert.equal(reopened.workItem, undefined);
      await assert.rejects(factory.resumeRun(runId, { review: 'Reviewed controlled fixture.' }), { code: 'UNSAFE_RESUME' });
      assert.equal(resumed.inputs.length, 0);
    } finally { await factory.close(); }
  } finally { if (drained) await rm(root, { recursive: true, force: true }); }
});
