import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { privateDirectory, acquireOwner, openRecords, STORAGE_VERSIONS, ACTIVE_STATUSES, FactoryError,
  backupFactory as backupStores, restoreFactory as restoreStores } from './storage.mjs';
import { inspectExecution, validateExecutionStores } from './execution.mjs';

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

function applyReceipt(record, receipt) {
  if (receipt.runId && (receipt.runId !== record.id || receipt.requestId !== record.execution.requestId)) {
    throw new FactoryError('RECEIPT_MISMATCH', 'The execution receipt does not belong to this run.');
  }
  if (receipt.submissionId) record.execution.submissionId = receipt.submissionId;
  if (receipt.status === 'done') {
    record.status = 'completed';
    record.outcome = { kind: 'fixture-completed', reviewReady: false, answer: receipt.answer };
  } else if (receipt.status === 'unanswered') {
    record.status = receipt.reason === 'aborted' ? 'stopped' : 'failed';
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
        applyReceipt(record, await inspectExecution(join(stateDir, 'runs', record.id), { stateRoot: stateDir }));
      }
    }
    return runId ? runs[0] : runs;
  } finally { records?.close(); release(); }
}

export async function openFactory({ stateDir = DEFAULT_STATE_DIR, project = { id: 'vanguard', repositoryPath: join(homedir(), 'Projects', 'vanguard') }, execution } = {}) {
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
    // Reconcile existing receipts passively. Never reopen an old execution store writable here.
    const active = records.active();
    if (active) records.save(applyReceipt(active, await inspectExecution(join(stateDir, 'runs', active.id), { stateRoot: stateDir })));
  } catch (error) { records.close(); release(); throw error; }
  let closing = false;
  let closePromise;
  let job;
  let handle;
  let stopping = false;
  const get = (id) => {
    const record = records.get(id);
    if (!record) throw new FactoryError('RUN_NOT_FOUND', 'No run has that identity.');
    return record;
  };
  const execute = async (id) => {
    let record = get(id);
    let executionHandle;
    try {
      const directory = await privateDirectory(join(stateDir, 'runs', id), { mustBeWithin: stateDir });
      record.status = 'running';
      record.counters.modelAttempts = 1;
      record.counters.reservedOutputTokens = record.limits.requestedOutputTokens;
      records.save(record); // Admission, original deadline, and attempt reservation precede scheduling.
      executionHandle = await execution.start({ directory, runId: id, requestId: record.execution.requestId, brief: record.brief });
      handle = executionHandle;
      record.execution.submissionId = executionHandle.submissionId;
      records.save(record);
      if (stopping) await executionHandle.cancel();
      const receipt = await executionHandle.finished;
      record = applyReceipt(record, receipt);
      if (stopping) { record.status = 'stopped'; record.outcome = { kind: 'stopped', reviewReady: false }; }
    } catch (error) {
      record.status = stopping ? 'stopped' : 'failed';
      record.outcome = { kind: record.status, reviewReady: false, reason: error instanceof FactoryError ? error.code : 'execution_failed' };
    } finally {
      if (executionHandle) await executionHandle.close();
      if (handle === executionHandle) handle = undefined;
      // Release admission only after the previous execution store has closed.
      records.save(record);
    }
  };
  return {
    stateDir,
    storageInfo: () => ({ ...STORAGE_VERSIONS }),
    async startRun({ requestId, brief }) {
      if (closing) throw new FactoryError('BACKEND_CLOSING', 'The backend is shutting down.');
      if (typeof requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) {
        throw new FactoryError('INVALID_REQUEST_ID', 'Supply a stable request ID of 1–128 letters, digits, dots, underscores, colons, or hyphens.');
      }
      const admittedBrief = snapshotBrief(brief);
      const existing = records.byRequest(requestId);
      if (existing) {
        if (existing.brief.text !== brief || JSON.stringify(existing.project) !== JSON.stringify(project)) {
          throw new FactoryError('REQUEST_CONFLICT', 'That request ID already belongs to a different admitted task brief or project.');
        }
        return existing; // Idempotent lookup must not enable any execution scheduler.
      }
      const active = records.active();
      if (active) throw new FactoryError('RUN_ACTIVE', `Run ${active.id} is active. Inspect it with: factory inspect ${active.id}`, { activeRunId: active.id });
      if (!execution) throw new FactoryError('MODEL_NOT_READY', 'Production execution is not enabled yet. No fixture substitution was made. Use the explicitly selected fixture backend for this slice.');
      const id = `run_${randomUUID()}`;
      const admittedAt = Date.now();
      const record = {
        id, requestId, project: { ...project }, brief: admittedBrief, status: 'admitted', admittedAt,
        deadlineAt: admittedAt + PHASE_1_LIMITS.runDeadlineMs, limits: { ...PHASE_1_LIMITS },
        counters: { modelAttempts: 0, toolRounds: 0, reservedOutputTokens: 0 },
        storageVersions: { ...STORAGE_VERSIONS },
        execution: { mode: execution.mode, model: execution.model, requestId: `factory:${id}:input:1` },
        capabilities: { repositoryTools: false, productionModel: false, resourceContainmentVerified: false },
        outcome: null,
      };
      records.save(record);
      job = execute(id);
      job.catch(() => {});
      return structuredClone(record);
    },
    inspectRun: async (id) => get(id),
    listRuns: async () => records.list(),
    close() {
      if (closePromise) return closePromise;
      closing = true;
      stopping = true;
      closePromise = (async () => {
        try {
          // Cancellation may race with an already-closing SDK. Always drain finalization before releasing ownership.
          try { if (handle) await handle.cancel(); } catch { /* The job still owns cleanup and its final receipt. */ }
          if (job) await job;
        } finally { records.close(); release(); }
      })();
      return closePromise;
    },
  };
}
