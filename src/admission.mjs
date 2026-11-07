import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { InMemoryModelsStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { FactoryError } from './storage.mjs';
import { inspectWorkspace } from './workspace.mjs';
import { sourceFingerprint } from './containment-files.mjs';
import { inspectDependencies, verifyDependencyBundle, DependencyError } from './dependencies.mjs';
import { createRunTools } from './run-tools.mjs';
import { createModelExecution } from './model-execution.mjs';
import { MODEL_ROUTE } from './model.mjs';
import { verifyContainmentEnvelope, ContainmentError } from './containment.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const handoffs = new WeakMap();
const activations = new WeakMap();
const instruction = 'Inspect the retained admission/check evidence. Correct prerequisites or baseline failures outside agent execution, explicitly prepare matching dependencies if needed, then start a new run with a new request ID. Never reuse stale smoke or baseline evidence.';
const fail = (code) => { throw new FactoryError(code, instruction); };
const isDrain = error => ['DRAIN_FAILED', 'MODEL_DRAIN_FAILED'].includes(error?.code);

// Only composed runs carry run.qualification; legacy admission/executor profiles never hash these modules.
const qualifiedFiles = ['qualified-execution.mjs', 'qualification.mjs', 'qualification-artifacts.mjs', 'qualification-source.mjs',
  'qualification-selection.mjs', 'qualification-scope.mjs', 'qualification-reporting.mjs', 'qualification-reporter.mjs',
  'work-items.mjs', 'factory.mjs', 'execution.mjs', 'storage.mjs', 'workspace.mjs', 'workspace-git.mjs',
  'containment-lifetime.mjs', 'containment-entry.mjs', 'containment-host-probes.mjs', 'containment-test-profile.mjs', 'recovery-owner.mjs'];
async function profile(run, dependencies, kind) {
  const files = {};
  for (const name of ['admission.mjs', 'run-tools.mjs', 'containment.mjs', 'containment-files.mjs',
    'containment-probe.mjs', 'containment-filter.mjs', 'containment-namespace.mjs', 'dependencies.mjs',
    'dependencies-files.mjs', 'dependencies-lock.mjs', 'dependencies-cache.mjs', 'dependencies-graph.mjs',
    'model.mjs', 'model-execution.mjs', 'model-transport.mjs', 'model-accounting.mjs',
    'executor.mjs', 'executor-policy.mjs', 'executor-artifacts.mjs', 'executor-model.mjs', 'executor-tools.mjs',
    '../docs/agents/change-quality.md', ...(run.qualification ? qualifiedFiles : [])]) {
    files[name] = hash(await readFile(new URL(name, import.meta.url)));
  }
  return { version: 1, kind, model: MODEL_ROUTE, reasoning: 'low', limits: run.limits,
    ...(run.executor ? { executorScope: run.executor.scope } : {}),
    checks: ['vitest run --maxWorkers=2 --no-file-parallelism', 'eslint . --no-cache'],
    dependencyIntentId: dependencies.intent.id, inventoryDigest: dependencies.receipt.inventoryDigest,
    toolchain: dependencies.intent.toolchain, implementation: files };
}

/** Explicit retirement prerequisite only: validate retained ownership/profile without
 * requiring the quarantined draft to equal its pristine baseline or enabling work. */
export async function verifyRecoveryAdmission(run, dependencyRun) {
  const binding = run.admission?.binding;
  const deps = dependencyRun?.dependencies;
  if (!binding || !deps?.intent || deps.status !== 'prepared' || dependencyRun.id !== run.admission.dependencyRunId
    || deps.intent.workspaceIntent.runId !== dependencyRun.id || JSON.stringify(dependencyRun.project) !== JSON.stringify(run.project)
    || JSON.stringify(deps.intent.workspaceIntent) !== JSON.stringify(dependencyRun.workspace?.intent)
    || binding.runId !== run.id || binding.workspaceIntentId !== run.workspace.intent.id
    || binding.baseCommit !== run.workspace.intent.baseCommit || binding.sourceManifestId !== run.workspace.intent.sourceManifest.id
    || JSON.stringify(await inspectWorkspace(run.workspace.intent)) !== JSON.stringify(run.workspace.receipt)) fail('RECOVERY_REQUIRED');
  await verifyDependencyBundle(deps.intent, { workspaceIntent: run.workspace.intent });
  const receipt = await inspectDependencies(deps.intent);
  if (JSON.stringify(receipt) !== JSON.stringify(deps.receipt)
    || hash(JSON.stringify(await profile(run, { intent: deps.intent, receipt }, run.admission.kind))) !== binding.profileDigest) fail('RECOVERY_REQUIRED');
}

/** Passive evidence freshness only. It cannot mint a handoff, run probes, or reconcile effects. */
export async function observeAdmission(run, dependencyRun) {
  if (run.admission?.status !== 'verified') return run;
  try {
    const binding = run.admission.binding;
    const intent = dependencyRun?.dependencies?.intent;
    if (!binding || !intent) fail('ADMISSION_INVALIDATED');
    if (JSON.stringify(await inspectWorkspace(run.workspace.intent)) !== JSON.stringify(run.workspace.receipt)) fail('WORKSPACE_REQUIRED');
    await verifyDependencyBundle(intent, { workspaceIntent: run.workspace.intent });
    const receipt = await inspectDependencies(intent);
    const currentProfile = await profile(run, { intent, receipt }, run.admission.kind);
    if (await sourceFingerprint(run.workspace.intent.worktree, run.workspace.intent.sourceManifest) !== binding.sourceDigest
      || hash(JSON.stringify(currentProfile)) !== binding.profileDigest) fail('ADMISSION_INVALIDATED');
    run.admission.artifactStatus = 'verified';
  } catch {
    run.admission.artifactStatus = 'invalid';
    run.admission.readiness = 'invalidated';
    run.admission.inspectionFailure = { code: 'ADMISSION_INVALIDATED', message: instruction };
  }
  return run;
}

/** A receipt/JSON flag is never authority. Only a live adapter can issue this token.
 * Revalidation includes actual source bytes, dependencies, policy and live resource scope.
 * Closing or invalidating its owner permanently revokes it. No executor is installed here.
 */
export async function verifyAdmissionHandoff(token, { runId, kind = 'owner' } = {}) {
  const owner = handoffs.get(token);
  if (!owner || owner.consumed || owner.runId !== runId || owner.kind !== kind) fail('ADMISSION_AUTHORITY_REQUIRED');
  await owner.verify();
  return Object.freeze({ runId, kind, binding: structuredClone(owner.binding) });
}

/** Internal executor transition, not a callback/JSON authorization seam. Verify pristine
 * source first, consume exactly once, then retain policy/dependency/ownership checks.
 * The executor separately verifies every non-scoped source byte against the baseline.
 */
export async function consumeAdmissionHandoff(token, identity) {
  await verifyAdmissionHandoff(token, identity);
  const owner = handoffs.get(token);
  if (owner.consumed) fail('ADMISSION_AUTHORITY_REQUIRED');
  owner.consumed = true;
  const authority = Object.freeze({});
  activations.set(authority, owner.activate());
  return authority;
}
export async function verifyActivatedAdmission(authority) {
  const activation = activations.get(authority);
  if (!activation) fail('ADMISSION_AUTHORITY_REQUIRED');
  await activation.verify();
  return { ...activation, binding: structuredClone(activation.binding) };
}

/** Trusted execution seam. Constructor/inspection/recovery do not initialize ModelRuntime.
 * Injection is in-process trusted application code, never CLI module/auth/transport input.
 * Fixture identity is explicit and cannot attest to the real owner profile.
 */
export function createAdmissionExecution({ createRuntime, fetch, clock, fixture = false } = {}) {
  if (typeof fixture !== 'boolean' || (!fixture && (createRuntime || fetch || clock))
    || (fixture && (typeof createRuntime !== 'function' || typeof fetch !== 'function'))) {
    throw new FactoryError('ADMISSION_CONFIGURATION', 'Injected runtime/transport/clock require explicit controlled-fixture identity and both runtime and transport. Owner admission accepts no overrides.');
  }
  createRuntime ??= options => ModelRuntime.create(options);
  const kind = fixture ? 'controlled-fixture' : 'owner';
  return Object.freeze({ mode: 'admission-only', model: MODEL_ROUTE, admissionKind: kind,
    async start(input) {
      const { budget, signal, saveAdmission } = input;
      const run = structuredClone(input.run);
      const dependencyRun = structuredClone(input.dependencyRun);
      if (!run.admission || run.admission.kind !== kind || typeof saveAdmission !== 'function') fail('ADMISSION_REQUIRED');
      const shutdown = new AbortController();
      const combined = AbortSignal.any([signal, shutdown.signal]);
      let tools; let model; let closing; let closed = false; let invalid = false; let ready = false;
      let binding; let dependencyBundle; let modelRuntime; let activated = false;
      let state = { ...run.admission, status: 'checking', readiness: 'not-ready', baselines: [] };
      const save = patch => { state = { ...state, ...patch }; saveAdmission(structuredClone(state)); };
      const active = () => { budget.assertActive(); if (closed || combined.aborted) fail('RUN_STOPPING'); if (invalid) fail('ADMISSION_INVALIDATED'); };
      async function capture(draft = false) {
        active();
        await verifyContainmentEnvelope();
        if (!run.workspace?.intent || run.workspace.intent.runId !== run.id
          || JSON.stringify(await inspectWorkspace(run.workspace.intent)) !== JSON.stringify(run.workspace.receipt)) fail('WORKSPACE_REQUIRED');
        const deps = dependencyRun?.dependencies;
        if (!deps?.intent || deps.status !== 'prepared' || dependencyRun.id !== run.admission.dependencyRunId
          || deps.intent.workspaceIntent.runId !== dependencyRun.id
          || JSON.stringify(dependencyRun.project) !== JSON.stringify(run.project)
          || JSON.stringify(deps.intent.workspaceIntent) !== JSON.stringify(dependencyRun.workspace?.intent)) fail('DEPENDENCIES_MISSING');
        dependencyBundle = await verifyDependencyBundle(deps.intent, { workspaceIntent: run.workspace.intent });
        const receipt = await inspectDependencies(deps.intent);
        if (JSON.stringify(receipt) !== JSON.stringify(deps.receipt)) fail('DEPENDENCIES_STALE');
        let sourceDigest;
        try { sourceDigest = await sourceFingerprint(run.workspace.intent.worktree, draft ? undefined : run.workspace.intent.sourceManifest); }
        catch { fail('ADMISSION_SOURCE_CHANGED'); }
        const executionProfile = await profile(run, { intent: deps.intent, receipt }, kind);
        active();
        return { runId: run.id, workspaceIntentId: run.workspace.intent.id, baseCommit: run.workspace.intent.baseCommit,
          sourceManifestId: run.workspace.intent.sourceManifest.id, sourceDigest, profileDigest: hash(JSON.stringify(executionProfile)), executionProfile };
      }
      async function verify() {
        try {
          active();
          const current = await capture();
          if (JSON.stringify(current) !== JSON.stringify(binding)) fail('ADMISSION_INVALIDATED');
        } catch (error) {
          invalid = true; ready = false;
          try { save({ status: 'invalidated', readiness: 'invalidated', failure: { code: error.code ?? 'ADMISSION_INVALIDATED', message: instruction } }); }
          catch (reportError) { if (!isDrain(error)) throw reportError; }
          throw error;
        }
      }
      async function verifyDraftPolicy() {
        try {
          active();
          const current = await capture(true);
          if (JSON.stringify({ ...current, sourceDigest: binding.sourceDigest }) !== JSON.stringify(binding)) fail('ADMISSION_INVALIDATED');
        } catch (error) { invalid = true; throw error; }
      }
      async function drain() {
        const results = await Promise.allSettled([model?.close(), tools?.close()]);
        const failed = results.find(r => r.status === 'rejected' && isDrain(r.reason))
          ?? results.find(r => r.status === 'rejected');
        if (failed) throw new FactoryError(isDrain(failed.reason) ? failed.reason.code : 'DRAIN_FAILED', 'Admission cleanup is unconfirmed. Ownership remains fenced.');
      }
      const finished = (async () => {
        try {
          save({ stage: 'prerequisites' }); // Intent precedes every gate effect.
          binding = await capture();
          if (run.qualification) {
            // Composed runs only: an admitted helper the qualifier cannot parse refuses
            // before containment, ModelRuntime construction, or the smoke request.
            // Loaded here so legacy admission never depends on qualification modules.
            save({ binding, stage: 'helper-eligibility' });
            const { verifyAdmittedHelper } = await import('./qualification-scope.mjs');
            await verifyAdmittedHelper({ intent: run.workspace.intent, writePaths: run.executor?.scope?.writePaths });
            active();
          }
          save({ binding, stage: 'containment' });
          tools = await createRunTools({ ...input, signal: combined, dependencyBundle });
          if (tools.verification.sourceDigest !== binding.sourceDigest) fail('ADMISSION_INVALIDATED');
          save({ containment: tools.verification });
          await verify();
          if (budget.modelAttempts().length >= run.limits.modelAttempts) fail('MODEL_ATTEMPT_LIMIT');
          if (budget.modelAttempts().some(attempt => attempt.smoke)) fail('SMOKE_LIMIT');
          save({ stage: 'model-preflight' });
          try { modelRuntime = await createRuntime({ modelsPath: null, modelsStore: new InMemoryModelsStore(),
            refreshOnCreate: false, allowModelNetwork: false, signal: combined }); }
          catch { active(); fail('MODEL_INITIALIZATION_FAILED'); }
          await verify(); // Lazy initialization may have taken time or raced source/profile changes.
          model = await createModelExecution({ modelRuntime, fetch, clock }).start({ ...input, signal: combined });
          save({ smokeSubmissionId: model.submissionId });
          const smoke = await model.finished;
          await model.close();
          const attempt = budget.modelAttempts().find(r => r.smoke && r.state === 'settled' && r.accounting?.preflight);
          if (smoke.status !== 'done' || !attempt) fail(budget.modelAttempts().at(-1)?.accounting?.reason ?? 'MODEL_PREFLIGHT_FAILED');
          await verify();
          save({ smoke: { reservationId: attempt.id, submissionId: model.submissionId, bindingDigest: hash(JSON.stringify(binding)) } });
          for (const name of ['vitest', 'lint']) {
            await verify();
            save({ stage: name });
            const result = await tools.check(name);
            save({ baselines: [...state.baselines, { ...result, bindingDigest: hash(JSON.stringify(binding)) }] }); // Retain failed checks as well.
            await verify();
            if (result.sourceDigest !== binding.sourceDigest || result.dependencyIntentId !== binding.executionProfile.dependencyIntentId) fail('ADMISSION_INVALIDATED');
            if (!result.passed) fail(name === 'vitest' ? 'BASELINE_VITEST_FAILED' : 'BASELINE_LINT_FAILED');
          }
          save({ stage: 'draining' });
          await drain();
          await verify();
          ready = true;
          save({ stage: 'complete', status: 'verified', readiness: 'baseline-healthy', reviewReady: false });
          return { status: 'admission-only', runId: run.id, requestId: input.requestId };
        } catch (error) {
          ready = false;
          const code = error instanceof FactoryError || error instanceof DependencyError || error instanceof ContainmentError ? error.code : 'ADMISSION_FAILED';
          try { save({ status: invalid ? 'invalidated' : 'blocked', readiness: invalid ? 'invalidated' : 'not-ready', failure: { code, message: instruction } }); }
          catch (reportError) { if (!isDrain(error)) throw reportError; }
          if (isDrain(error)) throw error;
          return { status: 'admission-blocked', runId: run.id, requestId: input.requestId, reason: code };
        } finally { await drain(); }
      })();
      finished.catch(() => {});
      return Object.freeze({ finished,
        async handoff() {
          await finished;
          if (!ready || activated) fail('ADMISSION_AUTHORITY_REQUIRED');
          await verify();
          const token = Object.freeze({});
          handoffs.set(token, { runId: run.id, kind, binding, verify,
            activate() {
              if (activated) fail('ADMISSION_AUTHORITY_REQUIRED');
              activated = true;
              return { runId: run.id, kind, binding, modelRuntime, dependencyBundle, verify: verifyDraftPolicy };
            } });
          return token;
        },
        async cancel() { shutdown.abort(); await Promise.allSettled([model?.cancel()]); },
        close() {
          return closing ??= (async () => {
            closed = true; ready = false; shutdown.abort();
            let failure;
            try { await finished; } catch (error) { failure = error; }
            try { await drain(); } catch (error) { failure = error; }
            if (failure) throw failure;
          })();
        },
      });
    },
    async resume() { fail('UNSAFE_RESUME'); },
    async assessRecovery() {
      return { kind: 'admission-only', quiescent: false, resumable: false,
        evidence: 'An SDK smoke receipt is not completion of admission. No production effect reconciliation or automatic replay is installed.' };
    },
  });
}
