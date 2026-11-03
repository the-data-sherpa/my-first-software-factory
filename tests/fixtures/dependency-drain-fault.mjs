// Faults are process-local test instrumentation: deny namespace SIGKILL and the
// subsequent exact-scope kill. No manager configuration or host permissions change.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { StatementSync } from 'node:sqlite';
const [root, owner] = process.argv.slice(2);
const runStatement = StatementSync.prototype.run;
let failNextWrite = false;
StatementSync.prototype.run = function (...args) {
  if (failNextWrite) {
    failNextWrite = false;
    throw Object.assign(new Error('Injected transient persistence failure'), { code: 'SQLITE_IOERR' });
  }
  return runStatement.apply(this, args);
};
const execFile = childProcess.execFile; const kill = process.kill;
let deny = false; let sandbox; const scopeKills = []; const deniedPids = [];
childProcess.execFile = (command, args, ...tail) => {
  if (deny && command === '/usr/bin/systemctl' && args.includes('kill')) {
    scopeKills.push(args.at(-1));
    queueMicrotask(() => tail.at(-1)(Object.assign(new Error('Injected manager refusal'), { code: 'EPERM' })));
    return {};
  }
  return execFile(command, args, ...tail);
};
const injectedExecFile = childProcess.execFile;
injectedExecFile[promisify.custom] = (...args) => new Promise((resolve, reject) => {
  injectedExecFile(...args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
});
syncBuiltinESMExports();
// Import after instrumentation, including modules that promisify execFile.
const { dependencyFixture } = await import('../../src/dependencies-diagnostics.mjs');
const { admitDependencies, prepareDependencies, prepareOwnerDependencies, dependencyDirectory, serializeDependencyError } = await import('../../src/dependencies.mjs');
const { verifyContainmentEnvelope } = await import('../../src/containment.mjs');
const { stopPreparationStartup } = await import('../../src/containment-startup-fixture.mjs');
const { acquireOwner } = await import('../../src/storage.mjs');
const { waitForCleanup, livingProcesses } = await import('../../src/containment-process-fixtures.mjs');
const f = await dependencyFixture(root);
const envelope = await verifyContainmentEnvelope();
const fault = stopPreparationStartup(root, 'proof', envelope);
process.kill = (pid, signal) => {
  if (deny && pid === sandbox.pid && signal === 'SIGKILL') {
    deniedPids.push(pid); throw Object.assign(new Error('Injected namespace signal refusal'), { code: 'EPERM' });
  }
  return kill(pid, signal);
};
let ready; let result; let factory;
try {
  if (owner === 'standalone') {
    const controller = new AbortController();
    const operation = prepareOwnerDependencies(f.intent, { signal: controller.signal }); operation.catch(() => {});
    ready = await fault.ready; sandbox = ready.observed[1]; deny = true; controller.abort();
    let failure;
    await assert.rejects(operation, (error) => { failure = serializeDependencyError(error); return error.code === 'DRAIN_FAILED'; });
    assert.equal(failure.code, 'DRAIN_FAILED');
    const retained = JSON.parse(await readFile(`${dependencyDirectory(f.intent)}/failure.json`, 'utf8'));
    assert.equal(retained.code, 'DRAIN_FAILED');
    result = { failure, retained };
  } else {
    const { openFactory } = await import('../../src/factory.mjs');
    const { admitWorkspace, prepareWorkspace } = await import('../../src/workspace.mjs');
    factory = await openFactory({ stateDir: f.workspaceIntent.stateDir, project: { id: 'vanguard', repositoryPath: f.repositoryPath },
      workspace: { admit: admitWorkspace, prepare: prepareWorkspace },
      dependencyPreparation: {
        admit: admitDependencies,
        async prepare(...args) {
          try { return await prepareDependencies(...args); }
          catch (error) {
            // Fail one storage mutation after the real preparation reports failed
            // drainage. Assertions remain at the application/ownership interfaces.
            if (owner === 'application-persistence' && error.code === 'DRAIN_FAILED') failNextWrite = true;
            throw error;
          }
        },
      } });
    const brief = 'Goal: Test preparation drainage.\nAcceptance criteria: Retain ownership on failure.\nEvidence: Disposable OS fixture.';
    const run = await factory.startRun({ requestId: 'drain-source', brief });
    while ((await factory.inspectRun(run.id)).status !== 'blocked') await delay(5);
    await factory.prepareDependencies(run.id, { bunPath: '/home/cowen/.bun/bin/bun' });
    ready = await fault.ready; sandbox = ready.observed[1]; deny = true;
    let stopFailure;
    await assert.rejects(factory.stopRun(run.id), (error) => { stopFailure = error; return error.code === 'DRAIN_FAILED'; });
    const retained = await factory.inspectRun(run.id);
    assert.equal(retained.status, 'interrupted');
    assert.equal(retained.outcome.reason, 'drain_failed');
    if (owner === 'application-persistence') assert.equal(retained.dependencies.failure, undefined);
    else assert.equal(retained.dependencies.failure.code, 'DRAIN_FAILED');
    await assert.rejects(factory.startRun({ requestId: 'cannot-overlap', brief }), { code: 'RUN_ACTIVE' });
    await assert.rejects(factory.close(), { code: 'DRAIN_FAILED' });
    result = { status: retained.status, reason: retained.outcome.reason,
      failure: retained.dependencies.failure ?? { code: stopFailure.code }, failureRecordUnavailable: !retained.dependencies.failure };
  }
  await assert.rejects(acquireOwner(f.workspaceIntent.stateDir), { code: 'BACKEND_OWNED' });
  await assert.rejects(verifyContainmentEnvelope(), { code: 'CONTAINMENT_REQUIRED' });
  assert.deepEqual(scopeKills, [envelope.unit]);
  assert.deepEqual(deniedPids, [sandbox.pid]);
  assert.equal((await livingProcesses([sandbox])).length, 1);
  result = { ...result, ownerRetained: true, executionFenced: true, scopeKills, deniedPids, unit: envelope.unit };
} finally {
  // Test-owned teardown only, after assertions. Production never releases this
  // fence or retries failed drainage. The outer harness still owns the whole scope.
  deny = false; process.kill = kill; childProcess.execFile = execFile; StatementSync.prototype.run = runStatement; syncBuiltinESMExports();
  if (ready) {
    for (const identity of [...ready.observed].reverse()) {
      if ((await livingProcesses([identity])).length) kill(identity.pid, 'SIGKILL');
      assert.deepEqual(await waitForCleanup([identity]), []);
    }
  }
  fault.restore();
}
process.stdout.write(`${JSON.stringify(result)}\n`);
