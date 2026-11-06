import { FactoryError } from './storage.mjs';
import { createRepositoryExecution, verifyExecutorHandoff } from './executor.mjs';
import { createDraftQualification } from './qualification.mjs';

const isDrain = error => ['DRAIN_FAILED', 'MODEL_DRAIN_FAILED'].includes(error?.code);
const failure = code => new FactoryError(code, 'Inspect the retained executor and qualification evidence. No readiness or safe replay is established.');
// Exactly the executor's controlled-fixture options. A verifier, qualifier, or other
// authority cannot enter through configuration; composition binds the real ones below.
const executorOptions = new Set(['fixture', 'createRuntime', 'fetch', 'clock']);

/** Composes the real repository executor with the real draft qualifier under one live owner.
 * The executor's opaque handoff stays in this closure. Saved JSON never supplies authority.
 * Construction, resume, and recovery assessment remain passive.
 */
export function createQualifiedRepositoryExecution(options = {}) {
  if (!options || typeof options !== 'object' || Object.keys(options).some(key => !executorOptions.has(key))) {
    throw failure('QUALIFICATION_CONFIGURATION');
  }
  const executor = createRepositoryExecution(options);
  const kind = executor.admissionKind;
  return Object.freeze({ mode: executor.mode, model: executor.model, admissionKind: kind, qualifiesDrafts: true,
    async start(original) {
      const { saveQualification, ...input } = original;
      const pending = original.run?.qualification;
      if (typeof saveQualification !== 'function' || pending?.version !== 1 || pending.runId !== original.runId
        || pending.kind !== kind || pending.status !== 'pending' || pending.reviewReady !== false) throw failure('QUALIFICATION_CONFIGURATION');
      const { runId, requestId, budget, directory } = input;
      // The qualifier needs the latest admission and executor projections.
      // The application's initial run object is stale after executor dispatch.
      const current = structuredClone(original.run);
      const shutdown = new AbortController();
      let stopping = false; let fault; let qualifying; let closing; let settled = false;
      // Unconfirmed drainage is sticky and outranks every handled or reporting error.
      const latch = error => { if (isDrain(error)) fault ??= error; };
      // Cleanup methods confirm drainage only; an unfamiliar rejection is not proof
      // that cleanup succeeded. Reporting failures belong to `finished` instead.
      const cleanupFailure = error => latch(isDrain(error) ? error : failure('DRAIN_FAILED'));
      const halted = () => stopping || input.signal?.aborted;
      const owner = await executor.start({ ...input,
        saveAdmission(state) { const result = input.saveAdmission(state); current.admission = structuredClone(state); return result; },
        saveExecutor(state) { const result = input.saveExecutor(state); current.executor = { ...structuredClone(state), reviewReady: false }; return result; },
      });
      const outcome = (status, reason, artifacts) => ({ status, ...(reason ? { reason } : {}), kind, runId, requestId,
        reviewReady: false, ...(artifacts ? { artifacts } : {}) });
      const finished = (async () => {
        try {
          const receipt = await owner.finished;
          // Only a completed draft is qualified. Other executor outcomes stay unchanged.
          if (receipt.status !== 'draft-produced') return receipt;
          try { budget.assertActive(); } catch (error) {
            return outcome(error.code === 'RUN_DEADLINE' || /LIMIT/.test(error.code ?? '') ? 'budget-limited' : 'stopped', error.code ?? 'RUN_STOPPING');
          }
          let token;
          try { token = await owner.handoff(); } catch (error) {
            if (isDrain(error)) throw error;
            return halted() ? outcome('stopped', 'RUN_STOPPING') : outcome('blocked', error.code ?? 'EXECUTOR_AUTHORITY_REQUIRED');
          }
          if (halted()) return outcome('stopped', 'RUN_STOPPING');
          const qualifier = createDraftQualification({ verifyDraft: expected => verifyExecutorHandoff(token, expected) });
          // No await separates the stop check from this assignment, so cancel sees either the flag or the start.
          qualifying = qualifier.start({ directory, run: structuredClone(current), dependencyRun: structuredClone(input.dependencyRun),
            budget, signal: AbortSignal.any([input.signal, shutdown.signal]),
            saveQualification(state) {
              const result = saveQualification(state);
              if (result?.then) throw failure('QUALIFICATION_PERSISTENCE');
              current.qualification = structuredClone(state);
            } });
          qualifying.catch(() => {});
          let qualification;
          try { qualification = await qualifying; } catch (error) {
            if (isDrain(error)) throw error;
            return halted() ? outcome('stopped', 'RUN_STOPPING') : outcome('blocked', error.code ?? 'QUALIFICATION_FAILED');
          }
          let verdict;
          try { verdict = await qualification.finished; } catch (error) {
            // The qualifier drained before reporting this. A drain failure is rethrown below.
            if (isDrain(error)) throw error;
            return outcome('failed', 'QUALIFICATION_PERSIST_FAILED', current.qualification?.artifacts);
          }
          if (verdict.runId !== runId || verdict.kind !== kind) return outcome('failed', 'QUALIFICATION_IDENTITY');
          return { ...outcome(verdict.status, verdict.reason, verdict.artifacts),
            reviewReady: verdict.status === 'qualified' && verdict.reviewReady === true && kind === 'owner' };
        } catch (error) { latch(error); throw fault ?? error; } finally { settled = true; }
      })();
      finished.catch(() => {});
      const startedQualification = () => qualifying?.catch(() => undefined);
      return Object.freeze({ finished,
        async cancel() {
          stopping = true; shutdown.abort();
          const results = await Promise.allSettled([owner.cancel(), (async () => { await (await startedQualification())?.cancel(); })()]);
          for (const result of results) if (result.status === 'rejected') cleanupFailure(result.reason);
          if (fault) throw fault;
        },
        // Qualification closes first: its final freshness check needs the live executor owner.
        close() {
          return closing ??= (async () => {
            stopping = true;
            let error;
            if (!settled) {
              shutdown.abort();
              try { await owner.cancel(); } catch (e) { cleanupFailure(e); }
            }
            try { await finished; } catch (e) { latch(e); error ??= e; }
            try { await (await startedQualification())?.close(); } catch (e) { cleanupFailure(e); }
            try { await owner.close(); } catch (e) { cleanupFailure(e); }
            if (fault) throw fault;
            if (error) throw error;
          })();
        },
      });
    },
    async resume() { throw failure('UNSAFE_RESUME'); },
    assessRecovery: () => executor.assessRecovery(),
  });
}
