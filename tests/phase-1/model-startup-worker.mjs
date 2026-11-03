// Controlled startup failure at the accepted execution boundary. No external transport.
import { openFactory } from '../../src/factory.mjs';
import { createModelExecution } from '../../src/execution.mjs';
import { controlledRuntime } from './model-fixtures.mjs';
import { until } from '../phase-0/helpers.mjs';

const [stateDir, scenario] = process.argv.slice(2);
globalThis.fetch = async () => { throw new Error('No external transport is authorized.'); };
const entered = Promise.withResolvers();
let dispatches = 0;
let stopping;
const execution = createModelExecution({ modelRuntime: await controlledRuntime(), fetch: async () => {
  dispatches++;
  return new Response(new ReadableStream({ start() { entered.resolve(); }, cancel() {
    throw new Error('Controlled undrained startup response.');
  } }), { headers: { 'content-type': 'text/event-stream' } });
} });
const factory = await openFactory({ stateDir, execution: { ...execution, async start(input) {
  const handle = await execution.start(input);
  await entered.promise;
  if (scenario === 'stop') {
    stopping = factory.stopRun(input.runId);
    stopping.catch(() => {});
  }
  // Simulate a startup failure before transferring this real handle to the application.
  // The real body cancellation fails; the adapter's close must report MODEL_DRAIN_FAILED.
  await handle.close();
  throw new Error('Controlled cleanup unexpectedly succeeded.');
} } });
const brief = 'Goal: Retain unconfirmed startup.\nAcceptance criteria: No overlapping admission.\nEvidence: Controlled model cancellation.';
const admitted = await factory.startRun({ requestId: 'startup-drain', brief });
const record = await until(() => factory.inspectRun(admitted.id), (run) => ['failed', 'stopped', 'interrupted'].includes(run.status));
const code = async (operation) => {
  try { const result = await operation(); await result?.close?.(); return 'unexpected-success'; }
  catch (error) { return error.code; }
};
const ownerBefore = await code(() => openFactory({ stateDir }));
const overlap = await code(() => factory.startRun({ requestId: 'cannot-overlap', brief }));
const replacement = await code(() => factory.replaceRun(admitted.id, { requestId: 'cannot-replace', review: 'Cleanup remains unconfirmed.' }));
const stop = await code(() => stopping ?? factory.stopRun(admitted.id));
const close = await code(() => factory.close());
const ownerAfter = await code(() => openFactory({ stateDir }));
process.send({ record, ownerBefore, overlap, replacement, stop, close, ownerAfter, dispatches });
setInterval(() => {}, 1000); // Parent kills only this test worker, releasing the OS-owned lock.
