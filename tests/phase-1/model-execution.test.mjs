import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { openFactory, inspectHistory } from '../../src/factory.mjs';
import { createModelExecution, inspectExecution } from '../../src/execution.mjs';
import { controlledRuntime, controlledTransport, eventsResponse } from './model-fixtures.mjs';
import { until } from '../phase-0/helpers.mjs';

const brief = 'Goal: Controlled bounded model.\nAcceptance criteria: No repository tools or readiness.\nEvidence: Dummy transport.';
async function setup(t, reply, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'factory-model-'));
  const transport = controlledTransport(reply);
  const execution = createModelExecution({ modelRuntime: await controlledRuntime(), fetch: transport.fetch, ...options });
  const stateDir = join(directory, 'state');
  const factory = await openFactory({ stateDir, project: { id: 'vanguard', repositoryPath: join(directory, 'unused') }, execution });
  t.after(async () => { await factory.close(); await rm(directory, { recursive: true, force: true }); });
  return { factory, stateDir, execution, ...transport };
}

test('crashed production-adapter work inspects passively and fails closed on resume without changing submission identity or allowances', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-model-crash-'));
  const stateDir = join(directory, 'state');
  const worker = fork(new URL('./model-worker.mjs', import.meta.url), [stateDir], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { HOME: directory, PATH: process.env.PATH },
  });
  const kill = async () => {
    if (worker.exitCode !== null || worker.signalCode !== null) return;
    const exited = once(worker, 'exit');
    worker.kill('SIGKILL');
    await exited;
  };
  t.after(async () => { await kill(); await rm(directory, { recursive: true, force: true }); });
  let admitted;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Controlled model request checkpoint missing.')), 5000);
    worker.on('message', (message) => {
      if (message.event === 'admitted') admitted = message.run;
      if (message.event === 'request') { clearTimeout(timer); resolve(); }
    });
    worker.on('exit', () => { clearTimeout(timer); reject(new Error('Controlled worker exited before checkpoint.')); });
  });
  await kill();
  const before = await inspectHistory({ stateDir, runId: admitted.id });
  assert.equal(before.status, 'interrupted');
  assert.equal(before.counters.modelAttempts, 1);
  assert.equal(before.reservations[0].state, 'uncertain');
  assert.equal(before.reservations[0].requestedOutputTokens, 1024);
  const transport = controlledTransport();
  const execution = createModelExecution({ modelRuntime: await controlledRuntime(), fetch: transport.fetch });
  const factory = await openFactory({ stateDir, project: before.project, execution });
  try {
    await assert.rejects(factory.resumeRun(before.id, { review: 'Review does not reconcile remote or tool effects.' }), { code: 'UNSAFE_RESUME' });
    await assert.rejects(execution.resume({}), { code: 'UNSAFE_RESUME' });
    await assert.rejects(factory.startRun({ requestId: 'cannot-wake-or-overlap', brief }), { code: 'RUN_ACTIVE' });
    const after = await factory.inspectRun(before.id);
    assert.equal(after.execution.submissionId, before.execution.submissionId);
    assert.equal(after.deadlineAt, before.deadlineAt);
    assert.deepEqual(after.reservations, before.reservations);
    assert.equal(transport.requests.length, 0);
  } finally { await factory.close(); }
});

test('default explicit preflight is one no-tool request even for transient errors and length stops', async (t) => {
  for (const reply of [() => new Response('{"error":{"message":"rate limit sensitive-provider"}}', { status: 429 }),
    () => eventsResponse({ status: 'incomplete' }), () => eventsResponse()]) {
    const { factory, requests } = await setup(t, reply);
    const run = await factory.startRun({ requestId: 'smoke-only', brief });
    const done = await until(() => factory.inspectRun(run.id), (item) => ['completed', 'failed'].includes(item.status));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].payload.max_output_tokens, 1024);
    assert.equal(done.counters.modelAttempts, 1);
    assert.equal(done.outcome.reviewReady, false);
    assert.doesNotMatch(JSON.stringify(done), /sensitive-provider/);
  }
});

test('stop aborts the live model body, drains cancellation, and retains unknown usage without releasing admission early', async (t) => {
  const entered = Promise.withResolvers();
  const cancelling = Promise.withResolvers();
  const drained = Promise.withResolvers();
  t.after(() => drained.resolve());
  const { factory, requests } = await setup(t, () => new Response(new ReadableStream({
    start() { entered.resolve(); }, cancel() { cancelling.resolve(); return drained.promise; },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  const run = await factory.startRun({ requestId: 'stop-model', brief });
  await entered.promise;
  const stopping = factory.stopRun(run.id);
  await cancelling.promise;
  assert.equal(requests[0].signal.aborted, true);
  await assert.rejects(factory.startRun({ requestId: 'cannot-overlap', brief }), { code: 'RUN_ACTIVE' });
  let stopped = false;
  stopping.then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false);
  drained.resolve();
  const result = await stopping;
  assert.equal(result.status, 'stopped');
  assert.equal(result.counters.modelAttempts, 1);
  assert.equal(result.reservations[0].accounting.unmeasuredOutputTokens, 1024);
  assert.equal(result.reservations[0].accounting.cost.status, 'unknown');
  assert.equal(result.outcome.reviewReady, false);
});

test('explicit bounded no-tool execution durably retries once, retains failed usage, and never establishes maintenance readiness', async (t) => {
  for (const failures of [1, 2]) {
    const { factory, stateDir, requests } = await setup(t, (_request, count) => count > 1 && count <= failures + 1
      ? eventsResponse({ status: 'failed', error: { code: 'server_error', message: 'sensitive-provider-diagnostic' } }) : eventsResponse(), { purpose: 'bounded-no-tools' });
    const admitted = await factory.startRun({ requestId: 'bounded-model', brief });
    const done = await until(() => factory.inspectRun(admitted.id), (run) => ['failed', 'completed'].includes(run.status));
    assert.equal(done.status, failures === 1 ? 'completed' : 'failed', JSON.stringify(done));
    assert.equal(requests.length, 3); // smoke, original, one DURABLE retry; no provider retries
    assert.equal(done.counters.modelAttempts, 3);
    assert.equal(done.counters.reservedOutputTokens, 17408);
    assert.equal(done.counters.toolRounds, 0);
    assert.equal(done.reservations[2].retry, true);
    assert.equal(done.reservations[2].generationId, done.reservations[1].generationId);
    assert.equal(done.reservations[1].accounting.usage.output, 10);
    assert.equal(done.outcome.reviewReady, false);
    assert.doesNotMatch(JSON.stringify(done), /sensitive-provider/);
    const receipt = await inspectExecution(join(stateDir, 'runs', done.id));
    assert.equal(receipt.submissionId, done.execution.submissionId);
    assert.equal(receipt.runId, done.id);
    assert.equal(receipt.requestId, done.execution.requestId);
    const before = requests.length;
    await factory.close();
    assert.deepEqual((await inspectHistory({ stateDir, runId: done.id })).reservations, done.reservations);
    assert.equal(requests.length, before);
  }
});
