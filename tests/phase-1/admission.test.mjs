import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runOwnedScope, startForeground } from '../fixtures/containment-harness.mjs';
import { openFactory, inspectHistory } from '../../src/factory.mjs';
import { createAdmissionExecution } from '../../src/admission.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';

const worker = fileURLToPath(new URL('./admission-worker.mjs', import.meta.url));
const executable = fileURLToPath(new URL('../../bin/factory.mjs', import.meta.url));
const exec = promisify(execFile);
async function cleanup(root) {
  if (process.env.FACTORY_ADMISSION_EVIDENCE) return;
  // Only after exact-scope drainage, make this disposable sealed tree removable.
  // Never follow its validated .bin symlinks.
  async function writable(path) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await writable(`${path}/${entry.name}`);
  }
  await writable(root);
  await rm(root, { recursive: true, force: true });
}
for (const scenario of ['success', 'hidden-source', 'passive-profile', 'model-drain', 'model-drain-report', 'stop-draining', 'tool-limit', 'model-limit', 'selection', 'missing', 'stale', 'foreign-source', 'refusal', 'vitest', 'lint',
  'initial-source', 'smoke-source', 'profile', 'between-checks', 'handoff', 'before-handoff', 'profile-handoff',
  'stop-initialize', 'stop-model', 'stop-check', 'shutdown-model', 'shutdown-check', 'deadline-model', 'deadline-check',
  'cli-success', 'cli-refusal', 'cli-vitest', 'cli-lint', 'cli-missing', 'cli-stop-check']) {
  test(`admission gates without agent authority: ${scenario}`, async t => {
    const root = await mkdtemp('/tmp/factory-dependencies-');
    let drained = false;
    try {
      const result = await runOwnedScope(t, [worker, root, scenario], { timeout: 60000 });
      drained = true;
      assert.equal(result.code, 0, result.stderr);
      const evidence = JSON.parse(result.stdout);
      if (process.env.FACTORY_ADMISSION_EVIDENCE) await writeFile(`${process.env.FACTORY_ADMISSION_EVIDENCE}/${scenario}.json`, JSON.stringify({ root, ...evidence }), { mode: 0o600 });
    } finally { if (drained) await cleanup(root); }
  });
}

test('CLI crash after smoke remains interrupted on passive reopen and duplicate requests, with no new runtime', async t => {
  const root = await mkdtemp('/tmp/factory-dependencies-');
  let drained = false;
  try {
    const crashed = await runOwnedScope(t, [worker, root, 'cli-crash']);
    drained = true;
    assert.notEqual(crashed.code, 0);
    const { admitted, stateDir, project } = JSON.parse(crashed.stdout);
    const { stdout } = await exec(process.execPath, [executable, 'inspect', admitted.id, '--state-dir', stateDir], { env: { PATH: '/usr/bin', HOME: root } });
    const passive = JSON.parse(stdout);
    assert.equal(passive.status, 'interrupted');
    assert.equal(passive.outcome.reason, 'admission_reconciliation_required');
    assert.equal(passive.counters.modelAttempts, 1);
    assert.equal(passive.admission.smoke.reservationId.length > 0, true);
    let initialized = 0;
    const factory = await openFactory({ stateDir, project, workspace: { admit: admitWorkspace, prepare: prepareWorkspace },
      execution: createAdmissionExecution({ fixture: true, fetch: async () => { throw new Error('Passive transport'); }, createRuntime() { initialized++; throw new Error('Passive initialization'); } }) });
    try {
      const run = await factory.inspectRun(admitted.id);
      assert.equal(run.status, 'interrupted');
      assert.equal((await factory.startRun({ requestId: admitted.requestId, brief: admitted.brief.text, dependencyRunId: admitted.admission.dependencyRunId })).status, 'interrupted');
      await assert.rejects(factory.startRun({ requestId: 'cannot-wake', brief: admitted.brief.text, dependencyRunId: admitted.admission.dependencyRunId }), { code: 'RUN_ACTIVE' });
      await assert.rejects(factory.resumeRun(admitted.id, { review: 'Inspect partial checks' }), { code: 'UNSAFE_RESUME' });
      await assert.rejects(factory.stopRun(admitted.id), { code: 'RECOVERY_REQUIRED' });
      assert.equal(initialized, 0);
      assert.equal(run.deadlineAt, admitted.deadlineAt);
      assert.equal(run.counters.modelAttempts, passive.counters.modelAttempts);
    } finally { await factory.close(); }
    assert.equal((await inspectHistory({ stateDir, runId: admitted.id })).status, 'interrupted');
    if (process.env.FACTORY_ADMISSION_EVIDENCE) await writeFile(`${process.env.FACTORY_ADMISSION_EVIDENCE}/crash.json`, JSON.stringify({ root, passive }), { mode: 0o600 });
  } finally { if (drained) await cleanup(root); }
});

test('controlled providers cannot accidentally attest to the owner admission profile', () => {
  assert.throws(() => createAdmissionExecution({ createRuntime: async () => ({}) }), { code: 'ADMISSION_CONFIGURATION' });
  assert.throws(() => createAdmissionExecution({ fixture: true }), { code: 'ADMISSION_CONFIGURATION' });
});

test('owner CLI opt-in serves and inspects without constructing a credential runtime', async t => {
  const stateDir = await mkdtemp('/tmp/factory-admission-');
  const h = await startForeground(t, ['serve', '--admit-agent', '--state-dir', stateDir, '--project-path', `${stateDir}/absent-synthetic-repository`]);
  try {
    assert.equal((await h.ready()).mode, 'admission-only');
    const { stdout } = await exec(process.execPath, [executable, 'info', '--state-dir', stateDir], { env: { PATH: '/usr/bin', HOME: stateDir } });
    assert.equal(JSON.parse(stdout).fixture, false);
    await assert.rejects(exec(process.execPath, [executable, 'start', '--state-dir', stateDir, '--request-id', 'no-selection',
      '--brief-text', 'Goal: No work\nAcceptance criteria: No runtime\nEvidence: Missing selection'], { env: { PATH: '/usr/bin', HOME: stateDir } }), error => error.stderr.includes('DEPENDENCY_SELECTION_REQUIRED'));
  } finally { await h.dispose(); await rm(stateDir, { recursive: true, force: true }); }
});
