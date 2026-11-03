import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { openFactory, inspectHistory, backupFactory, restoreFactory } from '../../src/factory.mjs';
import { createFixtureExecution } from '../../src/execution.mjs';
import { admitWorkspace, prepareWorkspace, inspectWorkspace } from '../../src/workspace.mjs';
import { fixture, git } from './workspace-fixture.mjs';
import { until } from '../phase-0/helpers.mjs';

const brief = 'Goal: Retain exact source.\nAcceptance criteria: Leave the owner checkout unchanged.\nEvidence: Disposable Git repository.';
const workspace = { admit: admitWorkspace, prepare: prepareWorkspace, inspect: inspectWorkspace };

async function setup(t, options = {}) {
  const cleanups = [];
  // Register cleanup before the disposable repository's removal hook.
  t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });
  const f = await fixture(t);
  const factory = await openFactory({ stateDir: f.stateDir, project: f.project, workspace, ...options });
  cleanups.push(() => factory.close());
  return { ...f, factory, cleanups };
}

test('application persists source intent before preparation and receipt before executor dispatch', async (t) => {
  const execution = createFixtureExecution();
  let factory;
  const f = await setup(t, {
    workspace: { ...workspace, async prepare(intent, options) {
      const run = await factory.inspectRun(intent.runId);
      assert.deepEqual(run.workspace.intent, intent);
      assert.equal(run.counters.modelAttempts, 0);
      return prepareWorkspace(intent, options);
    } },
    execution: { ...execution, async start(input) {
      const run = await factory.inspectRun(input.runId);
      assert.equal(run.workspace.receipt.status, 'prepared');
      assert.equal(run.workspace.intent.baseCommit, f.base);
      assert.deepEqual(input.run.workspace, run.workspace);
      return execution.start(input);
    } },
  });
  factory = f.factory;
  await writeFile(join(f.repositoryPath, 'logic.txt'), 'owner dirty bytes\n');
  const ownerBefore = git(f.repositoryPath, 'status', '--porcelain=v1');
  const admitted = await factory.startRun({ requestId: 'workspace-source', brief });
  const done = await until(() => factory.inspectRun(admitted.id), (run) => ['failed', 'completed'].includes(run.status));
  assert.equal(done.status, 'completed');
  assert.equal(done.workspace.intent.baseCommit, f.base);
  assert.equal(done.workspace.receipt.sourceManifestId, done.workspace.intent.sourceManifest.id);
  assert.equal(await readFile(join(done.workspace.receipt.worktree, 'logic.txt'), 'utf8'), 'committed source\n');
  assert.equal(git(f.repositoryPath, 'status', '--porcelain=v1'), ownerBefore);
  assert.equal((await factory.startRun({ requestId: 'workspace-source', brief })).id, done.id);
  await factory.close();
  assert.deepEqual(await inspectHistory({ stateDir: f.stateDir, runId: done.id }), done);
});

test('workspace-only admission retains source but blocks production execution without a fixture fallback', async (t) => {
  const { factory, base } = await setup(t);
  const admitted = await factory.startRun({ requestId: 'workspace-only', brief });
  const run = await until(() => factory.inspectRun(admitted.id), (run) => run.status === 'blocked');
  assert.equal(run.workspace.intent.baseCommit, base);
  assert.equal(run.workspace.receipt.status, 'prepared');
  assert.equal(run.outcome.reason, 'MODEL_NOT_READY');
  assert.equal(run.execution.mode, 'production-blocked');
  assert.equal(run.execution.submissionId, undefined);
  assert.equal(run.counters.modelAttempts, 0);
  assert.equal(run.outcome.reviewReady, false);
});

test('workspace archives retain source but refuse unvalidated absolute-path relocation on restore', async (t) => {
  const f = await setup(t);
  const admitted = await f.factory.startRun({ requestId: 'workspace-archive', brief });
  const run = await until(() => f.factory.inspectRun(admitted.id), (run) => run.status === 'blocked');
  await f.factory.close();
  const destination = join(f.root, 'archive');
  await backupFactory({ stateDir: f.stateDir, destination });
  const relativeSource = join('runs', run.id, 'workspace', 'source', 'logic.txt');
  assert.equal(await readFile(join(destination, relativeSource), 'utf8'), 'committed source\n');
  await assert.rejects(restoreFactory({ backupDir: destination, stateDir: join(f.root, 'restored') }), { code: 'WORKSPACE_RELOCATION_REQUIRED' });
  assert.equal((await readdir(f.root)).includes('restored'), false);
  assert.equal((await inspectHistory({ stateDir: f.stateDir, runId: run.id })).workspace.receipt.worktree, run.workspace.receipt.worktree);
});

