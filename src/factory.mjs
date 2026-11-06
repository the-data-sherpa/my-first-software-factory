import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { privateDirectory, acquireOwner, openRecords, STORAGE_VERSIONS, ACTIVE_STATUSES, FactoryError,
  backupFactory as backupStores, restoreFactory as restoreStores } from './storage.mjs';
import { inspectExecution, validateExecutionStores, inspectExecutor, validateExecutorScope } from './execution.mjs';
import { executionBudget, requireReview, requireRemainingBudget, requireSafeResume } from './recovery.mjs';
import { observeWorkspace, prepareRunWorkspace, requireWorkspaceQuiescence } from './workspace-run.mjs';
import { observeDependencies, prepareRunDependencies, requireDependencyQuiescence } from './dependency-run.mjs';
import { observeAdmission } from './admission.mjs';
import { initialQualification, validateQualificationState, applyQualificationReceipt, finalizeQualifiedRun,
  observeQualification, limitOutcome } from './work-items.mjs';

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
  if (receipt.submissionId) {
    if (record.executor && receipt.safety?.kind === 'model-only' && receipt.safety.purpose === 'preflight') {
      record.execution.preflightSubmissionId = receipt.submissionId;
    } else record.execution.submissionId = receipt.submissionId;
  }
  if (record.operation === 'dependency-preparation') {
    record.status = 'interrupted';
    record.outcome = { kind: 'uncertain', reviewReady: false, reason: 'dependency_reconciliation_required' };
    return record;
  }
  if (record.execution.mode === 'admission-only') {
    if (passive) {
      record.status = 'interrupted';
      record.outcome = { kind: 'uncertain', reviewReady: false, reason: 'admission_reconciliation_required' };
    } else {
      record.status = 'blocked';
      record.outcome = { kind: receipt.status === 'admission-only' ? 'admission-only' : 'blocked', reviewReady: false,
        reason: receipt.status === 'admission-only' ? 'EXECUTOR_NOT_IMPLEMENTED' : receipt.reason ?? 'ADMISSION_INCOMPLETE' };
    }
    return record;
  }
  const uncertainTools = record.reservations?.some((item) => item.kind === 'tool-round' && item.state === 'uncertain');
  if (record.execution.mode === 'repository-executor') {
    if (passive || uncertainTools) {
      record.status = 'interrupted';
      record.outcome = { kind: 'uncertain', reviewReady: false, reason: 'executor_reconciliation_required' };
    } else if (record.qualification && applyQualificationReceipt(record, receipt)) {
      // Opted-in composed runs use only the persisted, matching qualification verdict.
    } else if (['draft-produced', 'no-change'].includes(receipt.status)) {
      record.status = 'completed';
      record.outcome = { kind: receipt.status, reviewReady: false,
        reason: receipt.status === 'draft-produced' ? 'QUALIFICATION_REQUIRED' : 'NO_CHANGE' };
    } else {
      record.status = receipt.status === 'stopped' ? 'stopped' : receipt.status === 'interrupted' ? 'interrupted'
        : record.admission.status !== 'verified' ? 'blocked' : 'failed';
      record.outcome = { kind: receipt.status === 'budget-limited' ? 'budget-limited' : record.status,
        reviewReady: false, reason: receipt.reason ?? 'EXECUTOR_INCOMPLETE' };
    }
    return record;
  }
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
      : { kind: record.execution.mode === 'fixture' ? 'fixture-completed'
        : record.execution.mode === 'model-preflight' ? 'model-preflight-completed' : 'execution-completed',
      reviewReady: false, answer: receipt.answer };
  } else if (receipt.status === 'unanswered') {
    record.status = record.stopRequested || receipt.reason === 'aborted' ? 'stopped'
      : record.execution.mode === 'model-preflight' ? 'blocked' : 'failed';
    const modelReason = record.reservations?.filter((item) => item.kind === 'model').at(-1)?.accounting?.reason;
    record.outcome = { kind: record.status, reviewReady: false, reason: modelReason ?? 'execution_unanswered' };
  } else record.status = 'interrupted';
  return record;
}

function inspectionOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => !['page', 'offset', 'length'].includes(key))
    || (options.page !== undefined && (!Number.isSafeInteger(options.page) || options.page < 0))
    || (options.offset !== undefined && (!Number.isSafeInteger(options.offset) || options.offset < 0))
    || (options.length !== undefined && (!Number.isInteger(options.length) || options.length < 4 || options.length > 16384))) {
    throw new FactoryError('INVALID_ARGUMENTS', 'Use a nonnegative executor event index and byte offset, with a page length of 4–16384 bytes.');
  }
  return { ...options };
}
async function observeRunEvidence(record, stateDir, dependencyRun, options = {}, saved = record, verify = true) {
  if (!record.executor) return observeAdmission(record, dependencyRun);
  if (record.admission?.status === 'verified') record.admission.historical = true;
  try { record.executorEvidence = await inspectExecutor({ directory: join(stateDir, 'runs', record.id), run: record, ...options }); }
  catch {
    record.executorEvidence = { status: 'unavailable', artifactStatus: 'invalid-or-incomplete', reviewReady: false,
      inspectionFailure: { code: 'EXECUTOR_ARTIFACT', message: 'Executor evidence is invalid or incomplete. Retain the private artifacts and draft for inspection; no repair or replay occurred.' } };
  }
  // Qualification freshness is checked against the stored, unobserved record.
  return observeQualification(record, saved, join(stateDir, 'runs', record.id), dependencyRun, { verify });
}

export async function inspectHistory({ stateDir = DEFAULT_STATE_DIR, runId, inspection } = {}) {
  const options = inspectionOptions(inspection);
  stateDir = await privateDirectory(stateDir, { create: false });
  const release = await acquireOwner(stateDir);
  let records;
  try {
    records = await openRecords(stateDir, { readOnly: true });
    const runs = runId ? [records.get(runId)] : records.list();
    if (runId && !runs[0]) throw new FactoryError('RUN_NOT_FOUND', 'No run has that identity.');
    for (const record of runs) {
      const saved = structuredClone(record);
      await observeWorkspace(record, stateDir);
      await observeDependencies(record, stateDir);
      if (ACTIVE_STATUSES.includes(record.status)) {
        applyReceipt(record, await inspectExecution(join(stateDir, 'runs', record.id), { stateRoot: stateDir }), { passive: true });
      }
      await observeRunEvidence(record, stateDir, record.admission ? records.get(record.admission.dependencyRunId) : undefined, options, saved, Boolean(runId));
    }
    return runId ? runs[0] : runs;
  } finally { records?.close(); release(); }
}

/** Execution is trusted code, not operator configuration. start/resume must return an owned handle.
 * cancel requests cancellation; finished settles the receipt; close MUST join all owned work.
 * A thrown start/resume must have drained anything it started before rejecting.
 * If startup drainage cannot be confirmed, reject with DRAIN_FAILED (or MODEL_DRAIN_FAILED)
 * so admission and ownership remain fenced even without a returned handle.
 * assessRecovery must establish quiescence and reconcile partial effects without enabling scheduling.
 */
