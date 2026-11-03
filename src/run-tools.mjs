import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { privateDirectory, FactoryError } from './storage.mjs';
import { inspectWorkspace } from './workspace.mjs';
import { createContainedExecution, verifyContainmentEnvelope } from './containment.mjs';

/** Trusted execution-adapter interface. The caller receives run/budget/signal from the factory,
 * never from model arguments. Each bounded operation conservatively consumes one tool round.
 * The caller must join close() before returning from start/resume failure or finalization.
 */
export async function createRunTools({ directory, run, budget, signal, dependencyBundle }) {
  budget.assertActive();
  const intent = run.workspace?.intent;
  const admitted = run.workspace?.receipt;
  if (!intent || !admitted || intent.runId !== run.id || intent.projectId !== run.project.id
    || directory !== join(intent.stateDir, 'runs', run.id)) {
    throw new FactoryError('WORKSPACE_REQUIRED', 'Contained tools require this run\'s retained workspace intent and receipt.');
  }
  await privateDirectory(directory, { create: false, mustBeWithin: intent.stateDir });
  const actual = await inspectWorkspace(intent);
  if (actual.status !== 'prepared' || JSON.stringify(actual) !== JSON.stringify(admitted)) {
    throw new FactoryError('WORKSPACE_REQUIRED', 'The retained workspace receipt does not match its private ownership metadata.');
  }
  await verifyContainmentEnvelope();
  budget.assertActive();
  const receiptDirectory = await privateDirectory(join(directory, 'checks'), { mustBeWithin: intent.stateDir });
  const reservation = budget.reserveToolRound({ roundId: `verify:${randomUUID()}` });
  const tools = await createContainedExecution({ worktree: actual.worktree, receiptDirectory, signal, dependencyBundle });
  try {
    budget.settle(reservation.id, JSON.stringify({ kind: 'containment-verification', receipt: tools.verification.receipt, sourceDigest: tools.verification.sourceDigest }));
  } catch (error) { await tools.close(); throw error; }
  const invoke = async (method, args) => {
    budget.assertActive();
    const reserved = budget.reserveToolRound({ roundId: `${method}:${randomUUID()}` });
    try {
      const result = await tools[method](...args);
      budget.settle(reserved.id, JSON.stringify({ kind: method, resultDigest: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
        ...(method === 'check' ? { receipt: result.receipt, passed: result.passed } : {}) }));
      return result;
    } catch (error) {
      // Reads/checks do not mutate source, and the execution interface drains before rejecting.
      // A failed write may have partial effects. Retain its uncertainty for operator reconciliation.
      if (method !== 'write') budget.settle(reserved.id, JSON.stringify({ kind: method, failed: true }));
      throw error;
    }
  };
  return Object.freeze({
    verification: tools.verification,
    read: (path, options) => invoke('read', [path, options]),
    write: (path, text) => invoke('write', [path, text]),
    check: (name, options) => invoke('check', [name, options]),
    close: () => tools.close(),
  });
}
