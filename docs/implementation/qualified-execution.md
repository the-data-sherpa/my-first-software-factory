# Composed executor and draft qualification

## Status and scope

This is integration stream C for ticket #9.
It adds `createQualifiedRepositoryExecution` in `src/qualified-execution.mjs`.
The adapter composes the real repository executor with the real draft qualifier under one live owner.
It does not accept ticket #9, establish real toolchain or provider readiness, or complete Phase 1.

The parent owns the `src/execution.mjs` re-export, the CLI `serve --execute-agent` wiring, and final acceptance.
Stream D owns application persistence and the work item.
This stream does not edit the factory, CLI, executor, admission, containment, or qualifier files.

## Adapter

```js
const execution = createQualifiedRepositoryExecution(options);
// { mode: 'repository-executor', model, admissionKind, qualifiesDrafts: true, start, resume, assessRecovery }
```

`options` accepts only the executor's own keys: `fixture`, `createRuntime`, `fetch`, and `clock`.
Any other key, such as `verifyDraft` or `qualifier`, fails with `QUALIFICATION_CONFIGURATION`.
The executor keeps its existing rule: injected runtime or transport requires explicit fixture identity.
Construction, `resume`, and `assessRecovery` load no model and perform no work.
`resume` always fails with `UNSAFE_RESUME`. An interrupted composed run never resumes automatically.
`createRepositoryExecution` is unchanged and remains valid for non-composed use.

## Start input

`start` accepts every existing executor input plus `saveQualification(state)`.
The application must also supply the initial projection:

```js
run.qualification = { version: 1, runId, kind: run.admission.kind, status: 'pending', reviewReady: false };
```

A missing callback or a mismatched projection fails with `QUALIFICATION_CONFIGURATION` before executor dispatch.
`saveQualification` must persist a detached snapshot synchronously. A returned promise fails the qualification.

## Composition

1. The adapter wraps `saveAdmission` and `saveExecutor`. Each call forwards to the application first, then updates a private local run snapshot.
   The application's initial `run` is stale after dispatch. The qualifier receives the latest admission and executor projections.
   The adapter never reads saved JSON as authority.
2. Only an executor receipt with `status: 'draft-produced'` continues.
   `no-change`, `failed`, `stopped`, `interrupted`, and `budget-limited` receipts pass through unchanged. No qualifier starts.
3. The adapter rechecks the original budget, then obtains the opaque token from `handoff()`.
4. It constructs the real qualifier with `verifyDraft: expected => verifyExecutorHandoff(token, expected)`.
   The token stays in that closure. It is never a JSON field, model tool, or CLI input.
5. The qualifier starts with the same budget, the explicit dependency run, the original signal joined with the adapter's shutdown signal, and the current snapshot.
   No budget is reset and no deadline or watchdog is extended.

## Receipts

Executor-only outcomes keep the executor receipt: `{ status, reason?, runId, requestId, reviewReady: false }`.
Qualification outcomes use:

```js
{ status, reason?, kind, runId, requestId, reviewReady, artifacts }
```

`status` and `reason` come from the qualifier verdict: `qualified`, `no-change`, `blocked`, `failed`, `stopped`, or `interrupted`.
Run, request, and kind identity come from the admitted run, not from the verdict. A verdict with a different run or kind becomes `failed / QUALIFICATION_IDENTITY`.
`reviewReady` is true only for a `qualified` verdict that reports readiness for an `owner` run.
Controlled-fixture receipts always have `reviewReady: false`, including qualified ones.

Other adapter outcomes:

- Stop before qualifier start: `stopped / RUN_STOPPING`.
- Original budget expired before qualifier start: `budget-limited` with the budget code.
- Handoff or qualifier startup refusal: `blocked` with its code, or `stopped` when stopping.
- Handled qualifier reporting failure after drainage: `failed / QUALIFICATION_PERSIST_FAILED`.

The application must accept a `qualified` receipt only for an opted-in run with a matching persisted qualification. That check belongs to stream D.

## Lifetime

The executor owner stays live until the qualifier has drained. The qualifier's final freshness check calls `verifyDraft`, which requires the live owner.

- `cancel()` sets the stop flag, aborts the shutdown signal, cancels the executor, and cancels any started qualifier.
  The stop flag and the qualifier start are separated by no `await`. A concurrent cancel therefore sees either the flag or the started qualifier.
- `close()` is memoized. If work has not settled, it aborts and cancels the executor.
  It then waits for the outcome, closes the qualifier, and closes the executor, in that order.
- `DRAIN_FAILED` and `MODEL_DRAIN_FAILED` are sticky. They take precedence over reporting and persistence errors.
  `finished`, every later `cancel()`, and every `close()` reject with the latched drain failure.
- A non-drain rejection from the qualifier's `cancel` or `close` repeats its already handled outcome. It is not reported as a drain failure.
- Any `close` failure of the executor is reported. The application then retains ownership.

## Verification

Tests use the existing exact-owned harness, disposable `/tmp/factory-dependencies-*` repositories, installed Bun, controlled synthetic Vitest and ESLint packages, dummy in-memory credentials, and a controlled Responses transport.
The transport only proposes tool calls. The real executor tools write `convex/syncHelpers.ts` and the new `lib/__tests__/normalize-address.test.ts`.
A narrow application bridge in the worker supplies the pending projection and synchronous save while stream D is pending. It injects stop requests and one reporting fault. It does not replace the executor, qualifier, budget, or containment.

`tests/phase-1/qualified-execution.test.mjs` covers:

- Passive construction, `UNSAFE_RESUME`, recovery assessment, rejected authority options, and opt-in validation without dispatch.
- `qualified`: ten ordered checks, the descriptor bound to the executor draft and admission binding, the executor-written new test in the complete patch, 18 of 30 original rounds, passive inspection without the verifier, and stale-source invalidation.
- `tautology`: the executor-written tautological candidate test is blocked as `REGRESSION_UNVERIFIED`.
- `no-change` and `refusal`: the executor receipt passes through and no qualifier starts.
- `tool-limit`: 23 real executor reads exhaust the original allowance. Qualification blocks with `TOOL_ROUND_LIMIT` and no reset.
- `stop-before-qualification`: an application stop at executor completion yields a stopped executor and no qualifier. The partial draft survives.
- `stop-qualification`: an application stop after draft capture yields `stopped / RUN_STOPPING` with retained capture evidence.
- `drain-report`: an injected namespace drain refusal plus a qualifier reporting failure. The adapter keeps `DRAIN_FAILED` on `finished`, repeated `close`, and `cancel`. The application stays interrupted and fenced.

The verification record for this stream is in the stream report, under `/tmp/factory-ticket09-streamC/`.

## Integration dependencies

- `qualified`, `tautology`, and `drain-report` require stream B's acceptance of the fixed `../docs/agents/change-quality.md` implementation key.
  Until then, the qualifier's prerequisites return `blocked / QUALIFICATION_INVALIDATED` for every actual executor draft.
- A stop that arrives during draft capture is classified by the qualifier as `blocked / WORKSPACE_CANCELLED`, not `stopped`.
  The application still records `stopped` from its own stop reason. The qualifier classification belongs to stream B.
- The current application maps any repository-executor receipt other than `draft-produced` or `no-change` to a failure. Stream D must add the qualified mapping.
- The parent must re-export the adapter and wire it to `serve --execute-agent`.
