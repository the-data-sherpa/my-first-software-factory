import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { until } from '../phase-0/helpers.mjs';
import { createModelRequests } from '../../src/execution.mjs';
import { controlledRuntime, retainedBudget, controlledTransport, eventsResponse } from './model-fixtures.mjs';

const messages = [{ role: 'user', content: 'Answer without tools.', timestamp: 1 }];

test('API keys and malformed OAuth block without transport I/O or raw auth errors', async () => {
  for (const [credential, code] of [
    [{ type: 'api_key', key: 'sensitive-access' }, 'MODEL_AUTH_INCOMPATIBLE'],
    [{ type: 'oauth', access: 'sensitive-invalid-token', refresh: 'unused', expires: Date.now() + 3_600_000 }, 'MODEL_AUTH_INCOMPATIBLE'],
  ]) {
    const transport = controlledTransport();
    const retained = retainedBudget();
    const requests = createModelRequests({ modelRuntime: await controlledRuntime(credential), budget: retained.budget, fetch: transport.fetch });
    const result = await requests.preflight();
    assert.equal(result.ok, false);
    assert.equal(result.reason, code);
    assert.equal(transport.requests.length, 0);
    assert.doesNotMatch(JSON.stringify({ result, saved: retained.inspect() }), /sensitive/);
  }
});

test('missing credentials block in an empty private home and scrubbed environment without host discovery', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-model-no-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const worker = fork(new URL('./model-worker.mjs', import.meta.url), ['--missing-auth'], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { HOME: directory, PATH: process.env.PATH },
  });
  t.after(() => { if (worker.exitCode === null) worker.kill('SIGKILL'); });
  const [message] = await once(worker, 'message');
  assert.deepEqual(message, { reason: 'MODEL_AUTH_REQUIRED', requests: 0 });
  const [code] = await once(worker, 'exit');
  assert.equal(code, 0);
});

test('normal requests require the same run’s successful smoke, and another smoke cannot replenish it', async () => {
  const transport = controlledTransport();
  const retained = retainedBudget();
  const modelRuntime = await controlledRuntime();
  const requests = createModelRequests({ modelRuntime, budget: retained.budget, fetch: transport.fetch });
  await assert.rejects(requests.request({ generationId: 'too-early', messages }), { code: 'MODEL_PREFLIGHT_REQUIRED' });
  assert.equal(transport.requests.length, 0);
  await requests.preflight();
  const reopened = createModelRequests({ modelRuntime, budget: retainedBudget({ record: retained.inspect() }).budget, fetch: transport.fetch });
  assert.equal((await reopened.preflight()).ok, true);
  assert.equal(transport.requests.length, 1);
  await reopened.request({ generationId: 'after-preflight', messages });
  assert.equal(transport.requests.length, 2);
});

test('the full-stream deadline aborts a stalled body and waits for its cancellation drainage', async () => {
  let now = 1000;
  const timers = new Set();
  const clock = { now: () => now, setTimeout: (callback, ms) => { const timer = { callback, ms }; timers.add(timer); return timer; },
    clearTimeout: (timer) => timers.delete(timer) };
  const retained = retainedBudget({ now: clock.now });
  const entered = Promise.withResolvers();
  const cancelling = Promise.withResolvers();
  const drained = Promise.withResolvers();
  const transport = controlledTransport((_request, count) => {
    if (count === 1) return eventsResponse();
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('event: response.created\ndata: {"type":"response.created","response":{"id":"r","status":"in_progress"}}\n\n'));
      entered.resolve();
    }, cancel() { cancelling.resolve(); return drained.promise; } }), { headers: { 'content-type': 'text/event-stream' } });
  });
  const requests = createModelRequests({ modelRuntime: await controlledRuntime(), budget: retained.budget, fetch: transport.fetch, clock });
  await requests.preflight();
  const pending = requests.request({ generationId: 'stall', messages });
  await entered.promise;
  assert.equal([...timers][0].ms, 180_000);
  assert.equal(retained.inspect().reservations[1].requestDeadlineAt, 181000);
  now = 181000;
  for (const timer of timers) timer.callback();
  await cancelling.promise;
  let settled = false;
  pending.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(transport.requests[1].signal.aborted, true);
  drained.resolve();
  const result = await pending;
  assert.equal(result.reason, 'MODEL_REQUEST_DEADLINE');
  assert.equal(result.reviewReady, false);
  assert.equal(result.accounting.unmeasuredOutputTokens, 8192);
  assert.equal(result.accounting.usage, undefined);
  assert.equal(result.accounting.cost.status, 'unknown');
  await requests.close();
});

