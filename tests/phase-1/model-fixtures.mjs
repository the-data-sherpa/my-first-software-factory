import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { executionBudget } from '../../src/recovery.mjs';

// No registration/refresh: those APIs can perform ambient availability checks.
// The selected builtin uses only this in-memory credential, never host auth/config.
export async function controlledRuntime(credential = { type: 'oauth', access: 'sk-ant-oat-controlled-not-a-secret', refresh: 'controlled-unused', expires: Date.now() + 3_600_000 }, extra = {}) {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify('anthropic', async () => credential);
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
  const measured = usage ? { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0, cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    output_tokens_details: { thinking_tokens: usage.output_tokens_details?.reasoning_tokens ?? 0 } } : undefined;
  const events = [
    { type: 'message_start', message: { id: 'msg_controlled', type: 'message', role: 'assistant', content: [],
      usage: measured ?? {} } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: status === 'incomplete' ? 'max_tokens' : status === 'failed' ? 'refusal' : 'end_turn' },
      ...(measured ? { usage: measured } : {}) },
    ...(status === 'failed' ? [{ type: 'error', error: { type: 'overloaded_error', message: error?.message ?? 'Controlled transient failure' } }] : []),
    { type: 'message_stop' },
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
