import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, chmod, readdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openFactory, inspectHistory, FactoryError } from '../../src/factory.mjs';
import { createRepositoryExecution } from '../../src/execution.mjs';
import { runOwnedScope, startForeground } from '../fixtures/containment-harness.mjs';
import { until } from '../phase-0/helpers.mjs';

const brief = 'Goal: A bounded draft.\nAcceptance criteria: Retain an unqualified change.\nEvidence: helper.mjs.';
const dependencyRunId = 'run_00000000-0000-0000-0000-000000000001';

async function cleanup(root) {
  if (process.env.FACTORY_EXECUTOR_APPLICATION_EVIDENCE) return;
  async function writable(path) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await writable(join(path, entry.name));
  }
  await writable(root); await rm(root, { recursive: true, force: true });
}
for (const scenario of ['draft', 'cli-draft', 'cli-refusal', 'cli-stop', 'no-change', 'drain-report']) {
  test(`repository executor application and CLI: ${scenario}`, async t => {
    const root = await mkdtemp('/tmp/factory-dependencies-'); let drained = false;
    try {
      const result = await runOwnedScope(t, [fileURLToPath(new URL('./executor-application-worker.mjs', import.meta.url)), root, scenario]);
      drained = true;
      assert.equal(result.code, 0, result.stderr);
      if (process.env.FACTORY_EXECUTOR_APPLICATION_EVIDENCE) await writeFile(`${process.env.FACTORY_EXECUTOR_APPLICATION_EVIDENCE}/${scenario}.json`, result.stdout, { mode: 0o600 });
    } finally { if (drained) await cleanup(root); }
  });
}

for (const scenario of ['crash', 'smoke-crash', 'completion-crash']) {
  test(`repository executor passive crash reconciliation: ${scenario}`, async t => {
    const root = await mkdtemp('/tmp/factory-dependencies-'); let drained = false;
    try {
      const result = await runOwnedScope(t, [fileURLToPath(new URL('./executor-application-worker.mjs', import.meta.url)), root, scenario]);
      drained = true;
      assert.notEqual(result.code, 0);
      const input = JSON.parse(await readFile(join(root, 'application-input.json'), 'utf8'));
      const command = promisify(execFile);
      const executable = fileURLToPath(new URL('../../bin/factory.mjs', import.meta.url));
      const inspect = async () => JSON.parse((await command(process.execPath, [executable, 'inspect', input.runId, '--state-dir', input.stateDir], {
        env: { PATH: '/usr/bin', HOME: root }, timeout: 15000, maxBuffer: 8 * 1024 * 1024,
      })).stdout);
      const before = await readFile(join(input.stateDir, 'runs', input.runId, 'execution.sqlite'));
      const saved = await inspect();
      assert.equal(saved.status, 'interrupted');
      assert.equal(saved.outcome.reason, 'executor_reconciliation_required');
      assert.equal(saved.outcome.reviewReady, false);
      if (scenario === 'smoke-crash') {
        assert.equal(saved.execution.submissionId, undefined, 'A completed smoke is not an executor submission.');
        assert.equal(saved.execution.preflightSubmissionId, saved.admission.smokeSubmissionId);
      } else {
        assert.equal(saved.execution.submissionId, saved.executor.submissionId);
        assert.equal(await readFile(join(saved.workspace.intent.worktree, 'helper.mjs'), 'utf8'), 'export const normalize = value => value.trim();\n');
        if (scenario === 'crash') assert.ok(saved.executorEvidence.uncertainOperations.some(op => op.tool === 'write_file'));
        else assert.equal(saved.executorEvidence.status, 'draft-produced');
      }
      let initialized = 0;
      const execution = createRepositoryExecution({ fixture: true, createRuntime() { initialized++; assert.fail('Passive runtime'); }, fetch() { assert.fail('Passive request'); } });
      const factory = await openFactory({ stateDir: input.stateDir, project: input.project, execution,
        workspace: { admit() { assert.fail('No repeated source admission'); }, prepare() { assert.fail('No repeated source preparation'); } } });
      try {
        const duplicate = await factory.startRun({ requestId: saved.requestId, brief: input.brief, dependencyRunId: input.dependencyRunId, scope: input.scope });
        assert.equal(duplicate.id, saved.id); assert.equal(duplicate.status, 'interrupted');
        assert.deepEqual(duplicate.counters, saved.counters);
        await assert.rejects(factory.resumeRun(saved.id, { review: 'Inspect retained partial effects before any recovery.' }), { code: 'UNSAFE_RESUME' });
        await assert.rejects(factory.stopRun(saved.id), { code: 'RECOVERY_REQUIRED' });
        assert.equal(initialized, 0);
      } finally { await factory.close(); }
      assert.deepEqual(await readFile(join(input.stateDir, 'runs', input.runId, 'execution.sqlite')), before);
      assert.equal((await inspect()).status, 'interrupted');
      if (process.env.FACTORY_EXECUTOR_APPLICATION_EVIDENCE) await writeFile(`${process.env.FACTORY_EXECUTOR_APPLICATION_EVIDENCE}/${scenario}.json`, JSON.stringify({ root, saved }), { mode: 0o600 });
    } finally { if (drained) await cleanup(root); }
  });
}