test('missing terminal usage remains a full reservation, while failed and length attempts retain measured inclusive output', async () => {
  for (const [reply, reason, expectedOutput] of [
    [() => eventsResponse({ usage: null }), undefined, undefined],
    [() => eventsResponse({ status: 'failed', error: { code: 'server_error', message: 'sensitive-provider-error' }, text: 'sensitive-partial' }), 'MODEL_TRANSIENT', 10],
    [() => eventsResponse({ status: 'incomplete' }), 'MODEL_OUTPUT_LIMIT', 10],
    [() => new Response(JSON.stringify({ error: { message: 'sensitive max_tokens is unsupported', type: 'invalid_request_error' } }), { status: 400 }), 'MODEL_CAP_REJECTED', undefined],
  ]) {
    const retained = retainedBudget();
    const transport = controlledTransport(reply);
    const requests = createModelRequests({ modelRuntime: await controlledRuntime(), budget: retained.budget, fetch: transport.fetch });
    const result = await requests.preflight();
    assert.equal(result.reason, reason);
    assert.equal(retained.inspect().reservations[0].accounting.reason, reason);
    assert.equal(result.reviewReady, false);
    assert.equal(result.accounting.usage?.output, expectedOutput);
    assert.equal(result.accounting.unmeasuredOutputTokens, expectedOutput === undefined ? 1024 : 0);
    assert.equal(result.accounting.cost.status, expectedOutput === undefined ? 'unknown' : 'estimated');
    if (reason) {
      assert.equal(result.ok, false);
      await assert.rejects(requests.preflight());
      await assert.rejects(requests.request({ generationId: 'blocked', messages }), { code: 'MODEL_PREFLIGHT_REQUIRED' });
    }
    assert.equal(transport.requests.length, 1);
    assert.doesNotMatch(JSON.stringify({ result, saved: retained.inspect() }), /sensitive/);
    await requests.close();
  }
});

test('smoke header waits use at most 60 seconds and never extend the original run deadline', async () => {
  for (const remaining of [1_200_000, 25]) {
    let now = 1000;
    let timer;
    const clock = { now: () => now, setTimeout: (callback, ms) => { timer = { callback, ms }; return timer; }, clearTimeout() {} };
    const record = retainedBudget({ now: clock.now }).inspect();
    record.deadlineAt = now + remaining;
    const retained = retainedBudget({ now: clock.now, record });
    const entered = Promise.withResolvers();
    const transport = controlledTransport(({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('sensitive transport cancellation')), { once: true });
      entered.resolve();
    }));
    const requests = createModelRequests({ modelRuntime: await controlledRuntime(), budget: retained.budget, fetch: transport.fetch, clock });
    const pending = requests.preflight();
    await entered.promise;
    assert.equal(timer.ms, remaining === 25 ? 25 : 60_000);
    now += timer.ms;
    timer.callback();
    const result = await pending;
    assert.equal(result.reason, 'MODEL_REQUEST_DEADLINE');
    assert.equal(retained.inspect().deadlineAt, record.deadlineAt);
    assert.equal(retained.inspect().reservations[0].accounting.unmeasuredOutputTokens, 1024);
    assert.equal(transport.requests.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /sensitive/);
    await requests.close();
  }
});

test('unconfirmed body drainage rejects closure and keeps the reservation uncertain', async () => {
  const entered = Promise.withResolvers();
  const retained = retainedBudget();
  const transport = controlledTransport(() => new Response(new ReadableStream({ start() { entered.resolve(); },
    cancel() { throw new Error('sensitive cleanup failure'); } }), { headers: { 'content-type': 'text/event-stream' } }));
  const requests = createModelRequests({ modelRuntime: await controlledRuntime(), budget: retained.budget, fetch: transport.fetch });
  const pending = requests.preflight();
  const failed = assert.rejects(pending, { code: 'MODEL_DRAIN_FAILED' });
  await entered.promise;
  await assert.rejects(requests.cancel(), { code: 'MODEL_DRAIN_FAILED' });
  await failed;
  await assert.rejects(requests.close(), { code: 'MODEL_DRAIN_FAILED' });
  assert.equal(retained.inspect().reservations[0].state, 'uncertain');
});

