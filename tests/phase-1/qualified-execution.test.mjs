import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runOwnedScope } from '../fixtures/containment-harness.mjs';
import { createQualifiedRepositoryExecution } from '../../src/qualified-execution.mjs';

test('composed execution construction and recovery stay passive and refuse injected authority', async () => {
  let initialized = 0;
  const options = { fixture: true, createRuntime() { initialized++; }, fetch: async () => assert.fail('No request') };
  const execution = createQualifiedRepositoryExecution(options);
  assert.equal(execution.mode, 'repository-executor');
  assert.equal(execution.admissionKind, 'controlled-fixture');
  assert.equal(execution.model, 'openai/gpt-6.1-sol');
  assert.equal(execution.qualifiesDrafts, true);
  assert.ok(Object.isFrozen(execution));
  for (const key of ['verifyDraft', 'qualifier', 'createDraftQualification', 'handoff']) {
    assert.throws(() => createQualifiedRepositoryExecution({ ...options, [key]: () => {} }), { code: 'QUALIFICATION_CONFIGURATION' });
  }
  assert.throws(() => createQualifiedRepositoryExecution({ createRuntime() {} }), { code: 'ADMISSION_CONFIGURATION' });
  assert.equal(createQualifiedRepositoryExecution().admissionKind, 'owner');
  await assert.rejects(execution.resume({}), { code: 'UNSAFE_RESUME' });
  assert.deepEqual({ ...(await execution.assessRecovery()), evidence: undefined },
    { kind: 'repository-executor', quiescent: false, resumable: false, evidence: undefined });
  const run = { id: 'r1', qualification: { version: 1, runId: 'r1', kind: 'controlled-fixture', status: 'pending', reviewReady: false } };
  const input = { runId: 'r1', run, saveQualification() {} };
  // Opt-in requires the application's pending projection and synchronous save. Neither
  // missing nor mismatched projections dispatch the executor or initialize a model.
  for (const bad of [{ saveQualification: undefined }, { run: { id: 'r1' } },
    { run: { ...run, qualification: { ...run.qualification, status: 'qualified' } } },
    { run: { ...run, qualification: { ...run.qualification, reviewReady: true } } },
    { run: { ...run, qualification: { ...run.qualification, kind: 'owner' } } },
    { run: { ...run, qualification: { ...run.qualification, runId: 'r2' } } }]) {
    await assert.rejects(execution.start({ ...input, ...bad }), { code: 'QUALIFICATION_CONFIGURATION' });
  }
  assert.equal(initialized, 0);
});

for (const scenario of ['qualified', 'tautology', 'no-change', 'refusal', 'tool-limit', 'stop-before-qualification', 'stop-qualification', 'drain-report']) {
  test(`actual executor draft through composed qualification: ${scenario}`, async t => {
    const root = await mkdtemp('/tmp/factory-dependencies-');
    let drained = false;
    try {
      const worker = scenario === 'drain-report' ? './qualified-execution-drain-worker.mjs' : './qualified-execution-worker.mjs';
      // Exhausting the allowance takes 23 real executor read rounds, each a durable model turn.
      const result = await runOwnedScope(t, [fileURLToPath(new URL(worker, import.meta.url)), root, scenario],
        scenario === 'tool-limit' ? { timeout: 180000 } : {});
      drained = true;
      if (process.env.FACTORY_QUALIFIED_EXECUTION_EVIDENCE) {
        await writeFile(`${process.env.FACTORY_QUALIFIED_EXECUTION_EVIDENCE}/${scenario}.json`,
          JSON.stringify({ root, code: result.code, stdout: result.stdout, stderr: result.stderr }), { mode: 0o600 });
      }
      assert.equal(result.code, 0, result.stderr);
    } finally {
      if (drained && !process.env.FACTORY_QUALIFIED_EXECUTION_EVIDENCE) {
        async function writable(path) {
          await chmod(path, 0o700);
          for (const item of await readdir(path, { withFileTypes: true })) if (item.isDirectory()) await writable(`${path}/${item.name}`);
        }
        await writable(root); await rm(root, { recursive: true, force: true });
      }
    }
  });
}
