import { mkdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createContainedExecution, inspectContainedChecks } from './containment.mjs';
import { sourceFingerprint } from './containment-files.mjs';
import { verifyDependencyBundle, inspectDependencies } from './dependencies.mjs';
import { qualificationSource } from './qualification-source.mjs';
import { verifyHelperScope } from './qualification-scope.mjs';
import { SELECTION, selectedTest, regressionEvidence, candidateEvidence, finalVitestEvidence } from './qualification-selection.mjs';
import { reportFiles, filesDigest, parseReport, probeEvidence } from './qualification-reporting.mjs';
import { hash, fail, same, save, json, readArtifact, validateWorkspace, captureDraft, verifyCaptured } from './qualification-artifacts.mjs';

const isDrain = error => ['DRAIN_FAILED', 'MODEL_DRAIN_FAILED'].includes(error?.code);
const implementationFiles = ['qualification.mjs', 'qualification-artifacts.mjs', 'qualification-source.mjs', 'qualification-selection.mjs', 'qualification-scope.mjs', 'qualification-reporting.mjs', 'qualification-reporter.mjs',
  'containment.mjs', 'containment-files.mjs', 'containment-namespace.mjs', 'containment-filter.mjs', 'containment-probe.mjs'];
async function implementation() {
  return Object.fromEntries(await Promise.all(implementationFiles.map(async name => [name, hash(await readFile(new URL(name, import.meta.url)))])));
}
// The accepted executor profile binds factory modules plus exactly one
// factory-owned policy document. Any other parent-relative key is refused.
const QUALITY_POLICY = '../docs/agents/change-quality.md';
async function profileImplementation(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files) || !Object.hasOwn(files, QUALITY_POLICY)) fail('QUALIFICATION_INVALIDATED');
  for (const [name, expected] of Object.entries(files)) {
    if ((name !== QUALITY_POLICY && !/^[a-z-]+\.mjs$/.test(name)) || typeof expected !== 'string') fail('QUALIFICATION_INVALIDATED');
    const bytes = await readFile(new URL(name === QUALITY_POLICY ? QUALITY_POLICY : `./${name}`, import.meta.url))
      .catch(() => fail('QUALIFICATION_INVALIDATED'));
    if (hash(bytes) !== expected) fail('QUALIFICATION_INVALIDATED');
  }
}
function artifactPath(directory, receipt) {
  const path = relative(directory, receipt ?? '');
  if (!/^(?:checks|qualification\/(?:base-checks|candidate-base-checks|draft-checks))\/check-[a-f0-9-]{36}\/result\.json$/.test(path)) fail('QUALIFICATION_ARTIFACT_INVALID');
  return path;
}
async function checkArtifact(directory, result) {
  const path = artifactPath(directory, result.receipt);
  const stored = await json(directory, path);
  const { output, ...withoutOutput } = result;
  if (!same(stored, withoutOutput)) fail('QUALIFICATION_ARTIFACT_INVALID');
  const checkDirectory = path.slice(0, -'/result.json'.length);
  const started = await json(directory, `${checkDirectory}/started.json`);
  for (const [key, value] of Object.entries(started)) if (!same(value, stored[key])) fail('QUALIFICATION_ARTIFACT_INVALID');
  if (!same(await json(directory, `${checkDirectory}/launch.json`), stored.launch)
    || await sourceFingerprint(join(directory, checkDirectory, 'source')) !== stored.sourceDigest
    || (await readArtifact(directory, `${checkDirectory}/output.log`)).toString('utf8') !== output) fail('QUALIFICATION_ARTIFACT_INVALID');
  const adapters = reportFiles(stored.name, selectedTest);
  if (adapters) {
    if (stored.selectionDigest !== filesDigest(adapters)
      || !same(stored.reportBinding, { id: stored.id, operation: stored.name, sourceDigest: stored.sourceDigest,
        dependencyIntentId: stored.dependencyIntentId, selectionDigest: stored.selectionDigest })
      || !same(await json(directory, `${checkDirectory}/binding.json`), stored.reportBinding)
      || (await readArtifact(directory, `${checkDirectory}/report.frame`)).toString('utf8') !== stored.report
      || Buffer.byteLength(stored.report) !== stored.reportBytes || hash(stored.report) !== stored.reportDigest
      || stored.outputBytes !== Buffer.byteLength(output) + stored.reportBytes) fail('QUALIFICATION_ARTIFACT_INVALID');
    for (const [file, expected] of Object.entries(adapters)) {
      if ((await readArtifact(directory, `${checkDirectory}/${file}`)).toString('utf8') !== expected) fail('QUALIFICATION_ARTIFACT_INVALID');
    }
  }
}
async function prerequisites(directory, run, dependencyRun, descriptor) {
  await validateWorkspace(directory, run);
  const binding = descriptor.admissionBinding;
  if (descriptor.version !== 1 || descriptor.runId !== run.id || descriptor.kind !== run.admission?.kind
    || !['controlled-fixture', 'owner'].includes(descriptor.kind) || descriptor.draft?.artifactDirectory !== 'executor'
    || !same(binding, run.admission.binding) || run.admission.status !== 'verified'
    || binding?.runId !== run.id || binding.workspaceIntentId !== run.workspace.intent.id
    || binding.baseCommit !== run.workspace.intent.baseCommit || binding.sourceManifestId !== run.workspace.intent.sourceManifest.id
    || run.admission.readiness !== 'baseline-healthy') fail('QUALIFICATION_BASELINE_REQUIRED');
  if (run.admission.dependencyRunId !== dependencyRun?.id || dependencyRun.dependencies?.status !== 'prepared'
    || !same(run.project, dependencyRun.project)) fail('DEPENDENCIES_MISSING');
  const deps = dependencyRun.dependencies;
  const bundle = await verifyDependencyBundle(deps.intent, { workspaceIntent: run.workspace.intent });
  const receipt = await inspectDependencies(deps.intent);
  if (!same(receipt, deps.receipt) || binding.executionProfile.dependencyIntentId !== deps.intent.id
    || binding.executionProfile.inventoryDigest !== receipt.inventoryDigest
    || !same(binding.executionProfile.toolchain, deps.intent.toolchain)
    || hash(JSON.stringify(binding.executionProfile)) !== binding.profileDigest
    || !same(binding.executionProfile.limits, run.limits) || binding.executionProfile.kind !== descriptor.kind) fail('QUALIFICATION_INVALIDATED');
  await profileImplementation(binding.executionProfile.implementation);
  const baselines = run.admission.baselines;
  if (!Array.isArray(baselines) || baselines.length !== 2 || baselines[0].name !== 'vitest' || baselines[1].name !== 'lint'
    || baselines[0].finishedAt > baselines[1].startedAt) fail('QUALIFICATION_BASELINE_REQUIRED');
  // This validates historical execution artifacts; JSON flags alone never suffice.
  await inspectContainedChecks(join(directory, 'checks'));
  for (const baseline of baselines) {
    const { bindingDigest, ...result } = baseline;
    if (!result.passed || result.reason !== 'passed' || result.exitCode !== 0 || result.exitSignal !== null
      || result.kind !== 'repository' || result.sourceDigest !== binding.sourceDigest
      || result.dependencyIntentId !== deps.intent.id || bindingDigest !== hash(JSON.stringify(binding))) fail('QUALIFICATION_BASELINE_REQUIRED');
    await checkArtifact(directory, result);
    await sourceFingerprint(join(directory, artifactPath(directory, result.receipt).replace('/result.json', '/source')), run.workspace.intent.sourceManifest);
  }
  await checkArtifact(directory, run.admission.containment);
  if (!run.admission.containment.passed || run.admission.containment.sourceDigest !== binding.sourceDigest) fail('QUALIFICATION_BASELINE_REQUIRED');
  return bundle;
}
function scope(capture, descriptor) {
  const allowed = [SELECTION.helper, SELECTION.test];
  if (!Array.isArray(descriptor.scope?.writePaths) || descriptor.scope.writePaths.length !== 2
    || !same([...descriptor.scope.writePaths].sort(), [...allowed].sort())) fail('QUALIFICATION_SCOPE');
  if (!capture.changes.length) return false;
  if (capture.changes.some(change => !allowed.includes(change.path) || change.operation === 'delete'
    || change.afterMode !== 0 || (change.beforeMode !== undefined && change.beforeMode !== 0))
    || !allowed.every(path => capture.changes.some(change => change.path === path))) fail('QUALIFICATION_SCOPE');
  const parents = new Set(allowed.flatMap(path => path.split('/').slice(0, -1).map((_, i) => path.split('/').slice(0, i + 1).join('/'))));
  const baseDirs = capture.base.inventory.filter(e => e.type === 'directory').map(e => e.path);
  const draftDirs = capture.draft.inventory.filter(e => e.type === 'directory').map(e => e.path);
  if (baseDirs.some(path => !draftDirs.includes(path)) || draftDirs.some(path => !baseDirs.includes(path) && !parents.has(path))) fail('QUALIFICATION_SCOPE');
  return true;
}
const verdict = (run, status, reason) => ({ status, ...(reason ? { reason } : {}), runId: run.id, kind: run.admission?.kind,
  reviewReady: status === 'qualified' && run.admission?.kind === 'owner' });