test('terminal usage persists before drainage, including a failed cancellation that leaves the attempt uncertain', async (t) => {
  const retained = retainedBudget();
  const wire = await eventsResponse().text();
  const transport = controlledTransport(() => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(wire));
  }, cancel() { throw new Error('sensitive drain failure after terminal usage'); } }), { headers: { 'content-type': 'text/event-stream' } }));
  const requests = createModelRequests({ modelRuntime: await controlledRuntime(), budget: retained.budget, fetch: transport.fetch });
  const pending = requests.preflight();
  pending.catch(() => {});
  t.after(() => requests.close().catch(() => {}));
  const observed = await until(() => retained.inspect(), (run) => Boolean(run.reservations[0]?.accounting?.usage), 500);
  assert.equal(observed.reservations[0].state, 'uncertain');
  assert.equal(observed.reservations[0].accounting.usage.output, 10);
  assert.equal(observed.reservations[0].accounting.preflight, false);
  await assert.rejects(requests.cancel(), { code: 'MODEL_DRAIN_FAILED' });
  await assert.rejects(pending, { code: 'MODEL_DRAIN_FAILED' });
  assert.deepEqual(retained.inspect().reservations[0].accounting.usage, observed.reservations[0].accounting.usage);
  assert.equal(retained.inspect().reservations[0].state, 'uncertain');
});

test('cancellation during final response drainage cannot pass preflight after the answer has arrived', async () => {
  const retained = retainedBudget();
  const draining = Promise.withResolvers();
  const release = Promise.withResolvers();
  const wire = `${await eventsResponse().text()}data: [DONE]\n\n`;
  const transport = controlledTransport(() => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(wire));
  }, cancel() { draining.resolve(); return release.promise; } }), { headers: { 'content-type': 'text/event-stream' } }));
  const requests = createModelRequests({ modelRuntime: await controlledRuntime(), budget: retained.budget, fetch: transport.fetch });
  const pending = requests.preflight();
  await until(() => retained.inspect(), run => Boolean(run.reservations[0]?.accounting?.usage), 500);
  const closing = requests.cancel();
  await draining.promise;
  release.resolve();
  const result = await pending;
  await closing;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'MODEL_CANCELLED');
  assert.equal(result.accounting.preflight, false);
  assert.equal(result.accounting.usage.output, 10);
});

test('a provider-reported cap violation blocks preflight while retaining its measured usage', async () => {
  const retained = retainedBudget();
  const transport = controlledTransport(() => eventsResponse({ usage: { input_tokens: 20, output_tokens: 1025,
    output_tokens_details: { reasoning_tokens: 1000 }, total_tokens: 1045 } }));
  const requests = createModelRequests({ modelRuntime: await controlledRuntime(), budget: retained.budget, fetch: transport.fetch });
  const result = await requests.preflight();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'MODEL_OUTPUT_CAP_VIOLATION');
  assert.equal(result.accounting.usage.output, 1025);
  assert.equal(result.accounting.usage.totalTokens, 1045);
  await assert.rejects(requests.request({ generationId: 'no-agent-work', messages }), { code: 'MODEL_PREFLIGHT_REQUIRED' });
  await requests.close();
});

