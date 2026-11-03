import assert from 'node:assert/strict';
import { openFactory, inspectHistory } from '../../src/factory.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { admitDependencies, prepareDependencies, inspectDependencies } from '../../src/dependencies.mjs';
import { dependencyFixture } from '../../src/dependencies-diagnostics.mjs';
import { until } from '../phase-0/helpers.mjs';
import { verifyContainmentEnvelope } from '../../src/containment.mjs';
import { scopeProcesses, waitForCleanup } from '../../src/containment-process-fixtures.mjs';
import { verifyDependencyBundle } from '../../src/dependencies.mjs';
import { createRunTools } from '../../src/execution.mjs';
import { retainedBudget } from './model-fixtures.mjs';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const [root, scenario = 'prepare'] = process.argv.slice(2);
const f = await dependencyFixture(root);
const stateDir = f.workspaceIntent.stateDir;
let intentSavedBeforeEffects = false;
let factory;
let now = 1000;
let deadline;
const entered = Promise.withResolvers();
factory = await openFactory({ stateDir, project: { id: 'vanguard', repositoryPath: f.repositoryPath },
  ...(scenario === 'deadline' ? { clock: { now: () => now, setTimeout: (callback) => { deadline = callback; }, clearTimeout() {} } } : {}),
  workspace: { admit: admitWorkspace, prepare: prepareWorkspace },
  dependencyPreparation: { admit: admitDependencies, inspect: inspectDependencies, async prepare(intent, options) {
    const saved = await factory.inspectRun(intent.workspaceIntent.runId);
    assert.deepEqual(saved.dependencies.intent, intent);
    assert.equal(saved.dependencies.status, 'preparing');
    assert.equal(saved.counters.modelAttempts, 0);
    intentSavedBeforeEffects = true;
    const crash = async () => {
      await new Promise((resolve) => process.stdout.write(`${JSON.stringify({ runId: saved.id, stateDir })}\n`, resolve));
      process.kill(process.pid, 'SIGKILL');
      await new Promise(() => {});
    };
    if (scenario === 'crash-intent') await crash();
    entered.resolve();
    const receipt = await prepareDependencies(intent, options);
    if (scenario === 'crash-receipt') await crash();
    return receipt;
  } },
});
try {
  const brief = 'Goal: Prepare a private bundle.\nAcceptance criteria: Keep the source and limits unchanged.\nEvidence: Local fixture archives.';
  const admitted = await factory.startRun({ requestId: 'owner-source', brief });
  const original = await until(() => factory.inspectRun(admitted.id), (run) => run.status === 'blocked');
  assert.equal(original.dependencies, undefined); // Ordinary admission never installs.
  const preparing = await factory.prepareDependencies(original.id, { bunPath: '/home/cowen/.bun/bin/bun' });
  assert.equal(preparing.status, 'admitted');
  await assert.rejects(factory.startRun({ requestId: 'cannot-overlap-preparation', brief }), { code: 'RUN_ACTIVE' });
  if (['stop', 'shutdown', 'deadline'].includes(scenario)) {
    await entered.promise;
    const envelope = await verifyContainmentEnvelope();
    const observed = await until(() => scopeProcesses(envelope), (processes) => processes.length >= 2);
    if (scenario === 'shutdown') await factory.close();
    else if (scenario === 'stop') await factory.stopRun(original.id);
    else { now = original.deadlineAt; deadline(); }
    let stopped;
    if (scenario === 'shutdown') stopped = await inspectHistory({ stateDir, runId: original.id });
    else stopped = await until(() => factory.inspectRun(original.id), (run) => ['failed', 'stopped'].includes(run.status));
    assert.equal(stopped.deadlineAt, original.deadlineAt);
    assert.deepEqual(stopped.counters, original.counters);
    const survivors = await waitForCleanup(observed);
    await factory.close();
    const reopened = await openFactory({ stateDir, project: stopped.project });
    try { assert.deepEqual(await reopened.inspectRun(stopped.id), stopped); } finally { await reopened.close(); }
    process.stdout.write(`${JSON.stringify({ stopped, survivors, observedCount: observed.length })}\n`);
  } else {
  const prepared = await until(() => factory.inspectRun(admitted.id), (run) => run.status === 'blocked' && run.dependencies?.status === 'prepared');
  assert.equal(prepared.deadlineAt, original.deadlineAt);
  assert.deepEqual(prepared.counters, original.counters);
  assert.equal(prepared.dependencies.receipt.scripts, 'disabled');
  assert.equal(prepared.dependencies.artifactStatus, 'prepared');
  assert.deepEqual(await factory.prepareDependencies(original.id, { bunPath: '/home/cowen/.bun/bin/bun' }), prepared);
  if (scenario === 'stale') {
    const path = join(prepared.workspace.receipt.worktree, 'package.json');
    const originalManifest = await readFile(path);
    await writeFile(path, Buffer.concat([originalManifest, Buffer.from('\n')]));
    assert.equal((await factory.inspectRun(prepared.id)).dependencies.artifactStatus, 'invalid');
    await assert.rejects(factory.prepareDependencies(prepared.id, { bunPath: '/home/cowen/.bun/bin/bun' }), { code: 'DEPENDENCIES_STALE' });
    await writeFile(path, originalManifest);
  }
  await factory.close();
  assert.deepEqual(await inspectHistory({ stateDir, runId: admitted.id }), prepared);
  let checks;
  if (scenario === 'tools') {
    // The execution seam takes a trusted budget. This fixture records it in memory;
    // application-backed accounting is covered by the existing run-tools worker.
    const saved = retainedBudget({ record: { ...prepared, status: 'running' } });
    const dependencyBundle = await verifyDependencyBundle(prepared.dependencies.intent);
    const input = { directory: join(stateDir, 'runs', prepared.id), run: prepared, budget: saved.budget,
      signal: saved.budget.signal, dependencyBundle };
    const tools = await createRunTools(input);
    try {
      const vitest = await tools.check('vitest');
      const lint = await tools.check('lint');
      await assert.rejects(tools.check('install'), { code: 'CHECK_NOT_ALLOWED' });
      checks = { vitest, lint, verification: tools.verification, budget: saved.inspect() };
    } finally { await tools.close(); }
    await assert.rejects(createRunTools({ ...input, dependencyBundle: { prepared: true } }), { code: 'DEPENDENCIES_UNSAFE' });
  }
  process.stdout.write(`${JSON.stringify({ prepared, intentSavedBeforeEffects, checks })}\n`);
  }
} finally { await factory.close(); }
