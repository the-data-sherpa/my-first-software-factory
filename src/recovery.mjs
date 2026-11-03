import { randomUUID } from 'node:crypto';
import { FactoryError } from './storage.mjs';

export function requireReview(review) {
  if (typeof review !== 'string' || !review.trim() || Buffer.byteLength(review) > 4096) {
    throw new FactoryError('REVIEW_REQUIRED', 'Supply a review of partial effects (1–4096 bytes). A review is not proof of containment.');
  }
  return review;
}

export function requireRemainingBudget(record, now) {
  if (now >= record.deadlineAt) throw new FactoryError('RUN_DEADLINE', 'The original run deadline has expired. Use an explicit linked replacement.');
  if (record.counters.modelAttempts >= record.limits.modelAttempts) throw new FactoryError('MODEL_ATTEMPT_LIMIT', 'The original model attempt allowance is exhausted.');
  if (record.counters.toolRounds >= record.limits.toolRounds) throw new FactoryError('TOOL_ROUND_LIMIT', 'The original tool round allowance is exhausted.');
}

// Assessments originate only in installed trusted adapters. Operator review never supplies these facts.
export function requireSafeResume(run, safety) {
  const evidence = (value) => typeof value === 'string' && value.trim().length > 0;
  const fixture = safety?.kind === 'tool-free-fixture' && run.execution.mode === 'fixture'
    && run.execution.model === 'factory-fixture/no-tools-v1' && run.counters.toolRounds === 0;
  const contained = safety?.kind === 'contained-execution' && safety.containment?.verified === true
    && evidence(safety.containment.evidence) && safety.partialEffects?.reconciled === true
    && evidence(safety.partialEffects.evidence);
  if (!safety?.quiescent || !safety.resumable || !evidence(safety.evidence) || (!fixture && !contained)) {
    throw new FactoryError('UNSAFE_RESUME', 'Trusted containment and partial-effect reconciliation are required. A tool-free fixture proves only its own safety.');
  }
}

/** Trusted execution-adapter seam, never an operator API. Reservations commit before the caller performs an effect.
 * A reservation is consumed even if the process dies before the effect starts. It is never refunded or reusable.
 * Every provider request (including smoke/retry/resume) and whole tool round must pass this gate.
 */
export function executionBudget({ get, save, now, signal }) {
  function current() {
    const run = get();
    if (signal.aborted || run.stopRequested || run.status !== 'running') throw new FactoryError('RUN_STOPPING', 'This run no longer admits effects.');
    if (now() >= run.deadlineAt) throw new FactoryError('RUN_DEADLINE', 'The original run deadline has expired.');
    run.reservations ??= [];
    return run;
  }
  function identity(value) {
    if (typeof value !== 'string' || !value || value.length > 256) throw new FactoryError('INVALID_RESERVATION', 'Supply a stable generation or round identity.');
  }
  function reserve(run, data) {
    const reservation = { id: randomUUID(), ...data, reservedAt: now(), state: 'uncertain' };
    run.reservations.push(reservation);
    save(run);
    return Object.freeze(structuredClone(reservation));
  }
  return Object.freeze({
    get deadlineAt() { return get().deadlineAt; },
    signal,
    assertActive() { current(); },
    modelAttempts() { return structuredClone(get().reservations?.filter((item) => item.kind === 'model') ?? []); },
    reserveModelAttempt({ generationId, retry = false, smoke = false, requestedOutputTokens, requestDeadlineAt } = {}) {
      identity(generationId);
      const run = current();
      const prior = run.reservations.filter((item) => item.kind === 'model' && item.generationId === generationId);
      if (prior.some((item) => item.smoke)) throw new FactoryError('SMOKE_LIMIT', 'The initial smoke allows one attempt, never a retry.');
      if (retry ? prior.length !== 1 : prior.length !== 0) throw new FactoryError('RETRY_LIMIT', 'A generation allows one original attempt and at most one retry.');
      if (run.counters.modelAttempts >= run.limits.modelAttempts) throw new FactoryError('MODEL_ATTEMPT_LIMIT', 'The original model attempt allowance is exhausted.');
      if (smoke && run.reservations.some((item) => item.smoke)) throw new FactoryError('SMOKE_LIMIT', 'The initial smoke allows one attempt.');
      const cap = smoke ? run.limits.smokeOutputTokens : run.limits.requestedOutputTokens;
      requestedOutputTokens ??= cap;
      if (!Number.isInteger(requestedOutputTokens) || requestedOutputTokens < 1 || requestedOutputTokens > cap) throw new FactoryError('INVALID_RESERVATION', 'Requested output exceeds the admitted output cap.');
      if (requestDeadlineAt !== undefined && (!Number.isSafeInteger(requestDeadlineAt) || requestDeadlineAt <= now()
        || requestDeadlineAt > Math.min(run.deadlineAt, now() + (smoke ? 60_000 : 180_000)))) {
        throw new FactoryError('INVALID_RESERVATION', 'The request deadline must fit within the original run and full-stream limits.');
      }
      run.counters.modelAttempts++;
      run.counters.reservedOutputTokens += requestedOutputTokens;
      return reserve(run, { kind: 'model', generationId, retry, smoke, requestedOutputTokens,
        ...(requestDeadlineAt === undefined ? {} : { requestDeadlineAt }) });
    },
    reserveToolRound({ roundId } = {}) {
      identity(roundId);
      const run = current();
      if (run.reservations.some((item) => item.kind === 'tool-round' && item.roundId === roundId)) throw new FactoryError('RESERVATION_REUSED', 'A reserved tool round cannot be replayed. Reconcile its partial effects.');
      if (run.counters.toolRounds >= run.limits.toolRounds) throw new FactoryError('TOOL_ROUND_LIMIT', 'The original tool round allowance is exhausted.');
      run.counters.toolRounds++;
      return reserve(run, { kind: 'tool-round', roundId });
    },
    observeModelUsage(reservationId, accounting) {
      const run = get();
      const item = run.reservations?.find((entry) => entry.id === reservationId);
      if (!item || item.kind !== 'model' || item.state !== 'uncertain' || !accounting?.usage || accounting.preflight !== false) {
        throw new FactoryError('INVALID_RESERVATION', 'Only an outstanding model attempt can retain observed usage before drainage.');
      }
      item.accounting = structuredClone(accounting);
      item.usageObservedAt = now();
      save(run); // Usage is durable now; it does not settle uncertain execution or pass preflight.
    },
    settle(reservationId, evidence, accounting) {
      const run = get();
      const item = run.reservations?.find((entry) => entry.id === reservationId);
      if (!item || item.state !== 'uncertain' || typeof evidence !== 'string' || !evidence || Buffer.byteLength(evidence) > 4096) throw new FactoryError('INVALID_RESERVATION', 'Settle an outstanding reservation with bounded evidence.');
      if (accounting !== undefined) {
        if (item.kind !== 'model') throw new FactoryError('INVALID_RESERVATION', 'Only model attempts carry model accounting.');
        item.accounting = structuredClone(accounting);
      }
      item.state = 'settled';
      item.evidence = evidence;
      item.settledAt = now();
      save(run); // Counters and conservative output reservations are never refunded.
    },
  });
}
