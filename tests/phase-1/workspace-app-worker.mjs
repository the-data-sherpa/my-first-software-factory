import { openFactory } from '../../src/factory.mjs';
import { createFixtureExecution } from '../../src/execution.mjs';
import { admitWorkspace, prepareWorkspace, inspectWorkspace } from '../../src/workspace.mjs';

const [stateDir, repositoryPath, checkpoint, mode] = process.argv.slice(2);
const hold = async (intent) => {
  process.send({ event: 'checkpoint', runId: intent.runId });
  await new Promise(() => {});
};
await (await openFactory({ stateDir, project: { id: 'vanguard', repositoryPath },
  ...(mode === 'workspace-only' ? {} : { execution: createFixtureExecution() }), workspace: {
  admit: admitWorkspace, inspect: inspectWorkspace,
  async prepare(intent, options) {
    if (checkpoint === 'saved-intent') await hold(intent);
    const receipt = await prepareWorkspace(intent, options);
    if (checkpoint === 'prepared-receipt') await hold(intent);
    return receipt;
  },
} })).startRun({ requestId: 'workspace-crash', brief: 'Goal: Retain source.\nAcceptance criteria: Inspect passively.\nEvidence: Disposable process fixture.' });
