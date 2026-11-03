import { join } from 'node:path';
import { openFactory } from '../../src/factory.mjs';
import { createModelExecution, createModelRequests } from '../../src/execution.mjs';
import { controlledRuntime, controlledTransport, retainedBudget } from './model-fixtures.mjs';

// Defense in depth: every authorized request uses the injected in-memory transport.
globalThis.fetch = async () => { throw new Error('Uncontrolled network is forbidden in the model worker.'); };
if (process.argv[2] === '--missing-auth') {
  const transport = controlledTransport();
  const requests = createModelRequests({ modelRuntime: await controlledRuntime({ type: 'api_key', key: '' }),
    budget: retainedBudget().budget, fetch: transport.fetch });
  const result = await requests.preflight();
  await requests.close();
  process.send({ reason: result.reason, requests: transport.requests.length });
  process.disconnect();
} else {
  const stateDir = process.argv[2];
  const execution = createModelExecution({ modelRuntime: await controlledRuntime(), fetch: async () => {
    process.send({ event: 'request' });
    return new Response(new ReadableStream({}), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const factory = await openFactory({ stateDir, project: { id: 'vanguard', repositoryPath: join(stateDir, 'unused') }, execution });
  const run = await factory.startRun({ requestId: 'crashed-model', brief: 'Goal: Crash a controlled request.\nAcceptance criteria: Passive recovery.\nEvidence: In-memory transport.' });
  process.send({ event: 'admitted', run });
}
