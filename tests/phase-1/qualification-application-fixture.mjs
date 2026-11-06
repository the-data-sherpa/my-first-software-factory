// Controlled REFUSAL fixture for the application seam only. It never runs the
// executor, qualifier, or checks, so nothing it reports can be qualified evidence.
// Actual composition acceptance belongs to the parent's combined process tests.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FactoryError } from '../../src/factory.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';

export const workspace = { admit: admitWorkspace, prepare: prepareWorkspace };
export const brief = 'Goal: Normalize address whitespace.\nAcceptance criteria: Keep units.\nEvidence: Controlled refusal fixture.';
export const dependencyRunId = 'run_00000000-0000-0000-0000-000000000001';
export const scope = { writePaths: ['convex/syncHelpers.ts', 'lib/__tests__/normalize-address.test.ts'] };
export const STAGES = ['base-boundary', 'runner-probe', 'base-regression', 'candidate-base-boundary', 'candidate-base-regression',
  'draft-boundary', 'draft-regression', 'draft-candidate', 'vitest', 'lint'];

export const binding = runId => ({ runId, fixture: 'controlled-refusal-binding' });
export const descriptor = (runId, overrides = {}) => ({ version: 1, runId, kind: 'controlled-fixture', admissionBinding: binding(runId),
  scope: { writePaths: [...scope.writePaths] }, draft: { sourceDigest: 'f'.repeat(64), artifactDirectory: 'executor' }, ...overrides });

/** A complete-looking but fabricated qualified projection. */
export function fabricatedQualified(runId, { withDescriptor = true } = {}) {
  const verdict = { status: 'qualified', runId, kind: 'controlled-fixture', reviewReady: false };
  return { version: 1, runId, kind: 'controlled-fixture', status: 'qualified', reviewReady: false, stage: 'complete',
    selection: { fabricated: true },
    checks: withDescriptor ? STAGES.map(stage => ({ stage, name: stage, passed: true, reason: 'passed', exitCode: 0,
      receipt: `/nonexistent/${stage}/result.json`, sourceDigest: 'f'.repeat(64), outputBytes: 65536, output: 'x'.repeat(65536) })) : [],
    artifacts: { directory: 'qualification', patch: 'qualification/patch.json', complete: true },
    ...(withDescriptor ? { descriptor: descriptor(runId), capture: { patchDigest: 'e'.repeat(64), sourceDigest: 'f'.repeat(64),
      baseSourceDigest: 'd'.repeat(64), base: { inventory: [] }, draft: { inventory: [] },
      changes: [{ path: scope.writePaths[1], operation: 'add', afterMode: 0 }] } } : {}),
    verdict };
}

export async function writeState(directory, state) {
  await mkdir(join(directory, 'qualification'), { mode: 0o700 });
  await writeFile(join(directory, 'qualification', 'state.json'), JSON.stringify(state), { mode: 0o600 });
}

/**
 * Opted-in adapter whose behavior is supplied by `run(input, context)`.
 * `run` returns the final receipt; `close` may inject a drain fault or a crash.
 */
export function composed({ run, close, cancel } = {}) {
  const inputs = [];
  const adapter = {
    mode: 'repository-executor', model: 'factory-fixture/composed-refusal-v1', admissionKind: 'controlled-fixture', qualifiesDrafts: true,
    inputs,
    async start(input) {
      inputs.push(input);
      input.saveAdmission({ ...input.run.admission, status: 'verified', readiness: 'baseline-healthy', binding: binding(input.runId) });
      input.saveExecutor({ version: 1, kind: 'controlled-fixture', status: 'draft-produced', scope: input.run.executor.scope,
        draft: { sourceDigest: 'f'.repeat(64), artifactDirectory: 'executor' } });
      const stopped = Promise.withResolvers();
      const finished = Promise.resolve().then(() => run(input, { stopped: stopped.promise }));
      finished.catch(() => {});
      return { finished,
        async cancel() { stopped.resolve(); await cancel?.(); },
        async close() { stopped.resolve(); await finished.catch(() => {}); await close?.(input); } };
    },
    async resume() { throw new FactoryError('UNSAFE_RESUME', 'Controlled fixture never resumes.'); },
    async assessRecovery() { return { kind: 'repository-executor', quiescent: false, resumable: false }; },
  };
  return adapter;
}

export const receiptFor = (input, verdict) => ({ ...verdict, requestId: input.requestId,
  artifacts: { directory: 'qualification', complete: true } });
