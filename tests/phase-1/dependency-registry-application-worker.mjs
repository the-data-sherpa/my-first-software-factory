import assert from 'node:assert/strict';
import { openFactory, inspectHistory } from '../../src/factory.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { admitDependencies, prepareDependencies, verifyDependencyBundle } from '../../src/dependencies.mjs';
import { createFixtureExecution, createRunTools } from '../../src/execution.mjs';
import { registryFixture, bunPath } from './dependencies-registry-fixture.mjs';
import { until } from '../phase-0/helpers.mjs';

const [root, scenario = 'registry-authorized'] = process.argv.slice(2);
const authorized = scenario !== 'registry-no-authorization';
const fetchEntered = Promise.withResolvers();
const f = await registryFixture(root, scenario === 'registry-stop-fetch' ? { response(_request, response) {
  response.writeHead(200, { 'content-type': 'application/octet-stream' });
  response.flushHeaders();
  fetchEntered.resolve(); // Keep the controlled body open until application stop aborts it.
} } : {});
const project = { id: 'vanguard', repositoryPath: f.repositoryPath };
const workspace = { admit: admitWorkspace, prepare: prepareWorkspace };
let factory;
let admissions = 0;
let preparations = 0;
factory = await openFactory({ stateDir: f.stateDir, project, workspace, dependencyPreparation: {
  async admit(input) {
    admissions++;
    assert.equal(input.registry, authorized);
    const record = await factory.inspectRun(input.workspaceIntent.runId);
    assert.equal(record.dependencies.registry, authorized);
    assert.equal(f.requests.length, 0);
    return admitDependencies(input);
  },
  async prepare(intent, options) {
    preparations++;
    assert.equal(options.authorizeRegistryFetch, true);
    const record = await factory.inspectRun(intent.workspaceIntent.runId);
    assert.deepEqual(record.dependencies.intent, intent);
    // Always supply the trusted loopback transport. This worker never contacts a public registry.
    return prepareDependencies(intent, { ...options, registryTransport: f.registryTransport });
  },
} });
try {
  const brief = 'Goal: Prepare locked fixture packages.\nAcceptance criteria: Explicit owner fetch only.\nEvidence: A controlled loopback registry.';
  const admitted = await factory.startRun({ requestId: 'registry-source', brief });
  const source = await until(() => factory.inspectRun(admitted.id), (run) => run.status === 'blocked');
  assert.equal(f.requests.length, 0);
  await assert.rejects(factory.prepareDependencies(source.id, { bunPath, registry: 'true' }), { code: 'INVALID_ARGUMENTS' });
  assert.equal((await factory.inspectRun(source.id)).dependencies, undefined);
  await factory.prepareDependencies(source.id, { bunPath, ...(authorized ? { registry: true } : {}) });
  if (scenario === 'registry-stop-fetch') {
    await fetchEntered.promise;
    await factory.stopRun(source.id);
    await until(() => f.sockets.size, (count) => count === 0);
    await assert.rejects(openFactory({ stateDir: f.stateDir }), { code: 'BACKEND_OWNED' });
  }
  const prepared = await until(() => factory.inspectRun(admitted.id), (run) => ['failed', 'blocked', 'stopped'].includes(run.status));
  assert.equal(prepared.deadlineAt, source.deadlineAt);
  assert.deepEqual(prepared.counters, source.counters);
  assert.equal(admissions, 1);
  if (scenario === 'registry-stop-fetch') {
    assert.equal(prepared.status, 'stopped');
    assert.equal(prepared.dependencies.failure.code, 'DEPENDENCIES_ABORTED');
    assert.equal(f.requests.length, 1);
    assert.equal(f.sockets.size, 0);
  } else if (authorized) {
    assert.equal(prepared.status, 'blocked', JSON.stringify(prepared.outcome));
    assert.equal(prepared.dependencies.status, 'prepared');
    assert.equal(preparations, 1);
    await assert.rejects(factory.prepareDependencies(prepared.id, { bunPath }), { code: 'DEPENDENCIES_EXISTS' });
    assert.deepEqual(await factory.prepareDependencies(prepared.id, { bunPath, registry: true }), prepared);
    assert.deepEqual(f.requests.map((request) => request.path).sort(), [...f.archives.keys()].sort());
  } else {
    assert.equal(prepared.outcome.reason, 'DEPENDENCIES_UNSUPPORTED');
    assert.equal(prepared.dependencies.intent, undefined);
    assert.equal(preparations, 0);
    assert.equal(f.requests.length, 0);
  }
  await factory.close();
  assert.deepEqual(await inspectHistory({ stateDir: f.stateDir, runId: prepared.id }), prepared);
  let reuse;
  if (scenario === 'registry-reuse') {
    await f.close(); // There is no registry server available to the later executor.
    const fixture = createFixtureExecution();
    let check;
    factory = await openFactory({ stateDir: f.stateDir, project, workspace, execution: {
      ...fixture, mode: 'dependency-reuse-fixture', async start(input) {
        const dependencyBundle = await verifyDependencyBundle(prepared.dependencies.intent, { workspaceIntent: input.run.workspace.intent });
        const tools = await createRunTools({ ...input, dependencyBundle });
        try {
          check = await tools.check('vitest');
          const handle = await fixture.start(input);
          return { ...handle, async close() { try { await handle.close(); } finally { await tools.close(); } } };
        } catch (error) { await tools.close(); throw error; }
      },
    } });
    const next = await factory.startRun({ requestId: 'explicit-controlled-reuse', brief });
    const run = await until(() => factory.inspectRun(next.id), (item) => ['failed', 'completed'].includes(item.status));
    assert.equal(run.status, 'completed', JSON.stringify(run.outcome));
    assert.equal(run.workspace.intent.sourceManifest.id, prepared.workspace.intent.sourceManifest.id);
    assert.notEqual(run.workspace.intent.worktree, prepared.workspace.intent.worktree);
    await factory.close();
    assert.deepEqual(await inspectHistory({ stateDir: f.stateDir, runId: prepared.id }), prepared);
    assert.deepEqual(await inspectHistory({ stateDir: f.stateDir, runId: run.id }), run);
    reuse = { run, check };
  }
  process.stdout.write(`${JSON.stringify({ prepared, requests: f.requests, reuse })}\n`);
} finally { await factory.close(); await f.close(); }
