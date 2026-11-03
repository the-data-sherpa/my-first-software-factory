import { createDraftQualification } from '../../src/qualification.mjs';
import assert from 'node:assert/strict';
import { writeFile, readFile, chmod, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileSync, chmodSync } from 'node:fs';
import { openFactory } from '../../src/factory.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { createAdmissionExecution, verifyAdmissionHandoff } from '../../src/admission.mjs';
import { sourceFingerprint } from '../../src/containment-files.mjs';
import { createRunTools } from '../../src/run-tools.mjs';
import { verifyDependencyBundle } from '../../src/dependencies.mjs';
import { qualificationProject, draftHelper, draftTest, candidateTest } from '../fixtures/qualification-project.mjs';
import { controlledRuntime, controlledTransport, eventsResponse } from './model-fixtures.mjs';
import { until } from '../phase-0/helpers.mjs';

const [root, scenario] = process.argv.slice(2);
globalThis.fetch = async () => { throw new Error('Uncontrolled network forbidden'); };
const fixture = await qualificationProject(root, ['stop', 'deadline', 'drain-report', 'crash-inspect'].includes(scenario) ? 'slow' : scenario);
const stateDir = fixture.workspaceIntent.stateDir;
const project = { id: 'vanguard', repositoryPath: fixture.repositoryPath };
const workspace = { admit: admitWorkspace, prepare: prepareWorkspace };
const brief = 'Goal: normalizeAddress whitespace.\nAcceptance criteria: Preserve units and abbreviations, no stored-data backfill.\nEvidence: Independently specified address examples.';
let factory = await openFactory({ stateDir, project, workspace });
const prep = await factory.startRun({ requestId: 'prepare', brief });
await until(() => factory.inspectRun(prep.id), r => r.status === 'blocked');
await factory.prepareDependencies(prep.id, { bunPath: `${root}/bun` });
const dependencyRun = await until(() => factory.inspectRun(prep.id), r => r.dependencies?.status === 'prepared' && r.status === 'blocked');
await factory.close();
const transport = controlledTransport(() => eventsResponse());
const admission = createAdmissionExecution({ fixture: true, createRuntime: () => controlledRuntime(), fetch: transport.fetch });
const completed = Promise.withResolvers();
let retainedRun; let final; let passive; let callbackCalls = 0;
const execution = { ...admission, async start(input) {
  let run = structuredClone(input.run);
  const owner = await admission.start({ ...input, saveAdmission: state => { run.admission = state; input.saveAdmission(state); } });
  let handle;
  const finished = owner.finished.then(async result => {
    assert.equal(result.status, 'admission-only');
    const original = await verifyAdmissionHandoff(await owner.handoff(), { runId: run.id, kind: 'controlled-fixture' });
    const tools = await createRunTools({ ...input, run, dependencyBundle: await verifyDependencyBundle(dependencyRun.dependencies.intent, { workspaceIntent: run.workspace.intent }) });
    try {
      if (scenario !== 'no-change') {
        await tools.write('convex/syncHelpers.ts', scenario === 'unchanged-helper' ? draftHelper.replace(".replace(/\\s+/g, ' ').trim();", ';') : draftHelper);
        await tools.write('lib/__tests__/normalize-address.test.ts', candidateTest(scenario));
      }
      if (scenario === 'wrong-scope') await tools.write('unrelated.mjs', 'export const unrelated = true;');
      if (scenario === 'same-helper-scope') await tools.write('convex/syncHelpers.ts', `${draftHelper}export const unrelated = true;\n`);
    } finally { await tools.close(); }
    if (scenario === 'deleted-file') await unlink(join(run.workspace.intent.worktree, 'lib/__tests__/existing.test.ts'));
    if (scenario === 'mode-change') await chmod(join(run.workspace.intent.worktree, 'convex/syncHelpers.ts'), 0o700);
    if (scenario === 'hidden-change') await writeFile(join(run.workspace.intent.worktree, '.env'), 'changed synthetic fixture only');
    if (scenario === 'owner-advance') {
      await writeFile(join(fixture.repositoryPath, 'convex/syncHelpers.ts'), 'This is NOT the recorded base.');
      fixture.git('add', '.'); fixture.git('commit', '-m', 'owner main advances independently');
    }
    run.executor = { status: scenario === 'incomplete' ? 'failed' : 'draft-produced' };
    const descriptor = { version: 1, runId: run.id, kind: 'controlled-fixture', admissionBinding: original.binding,
      scope: { writePaths: ['convex/syncHelpers.ts', 'lib/__tests__/normalize-address.test.ts'] },
      draft: { sourceDigest: await sourceFingerprint(run.workspace.intent.worktree), artifactDirectory: 'executor' } };
    const qualifier = createDraftQualification({ async verifyDraft(expected) {
      callbackCalls++;
      assert.deepEqual(expected, { runId: run.id, kind: 'controlled-fixture' });
      input.budget.assertActive();
      assert.equal(await sourceFingerprint(run.workspace.intent.worktree), descriptor.draft.sourceDigest);
      if (scenario === 'fabricated') return { passed: true, reviewReady: true, model: 'done' };
      return structuredClone(descriptor);
    } });
    retainedRun = run;
    if (scenario === 'missing') await unlink(join(dependencyRun.workspace.intent.stateDir, 'runs', dependencyRun.id, 'dependencies', dependencyRun.dependencies.intent.id, 'result.json'));
    if (scenario === 'tool-limit') for (let i = 0; i < 20; i++) input.budget.settle(input.budget.reserveToolRound({ roundId: `prior:${i}` }).id, 'Controlled earlier work, not a replenished budget.');
    const cancelled = new AbortController();
    let expired = false; let scheduled = false; let fault;
    const budget = scenario === 'deadline' ? { ...input.budget, assertActive() {
      if (expired) throw Object.assign(new Error('Original deadline'), { code: 'RUN_DEADLINE' });
      input.budget.assertActive();
    } } : input.budget;
    handle = await qualifier.start({ ...input, run, dependencyRun, budget, signal: AbortSignal.any([input.signal, cancelled.signal]), saveQualification(state) {
      run.qualification = state;
      if (scenario === 'late-source' && state.checks.at(-1)?.stage === 'lint') writeFileSync(join(run.workspace.intent.worktree, 'late.mjs'), 'edit after final lint');
      if (scenario === 'stop-finalization' && state.stage === 'complete') cancelled.abort();
      if (scenario === 'candidate-stale-live' && state.stage === 'candidate-base-regression') {
        chmodSync(join(input.directory, 'qualification/candidate-base/lib/__tests__/normalize-address.test.ts'), 0o600);
        writeFileSync(join(input.directory, 'qualification/candidate-base/lib/__tests__/normalize-address.test.ts'), candidateTest('candidate-tautology'));
      }
      if (['stop', 'deadline'].includes(scenario) && state.stage === 'base-regression' && !scheduled) {
        scheduled = true;
        setTimeout(() => { expired = scenario === 'deadline'; cancelled.abort(); }, 150);
      }
      if (scenario === 'crash-inspect' && state.stage === 'base-regression' && !scheduled) {
        scheduled = true;
        writeFileSync(`${root}/inspection-input.json`, JSON.stringify({ directory: input.directory, run, dependencyRun }), { mode: 0o600 });
        setTimeout(() => process.kill(process.pid, 'SIGKILL'), 150);
      }
      if (scenario === 'drain-report' && state.stage === 'base-regression' && !scheduled) {
        scheduled = true;
        fault = import('../fixtures/qualification-drain-fault.mjs').then(m => m.refuseDrain(join(input.directory, 'qualification/base-checks'), cancelled));
        fault.catch(() => {});
      }
      if (['report-failure', 'drain-report'].includes(scenario) && state.stage === 'complete') throw new Error('Controlled report write failure');
    } });
    if (scenario === 'drain-report') {
      await assert.rejects(handle.finished, { code: 'DRAIN_FAILED' });
      await (await fault)();
      await assert.rejects(handle.close(), { code: 'DRAIN_FAILED' });
      await assert.rejects(handle.close(), { code: 'DRAIN_FAILED' });
      final = run.qualification.verdict;
      assert.equal(final.status, 'interrupted'); assert.equal(final.reason, 'DRAIN_FAILED');
      completed.resolve();
      throw Object.assign(new Error('Retain ownership'), { code: 'DRAIN_FAILED' });
    }
    if (scenario === 'report-failure') {
      await assert.rejects(handle.finished, /Controlled report/);
      await assert.rejects(handle.close(), /Controlled report/);
      // The application fixture handles a reporting error only after successful drainage.
      handle = undefined;
      final = run.qualification.verdict;
    } else { final = await handle.finished; await handle.close(); }
    assert.equal(final.reviewReady, false);
    const green = ['green', 'owner-advance', 'executable-base', 'candidate-valid-literal'].includes(scenario) || scenario.startsWith('stale-') || ['missing-new-file'].includes(scenario);
    const expected = green ? 'qualified' : { 'no-change': 'no-change', stop: 'stopped', 'stop-finalization': 'stopped', deadline: 'failed', incomplete: 'failed', 'report-failure': 'failed' }[scenario] ?? 'blocked';
    assert.equal(final.status, expected, JSON.stringify(final));
    if (scenario === 'stale-source') await writeFile(join(run.workspace.intent.worktree, 'late.mjs'), 'late');
    if (scenario === 'stale-patch') await writeFile(join(input.directory, 'qualification/patch.json'), JSON.stringify({ complete: true, changes: [] }));
    if (scenario === 'stale-test') {
      const check = run.qualification.checks.find(c => c.stage === 'draft-regression');
      await writeFile(check.receipt.replace('result.json', 'selected.test.mjs'), 'changed selection');
    }
    if (scenario === 'stale-overlay') {
      const path = join(input.directory, 'qualification/candidate-base/convex/syncHelpers.ts');
      await chmod(path, 0o600); await writeFile(path, draftHelper);
    }
    if (scenario === 'stale-report') await writeFile(run.qualification.checks[1].receipt.replace('result.json', 'report.frame'), '2\n{}\n');
    if (scenario === 'stale-candidate') {
      const path = join(input.directory, 'qualification/candidate-base/lib/__tests__/normalize-address.test.ts');
      await chmod(path, 0o600); await writeFile(path, candidateTest('candidate-tautology'));
    }
    if (scenario === 'stale-toolchain') await chmod(`${root}/bun`, 0o700);
    if (scenario === 'stale-check') await writeFile(run.qualification.checks.at(-1).receipt.replace('result.json', 'output.log'), 'different log');
    if (scenario === 'stale-profile') run.limits.toolRounds = 31;
    if (scenario === 'missing-new-file') {
      const path = join(input.directory, 'qualification/draft/lib/__tests__/normalize-address.test.ts');
      await unlink(path);
    }
    const before = callbackCalls;
    passive = await qualifier.inspect({ directory: input.directory, run, dependencyRun });
    assert.equal(callbackCalls, before, 'Inspection cannot call the trusted authority callback.');
    if (scenario.startsWith('stale-') || scenario === 'missing-new-file') assert.equal(passive.artifactStatus, 'invalid');
    if (['stop', 'deadline', 'tool-limit', 'wrong-scope', 'final-lint', 'final-vitest'].includes(scenario)) assert.equal(run.qualification.artifacts.complete, true);
    if (scenario === 'report-failure') assert.equal(final.reason, 'QUALIFICATION_PERSIST_FAILED');
    if (scenario === 'tool-limit') assert.equal(run.qualification.checks.length, 0, 'All check rounds are reserved before dispatch.');
    if (['deleted-file', 'mode-change', 'hidden-change'].includes(scenario)) {
      assert.equal(run.qualification.artifacts.complete, true);
      assert.equal(final.reason, 'QUALIFICATION_SCOPE');
      const patch = JSON.parse(await readFile(join(input.directory, 'qualification/patch.json'), 'utf8'));
      if (scenario === 'deleted-file') assert.equal(patch.changes.find(c => c.path.endsWith('existing.test.ts')).after, null);
      if (scenario === 'mode-change') assert.equal(patch.changes.find(c => c.path.endsWith('syncHelpers.ts')).after.executable, 0o100);
      if (scenario === 'hidden-change') assert.ok(patch.changes.find(c => c.path === '.env'));
    }
    if (scenario === 'incomplete') assert.equal(callbackCalls, 0);
    if (['final-no-tests', 'final-skipped'].includes(scenario)) assert.equal(final.reason, 'FINAL_VITEST_UNVERIFIED');
    if (['wrong-case', 'wrong-assertion', 'malformed', 'skipped', 'no-tests', 'crash', 'unrelated-error'].includes(scenario)) assert.equal(final.reason, 'REGRESSION_UNVERIFIED');
    if (scenario === 'candidate-stale-live') assert.equal(final.reason, 'QUALIFICATION_INVALIDATED');
    if (scenario.startsWith('candidate-') && !['candidate-valid-literal', 'candidate-stale-live'].includes(scenario)) assert.equal(final.reason, 'REGRESSION_UNVERIFIED');
    if (scenario === 'final-lint') assert.equal(final.reason, 'FINAL_LINT_FAILED');
    if (scenario === 'final-vitest') assert.equal(final.reason, 'FINAL_VITEST_FAILED');
    if (scenario === 'green') {
      assert.equal(passive.status, 'qualified'); assert.equal(passive.artifactStatus, 'verified');
      assert.equal(run.qualification.checks.length, 10);
      const stages = run.qualification.checks.map(c => c.stage);
      assert.deepEqual(stages, ['base-boundary', 'runner-probe', 'base-regression', 'candidate-base-boundary', 'candidate-base-regression',
        'draft-boundary', 'draft-regression', 'draft-candidate', 'vitest', 'lint']);
      const patch = JSON.parse(await readFile(join(input.directory, 'qualification/patch.json'), 'utf8'));
      assert.equal(patch.complete, true);
      assert.equal(Buffer.from(patch.changes.find(c => c.path.endsWith('normalize-address.test.ts')).after.contentBase64, 'base64').toString(), draftTest);
      assert.equal(patch.changes.find(c => c.path.endsWith('normalize-address.test.ts')).before, null);
      assert.equal(await readFile(join(input.directory, 'qualification/candidate-base/lib/__tests__/normalize-address.test.ts'), 'utf8'), draftTest);
      assert.equal(await readFile(join(input.directory, 'qualification/candidate-base/convex/syncHelpers.ts'), 'utf8'),
        await readFile(join(input.directory, 'qualification/base/convex/syncHelpers.ts'), 'utf8'));
      assert.equal(run.qualification.reviewReady, false);
      assert.ok(run.qualification.checks.filter(c => c.report).every(c => c.output.includes('Controlled framework banner')));
      assert.equal(run.qualification.runtime.vitest, '4.0.17');
      await assert.rejects(qualifier.start({ ...input, run, dependencyRun, saveQualification() {} }), { code: 'QUALIFICATION_EXISTS' });
      await writeFile(join(run.workspace.intent.worktree, 'late.mjs'), 'late source');
      assert.equal((await qualifier.inspect({ directory: input.directory, run, dependencyRun })).artifactStatus, 'invalid');
    }
    completed.resolve();
    return result; // Parent wiring is intentionally absent; application retains admission-only outcome.
  }).catch(error => { completed.reject(error); throw error; });
  return { ...owner, finished, async cancel() { await handle?.cancel(); await owner.cancel(); }, async close() { await handle?.close(); await owner.close(); } };
} };
try {
  factory = await openFactory({ stateDir, project, workspace, execution });
  const admitted = await factory.startRun({ requestId: 'qualification', brief, dependencyRunId: prep.id });
  await completed.promise;
  if (scenario === 'drain-report') {
    const result = await until(() => factory.inspectRun(admitted.id), r => r.status === 'interrupted');
    assert.equal(result.outcome.reason, 'drain_failed');
    await assert.rejects(factory.startRun({ requestId: 'cannot-overlap', brief, dependencyRunId: prep.id }), { code: 'RUN_ACTIVE' });
    await assert.rejects(factory.close(), { code: 'DRAIN_FAILED' });
    await assert.rejects(openFactory({ stateDir, project }), { code: 'BACKEND_OWNED' });
    await new Promise(resolve => process.stdout.write(`${JSON.stringify({ scenario, final, run: retainedRun, fenced: true })}\n`, resolve));
    process.exit(0); // The exact-owned harness must drain the intentionally surviving namespace.
  }
  const result = await until(() => factory.inspectRun(admitted.id), r => r.status === 'blocked');
  assert.equal(result.counters.modelAttempts, 1);
  assert.equal(transport.requests.length, 1);
  process.stdout.write(`${JSON.stringify({ scenario, final, passive, counters: result.counters, run: retainedRun })}\n`);
} finally { await factory.close(); }
