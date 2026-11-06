import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openFactory } from '../../src/factory.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { createQualifiedRepositoryExecution } from '../../src/qualified-execution.mjs';
import { createDraftQualification } from '../../src/qualification.mjs';
import { qualificationProject, baseHelper, draftHelper, candidateTest } from '../fixtures/qualification-project.mjs';
import { qualifiedExecutorReply, scope, helperPath, testPath } from '../fixtures/qualified-execution-model.mjs';
import { controlledRuntime, controlledTransport } from './model-fixtures.mjs';
import { until } from '../phase-0/helpers.mjs';

const [root, scenario] = process.argv.slice(2);
globalThis.fetch = async () => { throw new Error('Uncontrolled network forbidden'); };
const fixture = await qualificationProject(root, scenario === 'drain-report' ? 'slow' : 'green');
const stateDir = fixture.workspaceIntent.stateDir;
const project = { id: 'vanguard', repositoryPath: fixture.repositoryPath };
const workspace = { admit: admitWorkspace, prepare: prepareWorkspace };
const brief = 'Goal: normalizeAddress whitespace.\nAcceptance criteria: Preserve units and abbreviations, add a focused regression test, no stored-data backfill.\nEvidence: Independently specified address examples.';
let factory = await openFactory({ stateDir, project, workspace });
const prep = await factory.startRun({ requestId: 'prepare', brief });
await until(() => factory.inspectRun(prep.id), r => r.status === 'blocked');
await factory.prepareDependencies(prep.id, { bunPath: `${root}/bun` });
const dependencyRun = await until(() => factory.inspectRun(prep.id), r => r.dependencies?.status === 'prepared' && r.status === 'blocked');
await factory.close();

// Admission (containment + vitest + lint) and executor (read + two writes) consume 7 original rounds.
// The burn scenario leaves exactly none for qualification capture, through real executor reads.
const extraReads = scenario === 'tool-limit' ? 23 : 0;
const variant = ['tautology', 'no-change', 'refusal'].includes(scenario) ? scenario : 'green';
const transport = controlledTransport(qualifiedExecutorReply({ variant, extraReads }));
let initialized = 0;
const qualified = createQualifiedRepositoryExecution({ fixture: true, createRuntime() { initialized++; return controlledRuntime(); }, fetch: transport.fetch });
assert.equal(initialized, 0, 'Construction is passive.');

