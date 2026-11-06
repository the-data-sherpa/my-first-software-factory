import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { openFactory, inspectHistory } from '../../src/factory.mjs';
import { createModelExecution, inspectExecution } from '../../src/execution.mjs';
import * as executionApi from '../../src/execution.mjs';
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

test('owner model preflight refuses credential initialization outside the verified resource scope', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-owner-envelope-'));
  let creations = 0;
  const execution = executionApi.createOwnerModelPreflight({ createRuntime: async () => { creations++; return controlledRuntime(); },
    fetch: controlledTransport().fetch });
  const factory = await openFactory({ stateDir: join(directory, 'state'), execution });
  t.after(async () => { await factory.close(); await rm(directory, { recursive: true, force: true }); });
  const admitted = await factory.startRun({ requestId: 'uncontained-owner-smoke', brief });
  const failed = await until(() => factory.inspectRun(admitted.id), (run) => ['failed', 'completed'].includes(run.status));
  assert.equal(failed.outcome.reason, 'CONTAINMENT_REQUIRED');
  assert.equal(creations, 0);
  assert.equal(failed.counters.modelAttempts, 0);
});

async function ownerScenario(t, scenario) {
  const directory = await mkdtemp(join(tmpdir(), 'factory-owner-model-'));
  const unit = `factory-contained-${randomUUID()}.scope`;
  const exec = promisify(execFile);
  t.after(async () => {
    await exec('/usr/bin/systemctl', ['--user', 'stop', unit]).catch(() => {});
    await exec('/usr/bin/systemctl', ['--user', 'reset-failed', unit]).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  });
  const worker = fileURLToPath(new URL('./model-owner-worker.mjs', import.meta.url));
  const { stdout } = await exec('/usr/bin/systemd-run', ['--user', '--scope', '--quiet', '--collect', `--unit=${unit}`,
    '--property=MemoryMax=4294967296', '--property=MemorySwapMax=0', '--property=TasksMax=256', '--property=OOMPolicy=kill',
    '--', process.execPath, worker, directory, scenario], { timeout: 15_000,
    env: { PATH: '/usr/bin:/bin', HOME: directory, XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus` },
  });
  return JSON.parse(stdout);
}

test('owner model startup loads no runtime until an admitted start and never on passive reopening', async (t) => {
  const { run, creations, dispatches } = await ownerScenario(t, 'lazy');
  assert.equal(run.outcome.kind, 'model-preflight-completed');
  assert.equal(creations, 1);
  assert.equal(dispatches, 1);
});

test('stop during owner runtime initialization holds admission until startup drains and dispatches no model request', async (t) => {
  const { run, creations, dispatches } = await ownerScenario(t, 'stop');
  assert.equal(run.status, 'stopped');
  assert.equal(run.counters.modelAttempts, 0);
  assert.equal(creations, 1);
  assert.equal(dispatches, 0);
});

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

test('startup drainage failure fences admission and ownership even without a returned handle or after stop', { timeout: 20_000 }, async (t) => {
  for (const scenario of ['failure', 'stop']) {
    const directory = await mkdtemp(join(tmpdir(), 'factory-model-startup-drain-'));
    const stateDir = join(directory, 'state');
    const worker = fork(new URL('./model-startup-worker.mjs', import.meta.url), [stateDir, scenario], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { HOME: directory, PATH: process.env.PATH },
    });
    const kill = async () => {
      if (worker.exitCode !== null || worker.signalCode !== null) return;
      const exited = once(worker, 'exit'); worker.kill('SIGKILL'); await exited;
    };
    t.after(async () => { await kill(); await rm(directory, { recursive: true, force: true }); });
    let stderr = '';
    worker.stderr.on('data', (chunk) => { stderr += chunk; });
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Startup checkpoint missing: ${stderr}`)), 8000);
      worker.once('message', (message) => { clearTimeout(timer); resolve(message); });
      worker.once('exit', () => { clearTimeout(timer); reject(new Error(`Startup worker exited: ${stderr}`)); });
    });
    assert.equal(result.record.status, 'interrupted');
    assert.equal(result.record.outcome.reason, 'drain_failed');
    assert.equal(result.record.reservations[0].state, 'uncertain');
    assert.equal(result.dispatches, 1);
    assert.equal(result.overlap, 'RUN_ACTIVE');
    assert.equal(result.replacement, 'RUN_ACTIVE');
    assert.equal(result.stop, 'DRAIN_FAILED');
    assert.equal(result.close, 'DRAIN_FAILED');
    assert.equal(result.ownerBefore, 'BACKEND_OWNED');
    assert.equal(result.ownerAfter, 'BACKEND_OWNED');
    await kill();
    const retained = await inspectHistory({ stateDir, runId: result.record.id });
    assert.equal(retained.status, 'interrupted');
    assert.equal(retained.deadlineAt, result.record.deadlineAt);
    assert.deepEqual(retained.reservations, result.record.reservations);
  }
});

test('default explicit preflight is one no-tool request even for transient errors and length stops', async (t) => {
  for (const reply of [() => new Response('{"error":{"message":"rate limit sensitive-provider"}}', { status: 429 }),
    () => eventsResponse({ status: 'incomplete' }), () => eventsResponse()]) {
    const { factory, requests } = await setup(t, reply);
    const run = await factory.startRun({ requestId: 'smoke-only', brief });
    const done = await until(() => factory.inspectRun(run.id), (item) => ['completed', 'failed', 'blocked'].includes(item.status));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].payload.max_tokens, 1024);
    assert.equal(done.counters.modelAttempts, 1);
    assert.equal(done.execution.model, 'anthropic/claude-sonnet-5-5');
    assert.equal(done.outcome.reviewReady, false);
    assert.equal(done.capabilities.productionModel, true);
    assert.equal(done.capabilities.repositoryTools, false);
    assert.equal(done.outcome.kind, done.status === 'completed' ? 'model-preflight-completed' : 'blocked');
    if (done.status === 'completed') assert.equal(done.reservations[0].accounting.preflight, true);
    else assert.match(done.outcome.reason, /^MODEL_/);
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
