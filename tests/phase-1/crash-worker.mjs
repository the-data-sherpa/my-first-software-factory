// Disposable OS fixture: die after execution admission but before the app receives its receipt ID.
import { openFactory } from '../../src/factory.mjs';
import { createFixtureExecution } from '../../src/execution.mjs';

const fixture = createFixtureExecution({ delayMs: 60_000 });
const factory = await openFactory({
  stateDir: process.argv[2],
  execution: {
    ...fixture,
    async start(input) {
      await fixture.start(input);
      process.send({ event: 'receipt-committed', runId: input.runId });
      return new Promise(() => {}); // Parent kills this exact child at the public execution seam.
    },
  },
});
const brief = '# Goal\nExercise a retained fixture run.\n## Acceptance criteria\nThe record survives reconnecting.\n## Evidence\nA disposable fixture.\n';
const admitted = await factory.startRun({ requestId: 'crash-window-request', brief });
process.send({ event: 'admitted', run: admitted });
