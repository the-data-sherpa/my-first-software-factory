import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { privateDirectory, acquireOwner, openRecords, STORAGE_VERSIONS, ACTIVE_STATUSES, FactoryError,
  backupFactory as backupStores, restoreFactory as restoreStores } from './storage.mjs';
import { inspectExecution, validateExecutionStores } from './execution.mjs';
import { executionBudget, requireReview, requireRemainingBudget, requireSafeResume } from './recovery.mjs';

export { FactoryError } from './storage.mjs';
export const backupFactory = (options) => backupStores(options, validateExecutionStores);
export const restoreFactory = (options) => restoreStores(options, validateExecutionStores);
export const DEFAULT_STATE_DIR = join(homedir(), '.local', 'state', 'tiny-software-factory');
export const PHASE_1_LIMITS = Object.freeze({
  runDeadlineMs: 1_200_000, toolRounds: 30, modelAttempts: 40,
  modelRequestDeadlineMs: 180_000, checkDeadlineMs: 120_000, requestedOutputTokens: 8192,
  reasoning: 'low', providerRetries: 0, durableRetriesPerGeneration: 1,
  memoryBytes: 4_294_967_296, swapBytes: 0, tasks: 256, concurrentChecks: 1,
  vitestWorkers: 2, scratchBytes: 268_435_456, checkLogBytes: 1_048_576,
  briefBytes: 65_536, writeBytes: 65_536, readResponseBytes: 16_384,
  smokeAttempts: 1, smokeDeadlineMs: 60_000, smokeOutputTokens: 1024,
  automaticCompaction: false, automaticContinuation: false, backgroundResponses: false,
});

function snapshotBrief(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > PHASE_1_LIMITS.briefBytes) {
    throw new FactoryError('INVALID_BRIEF', 'Supply a text or Markdown task brief of at most 64 KiB.');
  }
  const sections = { goal: [], acceptanceCriteria: [], evidence: [] };
  const names = { goal: 'goal', 'acceptance criteria': 'acceptanceCriteria', evidence: 'evidence' };
  let current;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:#{1,6}\s+)?(Goal|Acceptance criteria|Evidence)\s*(?::\s*(.*)|$)/i);
    if (match) { current = names[match[1].toLowerCase()]; if (match[2]) sections[current].push(match[2]); }
    else if (current) sections[current].push(line);
  }
  const brief = { text, ...Object.fromEntries(Object.entries(sections).map(([key, lines]) => [key, lines.join('\n').trim()])) };
  if (!brief.goal || !brief.acceptanceCriteria || !brief.evidence) {
    throw new FactoryError('INVALID_BRIEF', 'The task brief must contain Goal, Acceptance criteria, and Evidence sections.');
  }
  return brief;
}

function applyReceipt(record, receipt, { passive = false } = {}) {
  if (receipt.runId && (receipt.runId !== record.id || receipt.requestId !== record.execution.requestId)) {
    throw new FactoryError('RECEIPT_MISMATCH', 'The execution receipt does not belong to this run.');
  }
  if (receipt.submissionId) record.execution.submissionId = receipt.submissionId;
  const uncertainTools = record.reservations?.some((item) => item.kind === 'tool-round' && item.state === 'uncertain');
  const passiveFixture = record.execution.mode === 'fixture' && record.execution.model === 'factory-fixture/no-tools-v1'
    && record.counters.toolRounds === 0 && receipt.safety?.kind === 'tool-free-fixture';
  if (uncertainTools || (passive && !passiveFixture && ['done', 'unanswered'].includes(receipt.status))) {
    record.status = 'interrupted';
    record.outcome = { kind: 'uncertain', reviewReady: false, reason: 'effect_reconciliation_required' };
    return record;
  }
  if (receipt.status === 'done') {
    record.status = record.stopRequested ? 'stopped' : 'completed';
    record.outcome = record.stopRequested ? { kind: 'stopped', reviewReady: false, reason: record.stopReason }
      : { kind: 'fixture-completed', reviewReady: false, answer: receipt.answer };
  } else if (receipt.status === 'unanswered') {
    record.status = record.stopRequested || receipt.reason === 'aborted' ? 'stopped' : 'failed';
    record.outcome = { kind: record.status, reviewReady: false, reason: 'execution_unanswered' };
  } else record.status = 'interrupted';
  return record;
}

