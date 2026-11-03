import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryModelsStore } from '@earendil-works/pi-ai';
import { FactoryError } from './storage.mjs';
import { MODEL_ROUTE } from './model.mjs';
import { createModelExecution } from './model-execution.mjs';
import { verifyContainmentEnvelope } from './containment.mjs';

/** Owner-only opt-in. Construction and recovery never discover credentials. Only an
 * admitted start creates Pi's runtime, with its existing credential integration.
 * No catalog refresh, user model overrides, extensions or repository tools.
 */
export function createOwnerModelPreflight({ createRuntime = (options) => ModelRuntime.create(options), fetch, clock } = {}) {
  return Object.freeze({
    mode: 'model-preflight', model: MODEL_ROUTE,
    async start(input) {
      input.budget.assertActive();
      try { await verifyContainmentEnvelope(); }
      catch { throw new FactoryError('CONTAINMENT_REQUIRED', 'Model preflight requires the verified foreground resource scope. No credentials were loaded.'); }
      input.budget.assertActive();
      let modelRuntime;
      try {
        modelRuntime = await createRuntime({ modelsPath: null, modelsStore: new InMemoryModelsStore(),
          refreshOnCreate: false, allowModelNetwork: false, signal: input.signal });
      } catch {
        input.budget.assertActive();
        throw new FactoryError('MODEL_INITIALIZATION_FAILED', 'The selected model runtime could not initialize. No fallback was attempted.');
      }
      input.budget.assertActive();
      return createModelExecution({ modelRuntime, fetch, clock }).start(input);
    },
    async resume() {
      throw new FactoryError('UNSAFE_RESUME', 'Model recovery is not reconciled. Never resubmit the original input.');
    },
    async assessRecovery() {
      return { kind: 'model-only', quiescent: false, resumable: false,
        evidence: 'No trusted model-effect reconciliation is installed. Recovery does not load credentials or issue requests.' };
    },
  });
}
