import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openFactory } from '../../src/factory.mjs';
import { createQualifiedRepositoryExecution, createRepositoryExecution } from '../../src/execution.mjs';
import { serveFactory } from '../../src/control-server.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { helperProject, commitHelper, helperExecutorReply, nullableBase, nullableDraft, writeLimitBase, nullableCandidate, mismatchedNullableCandidate,
  draftVariants, unsupportedBases } from '../fixtures/helper-compatibility.mjs';
import { scope, helperPath, testPath } from '../fixtures/qualified-execution-model.mjs';
import { controlledRuntime, controlledTransport } from './model-fixtures.mjs';
import { until } from '../phase-0/helpers.mjs';

const [root, scenario, list, legacy, stateDirectory] = process.argv.slice(2);
globalThis.fetch = async () => { throw new Error('Uncontrolled network forbidden'); };
const workspace = { admit: admitWorkspace, prepare: prepareWorkspace };
const brief = 'Goal: normalizeAddress whitespace.\nAcceptance criteria: Preserve units, abbreviations, and the nullable contract with a regression test, no backfill.\nEvidence: Independently specified address examples.';
const exec = promisify(execFile);
const executable = fileURLToPath(new URL('../../bin/factory.mjs', import.meta.url));
const output = [];

// Dependencies bind the admitted base commit, so each authored base is prepared for itself.
async function prepared(stateDir, project, requestId) {
  const factory = await openFactory({ stateDir, project, workspace });
  try {
    const prep = await factory.startRun({ requestId, brief });
    await until(() => factory.inspectRun(prep.id), r => r.status === 'blocked');
    await factory.prepareDependencies(prep.id, { bunPath: `${root}/bun` });
    await until(() => factory.inspectRun(prep.id), r => r.dependencies?.status === 'prepared' && r.status === 'blocked');
    return prep.id;
  } finally { await factory.close(); }
}

/** One composed qualifying Run through the factory application and CLI. `onAdmission`
 * only observes saved admission state to request a stop, advance the clock, or edit
 * the worktree; the composed executor, admission, and qualifier are the real ones. */
async function composedRun({ stateDir, project, dependencyRunId, draft, candidate, requestId, writePaths = scope.writePaths, onAdmission }) {
  const transport = controlledTransport(helperExecutorReply(draft, candidate));
  let initialized = 0; let expired = false; let stopping; let factory;
  const composed = createQualifiedRepositoryExecution({ fixture: true,
    createRuntime() { initialized++; return controlledRuntime(); }, fetch: transport.fetch });
  const control = { expire() { expired = true; }, stop(runId) { stopping = factory.stopRun(runId); stopping.catch(() => {}); } };
  const execution = onAdmission ? { ...composed, start: input => composed.start({ ...input,
    saveAdmission(state) { input.saveAdmission(state); onAdmission(state, input, control); } }) } : composed;
  const clock = { now: () => Date.now() + (expired ? 1_200_001 : 0), setTimeout, clearTimeout };
  factory = await openFactory({ stateDir, project, workspace, execution, clock });
  const server = await serveFactory({ factory, mode: execution.mode, fixture: true });
  const cli = async (...args) => JSON.parse((await exec(process.execPath, [executable, ...args, '--state-dir', stateDir], {
    env: { PATH: '/usr/bin', HOME: root }, timeout: 15000, maxBuffer: 4 * 1024 * 1024 })).stdout);
  const start = () => cli('start', '--request-id', requestId, '--brief-text', brief, '--dependency-run', dependencyRunId,
    ...writePaths.flatMap(path => ['--write-path', path]));
  try {
    const admitted = await start();
    assert.equal(admitted.qualification.kind, 'controlled-fixture');
    const run = await until(() => cli('inspect', admitted.id), r => !['admitted', 'running'].includes(r.status), 55000);
    if (stopping) await stopping;
    assert.equal(run.deadlineAt, admitted.deadlineAt, 'The original deadline is never extended.');
    assert.equal(run.outcome.reviewReady, false, 'Controlled evidence never grants readiness.');
    const attempts = transport.requests.length;
    assert.equal((await start()).id, run.id);
    assert.equal(transport.requests.length, attempts, 'A duplicate request never repeats any stage.');
    return { run, initialized, requests: attempts, directory: join(stateDir, 'runs', run.id) };
  } finally { await server.close(); await factory.close(); }
}

const summary = ({ run, initialized, requests }) => ({ status: run.status, outcome: run.outcome, admission: run.admission?.failure?.code,
  stage: run.admission?.stage, executor: run.executor?.status, initialized, requests, counters: run.counters, workItem: run.workItem?.id ?? null });

