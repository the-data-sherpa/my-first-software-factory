// Controlled process-boundary checkpoints. No credentials, repository tools or external provider.
import { openFactory } from '../../src/factory.mjs';
import { createFixtureExecution } from '../../src/execution.mjs';
import { createPartialEffectFixture } from './recovery-fixtures.mjs';

const [stateDir, checkpoint = 'request', admittedAt] = process.argv.slice(2);
const fixture = checkpoint.startsWith('uncertain') ? createPartialEffectFixture({ delayMs: checkpoint === 'uncertain-completion' ? 0 : 60_000 })
  : createFixtureExecution({ delayMs: checkpoint === 'completion' ? 0 : 60_000 });
const hold = (event, runId) => {
  process.send({ event, runId });
  return new Promise(() => {});
};
const factory = await openFactory({ stateDir,
  ...(admittedAt ? { clock: { now: () => Number(admittedAt), setTimeout, clearTimeout } } : {}),
  execution: { ...fixture, async start(input) {
    if (checkpoint === 'intent') return hold('checkpoint', input.runId);
    if (checkpoint === 'reserved') {
      input.budget.reserveModelAttempt({ generationId: input.requestId });
      return hold('checkpoint', input.runId);
    }
    if (checkpoint === 'budget') {
      for (let index = 0; index < 38; index++) input.budget.reserveModelAttempt({ generationId: `fixture-prior-${index}` });
    }
    if (checkpoint === 'tool-limit') {
      for (let index = 0; index < 30; index++) input.budget.reserveToolRound({ roundId: `fixture-round-${index}` });
    }
    const handle = await fixture.start(input);
    if (checkpoint === 'drain-failure') {
      setImmediate(async () => {
        const codes = [];
        for (const operation of [() => factory.stopRun(input.runId), () => openFactory({ stateDir }),
          () => factory.startRun({ requestId: 'overlap', brief: input.brief.text }),
          () => factory.resumeRun(input.runId, { review: 'Cannot bypass failed drainage.' })]) {
          try { await operation(); codes.push('unexpected-success'); } catch (error) { codes.push(error.code); }
        }
        process.send({ event: 'checkpoint', runId: input.runId, codes });
      });
      return { ...handle, close: async () => { throw new Error('Controlled unconfirmed drainage.'); } };
    }
    if (checkpoint === 'stop-intent') {
      setImmediate(() => { void factory.stopRun(input.runId); });
      return { ...handle, close: () => hold('checkpoint', input.runId) };
    }
    if (['completion', 'uncertain-completion'].includes(checkpoint)) await handle.finished;
    return hold('checkpoint', input.runId);
  } },
});
const run = await factory.startRun({ requestId: 'process-original', brief: 'Goal: Recover safely.\nAcceptance criteria: Retain original limits.\nEvidence: Disposable fixture.' });
process.send({ event: 'admitted', run });