const stages = ['base-boundary', 'runner-probe', 'base-regression', 'candidate-base-boundary', 'candidate-base-regression',
  'draft-boundary', 'draft-regression', 'draft-candidate', 'vitest', 'lint'];
function runtimeEvidence(result, dependencyRun, expected) {
  const runtime = result.name === 'runner-probe' ? probeEvidence(result) : parseReport(result).runtime;
  const manifest = dependencyRun.dependencies.receipt.inventory.find(e => e.path === 'node_modules/vitest/package.json');
  if (runtime.manifestDigest !== manifest?.sha256 || (expected && !same(runtime, expected))) fail('QUALIFICATION_RUNNER_UNSUPPORTED');
  return runtime;
}

/** Trusted in-process composition seam. verifyDraft is never a JSON field or tool.
 * The parent closes the live executor only AFTER qualification closes. No model role.
 */
export function createDraftQualification({ verifyDraft } = {}) {
  if (typeof verifyDraft !== 'function') fail('QUALIFICATION_CONFIGURATION');
  return Object.freeze({
    async start(input) {
      const { directory, run, dependencyRun, budget, signal, saveQualification } = input;
      if (typeof saveQualification !== 'function') fail('QUALIFICATION_CONFIGURATION');
      await validateWorkspace(directory, run);
      const root = join(directory, 'qualification');
      // Exclusive creation prevents duplicate dispatch, even after an interrupted intent.
      try { await mkdir(root, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') fail('QUALIFICATION_EXISTS'); throw error; }
      const shutdown = new AbortController();
      const combined = AbortSignal.any([signal, budget.signal, shutdown.signal].filter(Boolean));
      let tools; let closing; let timer; let drainFailure; let settled = false;
      // Stage reservations whose operation was entered. Others are provably never dispatched.
      const reservations = new Map(); const dispatched = new Set();
      let state = { version: 1, runId: run.id, kind: run.admission?.kind, status: 'checking', reviewReady: false,
        stage: 'intent', selection: structuredClone(SELECTION), checks: [], artifacts: { directory: 'qualification', patch: null, complete: false } };
      const persist = async patch => {
        state = { ...state, ...patch };
        await save(join(root, 'state.json'), state);
        const result = saveQualification(structuredClone(state));
        // The projection callback is synchronous; a promise cannot confirm persistence.
        if (typeof result?.then === 'function') { Promise.resolve(result).catch(() => {}); fail('QUALIFICATION_PERSIST_FAILED'); }
      };
      const active = () => { budget.assertActive(); if (combined.aborted) fail('RUN_STOPPING'); };
      async function drain() {
        try { await tools?.close(); } catch (error) { drainFailure ??= isDrain(error) ? error : Object.assign(new Error('Unconfirmed qualification drainage.'), { code: 'DRAIN_FAILED' }); }
        if (drainFailure) throw drainFailure;
      }
      const finished = (async () => {
        let outcome;
        try {
          await persist({}); // Saved selection and stage intent before capture/check effects.
          active();
          timer = setTimeout(() => shutdown.abort(), budget.remainingMs);
          reservations.set('capture', budget.reserveToolRound({ roundId: 'qualification:capture' }));
          await persist({ stage: 'capture' });
          active(); dispatched.add('capture');
          const capture = await captureDraft(directory, run, combined);
          budget.settle(reservations.get('capture').id, JSON.stringify({ patchDigest: capture.patchDigest }));
          await persist({ capture, artifacts: { directory: 'qualification', patch: 'qualification/patch.json', complete: true } });
          active();
          // Composition filters non-drafts earlier; module callers still need this refusal.
          if (run.executor?.status && run.executor.status !== 'draft-produced') {
            const status = ['failed', 'stopped', 'interrupted'].includes(run.executor.status) ? run.executor.status
              : run.executor.status === 'no-change' && !capture.changes.length ? 'no-change' : 'blocked';
            outcome = verdict(run, status, 'EXECUTOR_INCOMPLETE');
          } else {
            const descriptor = await verifyDraft({ runId: run.id, kind: run.admission.kind });
            await persist({ descriptor: structuredClone(descriptor), implementation: await implementation(), stage: 'prerequisites' });
            let bundle = await prerequisites(directory, run, dependencyRun, descriptor);
            if (descriptor.draft.sourceDigest !== capture.sourceDigest || capture.baseSourceDigest !== descriptor.admissionBinding.sourceDigest) fail('QUALIFICATION_SOURCE_CHANGED');
            if (!scope(capture, descriptor)) outcome = verdict(run, 'no-change', 'NO_CHANGE');
            else {
              await verifyHelperScope(directory);
              for (const name of stages) {
                active(); reservations.set(name, budget.reserveToolRound({ roundId: `qualification:${name}` }));
              }
              const check = async (name, operation) => {
                active(); await persist({ stage: name });
                dispatched.add(name);
                const result = await operation();
                // The runner retains full receipts before qualification records any verdict.
                await persist({ checks: [...state.checks, { stage: name, ...result }] });
                budget.settle(reservations.get(name).id, JSON.stringify({ receipt: result.receipt, sourceDigest: result.sourceDigest }));
                active(); await verifyCaptured(directory, run, capture);
                await checkArtifact(directory, result);
                return result;
              };
              let candidateBase; let candidateDraft; let runtime;
              for (const variant of ['base', 'candidate-base', 'draft']) {
                active();
                bundle = await prerequisites(directory, run, dependencyRun, descriptor);
                const verificationSource = await qualificationSource({ directory, run, capture, variant });
                const receiptDirectory = join(root, `${variant}-checks`);
                await mkdir(receiptDirectory, { mode: 0o700 });
                await check(`${variant}-boundary`, async () => {
                  tools = await createContainedExecution({ worktree: run.workspace.intent.worktree, receiptDirectory,
                    dependencyBundle: bundle, verificationSource, signal: combined });
                  return tools.verification;
                });
                if (variant === 'base') {
                  runtime = runtimeEvidence(await check('runner-probe', () => tools.check('runner-probe')), dependencyRun);
                  await persist({ runtime });
                }
                const regression = await check(`${variant}-regression`, () => tools.check(variant === 'candidate-base' ? 'candidate-regression' : 'selected-regression'));
                runtimeEvidence(regression, dependencyRun, runtime);
                if (variant === 'candidate-base') { candidateBase = regression; candidateEvidence(candidateBase); }
                else regressionEvidence(regression, variant);
                if (variant === 'draft') {
                  candidateDraft = await check('draft-candidate', () => tools.check('candidate-regression'));
                  runtimeEvidence(candidateDraft, dependencyRun, runtime);
                  candidateEvidence(candidateBase, candidateDraft);
                  for (const name of ['vitest', 'lint']) {
                    const result = await check(name, () => tools.check(name === 'vitest' ? 'qualification-vitest' : name));
                    if (!result.passed || result.exitCode !== 0 || result.exitSignal !== null || result.reason !== 'passed') fail(`FINAL_${name.toUpperCase()}_FAILED`);
                    if (name === 'vitest') { finalVitestEvidence(result, candidateDraft); runtimeEvidence(result, dependencyRun, runtime); }
                  }
                }
                await drain(); tools = undefined;
              }
              await prerequisites(directory, run, dependencyRun, descriptor);
              await verifyCaptured(directory, run, capture);
              if (!same(await verifyDraft({ runId: run.id, kind: run.admission.kind }), descriptor)
                || !same(await implementation(), state.implementation)) fail('QUALIFICATION_INVALIDATED');
              active(); outcome = verdict(run, 'qualified');
            }
          }
        } catch (error) {
          if (isDrain(error)) drainFailure = error;
          let reason = error.code ?? 'QUALIFICATION_FAILED';
          // An effect cancelled by an actual stop/deadline reports that cause, not
          // its own cancellation code (for example WORKSPACE_CANCELLED in capture).
          if (!isDrain(error) && combined.aborted && !['RUN_STOPPING', 'RUN_DEADLINE'].includes(reason)) {
            try { budget.assertActive(); reason = 'RUN_STOPPING'; } catch (cause) { reason = cause.code === 'RUN_DEADLINE' ? 'RUN_DEADLINE' : 'RUN_STOPPING'; }
          }
          outcome = verdict(run, isDrain(error) ? 'interrupted' : reason === 'RUN_STOPPING' ? 'stopped'
            : reason === 'RUN_DEADLINE' ? 'failed' : 'blocked', reason);
        } finally {
          try { await drain(); } catch (error) { drainFailure = error; outcome = verdict(run, 'interrupted', error.code); }
          // Only after confirmed drainage: close reservations that no operation ever
          // entered. They stay counted (no refund). Entered-but-unsettled rounds remain
          // uncertain, as does everything after a drain failure.
          if (!drainFailure) {
            for (const [name, reservation] of reservations) {
              if (dispatched.has(name)) continue;
              try {
                budget.settle(reservation.id, JSON.stringify({ stage: name, dispatched: false, reason: outcome.reason ?? outcome.status }));
              } catch { /* An unsettled reservation remains conservatively uncertain. */ }
            }
          }
        }
        const finalFreshness = async () => {
          try {
            active(); await verifyCaptured(directory, run, state.capture);
            await prerequisites(directory, run, dependencyRun, state.descriptor);
            if (!same(await verifyDraft({ runId: run.id, kind: run.admission.kind }), state.descriptor)
              || !same(await implementation(), state.implementation)) fail('QUALIFICATION_INVALIDATED');
            active();
          } catch (error) { outcome = verdict(run, error.code === 'RUN_STOPPING' ? 'stopped'
            : error.code === 'RUN_DEADLINE' ? 'failed' : 'blocked', error.code ?? 'QUALIFICATION_FAILED'); }
        };
        try {
          if (outcome.status === 'qualified') await finalFreshness();
          await persist({ stage: 'complete', status: outcome.status, verdict: outcome, reviewReady: outcome.reviewReady });
          if (outcome.status === 'qualified') {
            await finalFreshness();
            if (outcome.status !== 'qualified') await persist({ status: outcome.status, verdict: outcome, reviewReady: false });
          }
        } catch (error) {
          // Never leave a successfully inspectable verdict after publication of the
          // private projection failed. A failed drain still has precedence.
          outcome = verdict(run, drainFailure ? 'interrupted' : 'failed', drainFailure?.code ?? 'QUALIFICATION_PERSIST_FAILED');
          try { await persist({ stage: 'complete', status: outcome.status, verdict: outcome, reviewReady: false }); } catch { /* Retain the original reporting error. */ }
          throw error;
        } finally { clearTimeout(timer); settled = true; if (drainFailure) throw drainFailure; }
        return { ...outcome, artifacts: structuredClone(state.artifacts) };
      })();
      finished.catch(() => {});
      // cancel/close confirm drainage only. A non-drain reporting error stays on
      // `finished`; drain failures are sticky and reject here too.
      const drained = async () => { await finished.catch(error => { if (isDrain(error)) throw error; }); await drain(); };
      return Object.freeze({ finished,
        async cancel() { shutdown.abort(); await drained(); },
        close() { return closing ??= (async () => { if (!settled) shutdown.abort(); await drained(); })(); },
      });
    },
    async inspect({ directory, run, dependencyRun }) {
      // Read-only projection. Never call verifyDraft, mint a source capability, or run Git.
      let state;
      try {
        await validateWorkspace(directory, run);
        state = await json(directory, 'qualification/state.json', 16 * 1024 * 1024);
        if (state.version !== 1 || state.runId !== run.id || state.kind !== run.admission?.kind
          || !same(state, run.qualification) || !Array.isArray(state.checks)) fail('QUALIFICATION_ARTIFACT_INVALID');
        // A qualified verdict stands only on its full retained evidence.
        if (state.verdict?.status === 'qualified' && (!state.descriptor || !state.capture || !state.runtime || !state.implementation
          || state.stage !== 'complete' || state.status !== 'qualified' || !same(state.checks.map(c => c.stage), stages))) fail('QUALIFICATION_INVALIDATED');
        if (state.capture) await verifyCaptured(directory, run, state.capture);
        if (state.descriptor) {
          await prerequisites(directory, run, dependencyRun, state.descriptor);
          if (!same(state.selection, SELECTION) || !same(state.implementation, await implementation())) fail('QUALIFICATION_INVALIDATED');
          for (const { stage, ...check } of state.checks) {
            await checkArtifact(directory, check);
            if (check.sourceDigest !== (stage.startsWith('base-') || stage === 'runner-probe' ? state.capture.baseSourceDigest
              : stage.startsWith('candidate-base-') ? state.capture.candidateBase?.sourceDigest : state.capture.sourceDigest)
              || check.dependencyIntentId !== state.descriptor.admissionBinding.executionProfile.dependencyIntentId) fail('QUALIFICATION_INVALIDATED');
          }
          if (state.verdict?.status === 'qualified') {
            if (state.verdict.reviewReady !== (state.kind === 'owner') || !scope(state.capture, state.descriptor)
              || !same(state.checks.map(c => c.stage), stages)) fail('QUALIFICATION_INVALIDATED');
            await verifyHelperScope(directory);
            const checks = Object.fromEntries(state.checks.map(c => [c.stage, c]));
            for (const check of state.checks.filter(c => reportFiles(c.name, selectedTest))) runtimeEvidence(check, dependencyRun, state.runtime);
            regressionEvidence(checks['base-regression'], 'base'); regressionEvidence(checks['draft-regression'], 'draft');
            candidateEvidence(checks['candidate-base-regression'], checks['draft-candidate']); finalVitestEvidence(checks.vitest, checks['draft-candidate']);
            for (const stage of ['base-boundary', 'candidate-base-boundary', 'draft-boundary', 'vitest', 'lint']) {
              if (!checks[stage].passed || checks[stage].reason !== 'passed') fail('QUALIFICATION_INVALIDATED');
            }
          }
        }
        // A missing final record remains interrupted; inspection never finishes a run.
        return { ...verdict(run, state.verdict?.status ?? 'interrupted', state.verdict?.reason),
          artifactStatus: 'verified', artifacts: state.artifacts, stages: state.checks.map(c => ({ stage: c.stage, passed: c.passed, receipt: artifactPath(directory, c.receipt) })) };
      } catch (error) {
        return { ...verdict(run, 'blocked', 'QUALIFICATION_INVALIDATED'), recordedStatus: state?.verdict?.status ?? 'interrupted',
          artifactStatus: 'invalid', artifacts: state?.artifacts ?? { directory: 'qualification', complete: false } };
      }
    },
  });
}
