import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { FactoryError } from './storage.mjs';
import { createDraftQualification } from './qualification.mjs';
import { inspectExecutor, validateExecutorScope } from './execution.mjs';

// Application-side handling for composed executions that opt in with
// `qualifiesDrafts: true`. A saved qualification projection is evidence only:
// the run outcome and its Work item come from passive revalidation of the
// retained private artifacts after the composed execution fully drained.

const MAX_CHANGE_SUMMARIES = 32;
const STAGES = ['base-boundary', 'runner-probe', 'base-regression', 'candidate-base-boundary', 'candidate-base-regression',
  'draft-boundary', 'draft-regression', 'draft-candidate', 'vitest', 'lint'];
const VERDICTS = ['qualified', 'no-change', 'blocked', 'failed', 'stopped', 'interrupted'];
const STATES = ['checking', ...VERDICTS];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const conflict = () => {
  throw new FactoryError('QUALIFICATION_CONFLICT', 'Saved qualification identity, scope, and evidence bindings are immutable.');
};

// Passive inspection never needs live authority. Any attempt to request it is refused.
const passive = createDraftQualification({ verifyDraft() {
  throw new FactoryError('QUALIFICATION_PASSIVE', 'Passive inspection cannot request live executor authority.');
} });

export function initialQualification(runId, kind) {
  return { version: 1, runId, kind, status: 'pending', reviewReady: false };
}

/** Validate a detached qualification snapshot before it replaces the saved projection. */
export function validateQualificationState(state, current) {
  const previous = current.qualification;
  if (!plain(state) || !plain(previous) || state.version !== 1 || state.runId !== current.id || state.kind !== previous.kind
    || !STATES.includes(state.status) || typeof state.reviewReady !== 'boolean'
    || (state.reviewReady && state.kind !== 'owner')) conflict();
  if (state.descriptor !== undefined) {
    const descriptor = state.descriptor;
    let scope;
    try { scope = validateExecutorScope(descriptor?.scope); } catch { conflict(); }
    if (!plain(descriptor) || descriptor.version !== 1 || descriptor.runId !== current.id || descriptor.kind !== state.kind
      || !same(scope, current.executor?.scope) || current.admission?.binding === undefined
      || !same(descriptor.admissionBinding, current.admission.binding)) conflict();
  }
  if (previous.descriptor !== undefined && !same(previous.descriptor, state.descriptor)) conflict();
  if (state.verdict !== undefined) {
    const verdict = state.verdict;
    if (!plain(verdict) || verdict.runId !== current.id || verdict.kind !== state.kind || !VERDICTS.includes(verdict.status)
      || verdict.status !== state.status || verdict.reviewReady !== state.reviewReady) conflict();
    // A recorded failure cannot later be rewritten into a success.
    if (verdict.status === 'qualified' && previous.verdict && previous.verdict.status !== 'qualified') conflict();
  } else if (state.status !== 'checking') conflict();
  return structuredClone(state);
}

const started = state => state.status !== 'pending' || state.stage !== undefined;

/** Map a final composed receipt. Returns false to fall back to plain executor outcomes. */
export function applyQualificationReceipt(record, receipt) {
  const state = record.qualification;
  const unverified = reason => {
    record.status = 'failed';
    record.outcome = { kind: 'failed', reviewReady: false, reason };
    return true;
  };
  if (!started(state)) {
    // The composition must qualify every produced draft before reporting it.
    if (receipt.status === 'draft-produced') return unverified('QUALIFICATION_MISSING');
    if (receipt.status === 'qualified') return unverified('QUALIFICATION_UNVERIFIED');
    return false;
  }
  // A reporting failure cannot always save its own verdict. The drained composition
  // may still report this specific failure, never a success based on a receipt alone.
  if (receipt.status === 'failed' && receipt.reason === 'QUALIFICATION_PERSIST_FAILED'
    && receipt.kind === state.kind && receipt.reviewReady === false) return unverified(receipt.reason);
  const verdict = state.verdict;
  if (!verdict) {
    if (receipt.status !== 'interrupted') return unverified('QUALIFICATION_UNVERIFIED');
    record.status = 'interrupted';
    record.outcome = { kind: 'uncertain', reviewReady: false, reason: receipt.reason ?? 'qualification_reconciliation_required' };
    return true;
  }
  if (state.stage !== 'complete' || receipt.status !== verdict.status || receipt.kind !== state.kind
    || receipt.reviewReady !== verdict.reviewReady || (receipt.reason ?? null) !== (verdict.reason ?? null)
    || (verdict.status === 'qualified' && record.executor?.status !== 'draft-produced')) return unverified('QUALIFICATION_UNVERIFIED');
  const reason = verdict.reason ?? (verdict.status === 'qualified' ? 'QUALIFIED_EVIDENCE' : undefined);
  record.status = ['qualified', 'no-change'].includes(verdict.status) ? 'completed' : verdict.status;
  record.outcome = { kind: limitOutcome(verdict.status === 'interrupted' ? 'uncertain' : verdict.status, reason), reviewReady: false,
    ...(reason ? { reason } : {}) };
  return true;
}