// Narrow application bridge pending parent wiring (contract: stream D). It supplies the
// application's initial pending projection and a synchronous detached save. It injects
// stop requests and a reporting fault only; the composed executor and qualifier are real.
const saved = []; let handle; let receipt; let runId; let stopping; let fault; let scheduled = false;
const execution = { ...qualified, async start(input) {
  runId = input.runId;
  assert.deepEqual(input.run.qualification, { version: 1, runId: input.runId, kind: qualified.admissionKind, status: 'pending', reviewReady: false });
  handle = await qualified.start({ ...input,
    saveExecutor(state) {
      input.saveExecutor(state);
      if (scenario === 'stop-before-qualification' && state.stage === 'complete' && state.status === 'draft-produced') stopping = factory.stopRun(input.runId);
    },
    saveQualification(state) {
      input.saveQualification(state);
      assert.equal(state.version, 1); assert.equal(state.runId, input.runId); assert.equal(state.kind, qualified.admissionKind);
      saved.push(structuredClone(state));
      writeFileSync(join(root, 'qualification-projection.json'), JSON.stringify(state), { mode: 0o600 });
      // Immediately after the completed capture projection, the qualifier's next step is its stop check.
      if (scenario === 'stop-qualification' && state.capture && state.stage === 'capture' && !scheduled) { scheduled = true; stopping = factory.stopRun(input.runId); }
      if (scenario === 'drain-report' && state.stage === 'base-regression' && !scheduled) {
        scheduled = true;
        const cancelled = new AbortController();
        fault = import('../fixtures/qualification-drain-fault.mjs').then(m => m.refuseDrain(join(input.directory, 'qualification/base-checks'), cancelled));
        fault.catch(() => {});
        cancelled.signal.addEventListener('abort', () => { stopping = factory.stopRun(input.runId); stopping.catch(() => {}); });
      }
      if (scenario === 'drain-report' && state.stage === 'complete') throw new Error('Controlled qualification report failure');
    } });
  handle.finished.then(value => { receipt = value; }, error => { receipt = { rejected: error.code }; });
  return handle;
} };
try {
  factory = await openFactory({ stateDir, project, workspace, execution });
  const admitted = await factory.startRun({ requestId: 'qualified', brief, dependencyRunId: prep.id, scope });
  assert.equal(admitted.execution.mode, 'repository-executor');
  if (scenario === 'drain-report') {
    await until(async () => receipt, Boolean, 50000);
    assert.deepEqual(receipt, { rejected: 'DRAIN_FAILED' }, 'Drain failure outranks the reporting failure.');
    await assert.rejects(stopping ?? factory.stopRun(runId), { code: 'DRAIN_FAILED' });
    await (await fault)();
    await assert.rejects(handle.close(), { code: 'DRAIN_FAILED' });
    await assert.rejects(handle.close(), { code: 'DRAIN_FAILED' });
    await assert.rejects(handle.cancel(), { code: 'DRAIN_FAILED' });
    const retained = await factory.inspectRun(runId);
    assert.equal(retained.status, 'interrupted'); assert.equal(retained.outcome.reason, 'drain_failed');
    assert.equal(saved.at(-1).verdict.status, 'interrupted');
    await assert.rejects(factory.startRun({ requestId: 'overlap', brief, dependencyRunId: prep.id, scope }), { code: 'RUN_ACTIVE' });
    await assert.rejects(factory.close(), { code: 'DRAIN_FAILED' });
    await assert.rejects(openFactory({ stateDir, project }), { code: 'BACKEND_OWNED' });
    await new Promise(resolve => process.stdout.write(`${JSON.stringify({ scenario, receipt, run: retained, fenced: true })}\n`, resolve));
    process.exit(0); // The exact-owned harness drains the intentionally surviving namespace.
  }
  const run = await until(() => factory.inspectRun(admitted.id), r => !['admitted', 'running'].includes(r.status) && receipt, 150000);
  if (stopping) await stopping;
  const directory = join(stateDir, 'runs', run.id);
  const qualificationDirectory = await access(join(directory, 'qualification')).then(() => true, () => false);
  const worktree = run.workspace.intent.worktree;
  assert.equal(receipt.runId, run.id); assert.equal(receipt.requestId, run.execution.requestId);
  assert.equal(receipt.reviewReady, false, 'Controlled evidence never grants readiness.');
  assert.ok(run.counters.toolRounds <= run.limits.toolRounds);
  assert.equal(run.deadlineAt, admitted.deadlineAt, 'The original deadline is never extended.');
  assert.equal(await readFile(join(project.repositoryPath, helperPath), 'utf8'), baseHelper, 'The owner checkout is never modified.');
  if (['no-change', 'refusal', 'stop-before-qualification'].includes(scenario)) {
    assert.equal(saved.length, 0, 'No qualifier for an executor outcome other than draft-produced.');
    assert.equal(qualificationDirectory, false);
    assert.equal(receipt.kind, undefined, 'The executor receipt passes through unchanged.');
    assert.equal(receipt.status, { 'no-change': 'no-change', refusal: 'failed', 'stop-before-qualification': 'stopped' }[scenario]);
    assert.equal(run.executor.status, receipt.status);
  }
  if (scenario === 'refusal') { assert.equal(transport.requests.length, 1); assert.equal(run.status, 'blocked'); }
  if (scenario === 'no-change') assert.equal(run.outcome.kind, 'no-change');
  if (scenario === 'stop-before-qualification') {
    assert.equal(run.status, 'stopped');
    assert.equal(await readFile(join(worktree, testPath), 'utf8'), candidateTest('green'), 'Partial drafts survive a stop.');
  }
  if (['qualified', 'tautology', 'tool-limit', 'stop-qualification'].includes(scenario)) {
    assert.equal(run.executor.status, 'draft-produced');
    assert.equal(receipt.kind, 'controlled-fixture');
    assert.equal(await readFile(join(worktree, helperPath), 'utf8'), draftHelper);
    assert.equal(await readFile(join(worktree, testPath), 'utf8'), candidateTest(variant === 'tautology' ? 'candidate-tautology' : 'green'));
    const final = saved.at(-1);
    assert.equal(final.stage, 'complete'); assert.equal(final.reviewReady, false);
    assert.deepEqual(receipt, { status: final.verdict.status, ...(final.verdict.reason ? { reason: final.verdict.reason } : {}),
      kind: 'controlled-fixture', runId: run.id, requestId: run.execution.requestId, reviewReady: false, artifacts: final.artifacts });
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'qualification/state.json'), 'utf8')), JSON.parse(JSON.stringify(final)));
  }
  if (scenario === 'tool-limit') {
    assert.equal(receipt.status, 'blocked'); assert.equal(receipt.reason, 'TOOL_ROUND_LIMIT');
    assert.equal(run.counters.toolRounds, run.limits.toolRounds, 'Qualification never replenishes the original allowance.');
    assert.equal(saved.at(-1).checks.length, 0);
  }
  if (scenario === 'stop-qualification') {
    assert.equal(receipt.status, 'stopped'); assert.equal(receipt.reason, 'RUN_STOPPING');
    assert.equal(run.status, 'stopped'); assert.equal(saved.at(-1).checks.length, 0);
    assert.equal(saved.at(-1).artifacts.complete, true, 'Partial qualification evidence survives a stop.');
  }
  if (scenario === 'tautology') {
    assert.equal(receipt.status, 'blocked'); assert.equal(receipt.reason, 'REGRESSION_UNVERIFIED', JSON.stringify(receipt));
  }
  if (scenario === 'qualified') {
    assert.equal(receipt.status, 'qualified', JSON.stringify(receipt));
    assert.equal(receipt.artifacts.complete, true);
    const final = saved.at(-1);
    assert.deepEqual(final.checks.map(c => c.stage), ['base-boundary', 'runner-probe', 'base-regression', 'candidate-base-boundary',
      'candidate-base-regression', 'draft-boundary', 'draft-regression', 'draft-candidate', 'vitest', 'lint']);
    // The live descriptor came from the executor's opaque handoff, not a fixture verifier.
    assert.equal(final.descriptor.draft.sourceDigest, run.executor.draft.sourceDigest);
    assert.deepEqual(final.descriptor.admissionBinding, run.admission.binding);
    assert.deepEqual(final.descriptor.scope, scope);
    const patch = JSON.parse(await readFile(join(directory, 'qualification/patch.json'), 'utf8'));
    const added = patch.changes.find(c => c.path === testPath);
    assert.equal(added.before, null);
    assert.equal(Buffer.from(added.after.contentBase64, 'base64').toString(), candidateTest('green'));
    assert.equal(run.counters.toolRounds, 7 + 11, 'Qualification consumes the original allowance.');
    const passive = createDraftQualification({ verifyDraft() { assert.fail('Passive inspection cannot request live authority.'); } });
    const evidence = await passive.inspect({ directory, run: { ...run, qualification: final }, dependencyRun });
    assert.equal(evidence.status, 'qualified'); assert.equal(evidence.artifactStatus, 'verified'); assert.equal(evidence.reviewReady, false);
    await writeFile(join(worktree, 'late.mjs'), 'late source');
    assert.equal((await passive.inspect({ directory, run: { ...run, qualification: final }, dependencyRun })).artifactStatus, 'invalid');
  }
  const attempts = transport.requests.length;
  assert.equal((await factory.startRun({ requestId: 'qualified', brief, dependencyRunId: prep.id, scope })).id, run.id);
  assert.equal(transport.requests.length, attempts, 'A duplicate request never repeats either stage.');
  await assert.rejects(qualified.resume({}), { code: 'UNSAFE_RESUME' });
  process.stdout.write(`${JSON.stringify({ scenario, receipt, final: saved.at(-1), counters: run.counters, status: run.status, outcome: run.outcome, requests: attempts })}\n`);
} finally { await factory.close(); }