/** No ModelRuntime, request, attempt, tool round, submission, draft, qualification, or Work item. */
async function zeroEffect(result, label, { status = 'blocked', reason, admission = reason, stage = 'helper-eligibility' }) {
  const { run, directory } = result;
  const detail = JSON.stringify({ label, ...summary(result) });
  assert.equal(result.initialized, 0, `No ModelRuntime construction: ${detail}`);
  assert.equal(result.requests, 0, `No model request or smoke: ${detail}`);
  assert.equal(run.counters.modelAttempts, 0, detail);
  assert.equal(run.counters.toolRounds, 0, `No containment, check, or executor tool round: ${detail}`);
  assert.equal(run.status, status, detail);
  assert.equal(run.outcome.reason, reason, detail);
  assert.equal(run.admission.failure.code, admission, `The refusal is inspectable on the admission record: ${detail}`);
  assert.equal(run.admission.stage, stage, detail);
  assert.notEqual(run.admission.readiness, 'baseline-healthy');
  assert.deepEqual(run.admission.baselines, []);
  assert.equal(run.admission.containment, undefined);
  assert.equal(run.admission.smoke, undefined);
  assert.equal(run.executor.submissionId, undefined, 'No tool-enabled executor submission.');
  assert.equal(run.executor.partialDraft ?? false, false, 'No draft.');
  assert.equal(run.qualificationEvidence.status, 'not-started');
  assert.equal(await access(join(directory, 'qualification')).then(() => true, () => false), false);
  assert.equal(run.workItem, undefined);
}

async function nullableFixture(base = nullableBase) {
  const fixture = await helperProject(root, base, { stateDir: stateDirectory });
  const stateDir = fixture.workspaceIntent.stateDir;
  const project = { id: 'vanguard', repositoryPath: fixture.repositoryPath };
  return { fixture, stateDir, project, dependencyRunId: await prepared(stateDir, project, 'prepare') };
}

