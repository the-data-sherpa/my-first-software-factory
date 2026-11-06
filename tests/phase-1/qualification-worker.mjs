import assert from 'node:assert/strict';
import { writeFile, readFile, chmod, unlink, cp, mkdir, symlink, realpath, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileSync, chmodSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { qualificationProject, draftHelper, draftTest, candidateTest } from '../fixtures/qualification-project.mjs';
import { controlledRuntime, controlledTransport, eventsResponse } from './model-fixtures.mjs';
import { until } from '../phase-0/helpers.mjs';

const [root, scenario] = process.argv.slice(2);
// Policy/profile scenarios run a disposable copy of the factory modules and its
// fixed quality policy, so edits never touch the repository under test.
const copied = { 'policy-live': null, 'policy-passive': null, 'module-live': null, 'module-passive': null, 'qualifier-module-passive': null,
  'composed-modules': ["'../docs/agents/change-quality.md',", "'../docs/agents/change-quality.md', 'qualification.mjs', 'qualification-selection.mjs',"],
  'composed-missing': ["'../docs/agents/change-quality.md',", "'../docs/agents/change-quality.md', 'qualified-execution.mjs',"],
  'profile-traversal': ["'../docs/agents/change-quality.md',", "'../docs/agents/change-quality.md', '../package.json',"],
  'profile-policy-absent': ["'../docs/agents/change-quality.md', ", ""] };
const factoryRoot = join(root, 'factory');
let modules = new URL('../../src/', import.meta.url);
if (Object.hasOwn(copied, scenario)) {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  await cp(join(repository, 'src'), join(factoryRoot, 'src'), { recursive: true });
  await mkdir(join(factoryRoot, 'docs/agents'), { recursive: true });
  await cp(join(repository, 'docs/agents/change-quality.md'), join(factoryRoot, 'docs/agents/change-quality.md'));
  await cp(join(repository, 'package.json'), join(factoryRoot, 'package.json'));
  await symlink(await realpath(join(repository, 'node_modules')), join(factoryRoot, 'node_modules'));
  if (copied[scenario]) {
    const path = join(factoryRoot, 'src/admission.mjs');
    const [from, to] = copied[scenario];
    const source = await readFile(path, 'utf8');
    assert.ok(source.includes(from), 'Admission profile fixture anchor changed.');
    await writeFile(path, source.replace(from, to));
  }
  modules = new URL(`file://${factoryRoot}/src/`);
}
const load = name => import(new URL(name, modules).href);
const { createDraftQualification } = await load('qualification.mjs');
const { openFactory } = await load('factory.mjs');
const { admitWorkspace, prepareWorkspace } = await load('workspace.mjs');
const { createAdmissionExecution, verifyAdmissionHandoff } = await load('admission.mjs');
const { sourceFingerprint } = await load('containment-files.mjs');
const { createRunTools } = await load('run-tools.mjs');
const { verifyDependencyBundle } = await load('dependencies.mjs');
const policyPath = join(factoryRoot, 'docs/agents/change-quality.md');
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
        await tools.write('convex/syncHelpers.ts', scenario === 'unchanged-helper' ? draftHelper.replace(".replace(/\\s+/g, ' ').trim();", ';')
          // Stream E probe: mutating shared Object.is made toBe pass for an unchanged address.
          : scenario === 'object-is-gaming' ? 'export function normalizeAddress(address) {\n  Object.is = () => true; return address;\n}\n'
          : scenario === 'helper-unsupported' ? draftHelper.replace(".trim();", ".replace(/x/g, () => '').trim();")
          : ['helper-comment-2028', 'helper-comment-2029', 'helper-comment-cr'].includes(scenario)
            ? draftHelper.replace('{\n', `{\n  // An ECMAScript line terminator${String.fromCharCode(scenario.endsWith('2028') ? 0x2028 : scenario.endsWith('2029') ? 0x2029 : 0x0d)}Object.is = () => true;\n`)
            : draftHelper);
        await tools.write('lib/__tests__/normalize-address.test.ts', candidateTest(scenario));
      }
      if (scenario === 'wrong-scope') await tools.write('unrelated.mjs', 'export const unrelated = true;');
      if (scenario === 'same-helper-scope') await tools.write('convex/syncHelpers.ts', `${draftHelper}export const unrelated = true;\n`);
    } finally { await tools.close(); }
    if (scenario === 'composed-missing') await unlink(join(factoryRoot, 'src/qualified-execution.mjs'));
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
      if (state.stage === 'candidate-base-regression' && scenario === 'policy-live') appendFileSync(policyPath, '\nControlled policy edit.\n');
      if (state.stage === 'candidate-base-regression' && scenario === 'module-live') appendFileSync(join(factoryRoot, 'src/executor.mjs'), '\n// Controlled module edit.\n');
      if (scenario === 'late-source' && state.checks.at(-1)?.stage === 'lint') writeFileSync(join(run.workspace.intent.worktree, 'late.mjs'), 'edit after final lint');
      if (scenario === 'stop-finalization' && state.stage === 'complete') cancelled.abort();
      if (scenario === 'stop-capture' && state.stage === 'capture') cancelled.abort();
      if (scenario === 'stop-during-capture' && state.stage === 'capture' && !scheduled) { scheduled = true; setTimeout(() => cancelled.abort(), 0); }
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
      if (scenario === 'async-save') return Promise.reject(new Error('Controlled asynchronous projection'));
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
    if (['report-failure', 'async-save'].includes(scenario)) {
      await assert.rejects(handle.finished, scenario === 'async-save' ? { code: 'QUALIFICATION_PERSIST_FAILED' } : /Controlled report/);
      // Drainage succeeded, so close/cancel confirm it; only drain failures reject there.
      await handle.close(); await handle.cancel();
      final = run.qualification.verdict;
    } else { final = await handle.finished; await handle.close(); }
    assert.equal(final.reviewReady, false);
    // Qualifies only when the executed final-suite argv pins --pool=forks over the repository's threads config.
    const pinnedPool = scenario === 'final-pool-threads' && /"cliPool":"forks"/.test(run.qualification.checks.find(c => c.stage === 'vitest')?.output ?? '');
    const green = ['final-pool-threads', 'forged-state', 'green', 'owner-advance', 'executable-base', 'candidate-valid-literal'].includes(scenario) || scenario.startsWith('stale-')
      || ['missing-new-file', 'policy-passive', 'module-passive', 'qualifier-module-passive', 'composed-modules'].includes(scenario);
    const expected = green ? 'qualified' : { 'no-change': 'no-change', stop: 'stopped', 'stop-finalization': 'stopped', 'stop-capture': 'stopped', 'stop-during-capture': 'stopped', deadline: 'failed', incomplete: 'failed', 'report-failure': 'failed', 'async-save': 'failed' }[scenario] ?? 'blocked';
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
    if (scenario === 'policy-passive') await appendFile(policyPath, '\nControlled policy edit.\n');
    if (scenario === 'module-passive') await appendFile(join(factoryRoot, 'src/executor.mjs'), '\n// Controlled module edit.\n');
    if (scenario === 'qualifier-module-passive') await appendFile(join(factoryRoot, 'src/qualification-scope.mjs'), '\n// Controlled module edit.\n');
    if (scenario === 'forged-state') {
      // Matching persisted state and verdict, but none of the evidence behind it.
      const { descriptor, capture, checks, runtime, implementation, ...rest } = run.qualification;
      const forged = { ...rest, checks: [] };
      const path = join(input.directory, 'qualification/state.json');
      await chmod(path, 0o600); await writeFile(path, JSON.stringify(forged));
      run.qualification = forged;
    }
    if (scenario === 'missing-new-file') {
      const path = join(input.directory, 'qualification/draft/lib/__tests__/normalize-address.test.ts');
      await unlink(path);
    }
    const before = callbackCalls;
    passive = await qualifier.inspect({ directory: input.directory, run, dependencyRun });
    assert.equal(callbackCalls, before, 'Inspection cannot call the trusted authority callback.');
    if (scenario.startsWith('stale-') || ['forged-state', 'missing-new-file', 'policy-passive', 'module-passive', 'qualifier-module-passive'].includes(scenario)) {
      assert.equal(passive.artifactStatus, 'invalid');
      assert.equal(passive.status, 'blocked'); assert.equal(passive.recordedStatus, 'qualified'); assert.equal(passive.reviewReady, false);
    }
    if (['policy-live', 'module-live', 'composed-missing', 'profile-traversal', 'profile-policy-absent'].includes(scenario)) {
      assert.equal(final.reason, 'QUALIFICATION_INVALIDATED');
      assert.equal(passive.artifactStatus, 'invalid');
    }
    if (scenario === 'profile-traversal') assert.ok(Object.hasOwn(run.qualification.descriptor.admissionBinding.executionProfile.implementation, '../package.json'));
    if (scenario === 'composed-modules') {
      assert.equal(passive.status, 'qualified'); assert.equal(passive.artifactStatus, 'verified');
      assert.ok(Object.hasOwn(run.qualification.descriptor.admissionBinding.executionProfile.implementation, 'qualification.mjs'));
    }
    if (['stop', 'deadline', 'tool-limit', 'wrong-scope', 'final-lint', 'final-vitest'].includes(scenario)) assert.equal(run.qualification.artifacts.complete, true);
    if (['report-failure', 'async-save'].includes(scenario)) assert.equal(final.reason, 'QUALIFICATION_PERSIST_FAILED');
    if (scenario === 'object-is-gaming' || scenario === 'helper-unsupported') {
      assert.equal(final.reason, 'QUALIFICATION_SCOPE_UNSUPPORTED');
      assert.equal(passive.status, 'blocked'); assert.equal(passive.reviewReady, false);
    }
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
    if (['object-is-gaming', 'helper-unsupported', 'helper-comment-2028', 'helper-comment-2029', 'helper-comment-cr'].includes(scenario)) {
      assert.equal(final.reason, 'QUALIFICATION_SCOPE_UNSUPPORTED');
    }
    if (['final-no-tests', 'final-skipped'].includes(scenario)) assert.equal(final.reason, 'FINAL_VITEST_UNVERIFIED');
    if (['wrong-case', 'wrong-assertion', 'malformed', 'skipped', 'no-tests', 'crash', 'unrelated-error'].includes(scenario)) assert.equal(final.reason, 'REGRESSION_UNVERIFIED');
    if (scenario === 'candidate-stale-live') assert.equal(final.reason, 'QUALIFICATION_INVALIDATED');
    if (scenario.startsWith('candidate-') && !['candidate-valid-literal', 'candidate-stale-live'].includes(scenario)) assert.equal(final.reason, 'REGRESSION_UNVERIFIED');
    if (scenario === 'final-lint') assert.equal(final.reason, 'FINAL_LINT_FAILED');
    if (scenario === 'final-vitest') assert.equal(final.reason, 'FINAL_VITEST_FAILED');
    if (['runner-worker-count', 'runner-file-parallelism', 'runner-pool-threads'].includes(scenario)) assert.equal(final.reason, 'REGRESSION_UNVERIFIED');
    if (scenario === 'final-pool-threads') assert.equal(pinnedPool, true, 'The integrated command must override a repository threads pool with forks.');
    if (['stop-capture', 'stop-during-capture'].includes(scenario)) assert.equal(final.reason, 'RUN_STOPPING');
    if (['green', 'final-pool-threads'].includes(scenario) && final.status === 'qualified') assert.equal(run.qualification.runtime.pool, 'forks');
    if (['green', 'candidate-valid-literal'].includes(scenario)) {
      assert.equal(run.qualification.runtime.maxWorkers, 1);
      assert.equal(run.qualification.runtime.fileParallelism, false);
    }
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
    // A failed drain settles nothing: rounds stay uncertain for reconciliation.
    assert.ok(result.reservations.some(r => r.roundId?.startsWith('qualification:') && r.state === 'uncertain'));
    await assert.rejects(factory.startRun({ requestId: 'cannot-overlap', brief, dependencyRunId: prep.id }), { code: 'RUN_ACTIVE' });
    await assert.rejects(factory.close(), { code: 'DRAIN_FAILED' });
    await assert.rejects(openFactory({ stateDir, project }), { code: 'BACKEND_OWNED' });
    await new Promise(resolve => process.stdout.write(`${JSON.stringify({ scenario, final, run: retainedRun, fenced: true })}\n`, resolve));
    process.exit(0); // The exact-owned harness must drain the intentionally surviving namespace.
  }
  const result = await until(() => factory.inspectRun(admitted.id), r => r.status === 'blocked');
  assert.equal(result.counters.modelAttempts, 1);
  assert.equal(transport.requests.length, 1);
  // Accounting: every reservation stays counted; never-dispatched stages are
  // settled with bounded evidence only, and settled rounds keep their receipts.
  const rounds = result.reservations.filter(r => r.roundId?.startsWith('qualification:'));
  assert.equal(result.counters.toolRounds, result.reservations.filter(r => r.kind === 'tool-round').length);
  const executed = new Set(retainedRun.qualification.checks.map(c => c.stage));
  const notDispatched = rounds.filter(r => r.state === 'settled' && JSON.parse(r.evidence).dispatched === false);
  for (const round of notDispatched) assert.ok(!executed.has(round.roundId.slice('qualification:'.length)), round.roundId);
  for (const round of rounds.filter(r => r.state === 'uncertain')) {
    // Only an entered operation without a receipt may remain uncertain.
    // candidate-stale-live: containment entered the check and rejected the tampered
    // overlay without a receipt, which the qualifier cannot prove was never launched.
    assert.ok(['stop', 'deadline'].includes(scenario) || (scenario === 'stop-during-capture' && round.roundId === 'qualification:capture')
      || (scenario === 'candidate-stale-live' && round.roundId === 'qualification:candidate-base-regression'), `${scenario}: ${round.roundId}`);
  }
  if (['green', 'composed-modules'].includes(scenario)) {
    assert.equal(rounds.length, 11); assert.equal(notDispatched.length, 0);
    assert.ok(rounds.every(r => r.state === 'settled'));
  }
  if (scenario === 'candidate-tautology') {
    assert.equal(rounds.length, 11); assert.ok(rounds.every(r => r.state === 'settled'));
    assert.deepEqual(notDispatched.map(r => r.roundId), ['draft-boundary', 'draft-regression', 'draft-candidate', 'vitest', 'lint'].map(n => `qualification:${n}`));
    assert.equal(JSON.parse(notDispatched[0].evidence).reason, 'REGRESSION_UNVERIFIED');
  }
  if (scenario === 'stop-capture') assert.deepEqual(rounds.map(r => [r.roundId, r.state, JSON.parse(r.evidence).dispatched]), [['qualification:capture', 'settled', false]]);
  if (scenario === 'tool-limit') assert.ok(rounds.filter(r => r.roundId !== 'qualification:capture').every(r => r.state === 'settled' && JSON.parse(r.evidence).dispatched === false));
  process.stdout.write(`${JSON.stringify({ scenario, final, passive, counters: result.counters, reservations: result.reservations, run: retainedRun })}\n`);
} finally { await factory.close(); }
