import { FactoryError } from './storage.mjs';
import { isDeepStrictEqual } from 'node:util';
import { EXECUTOR_TOOLS, validateExecutorCall } from './executor-policy.mjs';
import { verifyActivatedAdmission } from './admission.mjs';
import { cancellableResponse } from './model-transport.mjs';
import { terminalUsage, modelAccounting, pricedUsage } from './model-accounting.mjs';
import { isRetryableAssistantError } from '@earendil-works/pi-ai/utils/retry';

export const MODEL_ROUTE = 'openai/gpt-6.1-sol';
export const MODEL_LIMITS = Object.freeze({ outputTokens: 8192, requestMs: 180_000, smokeOutputTokens: 1024, smokeMs: 60_000 });
const endpoint = 'https://api.openai.com/v1/responses';

export function modelFailure(reason) {
  return { role: 'assistant', api: 'openai-responses', provider: 'openai', model: 'gpt-6.1-sol',
    content: [], timestamp: Date.now(), stopReason: 'error',
    errorMessage: reason === 'MODEL_TRANSIENT' ? 'MODEL_TRANSIENT: service unavailable' : reason,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}

/** Factory-owned request seam. The caller supplies Pi's ModelRuntime, never credentials.
 * Construction/imports do not discover auth, load configuration or enable execution.
 */
export function createModelRequests(options) { return boundedRequests(options); }

// Internal factory-owned path. There is no caller-supplied tool allowlist or verifier.
export async function createExecutorModelRequests({ authority, ...options }) {
  const activation = await verifyActivatedAdmission(authority);
  return boundedRequests({ ...options, modelRuntime: activation.modelRuntime }, authority);
}
function boundedRequests({ modelRuntime, budget, signal, fetch = globalThis.fetch,
  clock = { now: Date.now, setTimeout, clearTimeout } }, authority) {
  const lifetime = new AbortController();
  const active = new Set();
  let drainFailure;
  const passedSmoke = () => budget.modelAttempts().find((item) => item.smoke && item.state === 'settled' && item.accounting?.preflight === true);
  async function attempt({ generationId, retry = false, smoke = false, messages, sessionId }) {
    if (lifetime.signal.aborted) throw new FactoryError('MODEL_CLOSED', 'Model request ownership has closed.');
    budget.assertActive();
    if (authority) await verifyActivatedAdmission(authority);
    const authorized = Boolean(authority) && !smoke;
    const requestedOutputTokens = smoke ? MODEL_LIMITS.smokeOutputTokens : MODEL_LIMITS.outputTokens;
    const requestDeadlineAt = Math.min(budget.deadlineAt, clock.now() + (smoke ? MODEL_LIMITS.smokeMs : MODEL_LIMITS.requestMs));
    const reservation = budget.reserveModelAttempt({ generationId, retry, smoke, requestedOutputTokens, requestDeadlineAt });
    const controller = new AbortController();
    const requestSignal = AbortSignal.any([controller.signal, lifetime.signal, budget.signal, ...(signal ? [signal] : [])]);
    let failure;
    const timer = clock.setTimeout(() => { failure = 'MODEL_REQUEST_DEADLINE'; controller.abort(); }, Math.max(0, requestDeadlineAt - clock.now()));
    const transports = [];
    let usage;
    let model;
    let httpStatus;
    let dispatched = false;
    const block = (code) => { failure = code; throw new FactoryError(code, code); };
    let message;
    try {
      model = modelRuntime.getPhysicalModel('openai', 'gpt-6.1-sol');
      if (!model || model.api !== 'openai-responses' || model.baseUrl !== 'https://api.openai.com/v1') block('MODEL_UNAVAILABLE');
      const auth = await modelRuntime.checkAuth('openai', { signal: requestSignal });
      if (!auth) block('MODEL_AUTH_REQUIRED');
      if (auth.type !== 'api_key') block('MODEL_AUTH_INCOMPATIBLE');
      // Pin effort in the request itself, not Pi's optional mid-conversation configuration items.
      const boundedModel = { ...model, compat: { ...model.compat, supportsMidConvoEffort: false,
        ...(authorized ? { supportsAdditionalTools: false, supportsToolSearch: false } : {}) } };
      const validatePayload = (payload) => {
        if (!Number.isInteger(payload?.max_output_tokens) || payload.max_output_tokens < 16
          || payload.max_output_tokens > requestedOutputTokens) block('MODEL_AUTH_INCOMPATIBLE');
        if (payload.model !== 'gpt-6.1-sol' || payload.reasoning?.effort !== 'low' || payload.stream !== true
          || payload.store !== false || payload.background || (!authorized && payload.tools?.length)) block('MODEL_PAYLOAD_REJECTED');
        if (authorized) {
          const expected = EXECUTOR_TOOLS.map(tool => ({ type: 'function', ...tool, strict: false }));
          if (!isDeepStrictEqual(payload.tools, expected)
            || payload.input?.some(item => ['additional_tools', 'tool_search_call', 'custom_tool_call'].includes(item.type))) block('MODEL_PAYLOAD_REJECTED');
        }
      };
      message = await modelRuntime.completeSimple(boundedModel, { messages }, {
        maxTokens: requestedOutputTokens, reasoning: 'low', maxRetries: 0, transport: 'sse',
        cacheRetention: 'none', sessionId, signal: requestSignal, onPayload: validatePayload,
        timeoutMs: Math.max(1, requestDeadlineAt - clock.now()),
        onProviderStreamEvent: (event) => {
          const observed = terminalUsage(event);
          if (!observed) return;
          usage = observed;
          budget.observeModelUsage(reservation.id, modelAccounting({ usage, model, requestedOutputTokens,
            outcome: 'pending', preflight: false }));
        },
        fetch: async (url, options) => {
          budget.assertActive();
          if (requestSignal.aborted || clock.now() >= requestDeadlineAt) block(failure ?? 'MODEL_CANCELLED');
          if (String(url) !== endpoint) block('MODEL_ROUTE_REJECTED');
          if (!new Headers(options.headers).get('authorization')?.startsWith('Bearer sk-')) block('MODEL_AUTH_INCOMPATIBLE');
          validatePayload(JSON.parse(options.body));
          if (dispatched) block('MODEL_PROVIDER_RETRY_DISABLED');
          dispatched = true;
          const response = await fetch(url, { ...options, redirect: 'error' });
          httpStatus = response.status;
          const transport = cancellableResponse(response, requestSignal);
          transports.push(transport);
          return transport.response;
        },
      });
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        failure ??= requestSignal.aborted ? 'MODEL_CANCELLED'
          : [401, 403].includes(httpStatus) ? 'MODEL_AUTH_REJECTED'
          : /max_output_tokens/.test(message.errorMessage ?? '') ? 'MODEL_CAP_REJECTED'
          : isRetryableAssistantError(message) ? 'MODEL_TRANSIENT' : 'MODEL_REQUEST_FAILED';
        message = modelFailure(failure);
      } else if (message.stopReason === 'length') {
        failure = 'MODEL_OUTPUT_LIMIT';
        message = { ...modelFailure(failure), stopReason: 'length' };
      } else if (message.stopReason !== 'stop' && !(authorized && message.stopReason === 'toolUse')) {
        failure = 'MODEL_UNEXPECTED_RESPONSE';
        message = modelFailure(failure);
      }
    } catch { message = modelFailure(failure ?? (requestSignal.aborted ? 'MODEL_CANCELLED' : 'MODEL_AUTH_FAILED')); }
    finally {
      try { await Promise.all(transports.map((transport) => transport.drain())); }
      catch (error) { drainFailure = error; throw error; }
      finally { clock.clearTimeout(timer); }
    }
    // Cancellation/deadline can arrive after the terminal event, during final drainage.
    if (clock.now() >= requestDeadlineAt) failure ??= 'MODEL_REQUEST_DEADLINE';
    if (requestSignal.aborted) failure ??= 'MODEL_CANCELLED';
    if (failure && ['stop', 'toolUse'].includes(message.stopReason)) message = modelFailure(failure);
    if (!failure && authorized) {
      try {
        const calls = message.content.filter(block => block.type === 'toolCall');
        if ((message.stopReason === 'toolUse') !== (calls.length > 0) || calls.length > 30
          || calls.some(c => typeof c.id !== 'string' || !c.id || c.id.length > 256)
          || new Set(calls.map(c => c.id.split('|')[0])).size !== calls.length) throw new Error();
        for (const call of calls) validateExecutorCall(call);
      } catch { failure = 'EXECUTOR_TOOL_SCHEMA'; message = modelFailure(failure); }
    }
    if (usage?.output > requestedOutputTokens) {
      failure = 'MODEL_OUTPUT_CAP_VIOLATION';
      message = modelFailure(failure);
    }
    const reason = failure ?? message.errorMessage;
    const accounting = modelAccounting({ usage, model, requestedOutputTokens, outcome: message.stopReason,
      preflight: smoke && message.stopReason === 'stop', reason });
    if (usage) message.usage = pricedUsage(model, usage);
    budget.settle(reservation.id, `Bounded model attempt ended: ${reason ?? message.stopReason}. No monetary ceiling is guaranteed; local cancellation does not prove provider billing stopped.`, accounting);
    return { ok: message.stopReason === 'stop' || (authorized && message.stopReason === 'toolUse'), ...(reason ? { reason } : {}),
      message, accounting, reservationId: reservation.id, reviewReady: false };
  }
  function tracked(input) {
    const pending = attempt(input);
    active.add(pending);
    pending.then(() => active.delete(pending), () => active.delete(pending));
    return pending;
  }
  async function close() {
    lifetime.abort();
    await Promise.allSettled([...active]);
    if (drainFailure) throw drainFailure;
  }
  return Object.freeze({
    cancel: close, close,
    async preflight() {
      if (lifetime.signal.aborted) throw new FactoryError('MODEL_CLOSED', 'Model request ownership has closed.');
      budget.assertActive();
      if (passedSmoke()) return Promise.resolve({ ok: true, reservationId: passedSmoke().id, reviewReady: false });
      return tracked({ generationId: 'model-preflight', smoke: true,
        messages: [{ role: 'user', content: 'Reply briefly with OK. Do not use tools.', timestamp: 0 }] });
    },
    async request({ generationId, retry = false, messages, sessionId }) {
      if (!passedSmoke()) throw new FactoryError('MODEL_PREFLIGHT_REQUIRED', 'A successful no-tool smoke in this run is required.');
      return tracked({ generationId, retry, messages, sessionId });
    },
  });
}
