import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { privateFile, FactoryError, STORAGE_VERSIONS } from './storage.mjs';
import { executionReceiptDocument as Receipt, readExecutionResult } from './execution.mjs';
import { createModelRequests, modelFailure, MODEL_ROUTE, SELECTED_MODEL } from './model.mjs';

/** Explicit owner-operated model adapter. No default runtime creation, tools, extensions,
 * resource discovery or automatic enablement. 'bounded-no-tools' exercises the normal request
 * path after its smoke; it is NOT the repository executor or proof of maintenance success.
 */
export function createModelExecution({ modelRuntime, fetch, clock, purpose = 'preflight' } = {}) {
  if (!modelRuntime || !['preflight', 'bounded-no-tools'].includes(purpose)) {
    throw new FactoryError('MODEL_CONFIGURATION', 'Supply ModelRuntime and an explicit supported model operation.');
  }
  const mode = purpose === 'preflight' ? 'model-preflight' : 'model-bounded-no-tools';
  async function start({ directory, runId, requestId, brief, budget, signal }) {
    const requests = createModelRequests({ modelRuntime, budget, signal, fetch, clock });
    let harness;
    let root;
    let storage;
    let closing;
    async function close() {
      closing ??= (async () => {
        // Request abort AND drain, independently of SQLite/harness closure.
        const results = await Promise.allSettled([requests.close(), harness ? harness.close(context) : storage?.close(context)]);
        if (results.some((result) => result.status === 'rejected')) {
          throw new FactoryError('MODEL_DRAIN_FAILED', 'Model execution cleanup is unconfirmed. Keep admission fenced.');
        }
      })();
      return closing;
    }
    try {
      budget.assertActive();
      const path = join(directory, 'execution.sqlite');
      await privateFile(path);
      // Narrow Models facade: no compaction, deferred API or alternate route can bypass the gate.
      const models = {
        getAuth() { throw new FactoryError('MODEL_API_DISABLED', 'Only factory-bounded model requests are enabled.'); },
        getModel: (provider, id) => provider === SELECTED_MODEL.provider && id === SELECTED_MODEL.modelId ? modelRuntime.getPhysicalModel(provider, id) : undefined,
        streamSimple(_model, transcript, options) {
          const stream = new AssistantMessageEventStream();
          (async () => {
            const smoke = await requests.preflight();
            let message = smoke.message;
            if (smoke.ok && purpose !== 'preflight') {
              const prior = budget.modelAttempts().filter((item) => item.generationId === requestId);
              message = (await requests.request({ generationId: requestId, retry: prior.length > 0,
                messages: transcript.messages, sessionId: options?.sessionId })).message;
            } else if (!smoke.ok) {
              // Smoke errors, including transient failures, must never get a durable retry.
              message = modelFailure('MODEL_PREFLIGHT_FAILED');
            }
            message ??= modelFailure('MODEL_PREFLIGHT_ALREADY_USED');
            const failed = ['error', 'aborted'].includes(message.stopReason);
            stream.push(failed ? { type: 'error', reason: message.stopReason, error: message }
              : { type: 'done', reason: message.stopReason, message });
            stream.end();
          })().catch(() => {
            const error = modelFailure('MODEL_EXECUTION_BLOCKED');
            stream.push({ type: 'error', reason: 'error', error });
            stream.end();
          });
          return stream;
        },
      };
      storage = await openNodeSqliteStorage(path);
      harness = await Harness.open(storage, { models, registry: createRegistry(), settings: {
        retry: { enabled: purpose !== 'preflight', maxRetries: purpose === 'preflight' ? 0 : 1, baseDelayMs: 0 },
        compaction: { enabled: false }, afterFailedRun: 'withdraw',
        stream: { maxRetries: 0, timeoutMs: 180_000, transport: 'sse' },
      } }, context);
      // No input lookup via resubmission, and never allow start to reuse an existing receipt.
      if ((await harness.snapshot(Receipt, context))?.submissionId) {
        throw new FactoryError('RECEIPT_EXISTS', 'This run already has an execution submission. Inspection is passive; resume is unavailable.');
      }
      root = await harness.root(context, { agent: {
        model: SELECTED_MODEL, thinkingLevel: 'low', tools: [], extensions: [], maxTurns: 1,
      } });
      budget.assertActive();
      const submissionId = await harness.commit(async (tx) => {
        const id = await root.submit(tx, { type: 'input', requestId, whenBusy: 'reject',
          content: purpose === 'preflight' ? 'Reply briefly with OK. Do not use tools.' : brief.text });
        Object.assign(await tx.doc(Receipt), { version: STORAGE_VERSIONS.execution, runId, requestId, submissionId: id,
          safety: { kind: 'model-only', version: 1, purpose } });
        return id;
      }, context);
      budget.assertActive();
      const submission = await harness.submission(submissionId, context);
      const finished = submission.wait(context).then(() => readExecutionResult(harness));
      finished.catch(() => {});
      return { submissionId, finished, close,
        async cancel() {
          const results = await Promise.allSettled([requests.cancel(), root.abort(context)]);
          if (results.some((result) => result.status === 'rejected')) {
            throw new FactoryError('MODEL_DRAIN_FAILED', 'Model cancellation could not confirm drainage.');
          }
        } };
    } catch (error) {
      await close(); // A startup rejection cannot leave owned execution behind.
      if (error instanceof FactoryError) throw error;
      throw new FactoryError('MODEL_START_FAILED', 'Model execution could not start. Retain the run for inspection.');
    }
  }
  return Object.freeze({ mode, model: MODEL_ROUTE, start,
    async resume() { throw new FactoryError('UNSAFE_RESUME', 'Production model recovery is not reconciled. Never resubmit the original input.'); },
    async assessRecovery() {
      return { kind: 'model-only', quiescent: false, resumable: false,
        evidence: 'No production effect reconciliation is implemented. Passive inspection cannot establish provider completion or authorize another request.' };
    },
  });
}
