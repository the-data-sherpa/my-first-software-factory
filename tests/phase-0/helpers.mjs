import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

export async function until(read, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await delay(20);
  } while (Date.now() < deadline);
  assert.fail(`Checkpoint not reached: ${JSON.stringify(value)}`);
}

export async function startWorker(t, directory, scenario) {
  const child = fork(new URL('./worker.mjs', import.meta.url), [directory, scenario], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    // Workers only register faux models and must not inherit model credentials via environment.
    env: { PATH: process.env.PATH, HOME: directory },
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  let sequence = 0;
  const pending = new Map();
  const events = new Set();
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Handle rejection immediately even if cleanup starts before the caller awaits readiness.
  ready.catch(() => {});
  const readyTimer = setTimeout(() => rejectReady(new Error(`Worker startup timed out: ${output}`)), 10_000);
  child.on('message', (message) => {
    if (message.event) events.add(message.event);
    if (message.event === 'ready') { clearTimeout(readyTimer); resolveReady(message); }
    const waiting = pending.get(message.id);
    if (waiting) {
      clearTimeout(waiting.timer);
      pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error));
      else waiting.resolve(message.value);
    }
  });
  child.on('exit', (code, signal) => {
    clearTimeout(readyTimer);
    const error = new Error(`Worker exited (${code}, ${signal}): ${output}`);
    rejectReady(error);
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error); }
    pending.clear();
  });
  child.on('error', rejectReady);
  const stop = async (signal = 'SIGKILL') => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill(signal);
    await exited;
  };
  t.after(() => stop());
  await ready;
  const request = (command, extra = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Command ${command} timed out: ${output}`)); }, 10_000);
    pending.set(id, { resolve, reject, timer });
    child.send({ id, command, ...extra }, (error) => {
      if (!error) return;
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    });
  });
  return {
    events, stop, request,
    snapshot: () => request('snapshot'),
    done: () => until(() => request('snapshot'), (state) => state.submission.status === 'done'),
  };
}

export const results = (state) => state.view.entries.filter((entry) => entry.kind === 'pi.tool-result');
export function assertOneInput(state) {
  assert.equal(state.view.entries.filter((entry) => entry.kind === 'pi.user').length, 1);
}
