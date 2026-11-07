import assert from 'node:assert/strict';
import { readFile, writeFile, cp, symlink, realpath, appendFile, unlink } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { qualificationProject, baseHelper, candidateTest } from '../fixtures/qualification-project.mjs';
import { qualifiedExecutorReply, scope, helperPath, testPath } from '../fixtures/qualified-execution-model.mjs';
import { controlledRuntime, controlledTransport } from './model-fixtures.mjs';
import { until } from '../phase-0/helpers.mjs';

const [root, scenario, stateDirectory] = process.argv.slice(2);
let source = new URL('../../', import.meta.url);
if (['stale-projection', 'stale-containment-entry', 'missing-qualification-module', 'unexpected-qualifier-close'].includes(scenario)) {
  const repository = fileURLToPath(source);
  const copy = join(root, 'factory');
  for (const directory of ['src', 'bin', 'docs/agents']) await cp(join(repository, directory), join(copy, directory), { recursive: true });
  await cp(join(repository, 'package.json'), join(copy, 'package.json'));
  await symlink(await realpath(join(repository, 'node_modules')), join(copy, 'node_modules'));
  source = pathToFileURL(`${copy}/`);
  if (scenario === 'unexpected-qualifier-close') {
    const module = new URL('src/qualification.mjs', source);
    const original = await readFile(module, 'utf8');
    const close = 'close() { return closing ??= (async () => { if (!settled) shutdown.abort(); await drained(); })(); },';
    assert.ok(original.includes(close), 'Qualification cleanup fault anchor changed.');
    await writeFile(module, original.replace(close, "close() { throw Object.assign(new Error('Controlled unexpected cleanup rejection'), { code: 'UNEXPECTED_CLEANUP' }); },"));
  }
}
const { openFactory } = await import(new URL('src/factory.mjs', source));
const { createQualifiedRepositoryExecution } = await import(new URL('src/execution.mjs', source));
const { serveFactory } = await import(new URL('src/control-server.mjs', source));
const { admitWorkspace, prepareWorkspace } = await import(new URL('src/workspace.mjs', source));
globalThis.fetch = async () => { throw new Error('Uncontrolled network forbidden'); };
const fixture = await qualificationProject(root, scenario === 'final-lint' ? 'final-lint' : scenario === 'crash-check' ? 'slow' : 'green', { stateDir: stateDirectory });
const stateDir = fixture.workspaceIntent.stateDir;
const project = { id: 'vanguard', repositoryPath: fixture.repositoryPath };
const workspace = { admit: admitWorkspace, prepare: prepareWorkspace };
const brief = 'Goal: normalizeAddress whitespace.\nAcceptance criteria: Preserve units and abbreviations with a regression test, no backfill.\nEvidence: Independently specified address examples.';
let factory = await openFactory({ stateDir, project, workspace });
const prep = await factory.startRun({ requestId: 'prepare', brief });
await until(() => factory.inspectRun(prep.id), r => r.status === 'blocked');
await factory.prepareDependencies(prep.id, { bunPath: `${root}/bun` });
await until(() => factory.inspectRun(prep.id), r => r.dependencies?.status === 'prepared' && r.status === 'blocked');
await factory.close();
const variant = ['tautology', 'no-change', 'refusal'].includes(scenario) ? scenario : 'green';
const transport = controlledTransport(qualifiedExecutorReply({ variant }));
let initialized = 0; let expired = false; let triggered = false; let stop; let cancelling = false;
const cancelGate = Promise.withResolvers();
const composed = createQualifiedRepositoryExecution({ fixture: true, createRuntime() { initialized++; return controlledRuntime(); }, fetch: transport.fetch });
const execution = { ...composed, async start(input) {
  const handle = await composed.start({ ...input, saveQualification(state) {
    if (scenario === 'report-failure' && state.stage === 'complete') throw new Error('Controlled application qualification persistence failure');
    input.saveQualification(state);
    const selectedStage = scenario === 'crash-check' ? 'base-regression' : scenario === 'crash-final' ? 'complete'
      : scenario === 'stop-check' ? 'base-regression' : scenario === 'stop-final' ? 'complete' : undefined;
    if (selectedStage && state.stage === selectedStage && !triggered) {
      triggered = true;
      if (scenario.startsWith('crash-')) {
        writeFileSync(join(root, 'crash-input.json'), JSON.stringify({ stateDir, project, runId: input.runId }), { mode: 0o600 });
        if (scenario === 'crash-check') setTimeout(() => process.kill(process.pid, 'SIGKILL'), 100);
        else process.kill(process.pid, 'SIGKILL');
      } else { stop = factory.stopRun(input.runId); stop.catch(() => {}); }
    }
  } });
  return { ...handle,
    async cancel() {
      await handle.cancel();
      if (scenario === 'deadline-cancel-join' && expired) { cancelling = true; await cancelGate.promise; }
    },
    async close() {
      await handle.close();
      if (['deadline-final', 'deadline-cancel-join'].includes(scenario)) expired = true;
    },
  };
} };
const clock = { now: () => Date.now() + (expired ? 1_200_001 : 0), setTimeout, clearTimeout };
if (scenario === 'missing-qualification-module') await unlink(new URL('src/qualification-reporter.mjs', source));
factory = await openFactory({ stateDir, project, workspace, execution, clock });
const server = await serveFactory({ factory, mode: execution.mode, fixture: true });
const exec = promisify(execFile);
const executable = fileURLToPath(scenario === 'missing-qualification-module'
  ? new URL('../../bin/factory.mjs', import.meta.url) : new URL('bin/factory.mjs', source));
