// Controlled Responses transport for the composed executor. The model only proposes
// tool calls. The real executor tools write every byte; this file never writes source.
import { eventsResponse } from '../phase-1/model-fixtures.mjs';
import { executorToolResponse } from './executor-model.mjs';
import { draftHelper, candidateTest } from './qualification-project.mjs';

export const helperPath = 'convex/syncHelpers.ts';
export const testPath = 'lib/__tests__/normalize-address.test.ts';
export const scope = { writePaths: [helperPath, testPath] };

/** Request 1 is the admission smoke. Later requests drive the executor's tool loop. */
export function qualifiedExecutorReply({ variant, extraReads = 0, onWork = () => {} }) {
  const candidate = candidateTest(variant === 'tautology' ? 'candidate-tautology' : 'green');
  return async (request, index) => {
    if (index === 1) return variant === 'refusal' ? new Response('controlled refusal', { status: 401 }) : eventsResponse();
    onWork(index);
    if (variant === 'no-change' && index === 2) return eventsResponse({ text: 'No change needed. This is not maintenance readiness.' });
    if (index === 2) return executorToolResponse('read_file', { path: helperPath, offset: 0 }, 'read',
      'Plan: inspect normalizeAddress, canonicalize whitespace after removing unit markers, and retain a focused regression test.');
    const step = index - 3;
    if (step < extraReads) return executorToolResponse('read_file', { path: helperPath, offset: 0 }, `reread-${step}`);
    if (step === extraReads) return executorToolResponse('write_file', { path: helperPath, text: draftHelper }, 'helper');
    if (step === extraReads + 1) return executorToolResponse('write_file', { path: testPath, text: candidate }, 'test');
    return eventsResponse({ text: 'Draft retained; independent qualification is required.' });
  };
}