test('configuration cannot remove caps, elevate reasoning, enable background work or substitute a route', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-model-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const modelsPath = join(directory, 'models.json');
  for (const [provider, reason] of [
    [{ compat: { forceAdaptiveThinking: false } }, 'MODEL_AUTH_INCOMPATIBLE'],
    [{ modelOverrides: { 'claude-sonnet-5-5': { samplingParams: { max_tokens: 32768 } } } }, 'MODEL_AUTH_INCOMPATIBLE'],
    [{ modelOverrides: { 'claude-sonnet-5-5': { samplingParams: { output_config: { effort: 'high' } } } } }, 'MODEL_PAYLOAD_REJECTED'],
    [{ modelOverrides: { 'claude-sonnet-5-5': { samplingParams: { background: true } } } }, 'MODEL_PAYLOAD_REJECTED'],
    [{ modelOverrides: { 'claude-sonnet-5-5': { samplingParams: { model: 'a-fallback' } } } }, 'MODEL_PAYLOAD_REJECTED'],
    [{ baseUrl: 'https://not-the-selected-route.invalid/v1' }, 'MODEL_UNAVAILABLE'],
  ]) {
    await writeFile(modelsPath, JSON.stringify({ providers: { anthropic: provider } }), { mode: 0o600 });
    const retained = retainedBudget();
    const transport = controlledTransport();
    const requests = createModelRequests({ modelRuntime: await controlledRuntime(undefined, { modelsPath }), budget: retained.budget, fetch: transport.fetch });
    const result = await requests.preflight();
    if (result.ok) {
      // Unsupported sampling overrides may be ignored by this provider; the actual
      // consumed packet must still preserve the fixed route, effort and cap.
      assert.equal(transport.requests.length, 1);
      const { payload } = transport.requests[0];
      assert.equal(payload.model, 'claude-sonnet-5-5');
      assert.equal(payload.max_tokens, 1024);
      assert.equal(payload.output_config.effort, 'low');
      assert.equal(payload.background, undefined);
    } else {
      assert.ok(['MODEL_AUTH_INCOMPATIBLE', 'MODEL_PAYLOAD_REJECTED', 'MODEL_UNAVAILABLE'].includes(result.reason));
      assert.equal(transport.requests.length, 0);
    }
    if (provider.baseUrl) assert.equal(result.reason, reason);
    await requests.close();
  }
});

test('reconstructed request budgets charge resumed requests before I/O without replacing original limits', async () => {
  const retained = retainedBudget();
  const transport = controlledTransport();
  const runtime = await controlledRuntime();
  const requests = createModelRequests({ modelRuntime: runtime, budget: retained.budget, fetch: transport.fetch });
  await requests.preflight();
  for (let index = 0; index < 37; index++) retained.budget.reserveModelAttempt({ generationId: `older-${index}` });
  retained.budget.reserveModelAttempt({ generationId: 'interrupted-generation' });
  const old = retained.inspect();
  const reopened = retainedBudget({ record: old });
  const resumedTransport = controlledTransport(() => {
    assert.equal(reopened.inspect().counters.modelAttempts, 40);
    return eventsResponse();
  });
  const resumed = createModelRequests({ modelRuntime: runtime, budget: reopened.budget, fetch: resumedTransport.fetch });
  assert.equal((await resumed.request({ generationId: 'interrupted-generation', retry: true, messages })).ok, true);
  await assert.rejects(resumed.request({ generationId: 'interrupted-generation', retry: true, messages }), { code: 'RETRY_LIMIT' });
  await assert.rejects(resumed.request({ generationId: 'fresh-input', messages }), { code: 'MODEL_ATTEMPT_LIMIT' });
  const saved = reopened.inspect();
  assert.equal(saved.deadlineAt, old.deadlineAt);
  assert.deepEqual(saved.reservations.slice(0, 39), old.reservations);
  assert.equal(resumedTransport.requests.length, 1);
  await resumed.close();
  await requests.close();
});

test('closing request ownership and retrying the smoke identity cannot admit more I/O', async () => {
  const retained = retainedBudget();
  const transport = controlledTransport();
  const requests = createModelRequests({ modelRuntime: await controlledRuntime(), budget: retained.budget, fetch: transport.fetch });
  await requests.preflight();
  await assert.rejects(requests.request({ generationId: 'model-preflight', retry: true, messages }), { code: 'SMOKE_LIMIT' });
  await requests.close();
  await assert.rejects(requests.request({ generationId: 'late-input', messages }), { code: 'MODEL_CLOSED' });
  assert.equal(transport.requests.length, 1);
  assert.equal(retained.inspect().counters.modelAttempts, 1);
});