const cli = async (...args) => JSON.parse((await exec(process.execPath, [executable, ...args, '--state-dir', stateDir], {
  env: { PATH: '/usr/bin', HOME: root }, timeout: 15000, maxBuffer: 4 * 1024 * 1024,
})).stdout);
try {
  const start = requestId => cli('start', '--request-id', requestId, '--brief-text', brief, '--dependency-run', prep.id,
    '--write-path', helperPath, '--write-path', testPath);
  const admitted = await start('integration');
  assert.equal(admitted.qualification.kind, 'controlled-fixture');
  if (scenario === 'deadline-cancel-join') {
    await until(async () => cancelling, Boolean, 55000);
    const pending = await factory.inspectRun(admitted.id);
    assert.equal(pending.status, 'running', 'Finalization must join a cancellation requested after execution close.');
    await assert.rejects(factory.startRun({ requestId: 'premature-overlap', brief, dependencyRunId: prep.id, scope }), { code: 'RUN_ACTIVE' });
    cancelGate.resolve();
  }
  const run = await until(() => cli('inspect', admitted.id), r => !['admitted', 'running'].includes(r.status), 55000);
  if (stop) await stop;
  assert.equal(run.outcome.reviewReady, false);
  assert.equal(run.deadlineAt, admitted.deadlineAt);
  assert.equal(initialized, scenario === 'missing-qualification-module' ? 0 : 1);
  assert.equal(await readFile(join(project.repositoryPath, helperPath), 'utf8'), baseHelper);
  assert.ok(!(run.qualification.checks ?? []).some(check => 'output' in check || 'report' in check));
  if (scenario === 'unexpected-qualifier-close') {
    assert.equal(run.status, 'interrupted', 'An unexpected cleanup rejection cannot be ignored just because its code is unfamiliar.');
    assert.equal(run.outcome.reason, 'drain_failed');
    assert.equal(run.workItem, undefined);
    await assert.rejects(factory.startRun({ requestId: 'premature-overlap', brief, dependencyRunId: prep.id, scope }), { code: 'RUN_ACTIVE' });
    await assert.rejects(factory.close(), { code: 'DRAIN_FAILED' });
    await assert.rejects(openFactory({ stateDir, project }), { code: 'BACKEND_OWNED' });
    process.stdout.write(`${JSON.stringify({ scenario, run, fenced: true })}\n`);
    process.exit(0); // The exact-owned harness drains the intentionally retained owner.
  }
  if (['green', 'stale-projection', 'stale-containment-entry'].includes(scenario)) {
    assert.equal(run.status, 'completed', JSON.stringify(run.outcome));
    assert.equal(run.outcome.kind, 'qualified');
    assert.equal(run.qualificationEvidence.status, 'qualified');
    assert.equal(run.qualificationEvidence.artifactStatus, 'verified');
    assert.equal(run.qualificationEvidence.stages.length, 10);
    assert.equal(run.workItem.runId, run.id);
    assert.equal(run.workItem.projectId, project.id);
    assert.equal(run.workItem.controlled, true);
    assert.equal(run.workItem.reviewReady, false);
    assert.equal(run.workItem.freshness, 'current');
    assert.equal(run.workItem.plan.provenance, 'model-authored');
    assert.equal(typeof run.workItem.plan.artifact, 'string');
    assert.equal(run.workItem.patch.artifact, 'qualification/patch.json');
    assert.equal(run.counters.toolRounds, 18);
    const patch = JSON.parse(await readFile(join(stateDir, 'runs', run.id, run.workItem.patch.artifact), 'utf8'));
    const added = patch.changes.find(change => change.path === testPath);
    assert.equal(added.before, null);
    assert.equal(Buffer.from(added.after.contentBase64, 'base64').toString(), candidateTest('green'));
    for (const name of ['proposal', 'approval', 'publish']) assert.equal(run.workItem[name], undefined);
    const listed = (await cli('list')).find(item => item.id === run.id);
    assert.equal(listed.workItem.id, run.workItem.id);
    assert.equal(listed.workItem.freshness, 'unverified');
    assert.equal(listed.workItem.reviewReady, false);
  } else {
    assert.equal(run.workItem, undefined);
    if (scenario === 'tautology' || scenario === 'final-lint') {
      assert.equal(run.status, 'blocked', JSON.stringify(run.outcome));
      assert.equal(run.outcome.reason, scenario === 'tautology' ? 'REGRESSION_UNVERIFIED' : 'FINAL_LINT_FAILED');
      assert.ok(run.reservations.filter(item => item.kind === 'tool-round').every(item => item.state === 'settled'),
        'A drained, terminal negative qualification must not leave never-dispatched rounds uncertain.');
      const next = await start('explicit-next');
      assert.notEqual(next.id, run.id, 'A drained blocked result must not fence an explicitly requested new run.');
      await factory.stopRun(next.id);
    } else if (scenario === 'missing-qualification-module') {
      assert.equal(run.status, 'blocked');
      assert.equal(run.outcome.reason, 'ADMISSION_FAILED');
      assert.equal(run.qualificationEvidence.status, 'not-started');
      assert.equal(run.counters.modelAttempts, 0);
      assert.equal(run.counters.toolRounds, 0);
      assert.equal(transport.requests.length, 0);
    } else if (scenario === 'no-change' || scenario === 'refusal') {
      assert.equal(run.qualificationEvidence.status, 'not-started');
      assert.equal(run.status, scenario === 'no-change' ? 'completed' : 'blocked');
    } else if (scenario.startsWith('stop-')) {
      assert.equal(run.status, 'stopped');
      assert.equal(run.outcome.reason, 'operator_stop');
      assert.notEqual(run.qualificationEvidence.status, 'qualified');
    } else if (['deadline-final', 'deadline-cancel-join'].includes(scenario)) {
      assert.equal(run.status, 'failed');
      assert.equal(run.outcome.kind, 'budget-limited');
      assert.equal(run.outcome.reason, 'RUN_DEADLINE');
    } else if (scenario === 'report-failure') {
      assert.equal(run.status, 'failed');
      assert.equal(run.outcome.reason, 'QUALIFICATION_PERSIST_FAILED');
    }
  }
  const attempts = transport.requests.length;
  assert.equal((await start('integration')).id, run.id);
  assert.equal(transport.requests.length, attempts);
  await server.close();
  const before = await readFile(join(stateDir, 'factory.sqlite'));
  const offline = await cli('inspect', run.id);
  assert.deepEqual(offline, run, 'Online and disconnected inspection expose the same retained result.');
  assert.deepEqual(await cli('inspect', run.id), offline);
  assert.deepEqual(await readFile(join(stateDir, 'factory.sqlite')), before);
  if (['green', 'stale-projection', 'stale-containment-entry'].includes(scenario)) {
    if (scenario === 'green') await writeFile(join(run.workspace.intent.worktree, 'late.mjs'), 'late source edit');
    else await appendFile(new URL(`src/${scenario === 'stale-projection' ? 'work-items' : 'containment-entry'}.mjs`, source), '\n// Controlled implementation edit.\n');
    const stale = await cli('inspect', run.id);
    assert.equal(stale.workItem.id, run.workItem.id);
    assert.equal(stale.workItem.freshness, 'invalidated');
    assert.equal(stale.workItem.reviewReady, false);
    assert.equal(stale.outcome.reviewReady, false);
    assert.equal(stale.qualificationEvidence.artifactStatus, 'invalid');
    assert.deepEqual(await readFile(join(stateDir, 'factory.sqlite')), before);
  }
  process.stdout.write(`${JSON.stringify({ scenario, run, offline, requests: attempts })}\n`);
} finally { cancelGate.resolve(); await server.close(); }