test('owner executor CLI is explicit and passive until an admitted start passes prerequisites', async t => {
  const root = await mkdtemp('/tmp/factory-owner-executor-');
  const stateDir = join(root, 'state');
  const h = await startForeground(t, ['serve', '--execute-agent', '--state-dir', stateDir, '--project-path', join(root, 'missing-owner-source')]);
  t.after(async () => { await h.dispose(); await rm(root, { recursive: true, force: true }); });
  assert.equal((await h.ready()).mode, 'repository-executor');
  const command = promisify(execFile);
  const executable = fileURLToPath(new URL('../../bin/factory.mjs', import.meta.url));
  const cli = async (...args) => JSON.parse((await command(process.execPath, [executable, ...args, '--state-dir', stateDir], {
    env: { PATH: '/usr/bin', HOME: root }, timeout: 15000, maxBuffer: 2 * 1024 * 1024,
  })).stdout);
  assert.deepEqual(await cli('list'), []);
  const run = await cli('start', '--request-id', 'owner-blocked', '--brief-text', brief, '--dependency-run', dependencyRunId, '--write-path', 'helper.mjs');
  assert.equal(run.capabilities.productionModel, true);
  const blocked = await until(() => cli('inspect', run.id), value => value.status === 'blocked');
  assert.equal(blocked.counters.modelAttempts, 0);
  assert.equal(blocked.counters.toolRounds, 0);
  assert.equal(blocked.executorEvidence.artifactStatus, 'missing');
  for (const conflict of ['--fixture', '--admit-agent', '--prepare-workspace', '--model-preflight']) {
    await assert.rejects(cli('serve', '--execute-agent', conflict), error => JSON.parse(error.stderr).error.code === 'INVALID_ARGUMENTS');
  }
  h.child.kill('SIGTERM');
  assert.equal((await h.bounded(h.finished, 10000)).code, 0);
});

test('application snapshots explicit executor permissions and retains them on duplicate and linked admission', async t => {
  const root = await mkdtemp('/tmp/factory-executor-app-');
  const stateDir = join(root, 'state');
  const project = { id: 'vanguard', repositoryPath: join(root, 'owner') };
  let initialized = 0;
  const execution = createRepositoryExecution({ fixture: true,
    createRuntime() { initialized++; assert.fail('No model after source refusal'); },
    fetch() { assert.fail('No request after source refusal'); },
  });
  const workspace = { admit() { throw new FactoryError('WORKSPACE_SOURCE', 'Controlled source refusal.'); }, prepare() { assert.fail('No source preparation'); } };
  const factory = await openFactory({ stateDir, project, workspace, execution });
  t.after(async () => { await factory.close(); await rm(root, { recursive: true, force: true }); });
  await assert.rejects(factory.startRun({ requestId: 'missing-scope', brief, dependencyRunId }), { code: 'EXECUTOR_SCOPE' });
  const scope = { writePaths: ['helper.test.mjs', 'helper.mjs'] };
  const run = await factory.startRun({ requestId: 'executor', brief, dependencyRunId, scope });
  assert.equal(run.execution.mode, 'repository-executor');
  assert.deepEqual(run.executor.scope, { writePaths: ['helper.mjs', 'helper.test.mjs'] });
  scope.writePaths.push('outside.mjs');
  await until(() => factory.inspectRun(run.id), value => value.status === 'blocked');
  const retained = await factory.inspectRun(run.id);
  assert.equal(retained.outcome.reason, 'WORKSPACE_SOURCE');
  assert.equal(retained.capabilities.productionModel, false);
  assert.equal(retained.executorEvidence.artifactStatus, 'missing');
  assert.equal((await factory.startRun({ requestId: 'executor', brief, dependencyRunId, scope: run.executor.scope })).id, run.id);
  await assert.rejects(factory.startRun({ requestId: 'executor', brief, dependencyRunId, scope }), { code: 'REQUEST_CONFLICT' });
  await assert.rejects(factory.startRun({ requestId: 'executor', brief, dependencyRunId }), { code: 'REQUEST_CONFLICT' });
  const replacement = await factory.replaceRun(run.id, { requestId: 'replacement', review: 'Correct the source prerequisite without changing permissions.' });
  assert.deepEqual(replacement.executor.scope, run.executor.scope);
  await until(() => factory.inspectRun(replacement.id), value => value.status === 'blocked');
  assert.equal(initialized, 0);
  await assert.rejects(factory.inspectRun(run.id, { page: -1 }), { code: 'INVALID_ARGUMENTS' });
  await factory.close();
  const offline = await inspectHistory({ stateDir, runId: run.id });
  assert.deepEqual(offline.executor.scope, run.executor.scope);
  assert.equal(offline.executorEvidence.artifactStatus, 'missing');
});
