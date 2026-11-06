import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { openFactory, inspectHistory } from '../../src/factory.mjs';
import { createFixtureExecution } from '../../src/execution.mjs';
import { createPartialEffectFixture } from './recovery-fixtures.mjs';
import { until } from '../phase-0/helpers.mjs';

const brief = 'Goal: Recover safely.\nAcceptance criteria: Retain original limits.\nEvidence: Disposable fixture.';
async function setup(t, execution = createFixtureExecution({ delayMs: 60_000 }), extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'factory-recovery-'));
  const stateDir = join(directory, 'state');
  const factory = await openFactory({ stateDir, execution, ...extra });
  t.after(async () => { await factory.close(); await rm(directory, { recursive: true, force: true }); });
  return { factory, stateDir };
}

async function crashed(t, checkpoint = 'request', admittedAt) {
  const directory = await mkdtemp(join(tmpdir(), 'factory-crash-'));
  const stateDir = join(directory, 'state');
  const worker = fork(new URL('./recovery-worker.mjs', import.meta.url), [stateDir, checkpoint, ...(admittedAt ? [String(admittedAt)] : [])], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { PATH: process.env.PATH, HOME: directory },
  });
  const kill = async () => {
    if (worker.exitCode !== null || worker.signalCode !== null) return;
    const exited = once(worker, 'exit');
    worker.kill('SIGKILL');
    await exited;
  };
  const factories = [];
  t.after(async () => { await kill(); for (const factory of factories.reverse()) await factory.close(); await rm(directory, { recursive: true, force: true }); });
  let admitted;
  let observedCheckpoint;
  let output = '';
  worker.stderr.on('data', (chunk) => { output += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Checkpoint timed out: ${output}`)), 5000);
    worker.on('message', (message) => {
      if (message.event === 'admitted') admitted = message.run;
      if (message.event === 'checkpoint') { observedCheckpoint = message; clearTimeout(timeout); resolve(); }
    });
    worker.on('exit', () => { clearTimeout(timeout); reject(new Error(`Worker exited: ${output}`)); });
  });
  await kill();
  return { stateDir, checkpoint: observedCheckpoint, run: await inspectHistory({ stateDir, runId: admitted.id }), closeLater: (factory) => factories.push(factory) };
}

test('downtime expires the original deadline and only an explicit new linked admission replenishes limits', async (t) => {
  const originalTime = Date.now() - 1_200_001;
  const { stateDir, run, closeLater } = await crashed(t, 'request', originalTime);
  const factory = await openFactory({ stateDir, project: run.project, execution: createFixtureExecution() });
  closeLater(factory);
  assert.equal(run.deadlineAt, originalTime + 1_200_000);
  await assert.rejects(factory.resumeRun(run.id, { review: 'Reviewed after downtime.' }), { code: 'RUN_DEADLINE' });
  await assert.rejects(factory.replaceRun(run.id, { requestId: run.requestId, review: 'New linked attempt.' }), { code: 'REQUEST_CONFLICT' });
  const replacement = await factory.replaceRun(run.id, { requestId: 'explicit-new-admission', review: 'Original deadline exhausted.' });
  assert.notEqual(replacement.id, run.id);
  assert.equal(replacement.replacesRunId, run.id);
  assert.equal(replacement.brief.text, run.brief.text);
  assert.equal(replacement.deadlineAt - replacement.admittedAt, 1_200_000);
  assert.equal((await factory.inspectRun(run.id)).replacedByRunId, replacement.id);
  const duplicate = await factory.replaceRun(run.id, { requestId: 'explicit-new-admission', review: 'Original deadline exhausted.' });
  assert.equal(duplicate.id, replacement.id);
  const old = await factory.inspectRun(run.id);
  assert.deepEqual(old.counters, run.counters);
  assert.equal(old.deadlineAt, run.deadlineAt);
});

test('a linked replacement cannot change the original project identity', async (t) => {
  const { stateDir, run, closeLater } = await crashed(t);
  const factory = await openFactory({ stateDir, project: { id: 'vanguard', repositoryPath: join(stateDir, 'different-project') }, execution: createFixtureExecution() });
  closeLater(factory);
  await assert.rejects(factory.replaceRun(run.id, { requestId: 'wrong-project', review: 'Must retain project ownership.' }), { code: 'PROJECT_MISMATCH' });
  assert.deepEqual((await factory.inspectRun(run.id)).project, run.project);
});

test('a resumed request consumes the last original attempt without new input or allowance', async (t) => {
  const { stateDir, run, closeLater } = await crashed(t, 'budget');
  assert.equal(run.counters.modelAttempts, 39);
  const factory = await openFactory({ stateDir, project: run.project, execution: createFixtureExecution() });
  closeLater(factory);
  await factory.resumeRun(run.id, { review: 'Reviewed the tool-free fixture and its prior reservations.' });
  const done = await until(() => factory.inspectRun(run.id), (item) => item.status === 'completed');
  assert.equal(done.counters.modelAttempts, 40);
  assert.equal(done.counters.reservedOutputTokens, 327680);
  assert.equal(done.deadlineAt, run.deadlineAt);
  assert.equal(done.execution.submissionId, run.execution.submissionId);
  assert.deepEqual(done.reservations.slice(0, 39), run.reservations);
});

test('crash windows before durable admission and after completion reconcile without creating new inputs', async (t) => {
  for (const checkpoint of ['intent', 'completion']) {
    const { stateDir, run, closeLater } = await crashed(t, checkpoint);
    const factory = await openFactory({ stateDir, project: run.project, execution: createFixtureExecution() });
    closeLater(factory);
    if (checkpoint === 'completion') {
      assert.equal(run.status, 'completed');
      assert.equal(run.counters.modelAttempts, 1);
      assert.equal(run.outcome.reviewReady, false);
      assert.deepEqual(await factory.inspectRun(run.id), run);
    } else {
      assert.equal(run.status, 'interrupted');
      assert.equal(run.execution.submissionId, undefined);
      assert.equal(run.counters.modelAttempts, 0);
      await assert.rejects(factory.resumeRun(run.id, { review: 'There was no original SDK admission.' }), { code: 'UNSAFE_RESUME' });
      const replacement = await factory.replaceRun(run.id, { requestId: 'replace-intent', review: 'Explicit replacement of missing submission.' });
      await until(() => factory.inspectRun(replacement.id), (item) => item.status === 'completed');
      assert.equal((await factory.inspectRun(run.id)).execution.submissionId, undefined);
    }
  }
});

test('uncertain partial effects are never replayed, even with an operator containment boolean; replacement requires trusted quiescence', async (t) => {
  const { stateDir, run, closeLater } = await crashed(t, 'uncertain');
  const fixture = createPartialEffectFixture();
  let factory = await openFactory({ stateDir, project: run.project, execution: { ...fixture, async assessRecovery() {
    return { quiescent: false, resumable: false, evidence: 'Controlled surviving-work uncertainty.' };
  } } });
  closeLater(factory);
  await assert.rejects(factory.replaceRun(run.id, { requestId: 'unsafe-overlap', review: 'Uncertain cleanup.' }), { code: 'RECOVERY_REQUIRED' });
  await factory.close();
  factory = await openFactory({ stateDir, project: run.project, execution: fixture });
  closeLater(factory);
  await assert.rejects(factory.resumeRun(run.id, { review: 'Reviewed partial file.', containmentVerified: true }), { code: 'UNSAFE_RESUME' });
  assert.deepEqual((await factory.inspectRun(run.id)).reservations, run.reservations);
  const replacement = await factory.replaceRun(run.id, { requestId: 'replace-uncertain', review: 'Do not replay the partial write. Start linked work.' });
  await until(() => factory.inspectRun(replacement.id), (item) => Boolean(item.execution.submissionId));
  const old = await factory.inspectRun(run.id);
  assert.equal(old.status, 'replaced');
  assert.equal(old.reservations[0].state, 'uncertain');
  assert.deepEqual(old.counters, run.counters);
  assert.equal(old.execution.submissionId, run.execution.submissionId);
  await factory.stopRun(replacement.id);
});

test('a crash after reserving but before submission consumes allowance and cannot silently submit on resume', async (t) => {
  const { stateDir, run, closeLater } = await crashed(t, 'reserved');
  assert.equal(run.counters.modelAttempts, 1);
  assert.equal(run.execution.submissionId, undefined);
  const factory = await openFactory({ stateDir, project: run.project, execution: createFixtureExecution() });
  closeLater(factory);
  await assert.rejects(factory.resumeRun(run.id, { review: 'Reservation persisted, no input committed.' }), { code: 'UNSAFE_RESUME' });
  assert.deepEqual((await factory.inspectRun(run.id)).counters, run.counters);
});

test('unconfirmed drainage retains admission and backend ownership instead of reporting a terminal stop', async (t) => {
  const { checkpoint } = await crashed(t, 'drain-failure');
  assert.deepEqual(checkpoint.codes, ['DRAIN_FAILED', 'BACKEND_OWNED', 'RUN_ACTIVE', 'RUN_NOT_INTERRUPTED']);
});

test('a crash during stop preserves terminal intent and cannot be resumed as pending work', async (t) => {
  const { stateDir, run, closeLater } = await crashed(t, 'stop-intent');
  assert.equal(run.stopRequested, true);
  const factory = await openFactory({ stateDir, project: run.project, execution: createFixtureExecution() });
  closeLater(factory);
  await assert.rejects(factory.resumeRun(run.id, { review: 'Stop intent cannot be revoked.' }), { code: 'RUN_NOT_INTERRUPTED' });
  const stopped = await factory.stopRun(run.id);
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(stopped.counters, run.counters);
});

test('a completed durable answer does not passively release an uncertain tool effect or unverified drainage', async (t) => {
  const { stateDir, run, closeLater } = await crashed(t, 'uncertain-completion');
  assert.equal(run.status, 'interrupted');
  assert.equal(run.outcome.reason, 'effect_reconciliation_required');
  const factory = await openFactory({ stateDir, project: run.project, execution: createPartialEffectFixture() });
  closeLater(factory);
  await assert.rejects(factory.startRun({ requestId: 'must-not-overlap', brief }), { code: 'RUN_ACTIVE' });
  assert.equal((await factory.inspectRun(run.id)).reservations[0].state, 'uncertain');
});

test('a future contained adapter cannot resume on a safety boolean without containment and partial-effect evidence', async (t) => {
  const { stateDir, run, closeLater } = await crashed(t, 'uncertain');
  const factory = await openFactory({ stateDir, project: run.project, execution: { ...createPartialEffectFixture(), async assessRecovery() {
    return { kind: 'contained-execution', quiescent: true, resumable: true };
  } } });
  closeLater(factory);
  await assert.rejects(factory.resumeRun(run.id, { review: 'A boolean is not OS enforcement.' }), { code: 'UNSAFE_RESUME' });
  assert.deepEqual((await factory.inspectRun(run.id)).counters, run.counters);
});

test('an exhausted tool allowance survives a process crash and refuses resume before effects', async (t) => {
  const { stateDir, run, closeLater } = await crashed(t, 'tool-limit');
  const factory = await openFactory({ stateDir, project: run.project, execution: createFixtureExecution() });
  closeLater(factory);
  assert.equal(run.counters.toolRounds, 30);
  await assert.rejects(factory.resumeRun(run.id, { review: 'Original rounds exhausted.' }), { code: 'TOOL_ROUND_LIMIT' });
  assert.deepEqual(await factory.inspectRun(run.id), run);
});

test('the live original deadline cancels and drains the current request and blocks late reservations', async (t) => {
  let now = 1000;
  let deadline;
  const clock = { now: () => now, setTimeout: (callback) => { deadline = callback; }, clearTimeout: () => {} };
  const fixture = createFixtureExecution({ delayMs: 60_000 });
  let budget;
  const { factory } = await setup(t, { ...fixture, start(input) { budget = input.budget; return fixture.start(input); } }, { clock });
  const run = await factory.startRun({ requestId: 'live-deadline', brief });
  await until(() => factory.inspectRun(run.id), (item) => Boolean(item.execution.submissionId));
  assert.equal(run.deadlineAt, 1201000);
  assert.equal(budget.remainingMs, 1_200_000);
  now = 1200000;
  assert.equal(budget.remainingMs, 1000);
  now = 1201000;
  assert.equal(budget.remainingMs, 0);
  assert.throws(() => budget.reserveModelAttempt({ generationId: 'too-late' }), { code: 'RUN_DEADLINE' });
  deadline();
  const failed = await until(() => factory.inspectRun(run.id), (item) => item.status === 'failed');
  assert.equal(failed.outcome.reason, 'RUN_DEADLINE');
  assert.equal(failed.counters.modelAttempts, 1);
  assert.equal(budget.signal.aborted, true);
});

test('durable transient retries reserve another attempt and stop after one retry', async (t) => {
  for (const transientFailures of [1, 2]) {
    const { factory } = await setup(t, createFixtureExecution({ transientFailures }));
    const run = await factory.startRun({ requestId: 'transient-retry', brief });
    const done = await until(() => factory.inspectRun(run.id), (item) => ['completed', 'failed'].includes(item.status));
    assert.equal(done.status, transientFailures === 1 ? 'completed' : 'failed');
    assert.equal(done.counters.modelAttempts, 2);
    assert.equal(done.counters.reservedOutputTokens, 16384);
    assert.equal(done.reservations[1].retry, true);
    assert.equal(done.reservations[1].generationId, done.reservations[0].generationId);
  }
});

test('execution reservations enforce cumulative attempts, tool rounds and retry limits before effects', async (t) => {
  const fixture = createFixtureExecution();
  const checked = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const { factory } = await setup(t, { ...fixture, async start(input) {
    const { budget } = input;
    for (let index = 0; index < 39; index++) budget.reserveModelAttempt({ generationId: `generation-${index}` });
    budget.reserveModelAttempt({ generationId: 'generation-0', retry: true });
    assert.throws(() => budget.reserveModelAttempt({ generationId: 'generation-0', retry: true }), { code: 'RETRY_LIMIT' });
    assert.throws(() => budget.reserveModelAttempt({ generationId: 'over-limit' }), { code: 'MODEL_ATTEMPT_LIMIT' });
    for (let index = 0; index < 30; index++) budget.reserveToolRound({ roundId: `round-${index}` });
    assert.throws(() => budget.reserveToolRound({ roundId: 'over-limit' }), { code: 'TOOL_ROUND_LIMIT' });
    checked.resolve();
    await release.promise;
    throw new Error('Controlled fixture has no remaining requests.');
  } });
  const run = await factory.startRun({ requestId: 'reservations', brief });
  await checked.promise;
  const observed = await factory.inspectRun(run.id);
  assert.equal(observed.counters.modelAttempts, 40);
  assert.equal(observed.counters.toolRounds, 30);
  assert.equal(observed.counters.reservedOutputTokens, 327680);
  assert.equal(observed.reservations.length, 70);
  release.resolve();
});

test('stop aborts a request even while its adapter has not returned the execution handle', async (t) => {
  const fixture = createFixtureExecution({ delayMs: 60_000 });
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const settled = Promise.withResolvers();
  t.after(() => release.resolve());
  const { factory } = await setup(t, { ...fixture, async start(input) {
    const handle = await fixture.start(input);
    handle.finished.then(settled.resolve, settled.reject);
    entered.resolve();
    await release.promise;
    return handle;
  } });
  const run = await factory.startRun({ requestId: 'stop-before-handle', brief });
  await entered.promise;
  const stopping = factory.stopRun(run.id);
  let timer;
  try {
    const receipt = await Promise.race([settled.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The request ignored the run abort signal.')), 1000); })]);
    assert.equal(receipt.status, 'unanswered');
  } finally { clearTimeout(timer); release.resolve(); }
  assert.equal((await stopping).status, 'stopped');
});

test('a per-run stop drains even when cancel throws, and fences admission and ownership until close finishes', { timeout: 5000 }, async (t) => {
  const fixture = createFixtureExecution({ delayMs: 60_000 });
  const drained = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const { factory, stateDir } = await setup(t, { ...fixture, async start(input) {
    const handle = await fixture.start(input);
    return { ...handle, cancel: async () => { throw new Error('Controlled cancel failure'); }, close: async () => {
      await handle.close();
      drained.resolve();
      await release.promise;
    } };
  } });
  const run = await factory.startRun({ requestId: 'cancel-fails', brief });
  await until(() => factory.inspectRun(run.id), (item) => Boolean(item.execution.submissionId));
  const stopping = factory.stopRun(run.id);
  await drained.promise;
  await assert.rejects(factory.startRun({ requestId: 'too-early', brief }), { code: 'RUN_ACTIVE' });
  await assert.rejects(openFactory({ stateDir }), { code: 'BACKEND_OWNED' });
  assert.equal((await factory.inspectRun(run.id)).stopRequested, true);
  release.resolve();
  const stopped = await stopping;
  assert.equal(stopped.status, 'stopped');
  assert.match(stopped.cancellationError, /failed/);
});

test('stop and shutdown cancel owned work even after its answer has entered final drainage', { timeout: 5000 }, async (t) => {
  for (const control of ['stop', 'shutdown']) {
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let signal;
    let cancellations = 0;
    t.after(() => release.resolve());
    const { factory, stateDir } = await setup(t, {
      mode: 'controlled-drain', model: 'controlled/no-network',
      async start(input) {
        signal = input.signal;
        return { finished: Promise.resolve({ status: 'done', answer: 'An answer is not drainage.' }),
          cancel: async () => { cancellations++; }, close: async () => { entered.resolve(); await release.promise; } };
      },
    });
    const run = await factory.startRun({ requestId: `final-drain-${control}`, brief });
    await entered.promise;
    const ending = control === 'stop' ? factory.stopRun(run.id) : factory.close();
    try {
      await Promise.resolve(); await Promise.resolve();
      assert.equal(signal.aborted, true);
      assert.equal(cancellations, 1);
      assert.equal((await factory.inspectRun(run.id)).stopRequested, true);
      await assert.rejects(openFactory({ stateDir }), { code: 'BACKEND_OWNED' });
    } finally { release.resolve(); await ending; }
    await factory.close();
    assert.equal((await inspectHistory({ stateDir, runId: run.id })).status, 'stopped');
  }
});

test('a drained interrupted job uses trusted quiescence assessment for terminal stop without replay', async (t) => {
  let assessments = 0;
  const { factory } = await setup(t, { mode: 'controlled-uncertain', model: 'controlled/no-network',
    async start({ budget }) {
      budget.reserveToolRound({ roundId: 'uncertain-round' });
      return { finished: Promise.resolve({ status: 'done', answer: 'Uncertain effect.' }), cancel: async () => {}, close: async () => {} };
    },
    async assessRecovery() { assessments++; return { quiescent: true, resumable: false, evidence: 'Controlled work has drained; its partial effect remains retained.' }; },
  });
  const run = await factory.startRun({ requestId: 'drained-uncertain', brief });
  await until(() => factory.inspectRun(run.id), (run) => run.status === 'interrupted');
  const stopped = await factory.stopRun(run.id);
  assert.equal(stopped.status, 'stopped');
  assert.equal(assessments, 1);
  assert.equal(stopped.reservations[0].state, 'uncertain');
  assert.equal(stopped.counters.toolRounds, 1);
});

test('stop drains a selected run, retains its admission and permits a new run without resuming the stopped run', async (t) => {
  const { factory, stateDir } = await setup(t);
  const run = await factory.startRun({ requestId: 'stop', brief });
  await until(() => factory.inspectRun(run.id), (item) => Boolean(item.execution.submissionId));
  const stopped = await factory.stopRun(run.id);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.brief.text, brief);
  assert.equal(stopped.deadlineAt, run.deadlineAt);
  assert.equal(stopped.counters.modelAttempts, 1);
  await assert.rejects(factory.resumeRun(run.id, { review: 'Reviewed partial effects.' }), { code: 'RUN_NOT_INTERRUPTED' });
  const next = await factory.startRun({ requestId: 'after-stop', brief });
  assert.notEqual(next.id, run.id);
  await factory.stopRun(next.id);
  await factory.close();
  assert.deepEqual(await inspectHistory({ stateDir, runId: run.id }), stopped);
});