if (['nullable-qualified', 'nullable-qualified-at-write-limit', 'nullable-candidate-mismatch'].includes(scenario) || scenario in draftVariants) {
  const base = scenario === 'nullable-qualified-at-write-limit' ? writeLimitBase : nullableBase;
  if (scenario === 'nullable-qualified-at-write-limit') assert.equal(Buffer.byteLength(base), 65_536);
  const { stateDir, project, dependencyRunId } = await nullableFixture(base);
  const draft = scenario in draftVariants ? draftVariants[scenario] : nullableDraft;
  const candidate = scenario === 'nullable-candidate-mismatch' ? mismatchedNullableCandidate : nullableCandidate;
  const result = await composedRun({ stateDir, project, dependencyRunId, draft, candidate, requestId: 'helper' });
  const { run } = result;
  output.push({ scenario, ...summary(result) });
  assert.equal(await readFile(join(project.repositoryPath, helperPath), 'utf8'), base, 'The owner checkout is never modified.');
  assert.equal(result.initialized, 1);
  assert.equal(run.executor.status, 'draft-produced', JSON.stringify(summary(result)));
  assert.equal(await readFile(join(run.workspace.intent.worktree, helperPath), 'utf8'), draft);
  if (['nullable-qualified', 'nullable-qualified-at-write-limit'].includes(scenario)) {
    assert.equal(run.status, 'completed', JSON.stringify(summary(result)));
    assert.equal(run.outcome.kind, 'qualified');
    assert.equal(run.qualificationEvidence.status, 'qualified');
    assert.equal(run.qualificationEvidence.artifactStatus, 'verified');
    assert.deepEqual(run.qualificationEvidence.stages.map(stage => stage.stage), ['base-boundary', 'runner-probe', 'base-regression',
      'candidate-base-boundary', 'candidate-base-regression', 'draft-boundary', 'draft-regression', 'draft-candidate', 'vitest', 'lint']);
    assert.equal(run.counters.toolRounds, 18, 'Admission, executor, and qualification share the original allowance.');
    assert.equal(run.workItem.runId, run.id);
    assert.equal(run.workItem.controlled, true);
    assert.equal(run.workItem.reviewReady, false);
    assert.equal(run.workItem.freshness, 'current');
    const patch = JSON.parse(await readFile(join(result.directory, run.workItem.patch.artifact), 'utf8'));
    const helper = patch.changes.find(change => change.path === helperPath);
    assert.equal(Buffer.from(helper.before.contentBase64, 'base64').toString(), base);
    assert.equal(Buffer.from(helper.after.contentBase64, 'base64').toString(), nullableDraft);
    const added = patch.changes.find(change => change.path === testPath);
    // Qualification required these retained candidate cases, including null,
    // undefined, and "", to pass on the candidate base and on the draft.
    assert.equal(Buffer.from(added.after.contentBase64, 'base64').toString(), nullableCandidate);
  } else if (scenario === 'nullable-candidate-mismatch') {
    // The authored nullable cases execute: a wrong null expectation fails on the
    // candidate base without matching the oracle, so the candidate is refused.
    assert.equal(run.status, 'blocked', JSON.stringify(summary(result)));
    assert.equal(run.outcome.reason, 'REGRESSION_UNVERIFIED');
    assert.equal(run.workItem, undefined);
  } else {
    // The late qualification check remains defense in depth after model work.
    assert.equal(run.status, 'blocked', JSON.stringify(summary(result)));
    assert.equal(run.outcome.reason, ['draft-reassignment', 'removed-guard'].includes(scenario) ? 'QUALIFICATION_SCOPE_UNSUPPORTED' : 'QUALIFICATION_SCOPE');
    assert.equal(run.workItem, undefined);
    assert.equal(run.qualification.checks?.length ?? 0, 0, 'No check runs on an unsupported or changed envelope.');
  }
} else if (['wrong-write-pair', 'stop-at-eligibility', 'deadline-at-eligibility', 'changed-before-read', 'changed-same-size-before-read'].includes(scenario)) {
  // A supported admitted helper; only the selected scope or the run's lifetime differs.
  const { stateDir, project, dependencyRunId } = await nullableFixture();
  const onAdmission = scenario === 'wrong-write-pair' ? undefined : (state, input, control) => {
    if (state.stage !== 'helper-eligibility') return;
    if (scenario === 'stop-at-eligibility') control.stop(input.runId);
    if (scenario === 'deadline-at-eligibility') control.expire();
    if (['changed-before-read', 'changed-same-size-before-read'].includes(scenario)) {
      // Synchronous: the admitted bytes change after capture, before the gate reads them.
      const changed = scenario === 'changed-same-size-before-read' ? nullableBase.replace('Canonical', 'canonical') : nullableDraft;
      if (scenario === 'changed-same-size-before-read') {
        assert.notEqual(changed, nullableBase);
        assert.equal(Buffer.byteLength(changed), Buffer.byteLength(nullableBase));
      }
      const path = join(input.run.workspace.intent.worktree, helperPath);
      chmodSync(path, 0o600); writeFileSync(path, changed);
    }
  };
  const writePaths = scenario === 'wrong-write-pair' ? [helperPath, testPath, 'lib/extra.ts'] : scope.writePaths;
  const result = await composedRun({ stateDir, project, dependencyRunId, draft: nullableDraft, requestId: 'helper', writePaths, onAdmission });
  output.push({ scenario, ...summary(result) });
  const expected = { 'wrong-write-pair': { reason: 'QUALIFICATION_SCOPE' },
    'stop-at-eligibility': { status: 'stopped', reason: 'operator_stop', admission: 'RUN_STOPPING' },
    'deadline-at-eligibility': { status: 'failed', reason: 'RUN_DEADLINE' },
    'changed-before-read': { reason: 'ADMISSION_SOURCE_CHANGED' },
    'changed-same-size-before-read': { reason: 'ADMISSION_SOURCE_CHANGED' } }[scenario];
  await zeroEffect(result, scenario, expected);
} else if (scenario === 'unsupported-base') {
  const names = list.split(',');
  const fixture = await helperProject(root, nullableBase, { stateDir: stateDirectory });
  const stateDir = fixture.workspaceIntent.stateDir;
  const project = { id: 'vanguard', repositoryPath: fixture.repositoryPath };
  let dependencyRunId;
  for (const name of names) {
    assert.ok(name in unsupportedBases, name);
    if (name === 'write-limit-comment') assert.equal(Buffer.byteLength(unsupportedBases[name]), 65_537);
    if (name === 'oversized-comment') assert.equal(Buffer.byteLength(unsupportedBases[name]), 1_048_577);
    if (name === 'deep-parentheses') assert.ok(Buffer.byteLength(unsupportedBases[name]) < 65_536);
    await commitHelper(fixture, unsupportedBases[name], `unsupported helper: ${name}`);
    dependencyRunId = await prepared(stateDir, project, `prepare-${name}`);
    const result = await composedRun({ stateDir, project, dependencyRunId, draft: nullableDraft, requestId: `helper-${name}` });
    output.push({ scenario, name, ...summary(result) });
    await zeroEffect(result, name, { reason: name === 'absent-helper' ? 'QUALIFICATION_BASE_INVALID' : 'QUALIFICATION_SCOPE_UNSUPPORTED' });
  }
  if (legacy === 'legacy') {
    // Legacy non-qualifying execution keeps its supported behavior on the same unsupported base.
    const transport = controlledTransport(helperExecutorReply(nullableDraft));
    let initialized = 0;
    const execution = createRepositoryExecution({ fixture: true, createRuntime() { initialized++; return controlledRuntime(); }, fetch: transport.fetch });
    const factory = await openFactory({ stateDir, project, workspace, execution });
    try {
      const admitted = await factory.startRun({ requestId: 'legacy', brief, dependencyRunId, scope });
      const run = await until(() => factory.inspectRun(admitted.id), r => !['admitted', 'running'].includes(r.status), 55000);
      output.push({ scenario: 'legacy-executor', status: run.status, executor: run.executor.status, initialized, requests: transport.requests.length });
      assert.equal(run.qualification, undefined);
      assert.equal(initialized, 1);
      assert.equal(run.admission.status, 'verified');
      assert.equal(run.executor.status, 'draft-produced', JSON.stringify(run.outcome));
      assert.equal(run.workItem, undefined);
    } finally { await factory.close(); }
  }
} else throw new Error(`Unknown scenario ${scenario}`);
process.stdout.write(`${JSON.stringify(output)}\n`);
