import { calculateCost } from '@earendil-works/pi-ai';

const count = (value) => Number.isSafeInteger(value) && value >= 0;

/** Responses output_tokens ALREADY includes reasoning_tokens. Missing/invalid usage is unknown,
 * not the zero-initialized Usage object emitted by pi-ai. Only terminal provider events count.
 */
export function terminalUsage(event) {
  if (!['response.completed', 'response.incomplete', 'response.failed'].includes(event?.type)) return;
  const value = event.response?.usage;
  if (!value || !count(value.input_tokens) || !count(value.output_tokens)) return;
  const cacheRead = value.input_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = value.input_tokens_details?.cache_write_tokens ?? 0;
  const reasoning = value.output_tokens_details?.reasoning_tokens ?? 0;
  if (![cacheRead, cacheWrite, reasoning].every(count) || cacheRead + cacheWrite > value.input_tokens || reasoning > value.output_tokens) return;
  return { input: value.input_tokens - cacheRead - cacheWrite, output: value.output_tokens, cacheRead, cacheWrite, reasoning,
    totalTokens: value.input_tokens + value.output_tokens };
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