export async function inspectHistory({ stateDir = DEFAULT_STATE_DIR, runId } = {}) {
  stateDir = await privateDirectory(stateDir, { create: false });
  const release = await acquireOwner(stateDir);
  let records;
  try {
    records = await openRecords(stateDir, { readOnly: true });
    const runs = runId ? [records.get(runId)] : records.list();
    if (runId && !runs[0]) throw new FactoryError('RUN_NOT_FOUND', 'No run has that identity.');
    for (const record of runs) {
      if (ACTIVE_STATUSES.includes(record.status)) {
        applyReceipt(record, await inspectExecution(join(stateDir, 'runs', record.id), { stateRoot: stateDir }), { passive: true });
      }
    }
    return runId ? runs[0] : runs;
  } finally { records?.close(); release(); }
}

/** Execution is trusted code, not operator configuration. start/resume must return an owned handle.
 * cancel requests cancellation; finished settles the receipt; close MUST join all owned work.
 * A thrown start/resume must have drained anything it started before rejecting.
 * assessRecovery must establish quiescence and reconcile partial effects without enabling scheduling.
 */
export async function openFactory({ stateDir = DEFAULT_STATE_DIR, project = { id: 'vanguard', repositoryPath: join(homedir(), 'Projects', 'vanguard') }, execution,
  clock = { now: Date.now, setTimeout, clearTimeout } } = {}) {
  stateDir = await privateDirectory(stateDir);
  if (project.id !== 'vanguard' || typeof project.repositoryPath !== 'string') {
    throw new FactoryError('INVALID_PROJECT', 'Phase 1 configures only the Vanguard project.');
  }
  project = { id: project.id, repositoryPath: resolve(project.repositoryPath) };
  const release = await acquireOwner(stateDir);
  let records;
  try { records = await openRecords(stateDir); }
  catch (error) { release(); throw error; }
  try {
    const active = records.active();
    if (active) records.save(applyReceipt(active, await inspectExecution(join(stateDir, 'runs', active.id), { stateRoot: stateDir }), { passive: true }));
  } catch (error) { records.close(); release(); throw error; }
  let closing = false;
  let closePromise;
  let job;
  let transition;
  const get = (id) => {
    const record = records.get(id);
    if (!record) throw new FactoryError('RUN_NOT_FOUND', 'No run has that identity.');
    return record;
  };
  const assertOpen = () => {
    if (closing) throw new FactoryError('BACKEND_CLOSING', 'The backend is shutting down.');
  };
  const assertControl = () => {
    assertOpen();
    if (transition) throw new FactoryError('CONTROL_BUSY', 'A recovery control is already in progress.');
  };
  const conflict = (active) => { throw new FactoryError('RUN_ACTIVE', `Run ${active.id} is active. Inspect it with: factory inspect ${active.id}`, { activeRunId: active.id }); };
  const validateRequest = (requestId) => {
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) {
      throw new FactoryError('INVALID_REQUEST_ID', 'Supply a stable request ID of 1–128 letters, digits, dots, underscores, colons, or hyphens.');
    }
  };
  const makeRecord = (requestId, brief) => {
    if (!execution) throw new FactoryError('MODEL_NOT_READY', 'Production execution is not enabled yet. No fixture substitution was made.');
    const id = `run_${randomUUID()}`;
    const admittedAt = clock.now();
    return {
      id, requestId, project: { ...project }, brief, status: 'admitted', admittedAt,
      deadlineAt: admittedAt + PHASE_1_LIMITS.runDeadlineMs, limits: { ...PHASE_1_LIMITS },
      counters: { modelAttempts: 0, toolRounds: 0, reservedOutputTokens: 0 }, reservations: [],
      storageVersions: { ...STORAGE_VERSIONS },
      execution: { mode: execution.mode, model: execution.model, requestId: `factory:${id}:input:1` },
      capabilities: { repositoryTools: false, productionModel: false, resourceContainmentVerified: false },
      outcome: null,
    };
  };
  async function assess(record) {
    if (!execution?.assessRecovery || execution.mode !== record.execution.mode || execution.model !== record.execution.model) {
      throw new FactoryError('RESUME_UNAVAILABLE', 'The original execution adapter cannot reconcile this run. Retain it until trusted recovery is available.');
    }
    const directory = join(stateDir, 'runs', record.id);
    try { await privateDirectory(directory, { create: false, mustBeWithin: stateDir }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return execution.assessRecovery({ directory, run: structuredClone(record) });
  }
  async function control(operation) {
    assertControl();
    transition = operation();
    try { return await transition; } finally { transition = undefined; }
  }
  async function cancel(owned) {
    if (!owned.handle || owned.cancelPromise) return owned.cancelPromise;
    owned.cancelPromise = Promise.resolve().then(() => owned.handle.cancel()).catch(() => {
      const record = get(owned.id);
      record.cancellationError = 'Cancellation failed; finalization must still drain owned work.';
      records.save(record);
    });
    return owned.cancelPromise;
  }
  function requestStop(owned, reason) {
    if (owned.drained || (owned.finalizing && reason !== 'RUN_DEADLINE')) return; // Completion already owns the final drain.
    const record = get(owned.id);
    owned.stopReason ??= reason;
    record.stopRequested = true;
    record.stopReason = owned.stopReason;
    records.save(record); // A crash during stop must never turn into a permitted resume.
    owned.controller.abort();
    owned.stopped.resolve();
    void cancel(owned);
  }
  async function execute(owned, resume) {
    const { id, controller } = owned;
    let record = get(id);
    try {
      const directory = await privateDirectory(join(stateDir, 'runs', id), { mustBeWithin: stateDir });
      if (owned.stopReason) throw new FactoryError('RUN_STOPPING', 'The run is stopping.');
      requireRemainingBudget(record, clock.now());
      record.status = 'running';
      records.save(record);
      const budget = executionBudget({ get: () => get(id), save: records.save, now: clock.now, signal: controller.signal });
      owned.handle = await execution[resume ? 'resume' : 'start']({ directory, runId: id, requestId: record.execution.requestId,
        brief: structuredClone(record.brief), run: structuredClone(record), budget, signal: controller.signal });
      record = get(id);
      record.execution.submissionId = owned.handle.submissionId;
      records.save(record);
      if (owned.stopReason) void cancel(owned);
      const receipt = await Promise.race([owned.handle.finished, owned.stopped.promise]);
      record = receipt ? applyReceipt(get(id), receipt) : get(id);
    } catch (error) {
      record = get(id);
      record.status = 'failed';
      record.outcome = { kind: 'failed', reviewReady: false, reason: error instanceof FactoryError ? error.code : 'execution_failed' };
    } finally {
      owned.finalizing = true;
      // Do not release admission or lifetime ownership on cancel failure. close is the mandatory drain.
      try {
        if (owned.handle) await owned.handle.close();
        await owned.cancelPromise;
      } catch {
        const latest = get(id);
        latest.status = 'interrupted';
        latest.outcome = { kind: 'uncertain', reviewReady: false, reason: 'drain_failed' };
        records.save(latest);
        clock.clearTimeout(owned.timer);
        throw new FactoryError('DRAIN_FAILED', 'Owned work did not confirm drainage. Admission and backend ownership remain fenced.');
      }
      clock.clearTimeout(owned.timer);
      const latest = get(id);
      if (owned.stopReason) {
        record.status = owned.stopReason === 'RUN_DEADLINE' ? 'failed' : 'stopped';
        record.outcome = { kind: record.status, reviewReady: false, reason: owned.stopReason };
      }
      records.save({ ...latest, status: record.status, outcome: record.outcome, execution: record.execution });
      owned.drained = true;
    }
  }
  function launch(id, resume = false) {
    const owned = { id, controller: new AbortController(), stopped: Promise.withResolvers(), drained: false };
    job = owned;
    owned.timer = clock.setTimeout(() => requestStop(owned, 'RUN_DEADLINE'), Math.max(0, get(id).deadlineAt - clock.now()));
    owned.promise = execute(owned, resume);
    owned.promise.catch(() => {}); // Control calls still observe drain failures.
  }
  return {
    stateDir,
    storageInfo: () => ({ ...STORAGE_VERSIONS }),
    async startRun({ requestId, brief }) {
      assertOpen();
      validateRequest(requestId);
      const admittedBrief = snapshotBrief(brief);
      const existing = records.byRequest(requestId);
      if (existing) {
        if (existing.brief.text !== brief || JSON.stringify(existing.project) !== JSON.stringify(project)) {
          throw new FactoryError('REQUEST_CONFLICT', 'That request ID already belongs to a different admitted task brief or project.');
        }
        return existing;
      }
      if (records.active()) conflict(records.active());
      if (transition) throw new FactoryError('CONTROL_BUSY', 'A recovery control is already in progress.');
      const record = makeRecord(requestId, admittedBrief);
      records.save(record);
      launch(record.id);
      return structuredClone(record);
    },
    async stopRun(id) {
      assertControl();
      const record = get(id);
      if (!ACTIVE_STATUSES.includes(record.status)) return record;
      if (job?.id === id) {
        requestStop(job, 'operator_stop');
        await job.promise;
        return get(id);
      }
      return control(async () => {
        const safety = await assess(record);
        if (!safety.quiescent) throw new FactoryError('RECOVERY_REQUIRED', 'Owned work may still execute. Reconcile containment before releasing admission.');
        record.status = 'stopped';
        record.stopRequested = true;
        record.stopReason ??= 'operator_stop';
        record.outcome = { kind: 'stopped', reviewReady: false, safety };
        records.save(record); // No scheduler is needed to retire a quiescent interrupted run.
        return record;
      });
    },
    async resumeRun(id, { review } = {}) {
      assertControl();
      const record = get(id);
      if (record.status !== 'interrupted' || record.stopRequested) throw new FactoryError('RUN_NOT_INTERRUPTED', 'Only an interrupted run without a stop intent can be resumed.');
      if (job?.id === id && !job.drained) throw new FactoryError('RECOVERY_REQUIRED', 'The current backend still owns undrained work.');
      requireReview(review);
      requireRemainingBudget(record, clock.now());
      if (!record.execution.submissionId) throw new FactoryError('UNSAFE_RESUME', 'The original durable submission is missing. Use an explicit linked replacement.');
      if (!execution?.resume) throw new FactoryError('RESUME_UNAVAILABLE', 'Safe resume is unavailable. Use an explicit linked replacement.');
      return control(async () => {
        const safety = await assess(record);
        requireSafeResume(record, safety);
        assertOpen();
        requireRemainingBudget(record, clock.now());
        record.recovery = { review, reviewedAt: clock.now(), safety };
        record.status = 'admitted';
        records.save(record);
        launch(id, true);
        return structuredClone(record);
      });
    },
    async replaceRun(id, { requestId, review } = {}) {
      assertControl();
      const record = get(id);
      if (JSON.stringify(record.project) !== JSON.stringify(project)) throw new FactoryError('PROJECT_MISMATCH', 'A linked replacement must retain the original project identity.');
      requireReview(review);
      validateRequest(requestId);
      const existing = records.byRequest(requestId);
      if (existing) {
        if (existing.replacesRunId === id) return existing;
        throw new FactoryError('REQUEST_CONFLICT', 'A replacement needs a new admission request ID.');
      }
      if (record.replacedByRunId) throw new FactoryError('REQUEST_CONFLICT', 'This run already has an explicitly linked replacement.');
      const active = records.active();
      if (active && (active.id !== id || active.status !== 'interrupted' || (job?.id === id && !job.drained))) conflict(active);
      return control(async () => {
        const safety = record.status === 'interrupted' ? await assess(record) : undefined;
        if (safety && !safety.quiescent) throw new FactoryError('RECOVERY_REQUIRED', 'A replacement cannot overlap surviving work. Reconcile containment first.');
        assertOpen();
        const replacement = makeRecord(requestId, structuredClone(record.brief));
        replacement.replacesRunId = id;
        replacement.replacementReview = { review, reviewedAt: clock.now(), ...(safety ? { safety } : {}) };
        record.replacedByRunId = replacement.id;
        if (record.status === 'interrupted') {
          record.status = 'replaced';
          record.outcome = { kind: 'replaced', reviewReady: false, reason: 'explicit_linked_replacement' };
        }
        records.saveTogether(record, replacement);
        launch(replacement.id);
        return structuredClone(replacement);
      });
    },
    inspectRun: async (id) => get(id),
    listRuns: async () => records.list(),
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        try { await transition; } catch { /* Failed controls enabled no work. */ }
        if (job && !job.drained) { requestStop(job, 'backend_shutdown'); await job.promise; }
        // A failed drain rejects above and intentionally retains the owner lock.
        records.close();
        release();
      })();
      return closePromise;
    },
  };
}
