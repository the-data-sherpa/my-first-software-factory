// Controlled-fixture adapter bridges parent-owned application wiring only. It
// calls the real executor with the original application budget/signal and saves
// its projections; it never simulates executor tools or model formatting.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { openFactory } from '../../src/factory.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { dependencyFixture } from '../../src/dependencies-diagnostics.mjs';
import { createRepositoryExecution, verifyExecutorHandoff, inspectExecutor, validateExecutorScope, inspectExecution } from '../../src/execution.mjs';
import { controlledRuntime, controlledTransport, eventsResponse } from './model-fixtures.mjs';
import { executorToolResponse as toolResponse } from '../fixtures/executor-model.mjs';
import { until } from '../phase-0/helpers.mjs';

const [root, scenario = 'draft'] = process.argv.slice(2);
const nowState = { value: Date.now() };
const clock = scenario.startsWith('deadline-') ? { now: () => nowState.value, setTimeout, clearTimeout } : undefined;
let drainEntered = false;
const drainage = Promise.withResolvers();
let toolWait = false;
globalThis.fetch = async () => { throw new Error('Uncontrolled network forbidden'); };
const fixture = await dependencyFixture(root, { copyToolchain: true, checkSuffix: `
if (process.argv.includes('run')) {
  try { await readFile('/work/helper.test.mjs'); await import('/work/helper.test.mjs');
    if (${JSON.stringify(scenario === 'check-output-limit')}) await new Promise(resolve => process.stdout.write('x'.repeat(1048577), resolve));
    if (${JSON.stringify(scenario === 'check-assertion-feedback')}) (await import('node:assert/strict')).default.equal(1, 2);
    if (${JSON.stringify(scenario === 'check-encoded-feedback')}) await new Promise(resolve => process.stdout.write(String.fromCharCode(0).repeat(8192), resolve));
    if (${JSON.stringify(['stop-tool', 'deadline-tool'].includes(scenario))}) await new Promise(r => setTimeout(r, 1500));
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
` });
await writeFile(join(fixture.repositoryPath, 'helper.mjs'), 'export const normalize = text => text;\n');
await writeFile(join(fixture.repositoryPath, 'evidence.md'), 'Normalize trailing spaces while preserving unit numbers.\n');
fixture.git('add', '.'); fixture.git('commit', '-m', 'executor-only controlled source');
const project = { id: 'vanguard', repositoryPath: fixture.repositoryPath };
const stateDir = fixture.workspaceIntent.stateDir;
const workspace = { admit: admitWorkspace, prepare: prepareWorkspace };
const brief = 'Goal: Normalize whitespace in the fixture helper.\nAcceptance criteria: Preserve unit numbers and add an offline test.\nEvidence: evidence.md and helper.mjs.';
let factory = await openFactory({ stateDir, project, workspace });
let handle; let result; let projection; let originalInput; let bridgeError;
let initializations = 0; let reportingFailed = false; let handoffToken;
let sourceRun;
async function handleReady() { await until(async () => handle, Boolean); }
const scope = validateExecutorScope({ writePaths: ['helper.mjs', 'helper.test.mjs'] });
const transport = controlledTransport(async ({ payload }, index) => {
  if (index === 1) { assert.equal(payload.tools?.length ?? 0, 0); return scenario === 'preflight-failed' ? new Response('refused', { status: 401 }) : eventsResponse(); }
  assert.equal(payload.max_tokens, 8192); assert.equal(payload.output_config.effort, 'low');
  assert.equal(payload.background, undefined); assert.equal(payload.store, undefined);
  assert.deepEqual(payload.tools.map(t => t.name), ['read_file', 'write_file', 'run_check']);
  assert.ok(payload.system.some(i => i.text.includes('Immutable task context:') && i.text.includes('evidence.md')));
  if (index > (scenario === 'transient-retry' ? 3 : 2)) assert.ok(payload.messages.some(i => Array.isArray(i.content) && i.content.some(block => block.type === 'tool_result')));
  if (index === 2 && ['model-drain', 'model-drain-report', 'stop-model', 'shutdown-model', 'deadline-model'].includes(scenario)) {
    return new Response(new ReadableStream({ cancel() {
      if (scenario.startsWith('model-drain')) throw new Error('Controlled model drain refusal');
    } }), { headers: { 'content-type': 'text/event-stream' } });
  }
  if (index === 2 && scenario === 'stop-draining-tooluse') {
    const bytes = new TextEncoder().encode(await toolResponse('write_file', { path: 'helper.mjs', text: 'must not execute' }, 'cancel', 'Plan: make a change.').text());
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); }, cancel() { drainEntered = true; return drainage.promise; } }), { headers: { 'content-type': 'text/event-stream' } });
  }
  if (index === 2 && scenario === 'transient-retry') return new Response('controlled unavailable', { status: 503 });
  if (scenario === 'transient-retry') index--;
  if (index === 2 && ['no-change', 'fabricated'].includes(scenario)) return eventsResponse({ text: scenario === 'fabricated' ? 'I fixed everything and all checks passed. This is review ready!' : 'No change needed.' });
  if (index === 2 && scenario === 'schema-denied') return toolResponse('read_file', { path: 'evidence.md', offset: 0, root: '/tmp', env: {} }, 'invalid');
  if (index === 2 && scenario === 'tool-denied') return toolResponse('shell', { command: 'touch forbidden' }, 'invalid');
  if (index === 2 && scenario === 'overflow-tool') return toolResponse('write_file', { path: 'helper.mjs', text: 'must not write' }, 'overflow', 'My plan is to write.', 8193);
  if (index === 3 && scenario === 'scope-expansion') return toolResponse('write_file', { path: 'evidence.md', text: 'expanded' }, 'denied');
  if (index === 3 && scenario === 'write-denied') return toolResponse('write_file', { path: 'evidence.md', text: 'not permitted' }, 'denied');
  if (index === 3 && scenario === 'duplicate-call') return toolResponse('write_file', { path: 'helper.mjs', text: 'duplicate must not write' }, 'read');
  if (index === 4 && scenario === 'output-limit') return eventsResponse({ status: 'incomplete', text: 'I declare success despite truncation.' });
  if (index === 4 && scenario === 'dependency-change') await writeFile(join(originalInput.run.workspace.intent.worktree, 'package.json'), '{}');
  if (index === 4 && scenario === 'source-change') await writeFile(join(originalInput.run.workspace.intent.worktree, 'unrelated.mjs'), 'unrelated');
  if (index === 4 && scenario === 'profile-change') await chmod(`${root}/bun`, 0o700);
  if (index === 2) return toolResponse('read_file', { path: 'evidence.md', offset: 0 }, 'read', 'My plan: read the evidence, trim whitespace without changing units, add a regression test, then run both fixed checks.');
  if (index === 3) return toolResponse('write_file', { path: 'helper.mjs', text: 'export const normalize = text => text.trim();\n' }, 'write');
  if (index === 4) return toolResponse('write_file', { path: 'helper.test.mjs', text: 'import assert from "node:assert/strict";\nimport { normalize } from "./helper.mjs";\nassert.equal(normalize("100 Main # 2  "), "100 Main # 2");\n' }, 'test');
  if (index === 5) return toolResponse('run_check', { name: 'vitest' }, 'vitest');
  if (index === 6 && ['check-assertion-feedback', 'check-encoded-feedback'].includes(scenario)) {
    const outputs = payload.messages.flatMap(item => Array.isArray(item.content) ? item.content : []).filter(item => item.type === 'tool_result').map(item => item.content);
    assert.ok(outputs.every(output => Buffer.byteLength(output) <= 16384));
    const feedback = outputs.map(output => JSON.parse(output));
    if (scenario === 'check-assertion-feedback') assert.ok(feedback.some(item => item.passed === false && item.reason === 'exit'));
    else assert.ok(feedback.some(item => item.passed === true && item.reason === 'passed' && item.outputTruncated === true && item.artifact));
  }
  if (index === 6) return toolResponse('run_check', { name: 'lint' }, 'lint');
  return eventsResponse({ text: 'The local draft and checks are retained. Independent qualification is still required.' });
});
try {
  const prep = await factory.startRun({ requestId: 'prep', brief }); sourceRun = prep;
  await until(() => factory.inspectRun(prep.id), r => r.status === 'blocked');
  await factory.prepareDependencies(prep.id, { bunPath: `${root}/bun` });
  await until(() => factory.inspectRun(prep.id), r => r.dependencies?.status === 'prepared' && r.status === 'blocked');
  await factory.close();
  const executor = createRepositoryExecution({ fixture: true, clock, createRuntime: async () => { initializations++; return controlledRuntime(); }, fetch: transport.fetch });
  const adapter = { ...executor, mode: 'admission-only', async start(input) {
    originalInput = input;
    const run = { ...structuredClone(input.run), executor: { version: 1, kind: 'controlled-fixture', status: 'pending', scope } };
    const saveExecutor = state => {
      if (['model-drain-report', 'tool-drain-report'].includes(scenario) && ['MODEL_DRAIN_FAILED', 'DRAIN_FAILED'].includes(state.failure?.code)) throw new Error('Controlled drain reporting failure');
      if (scenario === 'stop-finalization' && state.status === 'draft-produced') void handle.cancel();
      if (scenario === 'scope-expansion' && state.plan) run.executor.scope.writePaths.push('evidence.md');
      if (state.operations?.at(-1)?.type === 'tool-intent' && state.operations.at(-1).tool === 'run_check') toolWait = true;
      if ((scenario === 'persistence-report' && reportingFailed) || (scenario.startsWith('persistence-')
        && state.operations?.at(-1)?.type === 'tool-result' && state.operations.at(-1).tool === 'write_file')) {
        reportingFailed = true; throw new Error('Controlled projection persistence failure after a real effect.');
      }
      projection = { directory: input.directory, run: { ...run, executor: state } };
      writeFileSync(join(root, 'executor-projection.json'), JSON.stringify(projection), { mode: 0o600 });
    };
    saveExecutor(run.executor);
    if (scenario === 'model-budget') for (let i = 0; i < 39; i++) input.budget.settle(input.budget.reserveModelAttempt({ generationId: `prior:${i}` }).id, 'Controlled prior same-run attempt');
    if (scenario === 'tool-budget') for (let i = 0; i < 26; i++) input.budget.settle(input.budget.reserveToolRound({ roundId: `prior:${i}` }).id, 'Controlled prior same-run round');
    const budget = scenario === 'crash' ? { ...input.budget, settle(id, evidence, accounting) {
      if (evidence.startsWith('{') && JSON.parse(evidence).kind === 'write') {
        // A real synced mutation has returned, but its factory reservation and
        // executor result have not been acknowledged. Kill this exact worker.
        process.kill(process.pid, 'SIGKILL');
      }
      return input.budget.settle(id, evidence, accounting);
    } } : input.budget;
    const startInput = { ...input, run, budget, saveExecutor, saveAdmission: state => {
      input.saveAdmission(state);
      if (scenario === 'pristine-transition' && state.status === 'verified') writeFileSync(join(run.workspace.intent.worktree, 'helper.mjs'), 'changed before activation');
    } };
    handle = await executor.start(startInput);
    if (scenario === 'tool-startup-drain') {
      await globalThis.executorDrainFixture.ready;
      // Reject startup before transferring the real executor handle to the app.
      // Its mandatory close must preserve the actual namespace-drain failure.
      await handle.close();
      assert.fail('Unconfirmed startup drainage must reject.');
    }
    return { ...handle, finished: handle.finished.then(async value => {
      result = value;
      if (scenario === 'check-output-limit') {
        assert.equal(value.status, 'budget-limited', 'A check output-limit stop cannot produce a successful draft handoff.');
        assert.equal(value.reason, 'CHECK_OUTPUT_LIMIT');
        await assert.rejects(handle.handoff(), { code: 'EXECUTOR_AUTHORITY_REQUIRED' });
      }
      if (value.status === 'draft-produced') {
        await assert.rejects(executor.start(startInput), { code: 'DESTINATION_EXISTS' });
        const identity = { runId: input.runId, kind: 'controlled-fixture' };
        const token = await handle.handoff(); handoffToken = token;
        const evidence = await verifyExecutorHandoff(token, identity);
        assert.deepEqual(evidence.scope, scope);
        assert.equal(evidence.admissionBinding.sourceDigest === evidence.draft.sourceDigest, false);
        await assert.rejects(verifyExecutorHandoff(JSON.parse(JSON.stringify(token)), identity), { code: 'EXECUTOR_AUTHORITY_REQUIRED' });
        await assert.rejects(verifyExecutorHandoff(token, { ...identity, runId: prep.id }), { code: 'EXECUTOR_AUTHORITY_REQUIRED' });
        await assert.rejects(verifyExecutorHandoff(token, { runId: input.runId }), { code: 'EXECUTOR_AUTHORITY_REQUIRED' });
        if (scenario === 'stale-handoff') {
          const path = join(input.run.workspace.intent.worktree, 'helper.test.mjs');
          const original = await readFile(path);
          await writeFile(path, 'changed after issue');
          await assert.rejects(verifyExecutorHandoff(token, identity), { code: 'EXECUTOR_DRAFT_CHANGED' });
          await writeFile(path, original);
          await assert.rejects(verifyExecutorHandoff(token, identity), { code: 'EXECUTOR_AUTHORITY_REQUIRED' });
          // Keep the stale bytes visible to passive inspection as well.
          await writeFile(path, 'changed after issue');
        }
      }
      return { status: 'admission-blocked', reason: 'CONTROLLED_EXECUTOR_BRIDGE', runId: input.runId, requestId: input.requestId };
    }).catch(error => { bridgeError = error; throw error; }) };
  } };
  factory = await openFactory({ stateDir, project, workspace, execution: adapter, ...(clock ? { clock } : {}) });
  const admitted = await factory.startRun({ requestId: 'executor', brief, dependencyRunId: prep.id });
  // Do not repeatedly hash the entire bundle via application inspection while
  // the executor is independently revalidating it before each operation.
  await handleReady();
  if (['tool-startup-drain', 'tool-drain-report'].includes(scenario)) {
    await globalThis.executorDrainFixture.ready;
    await assert.rejects(factory.stopRun(admitted.id), { code: 'DRAIN_FAILED' });
    const fenced = await factory.inspectRun(admitted.id);
    assert.equal(fenced.status, 'interrupted');
    await assert.rejects(handle.close(), { code: 'DRAIN_FAILED' });
    await assert.rejects(factory.startRun({ requestId: 'cannot-overlap-tool', brief, dependencyRunId: prep.id }), { code: 'RUN_ACTIVE' });
    await assert.rejects(factory.close(), { code: 'DRAIN_FAILED' });
    await assert.rejects(openFactory({ stateDir, project }), { code: 'BACKEND_OWNED' });
    assert.equal(globalThis.executorDrainFixture.scopeKills.length, 1);
    const evidence = await inspectExecutor(projection);
    assert.equal(evidence.reviewReady, false);
    await new Promise(resolve => process.stdout.write(`${JSON.stringify({ root, run: fenced, evidence })}\n`, resolve));
    process.exit(0); // The outer exact-owned harness kills/drains the refused namespace.
  }
  if (['stop-model', 'shutdown-model', 'deadline-model', 'model-drain', 'model-drain-report'].includes(scenario)) {
    await until(async () => transport.requests.length, n => n === 2, 20000);
    if (scenario.startsWith('model-drain')) {
      await assert.rejects(factory.stopRun(admitted.id), { code: 'DRAIN_FAILED' });
      const fenced = await factory.inspectRun(admitted.id);
      assert.equal(fenced.status, 'interrupted');
      await assert.rejects(factory.startRun({ requestId: 'cannot-overlap', brief, dependencyRunId: prep.id }), { code: 'RUN_ACTIVE' });
      await assert.rejects(factory.close(), { code: 'DRAIN_FAILED' });
      await assert.rejects(openFactory({ stateDir, project }), { code: 'BACKEND_OWNED' });
      const evidence = await inspectExecutor(projection);
      assert.equal(evidence.artifactStatus, 'incomplete');
      assert.equal(evidence.operations.length, 0);
      await new Promise(resolve => process.stdout.write(`${JSON.stringify({ root, run: fenced, evidence })}\n`, resolve));
      process.exit(0); // Exact-owned harness drains this fixture process's scope.
    }
    if (scenario.startsWith('deadline-')) { nowState.value = admitted.deadlineAt; await handle.cancel(); }
    else if (scenario === 'shutdown-model') await factory.close();
    else await factory.stopRun(admitted.id);
  }
  if (scenario === 'stop-draining-tooluse') {
    await until(() => factory.inspectRun(admitted.id), r => r.reservations.some(a => a.kind === 'model' && !a.smoke && a.accounting?.usage), 20000);
    const stopping = factory.stopRun(admitted.id);
    await until(async () => drainEntered, Boolean);
    await assert.rejects(factory.startRun({ requestId: 'draining-overlap', brief, dependencyRunId: prep.id }), { code: 'RUN_ACTIVE' });
    drainage.resolve(); await stopping;
  }
  if (['stop-tool', 'deadline-tool'].includes(scenario)) {
    await until(async () => toolWait, Boolean, 25000);
    if (scenario.startsWith('deadline-')) { nowState.value = admitted.deadlineAt; await handle.cancel(); }
    else await factory.stopRun(admitted.id);
  }
  await handle.finished;
  await until(async () => result, Boolean);
  if (scenario === 'shutdown-model') factory = await openFactory({ stateDir, project, workspace, execution: adapter });
  await until(() => factory.inspectRun(admitted.id), r => ['blocked', 'failed', 'stopped'].includes(r.status));
  if (bridgeError) throw bridgeError;
  const unchanged = ['no-change', 'fabricated'];
  const complete = ['draft', 'stale-handoff', 'closed-handoff', 'transient-retry', 'check-assertion-feedback', 'check-encoded-feedback'];
  const expected = complete.includes(scenario) ? 'draft-produced' : unchanged.includes(scenario) ? 'no-change'
    : ['output-limit', 'check-output-limit', 'tool-budget', 'model-budget'].includes(scenario) || scenario.startsWith('deadline-') ? 'budget-limited'
    : scenario.startsWith('stop-') || scenario === 'shutdown-model' ? 'stopped' : 'failed';
  assert.equal(result?.status, expected, JSON.stringify({ result, projection: projection?.run.executor }));
  const run = await factory.inspectRun(admitted.id);
  const evidence = await inspectExecutor(projection);
  assert.equal(evidence.reviewReady, false);
  if (['check-output-limit', 'check-assertion-feedback'].includes(scenario)) {
    const checks = await Promise.all(evidence.operations.filter(op => op.type === 'tool-result' && op.tool === 'run_check')
      .map(async op => JSON.parse(await readFile(join(projection.directory, op.artifact), 'utf8')).result));
    assert.equal(checks[0].passed, false);
    assert.equal(checks[0].reason, scenario === 'check-output-limit' ? 'output-limit' : 'exit');
    if (scenario === 'check-output-limit') {
      assert.equal(checks[0].outputBytes, 1048576);
      assert.equal(checks.length, 1, 'No later check after output-limit termination.');
      assert.equal(transport.requests.length, 5, 'No later model request after output-limit termination.');
    } else assert.equal(checks[1].passed, true, 'An ordinary assertion failure remains feedback, not a latched resource limit.');
  }
  if (complete.includes(scenario)) {
    assert.equal(evidence.artifactStatus, scenario === 'stale-handoff' ? 'invalidated' : 'retained');
    assert.equal(evidence.plan.provenance, 'model-authored');
    assert.equal(evidence.operations.filter(e => e.type === 'tool-result').length, 5);
    assert.equal(await readFile(join(run.workspace.intent.worktree, 'helper.mjs'), 'utf8'), 'export const normalize = text => text.trim();\n');
    if (scenario !== 'stale-handoff') assert.match(await readFile(join(run.workspace.intent.worktree, 'helper.test.mjs'), 'utf8'), /100 Main # 2/);
    assert.equal(run.counters.modelAttempts, scenario === 'transient-retry' ? 8 : 7); assert.equal(run.counters.toolRounds, 9);
    if (scenario === 'transient-retry') assert.equal(run.reservations.filter(r => r.retry).length, 1);
    const receipt = await inspectExecution(originalInput.directory);
    assert.equal(receipt.status, 'done'); assert.equal(receipt.safety.kind, 'repository-executor');
    await assert.rejects(verifyExecutorHandoff(handoffToken, { runId: admitted.id, kind: 'controlled-fixture' }), { code: 'EXECUTOR_AUTHORITY_REQUIRED' });
  } else if (['output-limit', 'check-output-limit', 'dependency-change', 'source-change', 'profile-change', 'persistence-after-write', 'persistence-report', 'stop-tool', 'deadline-tool', 'stop-finalization'].includes(scenario)) {
    assert.equal(await readFile(join(run.workspace.intent.worktree, 'helper.mjs'), 'utf8'), 'export const normalize = text => text.trim();\n');
    assert.equal(evidence.artifactStatus, 'incomplete');
    assert.ok(evidence.operations.some(e => e.type === 'tool-result' && e.tool === 'write_file'), 'Passive evidence includes real effects even when saving their projection failed.');
    await assert.rejects(handle.handoff(), { code: 'EXECUTOR_AUTHORITY_REQUIRED' });
  } else {
    assert.equal(await readFile(join(run.workspace.intent.worktree, 'helper.mjs'), 'utf8'), scenario === 'pristine-transition' ? 'changed before activation' : 'export const normalize = text => text;\n');
    assert.equal(await readFile(join(run.workspace.intent.worktree, 'evidence.md'), 'utf8'), 'Normalize trailing spaces while preserving unit numbers.\n');
    assert.equal(evidence.operations.some(e => e.tool === 'write_file' && e.type === 'tool-result'), false);
    if (unchanged.includes(scenario)) { assert.equal(evidence.status, 'no-change'); assert.equal(run.counters.toolRounds, 4); }
    if (scenario === 'preflight-failed') assert.equal(transport.requests.length, 1);
  }
  assert.equal(initializations, 1);
  assert.equal((await factory.startRun({ requestId: 'executor', brief, dependencyRunId: prep.id })).id, admitted.id);
  if (!['model-budget'].includes(scenario)) assert.equal(run.counters.modelAttempts, transport.requests.length);
  if (scenario === 'model-budget') { assert.equal(run.counters.modelAttempts, 40); assert.equal(transport.requests.length, 1); }
  if (scenario === 'tool-budget') { assert.equal(run.counters.toolRounds, 30); assert.equal(evidence.operations.some(e => e.type === 'tool-result'), false); }
  const recovery = await executor.assessRecovery(projection);
  assert.equal(recovery.resumable, false);
  await assert.rejects(executor.resume(projection), { code: 'UNSAFE_RESUME' });
  process.stdout.write(`${JSON.stringify({ root, result, run, evidence })}\n`);
} finally {
  try { await factory.close(); }
  catch (error) { if (!['tool-startup-drain', 'tool-drain-report'].includes(scenario) || error.code !== 'DRAIN_FAILED') throw error; }
}
