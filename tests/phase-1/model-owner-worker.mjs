// Actual accepted foreground scope, controlled ModelRuntime credentials and transport only.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openFactory, inspectHistory } from '../../src/factory.mjs';
import { createOwnerModelPreflight } from '../../src/execution.mjs';
import { controlledRuntime, controlledTransport } from './model-fixtures.mjs';
import { until } from '../phase-0/helpers.mjs';

const [directory, scenario] = process.argv.slice(2);
globalThis.fetch = async () => { throw new Error('External transport is forbidden.'); };
const stateDir = join(directory, 'state');
const project = { id: 'vanguard', repositoryPath: join(directory, 'unread-repository') };
const brief = 'Goal: Controlled owner smoke.\nAcceptance criteria: No implicit model access.\nEvidence: In-memory credentials and transport.';
const entered = Promise.withResolvers();
const release = Promise.withResolvers();
const transport = controlledTransport();
let creations = 0;
let factory;
const execution = createOwnerModelPreflight({ fetch: transport.fetch, createRuntime: async (options) => {
  creations++;
  assert.equal((await factory.listRuns())[0].status, 'running');
  assert.equal(options.refreshOnCreate, false);
  assert.equal(options.allowModelNetwork, false);
  assert.equal(options.modelsPath, null);
  entered.resolve(options.signal);
  if (scenario === 'stop') await release.promise;
  return controlledRuntime();
} });
factory = await openFactory({ stateDir, project, execution });
try {
  assert.deepEqual(await factory.listRuns(), []);
  assert.equal(creations, 0);
  const admitted = await factory.startRun({ requestId: 'explicit-owner-smoke', brief });
  let run;
  if (scenario === 'stop') {
    const signal = await entered.promise;
    const stopping = factory.stopRun(admitted.id);
    assert.equal(signal.aborted, true);
    await assert.rejects(factory.startRun({ requestId: 'cannot-overlap-initialization', brief }), { code: 'RUN_ACTIVE' });
    release.resolve();
    run = await stopping;
  } else {
    run = await until(() => factory.inspectRun(admitted.id), (item) => item.status === 'completed');
    await factory.close();
    assert.deepEqual(await inspectHistory({ stateDir, runId: run.id }), run);
    factory = await openFactory({ stateDir, project, execution });
    assert.deepEqual(await factory.startRun({ requestId: 'explicit-owner-smoke', brief }), run);
    assert.deepEqual(await factory.inspectRun(run.id), run);
  }
  process.stdout.write(`${JSON.stringify({ run, creations, dispatches: transport.requests.length })}\n`);
} finally { release.resolve(); await factory.close(); }
