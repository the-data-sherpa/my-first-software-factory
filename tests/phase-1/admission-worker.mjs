import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, chmod, readdir, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openFactory, inspectHistory } from '../../src/factory.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { dependencyFixture } from '../../src/dependencies-diagnostics.mjs';
import { createAdmissionExecution, verifyAdmissionHandoff } from '../../src/admission.mjs';
import { serveFactory } from '../../src/control-server.mjs';
import { inspectContainedChecks } from '../../src/containment.mjs';
import { controlledRuntime, controlledTransport, eventsResponse } from './model-fixtures.mjs';
import { until } from '../phase-0/helpers.mjs';
import { vitestBaselineCli } from '../fixtures/vitest-baseline-cli.mjs';
import { baseHelper } from '../fixtures/qualification-project.mjs';

const [root, requested = 'success'] = process.argv.slice(2);
const cli = requested.startsWith('cli-');
const scenario = requested.replace(/^cli-/, '');
const exec = promisify(execFile);
const executable = fileURLToPath(new URL('../../bin/factory.mjs', import.meta.url));
globalThis.fetch = async () => { throw new Error('Uncontrolled network forbidden'); };
const fixture = await dependencyFixture(root, { copyToolchain: true, checkSuffix: `${vitestBaselineCli}
if (${JSON.stringify(scenario)} === 'vitest' && process.argv.includes('run')) process.exitCode = 7;
if (${JSON.stringify(scenario)} === 'lint' && process.argv.includes('--no-cache')) process.exitCode = 8;
if (['between-checks','stop-check','deadline-check','shutdown-check','crash'].includes(${JSON.stringify(scenario)})) await new Promise(r => setTimeout(r, 1500));
` });
const stateDir = fixture.workspaceIntent.stateDir;
const project = { id: 'vanguard', repositoryPath: fixture.repositoryPath };
if (scenario === 'qualified-profile') {
  // A composed run's admitted base contains the selected helper, which its early eligibility gate parses.
  await mkdir(join(fixture.repositoryPath, 'convex'), { mode: 0o700 });
  await writeFile(join(fixture.repositoryPath, 'convex/syncHelpers.ts'), baseHelper);
  fixture.git('add', '.'); fixture.git('commit', '-m', 'selected helper for the composed profile');
}
if (scenario === 'hidden-source') {
  await mkdir(join(fixture.repositoryPath, 'config'), { mode: 0o700 });
  await writeFile(join(fixture.repositoryPath, 'config', '.env'), 'synthetic excluded fixture');
  fixture.git('add', '.'); fixture.git('commit', '-m', 'committed directory with excluded input');
}
const workspace = { admit: admitWorkspace, async prepare(intent, options) {
  const receipt = await prepareWorkspace(intent, options);
  if (scenario === 'initial-source' && intent.runId !== preparingId) await writeFile(join(intent.worktree, 'unexpected.mjs'), 'changed');
  return receipt;
} };
const brief = 'Goal: Controlled admission only.\nAcceptance criteria: Healthy baseline gates without agent work.\nEvidence: Disposable packages.';
let preparingId;
let factory = await openFactory({ stateDir, project, workspace: { admit: admitWorkspace, prepare: prepareWorkspace } });
let server;
async function startServer(mode) { if (cli) server = await serveFactory({ factory, mode, fixture: true }); }
async function command(...args) {
  try {
    const { stdout } = await exec(process.execPath, [executable, ...args, '--state-dir', stateDir], {
      env: { PATH: '/usr/bin', HOME: root }, timeout: 15000, maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) { if (error.stderr?.trim().startsWith('{')) Object.assign(error, JSON.parse(error.stderr).error); throw error; }
}
const start = (requestId, dependencyRunId) => cli ? command('start', '--request-id', requestId, '--brief-text', brief,
  ...(dependencyRunId ? ['--dependency-run', dependencyRunId] : [])) : factory.startRun({ requestId, brief, dependencyRunId });
const inspect = id => cli ? command('inspect', id) : factory.inspectRun(id);
const stop = id => cli ? command('stop', id) : factory.stopRun(id);
const terminal = id => until(() => inspect(id), r => !['admitted', 'running'].includes(r.status), 20000);
async function close() { if (server) { const owned = server; server = undefined; await owned.close(); } else await factory.close(); }
try {
  await startServer('production-blocked');
  const source = await start('preparation'); preparingId = source.id;
  await until(() => inspect(source.id), r => r.status === 'blocked');
  if (cli) await command('prepare-dependencies', source.id, '--bun-path', `${root}/bun`);
  else await factory.prepareDependencies(source.id, { bunPath: `${root}/bun` });
  const prepared = await until(() => inspect(source.id), r => r.dependencies?.status === 'prepared' && r.status === 'blocked');
  await close();
  if (scenario === 'stale') await writeFile(join(prepared.workspace.receipt.worktree, 'package.json'), 'changed');
  if (scenario === 'foreign-source') { await writeFile(join(fixture.repositoryPath, 'new.mjs'), 'new base'); fixture.git('add', '.'); fixture.git('commit', '-m', 'different source'); }
  let currentId;
  let initializations = 0;
  let now = 1000;
  let deadline;
  const useClock = scenario.startsWith('deadline-');
  const clock = useClock ? { now: () => now, setTimeout: (callback, ms) => {
    if (ms === 1200000) { deadline = callback; return undefined; }
    return setTimeout(callback, ms);
  }, clearTimeout } : undefined;
  const drainage = Promise.withResolvers();
  let drainEntered = false;
  const transport = controlledTransport(async () => {
    if (['model-drain', 'model-drain-report'].includes(scenario)) return new Response(new ReadableStream({ cancel() { throw new Error('Controlled drain refusal'); } }), { headers: { 'content-type': 'text/event-stream' } });
    if (scenario === 'stop-draining') {
      const data = new TextEncoder().encode(await eventsResponse().text());
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(data); }, cancel() { drainEntered = true; return drainage.promise; } }), { headers: { 'content-type': 'text/event-stream' } });
    }
    if (scenario === 'refusal') return new Response('controlled refusal', { status: 401 });
    if (scenario === 'smoke-source') await writeFile(join((await factory.inspectRun(currentId)).workspace.receipt.worktree, 'new.mjs'), 'changed after dispatch');
    if (['stop-model', 'deadline-model', 'shutdown-model'].includes(scenario)) return new Response(new ReadableStream({ start() {}, cancel() {} }), { headers: { 'content-type': 'text/event-stream' } });
    return eventsResponse();
  });
  const execution = createAdmissionExecution({ fixture: true, clock, createRuntime: async options => {
    initializations++;
    const run = await factory.inspectRun(currentId);
    assert.equal(run.admission.stage, 'model-preflight');
    assert.equal(run.admission.baselines.length, 0);
    assert.equal(run.admission.containment.passed, true);
    assert.equal(run.capabilities.repositoryTools, false);
    if (scenario === 'profile') await chmod(`${root}/bun`, 0o700);
    if (scenario === 'stop-initialize') await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    return controlledRuntime();
  }, fetch: transport.fetch });
  let handoffEvidence;
  const wrapped = ['handoff', 'before-handoff', 'profile-handoff'].includes(scenario) ? { ...execution, async start(input) {
    const handle = await execution.start(input);
    assert.equal(handle.read, undefined); assert.equal(handle.write, undefined); assert.equal(handle.check, undefined);
    return { ...handle, finished: handle.finished.then(async receipt => {
      assert.equal(receipt.status, 'admission-only');
      if (scenario === 'before-handoff') {
        await writeFile(join(input.run.workspace.receipt.worktree, 'late.mjs'), 'late edit');
        await assert.rejects(handle.handoff(), { code: 'ADMISSION_SOURCE_CHANGED' });
        return { ...receipt, status: 'admission-blocked', reason: 'ADMISSION_INVALIDATED' };
      }
      const token = await handle.handoff();
      const identity = { runId: input.run.id, kind: 'controlled-fixture' };
      handoffEvidence = await verifyAdmissionHandoff(token, identity);
      await assert.rejects(verifyAdmissionHandoff(token, { runId: input.run.id }), { code: 'ADMISSION_AUTHORITY_REQUIRED' });
      await assert.rejects(verifyAdmissionHandoff(token, { ...identity, runId: source.id }), { code: 'ADMISSION_AUTHORITY_REQUIRED' });
      await assert.rejects(verifyAdmissionHandoff(JSON.parse(JSON.stringify(token)), identity), { code: 'ADMISSION_AUTHORITY_REQUIRED' });
      if (scenario === 'profile-handoff') await chmod(`${root}/bun`, 0o700);
      else await writeFile(join(input.run.workspace.receipt.worktree, 'late.mjs'), 'late edit');
      await assert.rejects(verifyAdmissionHandoff(token, identity));
      await assert.rejects(handle.handoff(), { code: 'ADMISSION_AUTHORITY_REQUIRED' });
      return { ...receipt, status: 'admission-blocked', reason: 'ADMISSION_INVALIDATED' };
    }) };
  } } : execution;
  const qualifiedFiles = ['qualified-execution.mjs', 'qualification.mjs', 'qualification-artifacts.mjs', 'qualification-source.mjs',
    'qualification-selection.mjs', 'qualification-scope.mjs', 'qualification-reporting.mjs', 'qualification-reporter.mjs',
    'work-items.mjs', 'factory.mjs', 'execution.mjs', 'storage.mjs', 'workspace.mjs', 'workspace-git.mjs',
    'containment-lifetime.mjs', 'containment-entry.mjs', 'containment-host-probes.mjs', 'containment-test-profile.mjs'];
  const assertDependencyImplementation = async binding => {
    for (const name of ['dependencies-cache.mjs', 'dependencies-graph.mjs']) {
      assert.equal(binding.executionProfile.implementation[name], createHash('sha256')
        .update(await readFile(new URL(`../../src/${name}`, import.meta.url))).digest('hex'), name);
    }
  };
  const composedModule = await readFile(new URL('../../src/qualified-execution.mjs', import.meta.url)).then(() => true, () => false);
  let composedStates = [];
  const bounded = ['tool-limit', 'model-limit', 'model-drain-report', 'qualified-profile'].includes(scenario) ? { ...wrapped, async start(input) {
    // Stands in for the application's opted-in composed run record; the profile alone is under test here.
    if (scenario === 'qualified-profile') return wrapped.start({ ...input,
      run: { ...input.run, qualification: { version: 1, runId: input.run.id, kind: 'controlled-fixture', status: 'pending', reviewReady: false },
        executor: { scope: { writePaths: ['convex/syncHelpers.ts', 'lib/__tests__/normalize-address.test.ts'] } } },
      saveAdmission: state => { composedStates.push(structuredClone(state)); input.saveAdmission(state); } });
    if (scenario === 'tool-limit') for (let i = 0; i < 28; i++) input.budget.settle(input.budget.reserveToolRound({ roundId: `prior:${i}` }).id, 'Controlled prior round in the original run.');
    if (scenario === 'model-limit') for (let i = 0; i < 40; i++) input.budget.settle(input.budget.reserveModelAttempt({ generationId: `prior:${i}` }).id, 'Controlled prior model allowance in the original run.');
    return wrapped.start({ ...input, saveAdmission: state => {
      if (scenario === 'model-drain-report' && state.failure?.code === 'MODEL_DRAIN_FAILED') throw new Error('Controlled report persistence failure');
      input.saveAdmission(state);
    } });
  } } : wrapped;
  factory = await openFactory({ stateDir, project, workspace, execution: bounded, ...(clock ? { clock } : {}) });
  await startServer('admission-only');
  assert.equal(initializations, 0);
  if (scenario === 'selection') {
    await assert.rejects(start('no-selection'), { code: 'DEPENDENCY_SELECTION_REQUIRED' });
    assert.equal(initializations, 0);
    assert.equal((await factory.listRuns()).length, 1);
    await assert.rejects(verifyAdmissionHandoff({ passed: true }, { runId: source.id }), { code: 'ADMISSION_AUTHORITY_REQUIRED' });
    process.stdout.write(`${JSON.stringify({ scenario, initializations })}\n`);
  } else {
    const selected = scenario === 'missing' ? 'run_00000000-0000-0000-0000-000000000000' : source.id;
    const admitted = await start('admission', selected); currentId = admitted.id;
    assert.equal(admitted.admission.dependencyRunId, selected);
    assert.equal((await start('admission', selected)).id, admitted.id);
    await assert.rejects(start('admission', 'run_00000000-0000-0000-0000-000000000001'), { code: 'REQUEST_CONFLICT' });
    if (['between-checks', 'stop-check', 'deadline-check', 'shutdown-check', 'crash'].includes(scenario)) {
      await until(() => inspect(admitted.id), r => r.admission?.stage === (scenario === 'between-checks' ? 'lint' : 'vitest'), 15000);
      if (scenario === 'between-checks') await writeFile(join((await inspect(admitted.id)).workspace.receipt.worktree, 'changed.mjs'), 'between checks');
      if (scenario === 'crash') {
        process.stdout.write(`${JSON.stringify({ admitted, stateDir, project })}\n`);
        process.kill(process.pid, 'SIGKILL'); await new Promise(() => {});
      }
    }
    if (['stop-model', 'deadline-model', 'shutdown-model'].includes(scenario)) await until(async () => transport.requests.length, n => n === 1);
    if (scenario === 'stop-initialize') await until(async () => initializations, n => n === 1);
    if (['model-drain', 'model-drain-report'].includes(scenario)) {
      await until(async () => transport.requests.length, n => n === 1);
      await assert.rejects(stop(admitted.id), { code: 'DRAIN_FAILED' });
      const fenced = await inspect(admitted.id);
      assert.equal(fenced.status, 'interrupted'); assert.equal(fenced.outcome.reason, 'drain_failed');
      assert.equal(fenced.admission.baselines.length, 0);
      await assert.rejects(start('cannot-overlap', selected), { code: 'RUN_ACTIVE' });
      await assert.rejects(factory.close(), { code: 'DRAIN_FAILED' });
      await assert.rejects(openFactory({ stateDir, project }), { code: 'BACKEND_OWNED' });
      await new Promise(resolve => process.stdout.write(`${JSON.stringify({ scenario, result: fenced, requests: transport.requests.length })}\n`, resolve));
      process.exit(0); // Only this fixture process dies; harness drains the exact owned scope.
    }
    if (scenario === 'stop-draining') {
      await until(() => inspect(admitted.id), r => r.reservations.some(item => item.accounting?.usage));
      const stopping = stop(admitted.id);
      await until(async () => drainEntered, Boolean);
      await assert.rejects(start('cannot-overlap-drain', selected), { code: 'RUN_ACTIVE' });
      drainage.resolve(); await stopping;
    } else if (scenario.startsWith('stop-')) await stop(admitted.id);
    if (scenario.startsWith('deadline-')) { now = admitted.deadlineAt; deadline(); }
    let result;
    if (scenario.startsWith('shutdown-')) { await close(); result = await inspectHistory({ stateDir, runId: admitted.id }); }
    else result = await terminal(admitted.id);
    assert.equal(result.outcome.reviewReady, false);
    assert.equal(result.capabilities.repositoryTools, false);
    assert.equal(result.capabilities.productionModel, false); // Controlled transport is never an enabled owner adapter.
    assert.equal(result.deadlineAt, admitted.deadlineAt);
    if (['success', 'passive-profile', 'hidden-source'].includes(scenario)) {
      assert.equal(result.status, 'blocked');
      assert.equal(result.outcome.reason, 'EXECUTOR_NOT_IMPLEMENTED');
      assert.equal(result.admission.readiness, 'baseline-healthy');
      assert.equal(result.admission.kind, 'controlled-fixture');
      assert.equal(result.counters.modelAttempts, 1);
      assert.equal(result.counters.toolRounds, 3);
      assert.deepEqual(result.admission.baselines.map(r => [r.name, r.passed]), [['vitest', true], ['lint', true]]);
      assert.equal(new Set(result.admission.baselines.map(r => r.sourceDigest)).size, 1);
      assert.equal(new Set(result.admission.baselines.map(r => r.bindingDigest)).size, 1);
      const outputs = result.admission.baselines.map(r => r.output.trim().split('\n').map(line => JSON.parse(line)));
      assert.deepEqual(outputs.map(([first]) => first.argv), [['run', '--maxWorkers=2', '--no-file-parallelism'], ['.', '--no-cache']]);
      // The executed consumer accepted every option and resolved serial files within the two-worker ceiling.
      assert.deepEqual(outputs[0][1], { vitestCli: { resolved: { watch: false, fileParallelism: false, maxWorkers: 1 } } });
      assert.equal(outputs[1].length, 1);
      for (const name of qualifiedFiles) assert.equal(name in result.admission.binding.executionProfile.implementation, false, name);
      await assertDependencyImplementation(result.admission.binding);
      assert.ok(result.admission.baselines[0].finishedAt <= result.admission.baselines[1].startedAt);
      assert.equal(result.admission.containment.probe.readOnlyBundle, true);
      assert.equal(transport.requests[0].payload.tools?.length ?? 0, 0);
      assert.equal(transport.requests.length, 1);
      assert.equal(initializations, 1);
      assert.deepEqual((await inspect(prepared.id)).counters, prepared.counters);
      assert.equal((await start('admission', selected)).id, result.id);
      if (scenario === 'passive-profile') await chmod(`${root}/bun`, 0o700);
      else await writeFile(join(result.workspace.receipt.worktree, 'late-passive.mjs'), 'invalidates evidence');
      const stale = await inspect(result.id);
      assert.equal(stale.admission.readiness, 'invalidated');
      assert.equal(transport.requests.length, 1);
    } else if (scenario === 'qualified-profile') {
      const bound = composedStates.findLast(state => state.binding)?.binding;
      if (composedModule) {
        await assertDependencyImplementation(bound);
        // Composed runs bind the qualified execution and qualifier modules in addition to the legacy profile.
        for (const name of qualifiedFiles) {
          assert.equal(bound.executionProfile.implementation[name], createHash('sha256').update(await readFile(new URL(`../../src/${name}`, import.meta.url))).digest('hex'), name);
        }
        assert.deepEqual(composedStates.at(-1).baselines.map(r => [r.name, r.passed]), [['vitest', true], ['lint', true]]);
        assert.equal(composedStates.at(-1).readiness, 'baseline-healthy');
      } else {
        // Without the composed module the profile cannot be computed: block before any gate effect.
        assert.equal(bound, undefined);
        assert.equal(result.status, 'blocked'); assert.equal(result.outcome.reason, 'ADMISSION_FAILED');
        assert.equal(result.admission.baselines.length, 0); assert.equal(initializations, 0); assert.equal(transport.requests.length, 0);
      }
    } else if (scenario.startsWith('stop-') || scenario.startsWith('shutdown-')) {
      assert.equal(result.status, 'stopped');
      assert.equal(result.admission.readiness === 'baseline-healthy', false);
    } else if (scenario.startsWith('deadline-')) {
      assert.equal(result.status, 'failed'); assert.equal(result.outcome.reason, 'RUN_DEADLINE');
      assert.equal(result.counters.modelAttempts <= 1, true);
    } else {
      assert.equal(result.status, 'blocked');
      const codes = { refusal: 'MODEL_AUTH_REJECTED', missing: 'DEPENDENCIES_MISSING', stale: 'DEPENDENCIES_STALE',
        'foreign-source': 'DEPENDENCIES_STALE', vitest: 'BASELINE_VITEST_FAILED', lint: 'BASELINE_LINT_FAILED',
        'initial-source': 'ADMISSION_SOURCE_CHANGED', 'smoke-source': 'ADMISSION_SOURCE_CHANGED', profile: 'DEPENDENCIES_STALE',
        'between-checks': 'ADMISSION_SOURCE_CHANGED', 'tool-limit': 'TOOL_ROUND_LIMIT', 'model-limit': 'MODEL_ATTEMPT_LIMIT', handoff: 'ADMISSION_INVALIDATED', 'before-handoff': 'ADMISSION_INVALIDATED', 'profile-handoff': 'ADMISSION_INVALIDATED' };
      assert.equal(result.outcome.reason, codes[scenario]);
      assert.equal(result.admission.readiness === 'baseline-healthy', false);
      if (['missing', 'stale', 'foreign-source', 'initial-source'].includes(scenario)) assert.equal(initializations, 0);
      if (['refusal', 'missing', 'stale', 'foreign-source', 'initial-source', 'smoke-source', 'profile'].includes(scenario)) assert.equal(result.admission.baselines.length, 0);
      if (scenario === 'vitest') assert.deepEqual(result.admission.baselines.map(r => [r.name, r.passed]), [['vitest', false]]);
      if (scenario === 'lint') assert.deepEqual(result.admission.baselines.map(r => [r.name, r.passed]), [['vitest', true], ['lint', false]]);
    }
    const checks = await readdir(join(stateDir, 'runs', result.id)).then(names => names.includes('checks') ? inspectContainedChecks(join(stateDir, 'runs', result.id, 'checks')) : []);
    if (scenario === 'refusal') assert.deepEqual(checks.map(r => r.name), ['boundary']);
    if (scenario === 'stop-initialize') assert.equal(transport.requests.length, 0);
    if (scenario === 'tool-limit') { assert.equal(result.counters.toolRounds, 30); assert.equal(result.admission.baselines.length, 1); }
    if (scenario === 'model-limit') { assert.equal(result.counters.modelAttempts, 40); assert.equal(transport.requests.length, 0); assert.equal(result.admission.baselines.length, 0); }
    await close();
    const reopened = await openFactory({ stateDir, project, execution: createAdmissionExecution({ fixture: true, fetch: transport.fetch, createRuntime: () => { throw new Error('Passive initialization'); } }), workspace });
    factory = reopened;
    const passive = await factory.inspectRun(result.id);
    assert.equal(passive.counters.modelAttempts, result.counters.modelAttempts);
    assert.equal(passive.deadlineAt, result.deadlineAt);
    assert.equal((await factory.startRun({ requestId: 'admission', brief, dependencyRunId: selected })).id, result.id);
    assert.equal(initializations <= 1, true);
    process.stdout.write(`${JSON.stringify({ scenario, root, result, checks, requests: transport.requests.length, initializations, handoffEvidence, ...(scenario === 'qualified-profile' ? { composedModule } : {}) })}\n`);
  }
} finally { await close(); }
