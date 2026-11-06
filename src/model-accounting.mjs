import { calculateCost } from '@earendil-works/pi-ai';

const count = (value) => Number.isSafeInteger(value) && value >= 0;

/** Anthropic input_tokens excludes cache reads/writes; output_tokens includes thinking.
 * Retain the stream's input counters, but publish usage only on a terminal message_delta.
 * Missing/invalid usage stays unknown, not pi-ai's zero-initialized Usage object.
 */
export function terminalUsage() {
  let value;
  return event => {
    if (event?.type === 'message_start') value = event.message?.usage ? { ...event.message.usage } : undefined;
    if (event?.type !== 'message_delta' || !value) return;
    value = { ...value, ...event.usage };
    if (!event.delta?.stop_reason || !count(event.usage?.output_tokens) || !count(value.input_tokens)) return;
    const cacheRead = value.cache_read_input_tokens ?? 0;
    const cacheWrite = value.cache_creation_input_tokens ?? 0;
    const reasoning = value.output_tokens_details?.thinking_tokens ?? 0;
    const cacheWrite1h = value.cache_creation?.ephemeral_1h_input_tokens;
    if (![cacheRead, cacheWrite, reasoning].every(count) || reasoning > value.output_tokens
      || (cacheWrite1h !== undefined && (!count(cacheWrite1h) || cacheWrite1h > cacheWrite))) return;
    return { input: value.input_tokens, output: value.output_tokens, cacheRead, cacheWrite, reasoning,
      ...(cacheWrite1h === undefined ? {} : { cacheWrite1h }),
      totalTokens: value.input_tokens + value.output_tokens + cacheRead + cacheWrite };
  };
}

export function pricedUsage(model, usage) {
  const result = { ...usage, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  if (model?.cost) calculateCost(model, result);
  return result;
}

export function modelAccounting({ usage, model, requestedOutputTokens, outcome, preflight, reason }) {
  let cost = { status: 'unknown' };
  if (usage && model?.cost) {
    const estimated = pricedUsage(model, usage).cost;
    if (Number.isFinite(estimated.total) && estimated.total >= 0) cost = { status: 'estimated', usd: estimated.total };
  }
  return { outcome, ...(reason ? { reason } : {}), ...(usage ? { usage } : {}), cost,
    unmeasuredOutputTokens: usage ? 0 : requestedOutputTokens, preflight };
}
