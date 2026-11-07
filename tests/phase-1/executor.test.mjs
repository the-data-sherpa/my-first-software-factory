import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openFactory, inspectHistory } from '../../src/factory.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { fileURLToPath } from 'node:url';
import { runOwnedScope } from '../fixtures/containment-harness.mjs';
import * as execution from '../../src/execution.mjs';

test('executor scope is detached, file-only, explicit, and cannot grant protected paths', () => {
  const input = { writePaths: ['helper.mjs', 'helper.test.mjs'] };
  const scope = execution.validateExecutorScope(input);
  input.writePaths.push('other.mjs');
  assert.deepEqual(scope, { writePaths: ['helper.mjs', 'helper.test.mjs'] });
  for (const path of ['../outside', '/tmp/out', '*.mjs', 'src/', '.git/config', '.env', 'package.json', 'bun.lock', 'package-lock.json', 'vendor/x', 'node_modules/x', 'vitest.config.ts', 'src/tsconfig.json', '.github/workflows/x.yml', 'ownership.json']) {
    assert.throws(() => execution.validateExecutorScope({ writePaths: [path] }), { code: 'EXECUTOR_SCOPE' }, path);
  }
  assert.throws(() => execution.validateExecutorScope({ writePaths: ['a', 'a'] }), { code: 'EXECUTOR_SCOPE' });
  assert.throws(() => execution.createRepositoryExecution({ createRuntime() {} }), { code: 'ADMISSION_CONFIGURATION' });
});

async function cleanup(root) {
  if (process.env.FACTORY_EXECUTOR_EVIDENCE) return;
  async function writable(path) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await writable(`${path}/${entry.name}`);
  }
  await writable(root); await rm(root, { recursive: true, force: true });
}
for (const scenario of ['draft', 'no-change', 'fabricated', 'write-denied', 'schema-denied', 'tool-denied', 'duplicate-call',
  'preflight-failed', 'output-limit', 'check-output-limit', 'check-assertion-feedback', 'check-encoded-feedback', 'overflow-tool', 'dependency-change', 'source-change', 'profile-change',
  'persistence-after-write', 'persistence-report', 'stale-handoff', 'closed-handoff', 'stop-model', 'stop-tool', 'shutdown-model',
  'stop-draining-tooluse', 'stop-finalization', 'deadline-model', 'deadline-tool', 'model-drain', 'model-drain-report',
  'tool-budget', 'model-budget', 'transient-retry', 'pristine-transition', 'scope-expansion', 'tool-startup-drain', 'tool-drain-report']) {
  test(`controlled repository executor: ${scenario}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'factory-dependencies-')); let drained = false;
    try {
      const worker = ['tool-startup-drain', 'tool-drain-report'].includes(scenario) ? './executor-drain-worker.mjs' : './executor-worker.mjs';
      const result = await runOwnedScope(t, [fileURLToPath(new URL(worker, import.meta.url)), root, scenario]);
      drained = true;
      assert.equal(result.code, 0, result.stderr);
      if (process.env.FACTORY_EXECUTOR_EVIDENCE) await writeFile(`${process.env.FACTORY_EXECUTOR_EVIDENCE}/${scenario}.json`, result.stdout, { mode: 0o600 });
    } finally { if (drained) await cleanup(root); }
  });
}

test('crash after a real mutation retains uncertainty; passive inspect, duplicate and reopen never replay', async t => {
  const root = await mkdtemp(join(tmpdir(), 'factory-dependencies-')); let drained = false;
  try {
    const result = await runOwnedScope(t, [fileURLToPath(new URL('./executor-worker.mjs', import.meta.url)), root, 'crash']);
    drained = true;
    assert.notEqual(result.code, 0);
    const projection = JSON.parse(await readFile(join(root, 'executor-projection.json'), 'utf8'));
    const stateDir = join(root, 'private');
    const saved = await inspectHistory({ stateDir, runId: projection.run.id });
    assert.equal(saved.status, 'interrupted');
    assert.ok(saved.reservations.some(r => r.kind === 'tool-round' && r.roundId.startsWith('write:') && r.state === 'uncertain'));
    assert.equal(await readFile(join(saved.workspace.intent.worktree, 'helper.mjs'), 'utf8'), 'export const normalize = text => text.trim();\n');
    const before = await readFile(join(projection.directory, 'execution.sqlite'));
    const evidence = await execution.inspectExecutor({ ...projection, run: { ...saved, executor: projection.run.executor } });
    assert.equal(evidence.status, 'interrupted');
    assert.equal(evidence.artifactStatus, 'incomplete');
    assert.ok(evidence.uncertainOperations.some(op => op.tool === 'write_file'));
    assert.deepEqual(await readFile(join(projection.directory, 'execution.sqlite')), before);
    let initialized = 0;
    const adapter = execution.createRepositoryExecution({ fixture: true, createRuntime() { initialized++; throw new Error('Passive model creation'); }, fetch() { throw new Error('Passive request'); } });
    const factory = await openFactory({ stateDir, project: saved.project, workspace: { admit: admitWorkspace, prepare: prepareWorkspace }, execution: { ...adapter, mode: 'admission-only' } });
    try {
      const duplicate = await factory.startRun({ requestId: saved.requestId, brief: saved.brief.text, dependencyRunId: saved.admission.dependencyRunId });
      assert.equal(duplicate.id, saved.id); assert.equal(duplicate.status, 'interrupted');
      await assert.rejects(factory.resumeRun(saved.id, { review: 'Inspect the partial file mutation.' }), { code: 'UNSAFE_RESUME' });
      await assert.rejects(factory.stopRun(saved.id), { code: 'RECOVERY_REQUIRED' });
      assert.equal(initialized, 0);
      assert.equal((await factory.inspectRun(saved.id)).counters.modelAttempts, saved.counters.modelAttempts);
    } finally { await factory.close(); }
    assert.deepEqual(await readFile(join(projection.directory, 'execution.sqlite')), before);
    if (process.env.FACTORY_EXECUTOR_EVIDENCE) await writeFile(`${process.env.FACTORY_EXECUTOR_EVIDENCE}/crash.json`, JSON.stringify({ root, saved, evidence }), { mode: 0o600 });
  } finally { if (drained) await cleanup(root); }
});