async function qualificationEvidence(directory, run, dependencyRun) {
  const state = run.qualification;
  if (!started(state)) {
    let exists = false;
    try { await lstat(join(directory, 'qualification')); exists = true; } catch (error) { if (error.code !== 'ENOENT') exists = true; }
    if (!exists) return { status: 'not-started', runId: run.id, kind: state.kind, reviewReady: false, artifactStatus: 'missing',
      artifacts: { directory: 'qualification', complete: false }, stages: [] };
    // A claimed directory without a state file means qualification began and never recorded intent.
    let stateFile = true;
    try { await lstat(join(directory, 'qualification', 'state.json')); } catch (error) { if (error.code === 'ENOENT') stateFile = false; }
    if (!stateFile) return { status: 'interrupted', reason: 'qualification_reconciliation_required', runId: run.id, kind: state.kind,
      reviewReady: false, artifactStatus: 'incomplete', artifacts: { directory: 'qualification', complete: false }, stages: [] };
  }
  const invalid = { status: 'blocked', reason: 'QUALIFICATION_INVALIDATED', runId: run.id, kind: state.kind, reviewReady: false,
    recordedStatus: state.verdict?.status ?? 'interrupted', artifactStatus: 'invalid', artifacts: { directory: 'qualification', complete: false }, stages: [] };
  let evidence;
  try { evidence = await passive.inspect({ directory, run, dependencyRun }); } catch { return invalid; }
  // Require the application's complete evidence shape as well as the qualifier verdict.
  return evidence.status === 'qualified' && !currentQualified(run, evidence) ? invalid : evidence;
}

function currentQualified(run, evidence) {
  const state = run.qualification;
  return evidence.status === 'qualified' && evidence.artifactStatus === 'verified' && evidence.runId === run.id
    && evidence.kind === state.kind && state.stage === 'complete' && state.verdict?.status === 'qualified'
    && plain(state.descriptor) && plain(state.capture) && state.artifacts?.complete === true
    && same(evidence.stages?.map(stage => stage.stage), STAGES) && evidence.stages.every(stage => stage.passed !== undefined)
    && same(state.checks?.map(check => check.stage), STAGES);
}

const digest = text => createHash('sha256').update(text).digest('hex');

/**
 * Called only after the composed execution confirmed drainage and no stop fence applies.
 * Revalidates retained executor and qualification artifacts and builds at most one Work item.
 */
export async function finalizeQualifiedRun({ run, directory, dependencyRun, now }) {
  const invalid = { status: 'blocked', outcome: { kind: 'blocked', reviewReady: false, reason: 'QUALIFICATION_INVALIDATED' } };
  try {
    if (run.workItem) return invalid; // Never replace an existing Work item.
    const evidence = await qualificationEvidence(directory, run, dependencyRun);
    if (!currentQualified(run, evidence)) return invalid;
    const executor = await inspectExecutor({ directory, run, length: 4 });
    const state = run.qualification;
    if (run.executor?.status !== 'draft-produced' || executor.artifactStatus !== 'retained' || executor.draftCurrent !== true
      || run.executor.draft?.sourceDigest !== state.descriptor.draft?.sourceDigest) return invalid;
    const reviewReady = state.kind === 'owner' && evidence.reviewReady === true && state.verdict.reviewReady === true;
    const outcome = { kind: 'qualified', reviewReady, reason: 'QUALIFIED_EVIDENCE' };
    const workItem = {
      version: 1, id: `work_${run.id.slice('run_'.length)}`, projectId: run.project.id, runId: run.id, requestId: run.requestId,
      kind: state.kind, controlled: state.kind === 'controlled-fixture', status: reviewReady ? 'review-ready' : 'qualified-evidence',
      // Only fresh owner-profile qualification can establish readiness, never Approval.
      reviewReady, createdAt: now,
      task: { brief: 'record:brief', sha256: digest(run.brief.text), evidence: 'record:brief.evidence' },
      plan: run.executor.plan ? { artifact: run.executor.plan.artifact, provenance: run.executor.plan.provenance } : null,
      transcript: { directory: 'executor', events: executor.events.length },
      draft: { sourceDigest: state.capture.sourceDigest, directory: 'qualification/draft' },
      patch: { artifact: 'qualification/patch.json', sha256: state.capture.patchDigest },
      newFiles: state.capture.changes.filter(change => change.operation === 'add').map(change => `qualification/draft/${change.path}`),
      checks: evidence.stages.map(stage => ({ stage: stage.stage, receipt: stage.receipt })),
      qualification: { artifact: 'qualification/state.json', status: 'qualified' },
      usage: { counters: structuredClone(run.counters), reservations: 'record:reservations' },
      outcome: 'record:outcome',
    };
    return { status: 'completed', outcome, workItem };
  } catch { return invalid; }
}