export async function openFactory({ stateDir = DEFAULT_STATE_DIR, project = { id: 'vanguard', repositoryPath: join(homedir(), 'Projects', 'vanguard') }, execution, workspace, dependencyPreparation,
  clock = { now: Date.now, setTimeout, clearTimeout } } = {}) {
  stateDir = await privateDirectory(stateDir);
  if (project.id !== 'vanguard' || typeof project.repositoryPath !== 'string') {
    throw new FactoryError('INVALID_PROJECT', 'Phase 1 configures only the Vanguard project.');
  }
  project = { id: project.id, repositoryPath: resolve(project.repositoryPath) };
  // Read the opt-in once. Only a composed repository executor may qualify drafts.
  const qualifiesDrafts = execution?.qualifiesDrafts === true;
  if ((execution?.qualifiesDrafts !== undefined && typeof execution.qualifiesDrafts !== 'boolean')
    || (qualifiesDrafts && execution.mode !== 'repository-executor')) {
    throw new FactoryError('INVALID_EXECUTION', 'Draft qualification requires an explicitly composed repository-executor adapter.');
  }
  const release = await acquireOwner(stateDir);
  let records;
  try { records = await openRecords(stateDir); }
  catch (error) { release(); throw error; }
  try {
    const active = records.active();
    if (active) {
      await observeWorkspace(active, stateDir);
      await observeDependencies(active, stateDir);
      records.save(applyReceipt(active, await inspectExecution(join(stateDir, 'runs', active.id), { stateRoot: stateDir }), { passive: true }));
    }
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
  const makeRecord = (requestId, brief, dependencyRunId, scope) => {
    const admissionEnabled = ['admission-only', 'repository-executor'].includes(execution?.mode);
    if (execution?.mode === 'repository-executor') scope = validateExecutorScope(scope);
    else if (scope !== undefined) throw new FactoryError('EXECUTOR_NOT_ENABLED', 'Write permissions require explicit repository-executor mode.');
    if (admissionEnabled && (!workspace || typeof dependencyRunId !== 'string' || !/^run_[a-f0-9-]{36}$/.test(dependencyRunId))) {
      throw new FactoryError('DEPENDENCY_SELECTION_REQUIRED', 'Admission requires --dependency-run RUN_ID naming an explicitly prepared run. No latest bundle is selected or installed.');
    }
    if (!admissionEnabled && dependencyRunId !== undefined) throw new FactoryError('ADMISSION_NOT_ENABLED', 'Dependency selection requires explicit repository admission mode.');
    if (!execution && !workspace) throw new FactoryError('MODEL_NOT_READY', 'Production execution is not enabled yet. No fixture substitution was made.');
    const id = `run_${randomUUID()}`;
    const admittedAt = clock.now();
    return {
      id, requestId, project: { ...project }, brief, status: 'admitted', admittedAt,
      deadlineAt: admittedAt + PHASE_1_LIMITS.runDeadlineMs, limits: { ...PHASE_1_LIMITS },
      counters: { modelAttempts: 0, toolRounds: 0, reservedOutputTokens: 0 }, reservations: [],
      storageVersions: { ...STORAGE_VERSIONS },
      execution: { mode: execution?.mode ?? 'production-blocked', model: execution?.model ?? 'openai/gpt-6.1-sol', requestId: `factory:${id}:input:1` },
      ...(workspace ? { workspace: { status: 'pending' } } : {}),
      ...(admissionEnabled ? { admission: { version: 1, kind: execution.admissionKind,
        dependencyRunId, status: 'pending', readiness: 'not-ready', reviewReady: false } } : {}),
      ...(execution?.mode === 'repository-executor' ? { executor: { version: 1, kind: execution.admissionKind, status: 'pending', scope } } : {}),
      ...(qualifiesDrafts ? { qualification: initialQualification(id, execution.admissionKind) } : {}),
      capabilities: { repositoryTools: execution?.mode === 'repository-executor',
        productionModel: ['model-preflight', 'model-bounded-no-tools'].includes(execution?.mode)
          || (admissionEnabled && execution.admissionKind === 'owner'),
        resourceContainmentVerified: false },
      outcome: null,
    };
  };
  async function assess(record) {
    await requireWorkspaceQuiescence(record, stateDir);
    await requireDependencyQuiescence(record, stateDir);
    if (record.execution.mode === 'production-blocked' && record.workspace?.artifactStatus === 'prepared'
      && record.execution.submissionId === undefined && record.counters.modelAttempts === 0
      && record.counters.toolRounds === 0 && (record.reservations?.length ?? 0) === 0) {
      return { kind: 'workspace-only', quiescent: true, resumable: false,
        evidence: 'Validated preparation receipts confirm trusted process drainage; this admission enabled no model or repository tools.' };
    }
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
    if (owned.drained) return; // An answer is not drainage. Stop still cancels during close().
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
      if (owned.preparingDependencies) {
        await prepareRunDependencies({ get: () => get(id), save: records.save, stateDir, dependencyPreparation, signal: controller.signal });
        record = get(id);
        record.status = 'blocked';
        record.outcome = { kind: 'blocked', reviewReady: false, reason: 'MODEL_NOT_READY' };
        return; // Preparation never dispatches an executor or implicitly enables agent tools.
      }
      await prepareRunWorkspace({ get: () => get(id), save: records.save, stateDir, workspace, signal: controller.signal });
      record = get(id);
      if (owned.stopReason || controller.signal.aborted) throw new FactoryError('RUN_STOPPING', 'The run is stopping.');
      requireRemainingBudget(record, clock.now());
      if (!execution) {
        record.status = 'blocked';
        record.outcome = { kind: 'blocked', reviewReady: false, reason: 'MODEL_NOT_READY' };
        return;
      }
      const budget = executionBudget({ get: () => get(id), save: records.save, now: clock.now, signal: controller.signal });
      owned.handle = await execution[resume ? 'resume' : 'start']({ directory, runId: id, requestId: record.execution.requestId,
        brief: structuredClone(record.brief), run: structuredClone(record), budget, signal: controller.signal,
        ...(record.admission ? {
          dependencyRun: records.get(record.admission.dependencyRunId),
          saveAdmission: (admission) => {
            const current = get(id);
            if (admission.dependencyRunId !== current.admission.dependencyRunId || admission.kind !== current.admission.kind) {
              throw new FactoryError('ADMISSION_CONFLICT', 'Saved admission choices are immutable.');
            }
            current.admission = structuredClone(admission);
            records.save(current);
          },
        } : {}),
        ...(record.executor ? { saveExecutor: (executor) => {
          const current = get(id);
          if (executor.version !== 1 || executor.kind !== current.executor.kind
            || JSON.stringify(validateExecutorScope(executor.scope)) !== JSON.stringify(current.executor.scope)) {
            throw new FactoryError('EXECUTOR_CONFLICT', 'Saved executor identity and file permissions are immutable.');
          }
          if (executor.submissionId !== undefined) {
            if (!Number.isSafeInteger(executor.submissionId) || executor.submissionId < 1
              || (current.execution.submissionId !== undefined && current.execution.submissionId !== executor.submissionId)) {
              throw new FactoryError('RECEIPT_MISMATCH', 'The executor submission identity cannot change.');
            }
            current.execution.submissionId = executor.submissionId;
          }
          current.executor = { ...structuredClone(executor), reviewReady: false };
          records.save(current);
        } } : {}),
        ...(record.qualification && qualifiesDrafts ? { saveQualification: (state) => {
          if (owned.drained) throw new FactoryError('QUALIFICATION_CONFLICT', 'The run has already been finalized.');
          const current = get(id);
          current.qualification = validateQualificationState(state, current);
          records.save(current); // Saved verbatim: passive inspection compares it with the private state artifact.
        } } : {}) });
      record = get(id);
      if (owned.handle.submissionId !== undefined) record.execution.submissionId = owned.handle.submissionId;
      records.save(record);
      if (owned.stopReason) void cancel(owned);
      const receipt = await Promise.race([owned.handle.finished, owned.stopped.promise]);
      record = receipt ? applyReceipt(get(id), receipt) : get(id);
    } catch (error) {
      owned.startupDrainFailed = ['MODEL_DRAIN_FAILED', 'DRAIN_FAILED'].includes(error?.code);
      record = get(id);
      record.status = record.admission ? 'blocked' : 'failed';
      record.outcome = { kind: record.status, reviewReady: false, reason: error instanceof FactoryError ? error.code : 'execution_failed' };
    } finally {
      owned.finalizing = true;
      // Do not release admission or lifetime ownership on cancel failure. close is the mandatory drain.
      try {
        if (owned.handle) await owned.handle.close();
        await owned.cancelPromise;
        if (owned.startupDrainFailed) throw new FactoryError('DRAIN_FAILED', 'Startup cleanup is unconfirmed.');
      } catch {
        const latest = get(id);
        latest.status = 'interrupted';
        latest.outcome = { kind: 'uncertain', reviewReady: false, reason: 'drain_failed' };
        records.save(latest);
        clock.clearTimeout(owned.timer);
        throw new FactoryError('DRAIN_FAILED', 'Owned work did not confirm drainage. Admission and backend ownership remain fenced.');
      }
      clock.clearTimeout(owned.timer);
      let latest = get(id);
      if (!owned.stopReason && latest.qualification && record.status === 'completed' && record.outcome?.kind === 'qualified') {
        // Only after confirmed drainage: revalidate retained evidence, then persist at most one Work item.
        const finalized = await finalizeQualifiedRun({ run: latest, directory: join(stateDir, 'runs', id),
          dependencyRun: records.get(latest.admission?.dependencyRunId), now: clock.now() });
        latest = get(id);
        ({ status: record.status, outcome: record.outcome } = finalized);
        if (finalized.workItem && !owned.stopReason) latest.workItem = finalized.workItem;
      }
      if (owned.stopReason) { // A stop fence outranks every receipt and qualification result.
        record.status = owned.stopReason === 'RUN_DEADLINE' ? 'failed' : 'stopped';
        record.outcome = { kind: latest.qualification ? limitOutcome(record.status, owned.stopReason) : record.status,
          reviewReady: false, reason: owned.stopReason };
      }
      records.save({ ...latest, status: record.status, outcome: record.outcome,
        execution: record.executor ? latest.execution : record.execution });
      owned.drained = true;
    }
  }
  function launch(id, resume = false, preparingDependencies = false) {
    const owned = { id, controller: new AbortController(), stopped: Promise.withResolvers(), drained: false, preparingDependencies };
    job = owned;
    owned.timer = clock.setTimeout(() => requestStop(owned, 'RUN_DEADLINE'), Math.max(0, get(id).deadlineAt - clock.now()));
    owned.promise = execute(owned, resume);
    owned.promise.catch(() => {}); // Control calls still observe drain failures.
  }
  return {
    stateDir,
    storageInfo: () => ({ ...STORAGE_VERSIONS }),
    async startRun({ requestId, brief, dependencyRunId, scope }) {
      assertOpen();
      validateRequest(requestId);
      const admittedBrief = snapshotBrief(brief);
      const normalizedScope = scope === undefined ? undefined : validateExecutorScope(scope);
      const existing = records.byRequest(requestId);
      if (existing) {
        if (existing.brief.text !== brief || JSON.stringify(existing.project) !== JSON.stringify(project)
          || existing.admission?.dependencyRunId !== dependencyRunId
          || JSON.stringify(existing.executor?.scope) !== JSON.stringify(normalizedScope)) {
          throw new FactoryError('REQUEST_CONFLICT', 'That request ID already belongs to a different admitted task brief or project.');
        }
        return existing;
      }
      if (records.active()) conflict(records.active());
      if (transition) throw new FactoryError('CONTROL_BUSY', 'A recovery control is already in progress.');
      const record = makeRecord(requestId, admittedBrief, dependencyRunId, normalizedScope);
      records.save(record);
      launch(record.id);
      return structuredClone(record);
    },
    async prepareDependencies(id, { bunPath, registry = false } = {}) {
      assertControl();
      const record = get(id);
      if (records.active()) conflict(records.active());
      if (JSON.stringify(record.project) !== JSON.stringify(project)) throw new FactoryError('PROJECT_MISMATCH', 'Dependency preparation must retain the original project identity.');
      if (typeof bunPath !== 'string' || resolve(bunPath) !== bunPath || typeof registry !== 'boolean') {
        throw new FactoryError('INVALID_ARGUMENTS', 'Supply a canonical Bun executable path and an explicit boolean registry choice.');
      }
      if (record.execution.mode !== 'production-blocked' || !record.workspace?.receipt || record.execution.submissionId
        || record.counters.modelAttempts !== 0 || record.counters.toolRounds !== 0 || record.stopRequested || record.replacedByRunId) {
        throw new FactoryError('DEPENDENCIES_PREPARATION_UNAVAILABLE', 'Explicit preparation requires an unused workspace-only run. No agent work was enabled.');
      }
      if (record.dependencies) {
        if (record.dependencies.status === 'prepared' && record.dependencies.bunPath === bunPath
          && (record.dependencies.registry ?? false) === registry) {
          await observeDependencies(record, stateDir);
          const failure = record.dependencies.inspectionFailure;
          if (failure) throw new FactoryError(failure.code, failure.message);
          if (record.dependencies.artifactStatus !== 'prepared') throw new FactoryError('DEPENDENCIES_MISSING', 'Inspect the incomplete bundle. No installation was repeated.');
          return record;
        }
        throw new FactoryError('DEPENDENCIES_EXISTS', 'Inspect the existing dependency attempt. Preparation is never retried implicitly.');
      }
      requireRemainingBudget(record, clock.now());
      record.operation = 'dependency-preparation';
      record.dependencies = { status: 'pending', bunPath, registry, requestedAt: clock.now() };
      record.status = 'admitted';
      record.outcome = null;
      records.save(record);
      launch(id, false, true);
      return structuredClone(record);
    },
    async stopRun(id) {
      assertControl();
      const record = get(id);
      if (!ACTIVE_STATUSES.includes(record.status)) return record;
      if (job?.id === id && !job.drained) {
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
      if (record.qualification) throw new FactoryError('UNSAFE_RESUME', 'A qualifying execution never resumes. Inspect its retained evidence and use an explicit linked replacement.');
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
      if (Boolean(record.workspace) !== Boolean(workspace)) throw new FactoryError('WORKSPACE_NOT_ENABLED', 'A linked replacement must retain the original workspace-preparation requirement.');
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
        const replacement = makeRecord(requestId, structuredClone(record.brief), record.admission?.dependencyRunId, record.executor?.scope);
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
    inspectRun: async (id, inspection) => {
      const options = inspectionOptions(inspection);
      const saved = get(id);
      const record = await observeDependencies(await observeWorkspace(structuredClone(saved), stateDir), stateDir);
      return observeRunEvidence(record, stateDir, record.admission ? records.get(record.admission.dependencyRunId) : undefined, options, saved);
    },
    listRuns: async () => Promise.all(records.list().map(async (record) => {
      const saved = structuredClone(record);
      await observeDependencies(await observeWorkspace(record, stateDir), stateDir);
      return observeRunEvidence(record, stateDir, record.admission ? records.get(record.admission.dependencyRunId) : undefined, {}, saved, false);
    })),
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
