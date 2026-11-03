import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { executionBudget } from '../../src/recovery.mjs';

// No registration/refresh: those APIs can perform ambient availability checks.
// The selected builtin uses only this in-memory credential, never host auth/config.
export async function controlledRuntime(credential = { type: 'api_key', key: 'sk-controlled-not-a-secret' }, extra = {}) {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify('openai', async () => credential);
  // Defense in depth for failing tests: OAuth resolution must never refresh over the network.
  if (credential.type === 'oauth') credentials.modify = async () => { throw new Error('Controlled fixture forbids credential refresh.'); };
  return ModelRuntime.create({ credentials, modelsStore: new InMemoryModelsStore(), modelsPath: null,
    refreshOnCreate: false, allowModelNetwork: false, ...extra });
}

export function retainedBudget({ now = Date.now, signal = new AbortController().signal, record } = {}) {
  let saved = record ?? { status: 'running', deadlineAt: now() + 1_200_000,
    limits: { modelAttempts: 40, toolRounds: 30, smokeOutputTokens: 1024, requestedOutputTokens: 8192 },
    counters: { modelAttempts: 0, toolRounds: 0, reservedOutputTokens: 0 }, reservations: [] };
  return { budget: executionBudget({ get: () => structuredClone(saved), save: (run) => { saved = structuredClone(run); }, now, signal }),
    inspect: () => structuredClone(saved) };
}

export function eventsResponse({ status = 'completed', usage = { input_tokens: 20, output_tokens: 10,
  output_tokens_details: { reasoning_tokens: 4 }, total_tokens: 30 }, error, text = 'Controlled answer.' } = {}) {
  const item = { id: 'msg_controlled', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }] };
  const events = [
    { type: 'response.created', response: { id: 'resp_controlled', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: `response.${status}`, response: { id: 'resp_controlled', status, output: [item], ...(usage ? { usage } : {}),
      ...(error ? { error } : {}), ...(status === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}) } },
  ];
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } });
}

export function controlledTransport(reply = () => eventsResponse()) {
  const requests = [];
  return { requests, fetch: async (url, options) => {
    requests.push({ url: String(url), payload: JSON.parse(options.body), headers: new Headers(options.headers), signal: options.signal });
    return reply(requests.at(-1), requests.length);
  } };
}
