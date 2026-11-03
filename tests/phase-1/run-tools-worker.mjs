import assert from 'node:assert/strict';
import { openFactory } from '../../src/factory.mjs';
import { createFixtureExecution, createRunTools, inspectContainedChecks } from '../../src/execution.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { until } from '../phase-0/helpers.mjs';
import { join } from 'node:path';

const [stateDir, repositoryPath, scenario = 'complete'] = process.argv.slice(2);
const fixture = createFixtureExecution();
const ready = Promise.withResolvers();
let verification;
let tools;
const factory = await openFactory({ stateDir, project: { id: 'vanguard', repositoryPath },
  workspace: { admit: admitWorkspace, prepare: prepareWorkspace }, execution: {
    ...fixture, mode: 'contained-fixture',
    async start(input) {
      tools = await createRunTools(input);
      verification = tools.verification;
      try {
        if (scenario === 'stop') {
          const checking = tools.check('boundary');
          ready.resolve();
          return { finished: new Promise(() => {}), cancel: async () => {}, close: async () => {
            await tools.close();
            await checking;
          } };
        }
        assert.equal((await tools.read('logic.txt')).text, 'committed source\n');
        await tools.write('draft.txt', 'controlled draft\n');
        assert.equal((await tools.read('draft.txt')).text, 'controlled draft\n');
        await assert.rejects(tools.read('.git'), { code: 'UNSAFE_PATH' });
        await assert.rejects(tools.read('../control/prepared.json'), { code: 'UNSAFE_PATH' });
        await assert.rejects(tools.check('vitest'), { code: 'DEPENDENCIES_NOT_PREPARED' });
        assert.equal((await tools.check('boundary')).passed, true);
        const handle = await fixture.start(input);
        return { ...handle, close: async () => { try { await handle.close(); } finally { await tools.close(); } } };
      } catch (error) { await tools.close(); throw error; }
    },
  },
});
try {
  const admitted = await factory.startRun({ requestId: 'contained-workspace', brief: 'Goal: Exercise bounded tools.\nAcceptance criteria: Retain source and budget receipts.\nEvidence: Disposable scoped fixture.' });
  if (scenario === 'stop') { await ready.promise; await factory.stopRun(admitted.id); }
  const run = await until(() => factory.inspectRun(admitted.id), (run) => ['completed', 'failed', 'stopped', 'interrupted'].includes(run.status));
  assert.equal(run.status, scenario === 'stop' ? 'stopped' : 'completed');
  await assert.rejects(tools.write('late.txt', 'must not write'), { code: 'RUN_STOPPING' });
  await factory.close();
  const checks = await inspectContainedChecks(join(stateDir, 'runs', run.id, 'checks'));
  process.stdout.write(`${JSON.stringify({ run, checks, verification })}\n`);
} finally { await factory.close(); }
