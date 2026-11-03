import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openFactory } from '../../src/factory.mjs';
import { createRepositoryExecution } from '../../src/execution.mjs';
import { serveFactory } from '../../src/control-server.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { dependencyFixture } from '../../src/dependencies-diagnostics.mjs';
import { controlledRuntime, controlledTransport, eventsResponse } from './model-fixtures.mjs';
import { executorToolResponse } from '../fixtures/executor-model.mjs';
import { until } from '../phase-0/helpers.mjs';

const [root, scenario] = process.argv.slice(2);
const cli = scenario.startsWith('cli-');
const kind = scenario.replace(/^cli-/, '');
const executable = fileURLToPath(new URL('../../bin/factory.mjs', import.meta.url));
const exec = promisify(execFile);
globalThis.fetch = async () => { throw new Error('Uncontrolled network forbidden'); };
const fixture = await dependencyFixture(root, { copyToolchain: true, checkSuffix: `
if (process.argv.includes('run')) {
  try { await readFile('/work/helper.test.mjs'); await import('/work/helper.test.mjs');
    if (${JSON.stringify(kind === 'check-output-limit')}) await new Promise(resolve => process.stdout.write('x'.repeat(1048577), resolve));
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
` });
const stateDir = fixture.workspaceIntent.stateDir;
const project = { id: 'vanguard', repositoryPath: fixture.repositoryPath };
const workspace = { admit: admitWorkspace, prepare: prepareWorkspace };
await writeFile(join(project.repositoryPath, 'helper.mjs'), 'export const normalize = value => value;\n');
const evidenceText = '\n'.repeat(8192) + '\0'.repeat(4096) + '🙂'.repeat(1025) + '\r\t"\\tail\n';
if (kind === 'pagination') await writeFile(join(project.repositoryPath, 'evidence.md'), evidenceText);
fixture.git('add', '.'); fixture.git('commit', '-m', 'controlled executor application source');
const brief = 'Goal: Trim fixture address whitespace.\nAcceptance criteria: Preserve units and add a regression test.\nEvidence: helper.mjs.';
const scope = { writePaths: ['helper.mjs', 'helper.test.mjs'] };
let factory = await openFactory({ stateDir, project, workspace });
let server; let handle; let initialized = 0; let workStarted = false;
let readOffset = 0; let received = ''; let feedbackFailure;
async function command(...args) {
  try {
    const { stdout } = await exec(process.execPath, [executable, ...args, '--state-dir', stateDir], {
      env: { PATH: '/usr/bin', HOME: root }, timeout: 15000, maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) { if (error.stderr?.trim().startsWith('{')) Object.assign(error, JSON.parse(error.stderr).error); throw error; }
}
const inspect = (id, options) => cli ? command('inspect', id, ...(options ? ['--event', String(options.page), '--length', String(options.length), '--offset', String(options.offset ?? 0)] : [])) : factory.inspectRun(id, options);
async function close() { if (server) { const current = server; server = undefined; await current.close(); } else await factory.close(); }
try {
  const preparation = await factory.startRun({ requestId: 'prepare', brief });
  await until(() => factory.inspectRun(preparation.id), run => run.status === 'blocked');
  await factory.prepareDependencies(preparation.id, { bunPath: `${root}/bun` });
  const prepared = await until(() => factory.inspectRun(preparation.id), run => run.dependencies?.status === 'prepared' && run.status === 'blocked');
  await close();
  const transport = controlledTransport((request, index) => {
    if (index === 1) return kind === 'refusal' ? new Response('controlled refusal', { status: 401 }) : eventsResponse();
    assert.deepEqual(request.payload.tools.map(tool => tool.name), ['read_file', 'write_file', 'run_check']);
    workStarted = true;
    if (kind === 'pagination') {
      try {
        if (index > 2) {
          const response = request.payload.input.filter(item => item.type === 'function_call_output').at(-1).output;
          assert.ok(Buffer.byteLength(response) <= 16384, `Encoded response is ${Buffer.byteLength(response)} bytes, exceeding 16384.`);
          const page = JSON.parse(response);
          assert.equal(page.offset, readOffset);
          assert.equal(page.bytes, Buffer.byteLength(page.text));
          assert.equal(page.text, Buffer.from(evidenceText).subarray(readOffset, readOffset + page.bytes).toString('utf8'));
          received += page.text;
          if (page.nextOffset === null) {
            assert.equal(received, evidenceText);
            return eventsResponse({ text: 'All evidence pages read. No source change needed.' });
          }
          assert.equal(page.nextOffset, readOffset + page.bytes); assert.ok(page.nextOffset > readOffset);
          readOffset = page.nextOffset;
        }
        return executorToolResponse('read_file', { path: 'evidence.md', offset: readOffset }, `read-${index}`, 'Plan: read all evidence pages before deciding whether to edit.');
      } catch (error) { feedbackFailure = error; throw error; }
    }
    if (index === 2 && ['stop', 'drain-report'].includes(kind)) return new Response(new ReadableStream({ cancel() {
      if (kind === 'drain-report') throw new Error('Controlled transport drain failure');
    } }), { headers: { 'content-type': 'text/event-stream' } });
    if (index === 2 && kind === 'no-change') return eventsResponse({ text: 'No change needed. This is not maintenance readiness.' });
    if (index === 2) return executorToolResponse('read_file', { path: 'helper.mjs', offset: 0 }, 'read', 'Plan: inspect the helper, trim whitespace, retain a regression, and run both checks.');
    if (index === 3) return executorToolResponse('write_file', { path: 'helper.mjs', text: 'export const normalize = value => value.trim();\n' }, 'write');
    if (index === 4) return executorToolResponse('write_file', { path: 'helper.test.mjs', text: 'import assert from "node:assert/strict";\nimport { normalize } from "./helper.mjs";\nassert.equal(normalize("Main # 2  "), "Main # 2");\n' }, 'test');
    if (index === 5) return executorToolResponse('run_check', { name: 'vitest' }, 'vitest');
    if (index === 6) return executorToolResponse('run_check', { name: 'lint' }, 'lint');
    return eventsResponse({ text: 'Draft retained; independent qualification is required.' });
  });
  const executor = createRepositoryExecution({ fixture: true, createRuntime() { initialized++; return controlledRuntime(); }, fetch: transport.fetch });
  // This wrapper injects only faults and observes lifecycle. It does not bridge
  // modes, invent projections, or replace real model/tool/persistence behavior.
  const execution = { ...executor, async start(input) {
    writeFileSync(join(root, 'application-input.json'), JSON.stringify({ stateDir, project, runId: input.runId, brief, scope, dependencyRunId: preparation.id }), { mode: 0o600 });
    const budget = kind === 'crash' ? { ...input.budget, settle(id, evidence, accounting) {
      if (evidence.startsWith('{') && JSON.parse(evidence).kind === 'write') process.kill(process.pid, 'SIGKILL');
      return input.budget.settle(id, evidence, accounting);
    } } : input.budget;
    handle = await executor.start({ ...input, budget, saveAdmission(state) {
      input.saveAdmission(state);
      if (kind === 'smoke-crash' && state.status === 'verified') process.kill(process.pid, 'SIGKILL');
    }, saveExecutor(state) {
      if (kind === 'drain-report' && state.failure?.code === 'MODEL_DRAIN_FAILED') throw new Error('Controlled projection failure');
      input.saveExecutor(state);
    } });
    if (kind === 'completion-crash') return { ...handle, finished: handle.finished.then(() => process.kill(process.pid, 'SIGKILL')) };
    return handle;
  } };
  factory = await openFactory({ stateDir, project, workspace, execution });
  if (cli) server = await serveFactory({ factory, mode: execution.mode, fixture: true });
  const start = () => cli ? command('start', '--request-id', 'executor', '--brief-text', brief, '--dependency-run', preparation.id,
    '--write-path', 'helper.test.mjs', '--write-path', 'helper.mjs') : factory.startRun({ requestId: 'executor', brief, dependencyRunId: preparation.id, scope });
  const admitted = await start();
  assert.equal(admitted.execution.mode, 'repository-executor');
  assert.deepEqual(admitted.executor.scope, scope);
  await until(async () => handle, Boolean);
  if (['stop', 'drain-report'].includes(kind)) {
    await until(async () => workStarted, Boolean, 20000);
    if (kind === 'drain-report') {
      await assert.rejects(factory.stopRun(admitted.id), { code: 'DRAIN_FAILED' });
      const retained = await factory.inspectRun(admitted.id);
      assert.equal(retained.status, 'interrupted'); assert.equal(retained.outcome.reason, 'drain_failed');
      await assert.rejects(factory.startRun({ requestId: 'overlap', brief, dependencyRunId: preparation.id, scope }), { code: 'RUN_ACTIVE' });
      await assert.rejects(factory.close(), { code: 'DRAIN_FAILED' });
      await assert.rejects(openFactory({ stateDir, project }), { code: 'BACKEND_OWNED' });
      await new Promise(resolve => process.stdout.write(`${JSON.stringify({ run: retained, fenced: true })}\n`, resolve));
      process.exit(0); // Exact-owned harness confirms teardown.
    }
    const stopped = cli ? await command('stop', admitted.id) : await factory.stopRun(admitted.id);
    assert.equal(stopped.status, 'stopped');
  }
  await handle.finished;
  if (feedbackFailure) throw feedbackFailure;
  const run = await until(() => inspect(admitted.id), value => !['admitted', 'running'].includes(value.status));
  assert.equal(run.status, kind === 'stop' ? 'stopped' : kind === 'refusal' ? 'blocked' : kind === 'check-output-limit' ? 'failed' : 'completed');
  assert.equal(run.outcome.reviewReady, false);
  assert.equal(run.capabilities.productionModel, false);
  if (kind === 'draft') {
    assert.equal(run.outcome.kind, 'draft-produced'); assert.equal(run.outcome.reason, 'QUALIFICATION_REQUIRED');
    assert.equal(run.executorEvidence.status, 'draft-produced'); assert.equal(run.executorEvidence.artifactStatus, 'retained');
    assert.equal(run.executorEvidence.plan.provenance, 'model-authored');
    assert.equal(run.admission.historical, true); assert.equal(run.admission.readiness, 'baseline-healthy');
    assert.equal(run.execution.submissionId, run.executor.submissionId);
    assert.notEqual(run.execution.submissionId, run.admission.smokeSubmissionId);
    assert.deepEqual(run.counters, { modelAttempts: 7, toolRounds: 9, reservedOutputTokens: 1024 + 6 * 8192 });
    assert.equal(await readFile(join(run.workspace.intent.worktree, 'helper.mjs'), 'utf8'), 'export const normalize = value => value.trim();\n');
    assert.match(await readFile(join(run.workspace.intent.worktree, 'helper.test.mjs'), 'utf8'), /Main # 2/);
    const page = (await inspect(run.id, { page: 0, length: 64 })).executorEvidence.page;
    assert.equal(page.nextOffset, 64); assert.equal(Buffer.byteLength(page.text), 64);
    const next = (await inspect(run.id, { page: 0, offset: page.nextOffset, length: 64 })).executorEvidence.page;
    assert.equal(next.offset, 64);
  }
  if (kind === 'refusal') { assert.equal(transport.requests.length, 1); assert.equal(run.counters.toolRounds, 1); }
  if (['no-change', 'pagination'].includes(kind)) assert.equal(run.outcome.kind, 'no-change');
  if (kind === 'pagination') { assert.equal(received, evidenceText); assert.ok(readOffset > 0); }
  if (kind === 'check-output-limit') {
    assert.equal(run.outcome.kind, 'budget-limited'); assert.equal(run.outcome.reason, 'CHECK_OUTPUT_LIMIT');
    assert.equal(run.executorEvidence.artifactStatus, 'incomplete'); assert.equal(run.executor.partialDraft, true);
    assert.equal(transport.requests.length, 5); assert.equal(run.counters.toolRounds, 8);
    assert.equal(await readFile(join(run.workspace.intent.worktree, 'helper.mjs'), 'utf8'), 'export const normalize = value => value.trim();\n');
  }
  const attempts = transport.requests.length;
  assert.equal((await start()).id, run.id);
  assert.equal(transport.requests.length, attempts); assert.equal(initialized, 1);
  assert.deepEqual((await factory.inspectRun(prepared.id)).counters, prepared.counters);
  assert.equal(await readFile(join(project.repositoryPath, 'helper.mjs'), 'utf8'), 'export const normalize = value => value;\n');
  await close();
  const offline = await command('inspect', run.id, '--event', '0', '--length', '64');
  assert.equal(offline.status, run.status); assert.equal(offline.executorEvidence.status, run.executorEvidence.status);
  assert.equal(transport.requests.length, attempts);
  process.stdout.write(`${JSON.stringify({ run, offline, requests: attempts })}\n`);
} finally { await close(); }