test('selected OAuth smoke and normal requests emit capped low-adaptive payloads and reserve before I/O', async () => {
  const retained = retainedBudget();
  const transport = controlledTransport((_request, count) => {
    assert.equal(retained.inspect().counters.modelAttempts, count);
    return eventsResponse();
  });
  const requests = createModelRequests({ modelRuntime: await controlledRuntime(), budget: retained.budget, fetch: transport.fetch });
  assert.equal((await requests.preflight()).ok, true);
  const normal = await requests.request({ generationId: 'first', messages });
  assert.equal(normal.ok, true);
  assert.equal(normal.message.usage.cost.output.toFixed(6), '0.000100');
  assert.equal(transport.requests.length, 2);
  for (const [index, request] of transport.requests.entries()) {
    assert.equal(request.url, 'https://api.anthropic.com/v1/messages?beta=true');
    assert.equal(request.headers.get('authorization'), 'Bearer sk-ant-oat-controlled-not-a-secret');
    assert.equal(request.payload.model, 'claude-sonnet-5-5');
    assert.equal(request.payload.max_tokens, index === 0 ? 1024 : 8192);
    assert.equal(request.payload.output_config.effort, 'low');
    assert.equal(request.payload.thinking.type, 'adaptive');
    assert.equal(request.payload.stream, true);
    assert.equal(request.payload.store, undefined);
    assert.equal(request.payload.background, undefined);
    assert.equal(request.payload.tools, undefined);
  }
  const saved = retained.inspect();
  assert.equal(saved.counters.modelAttempts, 2);
  assert.equal(saved.counters.reservedOutputTokens, 9216);
  assert.equal(saved.reservations[1].accounting.usage.output, 10);
  assert.equal(saved.reservations[1].accounting.usage.reasoning, 4);
  assert.equal(saved.reservations[1].accounting.usage.totalTokens, 30);
  assert.equal(saved.reservations[1].accounting.cost.status, 'estimated');
  // Pinned catalog: 20 input at $2/M + 10 output at $10/M, including thinking.
  // This is an estimate, not OAuth billing or a monetary ceiling.
  assert.equal(saved.reservations[1].accounting.cost.usd.toFixed(6), '0.000140');
  assert.equal(saved.reservations[1].accounting.unmeasuredOutputTokens, 0);
});

test('OAuth accounting keeps cache input separate and includes thinking once in output', async () => {
  const retained = retainedBudget();
  const transport = controlledTransport(() => eventsResponse({ usage: { input_tokens: 20, output_tokens: 10,
    cache_read_input_tokens: 40, cache_creation_input_tokens: 7, output_tokens_details: { reasoning_tokens: 4 } } }));
  const requests = createModelRequests({ modelRuntime: await controlledRuntime(), budget: retained.budget, fetch: transport.fetch });
  const result = await requests.preflight();
  assert.equal(result.ok, true);
  assert.deepEqual(result.accounting.usage, { input: 20, output: 10, cacheRead: 40, cacheWrite: 7, reasoning: 4, totalTokens: 77 });
  assert.equal(result.accounting.cost.status, 'estimated');
  assert.equal(result.accounting.cost.usd.toFixed(7), '0.0001615');
  await requests.close();
});

test('actual OAuth payload mutations are refused before transport', async () => {
  for (const [patch, reason] of [
    [{ max_tokens: 0 }, 'MODEL_AUTH_INCOMPATIBLE'], [{ max_tokens: 1025 }, 'MODEL_AUTH_INCOMPATIBLE'],
    [{ output_config: { effort: 'high' } }, 'MODEL_PAYLOAD_REJECTED'],
    [{ thinking: { type: 'disabled' } }, 'MODEL_PAYLOAD_REJECTED'],
    [{ model: 'claude-opus-5-5' }, 'MODEL_PAYLOAD_REJECTED'],
    [{ background: true }, 'MODEL_PAYLOAD_REJECTED'],
    [{ fallbacks: [{ model: 'claude-opus-5-5' }] }, 'MODEL_PAYLOAD_REJECTED'],
    [{ tools: [{ name: 'shell' }] }, 'MODEL_PAYLOAD_REJECTED'],
  ]) {
    const runtime = await controlledRuntime();
    const complete = runtime.completeSimple.bind(runtime);
    runtime.completeSimple = (model, context, options) => complete(model, context, { ...options,
      onPayload(payload) { Object.assign(payload, patch); return options.onPayload(payload); } });
    const retained = retainedBudget(); const transport = controlledTransport();
    const requests = createModelRequests({ modelRuntime: runtime, budget: retained.budget, fetch: transport.fetch });
    assert.equal((await requests.preflight()).reason, reason);
    assert.equal(transport.requests.length, 0);
    assert.equal(retained.inspect().counters.modelAttempts, 1);
    await requests.close();
  }
});
