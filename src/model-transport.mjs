import { FactoryError } from './storage.mjs';

/** Make cancellation cover the response BODY, not merely fetch's response-header promise.
 * The returned drain joins the underlying reader's cancellation, even when that is asynchronous.
 * A transport that cannot confirm cleanup must keep admission fenced, not pretend to be stopped.
 */
export function cancellableResponse(response, signal) {
  if (!response.body) return { response, drain: async () => {} };
  const reader = response.body.getReader();
  let controller;
  let ended = false;
  let cancellation;
  const cancel = () => {
    if (ended) return;
    ended = true;
    cancellation = reader.cancel().finally(() => reader.releaseLock());
    cancellation.catch(() => {});
    controller.error(new Error('Model response cancelled.'));
    signal.removeEventListener('abort', cancel);
  };
  const body = new ReadableStream({
    start(value) {
      controller = value;
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    },
    async pull() {
      try {
        const { value, done } = await reader.read();
        if (ended) return;
        if (done) {
          ended = true;
          signal.removeEventListener('abort', cancel);
          reader.releaseLock();
          controller.close();
        } else controller.enqueue(value);
      } catch {
        if (!ended) cancel();
      }
    },
    cancel() { cancel(); return cancellation; },
  });
  return { response: new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }),
    async drain() {
      if (!ended) cancel();
      try { await cancellation; }
      catch { throw new FactoryError('MODEL_DRAIN_FAILED', 'Model transport cleanup is unconfirmed. Keep admission fenced.'); }
    } };
}