/** Bounded public projection. Full logs, reports, and inventories stay in private artifacts. */
function boundedQualification(state) {
  const { checks, capture, descriptor, ...rest } = state;
  const changes = Array.isArray(capture?.changes) ? capture.changes : [];
  return { ...rest,
    ...(descriptor ? { descriptor: { version: descriptor.version, runId: descriptor.runId, kind: descriptor.kind,
      scope: descriptor.scope, draft: descriptor.draft } } : {}),
    ...(capture ? { capture: { patchDigest: capture.patchDigest, sourceDigest: capture.sourceDigest,
      baseSourceDigest: capture.baseSourceDigest, changes: changes.slice(0, MAX_CHANGE_SUMMARIES),
      changeCount: changes.length, changesTruncated: changes.length > MAX_CHANGE_SUMMARIES } } : {}),
    ...(checks ? { checks: checks.slice(0, STAGES.length).map(check => ({ stage: check.stage, name: check.name, passed: check.passed,
      reason: check.reason, exitCode: check.exitCode, sourceDigest: check.sourceDigest, outputBytes: check.outputBytes })) } : {}) };
}

/**
 * Passive freshness projection for inspect/list/offline history. `saved` is the
 * unobserved stored record. Nothing here saves records, calls live authority, or schedules work.
 */
export async function observeQualification(record, saved, directory, dependencyRun, { verify = true } = {}) {
  if (!saved?.qualification) return record;
  record.qualification = boundedQualification(saved.qualification);
  if (!verify) {
    // Listing skips artifact hashing. It shows the recorded summary as unverified, never as current.
    record.qualificationEvidence = { status: 'unverified', recordedStatus: saved.qualification.verdict?.status ?? saved.qualification.status,
      runId: saved.id, kind: saved.qualification.kind, reviewReady: false, artifactStatus: 'unverified' };
    record.qualification.recordedReviewReady = saved.qualification.reviewReady;
    record.qualification.reviewReady = false;
    if (record.outcome) record.outcome.reviewReady = false;
    if (saved.workItem) record.workItem = { ...structuredClone(saved.workItem), reviewReady: false, freshness: 'unverified' };
    return record;
  }
  let evidence = await qualificationEvidence(directory, saved, dependencyRun);
  const current = record.status === 'completed' && currentQualified(saved, evidence);
  if (evidence.status === 'qualified' && record.status !== 'completed') {
    // Run-level stop, failure, or interruption outranks a retained qualified verdict.
    evidence = { ...evidence, status: record.status, recordedStatus: 'qualified', reviewReady: false };
  }
  const reviewReady = current && saved.qualification.kind === 'owner' && evidence.reviewReady === true && saved.workItem?.reviewReady === true;
  record.qualification.recordedReviewReady = saved.qualification.reviewReady;
  record.qualification.reviewReady = reviewReady;
  record.qualificationEvidence = { ...evidence, reviewReady, stages: (evidence.stages ?? []).slice(0, STAGES.length) };
  if (record.outcome) record.outcome.reviewReady = reviewReady;
  if (saved.workItem) {
    record.workItem = { ...structuredClone(saved.workItem), reviewReady, freshness: current ? 'current' : 'invalidated' };
  }
  return record;
}

/** Normalize an existing limit or deadline outcome without changing its exact reason. */
export const limitOutcome = (kind, reason) => /LIMIT|^RUN_DEADLINE$/.test(reason ?? '') ? 'budget-limited' : kind;
