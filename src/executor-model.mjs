import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { FactoryError } from './storage.mjs';
import { executionReceiptDocument as Receipt, readExecutionResult } from './execution.mjs';
import { createExecutorModelRequests, modelFailure } from './model.mjs';
import { verifyActivatedAdmission } from './admission.mjs';
import { digest } from './executor-artifacts.mjs';

export async function startExecutorModel({ input, authority, tools, instructions, verify, journal, fail, fetch, clock }) {
  const { directory, runId, requestId, budget, signal } = input;
  const requests = await createExecutorModelRequests({ authority, budget, signal, fetch, clock });
  const activation = await verifyActivatedAdmission(authority);
  let storage; let harness; let conversation; let closing; let cancelPending;
  let lastResponse;
  const ids = new Set();
  const phaseRequestId = `executor:${digest(requestId)}`;
  const abort = () => { cancel().catch(fail); };
  async function cancel() {
    // Normal finalization has already joined model work. Do not abort a closed
    // Harness and misclassify that API rejection as uncertain transport drainage.
    if (closing) return closing;
    return cancelPending ??= (async () => {
      const results = await Promise.allSettled([requests.cancel(), conversation?.abort(context)]);
      if (results.some(r => r.status === 'rejected')) throw new FactoryError('MODEL_DRAIN_FAILED', 'Model cancellation drainage is unconfirmed.');
    })();
  }
  async function close() {
    return closing ??= (async () => {
      signal.removeEventListener('abort', abort);
      const results = await Promise.allSettled([requests.close(), harness ? harness.close(context) : storage?.close(context), cancelPending]);
      if (results.some(r => r.status === 'rejected')) throw new FactoryError('MODEL_DRAIN_FAILED', 'Model execution drainage is unconfirmed.');
    })();
  }
  try {
    await verify();
    const models = {
      getAuth() { throw new FactoryError('MODEL_API_DISABLED', 'Only bounded requests are available.'); },
      getModel: (provider, id) => provider === 'openai' && id === 'gpt-6.1-sol' ? activation.modelRuntime.getPhysicalModel(provider, id) : undefined,
      streamSimple(_model, transcript, options) {
        const stream = new AssistantMessageEventStream();
        (async () => {
          await verify();
          // A generation is the response to one fixed tool-result frontier. Transient
          // retry stays at that frontier and spends its own original reservation.
          const generationId = `${phaseRequestId}:${transcript.messages.filter(m => m.role === 'toolResult').length}`;
          const prior = budget.modelAttempts().filter(a => a.generationId === generationId);
          await journal({ type: 'model-intent', generationId, retry: prior.length > 0 });
          const response = await requests.request({ generationId, retry: prior.length > 0,
            messages: transcript.messages, sessionId: options?.sessionId });
          lastResponse = response;
          await verify(); // Late cancellation or changed input cannot dispatch pending calls.
          const calls = response.message.content.filter(b => b.type === 'toolCall');
          for (const call of calls) {
            const id = call.id.split('|')[0];
            if (ids.has(id)) throw new FactoryError('EXECUTOR_CALL_REUSED', 'A model call identity cannot be reused.');
            ids.add(id);
          }
          await journal({ type: 'model-response', generationId, message: response.message, accounting: response.accounting });
          if (!response.ok && response.reason !== 'MODEL_TRANSIENT') fail(new FactoryError(response.reason ?? 'EXECUTOR_MODEL_FAILED', 'The bounded model request did not complete.'));
          const message = response.message;
          const error = ['error', 'aborted'].includes(message.stopReason);
          stream.push(error ? { type: 'error', reason: message.stopReason, error: message } : { type: 'done', reason: message.stopReason, message });
          stream.end();
        })().catch(error => {
          fail(error);
          const message = modelFailure(error.code ?? 'EXECUTOR_MODEL_FAILED');
          stream.push({ type: 'error', reason: 'error', error: message }); stream.end();
        });
        return stream;
      },
    };
    const extension = { name: 'factory.repository', tools };
    const registry = createRegistry();
    registry.install(extension);
    storage = await openNodeSqliteStorage(join(directory, 'execution.sqlite'));
    harness = await Harness.open(storage, { models, registry, settings: {
      retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 }, compaction: { enabled: false }, afterFailedRun: 'withdraw',
      toolExecution: 'sequential', stream: { maxRetries: 0, timeoutMs: 180000, transport: 'sse' },
    } }, context);
    const smoke = await harness.snapshot(Receipt, context);
    const live = await harness.inspect(context);
    const previous = await readExecutionResult(harness);
    if (smoke?.runId !== runId || smoke.requestId !== requestId || smoke.safety?.purpose !== 'preflight'
      || previous.status !== 'done' || live.tasks.length || live.submissions.length) {
      throw new FactoryError('EXECUTOR_RECEIPT', 'Only the completed same-run admission smoke may precede executor activation. Pending work cannot be reopened.');
    }
    await verify();
    conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: {
      model: { provider: 'openai', modelId: 'gpt-6.1-sol' }, thinkingLevel: 'low', tools, extensions: [extension], instructions, maxTurns: 30,
    } }, context);
    const submissionId = await harness.commit(async tx => {
      const id = await conversation.submit(tx, { type: 'input', requestId: phaseRequestId, whenBusy: 'reject',
        content: 'Develop your own plan from the immutable task context, then use only the offered bounded tools. Retain an honest local draft or explain no-change.' });
      Object.assign(await tx.doc(Receipt), { version: 1, runId, requestId, submissionId: id, conversationId: conversation.id,
        phaseRequestId, smoke: structuredClone(smoke), safety: { kind: 'repository-executor', version: 1 } });
      return id;
    }, context);
    await journal({ type: 'submission', submissionId, phaseRequestId, conversationId: conversation.id });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { await cancel(); throw new FactoryError('RUN_STOPPING', 'Executor stopped before scheduling.'); }
    const submission = await harness.submission(submissionId, context);
    const finished = submission.wait(context).then(async () => ({ ...await readExecutionResult(harness), lastResponse }));
    finished.catch(() => {});
    return { submissionId, finished, cancel, close };
  } catch (error) { await close(); throw error; }
}