test('stop cancels preparation and retains ownership until the trusted preparer drains', { timeout: 5000 }, async (t) => {
  const entered = Promise.withResolvers();
  const aborted = Promise.withResolvers();
  const drained = Promise.withResolvers();
  t.after(() => drained.resolve());
  const f = await setup(t, { workspace: { ...workspace, async prepare(_intent, { signal }) {
    signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    if (signal.aborted) aborted.resolve();
    entered.resolve();
    await aborted.promise;
    await drained.promise;
    throw new Error('Controlled preparation cancellation.');
  } } });
  const admitted = await f.factory.startRun({ requestId: 'cancel-preparation', brief });
  await entered.promise;
  const stopping = f.factory.stopRun(admitted.id);
  await aborted.promise;
  try {
    await assert.rejects(openFactory({ stateDir: f.stateDir }), { code: 'BACKEND_OWNED' });
    await assert.rejects(f.factory.startRun({ requestId: 'too-soon', brief }), { code: 'RUN_ACTIVE' });
    assert.equal((await f.factory.inspectRun(admitted.id)).stopRequested, true);
  } finally { drained.resolve(); }
  const stopped = await stopping;
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.workspace.intent.baseCommit, f.base);
  assert.equal(stopped.counters.modelAttempts, 0);
  await assert.rejects(f.factory.resumeRun(admitted.id, { review: 'Cannot undo terminal stop.' }), { code: 'RUN_NOT_INTERRUPTED' });
});

test('crash inspection reconciles source receipts without preparing or silently restarting work', { timeout: 20_000 }, async (t) => {
  for (const scenario of ['fixture-replace', 'workspace-replace', 'workspace-stop']) {
   for (const checkpoint of ['saved-intent', 'prepared-receipt']) {
    const mode = scenario === 'fixture-replace' ? 'fixture' : 'workspace-only';
    const cleanups = [];
    t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });
    const f = await fixture(t);
    const child = fork(new URL('./workspace-app-worker.mjs', import.meta.url), [f.stateDir, f.repositoryPath, checkpoint, mode], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PATH: '/usr/bin:/bin', HOME: f.root },
    });
    const kill = async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    };
    cleanups.push(kill);
    const [message] = await once(child, 'message', { signal: AbortSignal.timeout(5000) });
    await kill();
    const observed = await inspectHistory({ stateDir: f.stateDir, runId: message.runId });
    assert.equal(observed.status, 'interrupted');
    assert.equal(observed.counters.modelAttempts, 0);
    assert.equal(observed.workspace.intent.baseCommit, f.base);
    assert.equal(observed.workspace.artifactStatus, checkpoint === 'saved-intent' ? 'not-prepared' : 'prepared');
    const factory = await openFactory({ stateDir: f.stateDir, project: f.project, workspace,
      ...(mode === 'fixture' ? { execution: createFixtureExecution() } : {}) });
    cleanups.push(() => factory.close());
    assert.deepEqual(await factory.inspectRun(message.runId), observed);
    await assert.rejects(factory.startRun({ requestId: 'cannot-wake', brief }), { code: 'RUN_ACTIVE' });
    await assert.rejects(factory.resumeRun(message.runId, { review: 'No original model input exists.' }), { code: 'UNSAFE_RESUME' });
    if (checkpoint === 'saved-intent') {
      await assert.rejects(factory.replaceRun(message.runId, { requestId: 'unsafe-source-retry', review: 'Preparation quiescence has not been established.' }), { code: 'WORKSPACE_RECOVERY_REQUIRED' });
      assert.equal((await inspectWorkspace(observed.workspace.intent)).status, 'not-prepared');
    } else if (scenario === 'workspace-stop') {
      const stopped = await factory.stopRun(message.runId);
      assert.equal(stopped.status, 'stopped');
      assert.equal(stopped.counters.modelAttempts, 0);
    } else {
      const replacement = await factory.replaceRun(message.runId, { requestId: 'linked-source-replacement', review: 'Prepared receipt confirms all trusted Git commands drained.' });
      const completed = await until(() => factory.inspectRun(replacement.id), (run) => run.status === (mode === 'fixture' ? 'completed' : 'blocked'));
      assert.equal(completed.replacesRunId, observed.id);
      assert.equal((await factory.inspectRun(observed.id)).workspace.intent.id, observed.workspace.intent.id);
    }
   }
  }
});

test('a preparation failure retains immutable intent and sanitized failure without executor dispatch', async (t) => {
  const fixtureExecution = createFixtureExecution();
  let dispatched = false;
  const f = await setup(t, {
    workspace: { ...workspace, async prepare(intent) {
      // A controlled module failure after source admission. Its original diagnostics must not leak.
      throw new Error('fixture-private-diagnostic');
    } },
    execution: { ...fixtureExecution, start(input) { dispatched = true; return fixtureExecution.start(input); } },
  });
  const admitted = await f.factory.startRun({ requestId: 'preparation-failure', brief });
  const failed = await until(() => f.factory.inspectRun(admitted.id), (run) => run.status === 'failed');
  assert.equal(failed.workspace.intent.baseCommit, f.base);
  assert.equal(failed.workspace.failure.code, 'WORKSPACE_FAILED');
  assert.equal(JSON.stringify(failed).includes('fixture-private-diagnostic'), false);
  assert.equal(dispatched, false);
  assert.equal(failed.counters.modelAttempts, 0);
  assert.equal((await f.factory.startRun({ requestId: 'preparation-failure', brief })).id, failed.id);
  assert.deepEqual(await readdir(join(f.stateDir, 'runs', failed.id)), []);
});
