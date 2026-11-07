# Ticket #2 implementation record

This slice implements factory recovery controls from baseline `9ed9439`.
It does not implement tickets #3 or #4, production inference, or a verified production sandbox.
The evidence uses disposable process fixtures and the accepted application, CLI, and execution-adapter interfaces.

## Operator controls

The foreground backend exposes these commands:

```text
factory stop RUN_ID
factory resume RUN_ID --review TEXT
factory replace RUN_ID --request-id NEW_ID --review TEXT
```

Each command also accepts `--state-dir`.
The application methods are `stopRun(id)`, `resumeRun(id, { review })`, and `replaceRun(id, { requestId, review })`.
A review describes partial effects. It is neither containment evidence nor a proposal-specific Approval.

Stop persists its intent before cancellation and waits for drainage before recording a terminal stopped outcome.
Graceful backend shutdown uses the same lifecycle.
A failed cancellation does not skip drainage.
A failed drain keeps admission and backend ownership fenced.
A crash during stop does not permit resume.

Restart and offline inspection use native read-only execution connections.
The SDK opener still never receives responsibility for enforcing read-only access.
Inspection does not submit inputs, enable scheduling, migrate stores, or reset counters.
A completed SDK answer cannot release an uncertain tool effect or unverified execution cleanup.

Resume requires an interrupted run, an operator review, trusted safety evidence, and remaining original limits.
It reopens the original durable submission without submitting another input.
Terminal stopped runs cannot resume.
A missing submission requires an explicit replacement, even when a reservation already consumed an allowance.

Replacement retains the original project and brief, but creates new run and admission-request identities.
The factory commits both links and the new admission in one application-store transaction.
The original counters, deadline, partial effects, and execution receipt remain available.
Replacement cannot overlap surviving work. A trusted adapter must establish quiescence first.
Unreconciled effects remain uncertain on the replaced run and never replay through its scheduler.

## Execution integration contract

The trusted execution object supplies `mode`, `model`, `start`, `resume`, and `assessRecovery`.
Only explicit controls call `assessRecovery`.
It must not enable a scheduler or execute pending work.
It receives `{ directory, run, dependencyRun? }`.
When the run has admission state, `dependencyRun` supplies its retained dependency-preparation record.

`start` and `resume` receive this input:

```js
{ directory, runId, requestId, brief, run, budget, signal }
```

`run` is a snapshot of the retained admission.
`requestId` identifies its original execution input, not a replacement input.
The adapter returns this handle:

```js
{ submissionId, finished, cancel, close }
```

- `finished` settles the execution receipt. It does not release factory admission.
- `cancel()` requests cancellation of the model and all owned tools.
- `close()` must join all owned execution, including contained descendants, before resolving.
- A rejected `start()` or `resume()` must first drain anything it started.
- The adapter must honor `signal` even before it returns its handle.
- The adapter must not submit a new SDK input during resume.

Ticket #3 must connect its verified containment and parent-death cleanup to this lifecycle.
For contained execution, resume requires an adapter-produced assessment with these fields:

```js
{
  kind: 'contained-execution',
  quiescent: true,
  resumable: true,
  evidence: 'Run-specific assessment evidence',
  containment: { verified: true, evidence: 'Trusted OS-enforcement evidence' },
  partialEffects: { reconciled: true, evidence: 'Run-specific partial-effect reconciliation' }
}
```

The structure is a trusted-code contract, not an operator certification form.
The adapter must derive those facts from enforcement and reconciliation.
No CLI boolean supplies them.

Retirement without resume uses the adapter's quiescence assessment. See the [composed lifecycle replacement contract](lifecycle-replacement.md) for that implementation.

A partial-effect fixture proves refusal, not production containment.
The tool-free fixture reports `kind: 'tool-free-fixture'` and leaves `resourceContainmentVerified` false.

Ticket #4 must persist the admitted source and workspace identity before execution starts.
The adapter can receive those retained fields through `run`.
This slice neither creates worktrees nor changes source selection.

## Persistent reservation interface

The factory owns the original 20-minute deadline, including downtime, and the cumulative 40-attempt and 30-round allowances.
A live deadline aborts execution and drains its handle.
The injected clock exists for deterministic testing. The CLI uses the system clock.

Tickets #5 and #8 can use these execution-only methods:

```js
budget.reserveModelAttempt({ generationId, retry, smoke, requestedOutputTokens })
budget.reserveToolRound({ roundId })
budget.assertActive()
budget.settle(reservationId, evidence)
budget.deadlineAt
budget.signal
```

Reservations commit synchronously before effects.
Every request, including smoke and retries, needs a reservation.
A generation allows one original attempt and at most one retry.
A tool-round identity cannot be reserved twice.
Adapters must check activity again if dispatch waits after reservation.

Settling records evidence, not a refund.
Unknown usage retains its requested output reservation without claiming measured usage or billed spend.
A crash before dispatch still consumes the reservation.
The fixture conservatively reserves before enabling scheduling and checks activity again at provider dispatch.

## Verification and limits

Final checks used Node 24.21.0:

- Phase 0 and Phase 1: **55/55 passed** with `node --test --test-concurrency=1 tests/phase-0/*.test.mjs tests/phase-1/*.test.mjs`.
- Phase 0 browser regression: **1/1 passed** with system Chromium.
- JavaScript syntax checks and `git diff --check` passed.

The regression suite covers real backend SIGKILL, passive restart, reviewed resume, original-submission identity, and cumulative budget continuity.
It also covers deadline expiry across downtime, live deadline cancellation, uncertain-effect refusal, linked replacement, and stop drainage.
Checkpoints cover factory intent, reservation, durable admission, completion, receipt recording, and stop intent.
Tests inspect public records and receipts rather than private SQL or source text.
Existing backup, identity, immutable-brief, ownership, and native read-only regressions remain intact.

No production-model request, host credential/config read, package installation, Vanguard access, GitHub write, push, or merge occurred.
The parent integration now tests actual contained-tool cancellation through the application. Safe production resume still requires the later execution adapter.
Model authentication, full-stream request deadlines, provider output-cap enforcement, and production model routing remain ticket #5 work.
Repository execution and readiness qualification remain later slices.
Host or power-loss durability is not established by these process-crash tests.

## Parent integration review

The independent recovery/workspace review found three control defects. Each has an executed regression and a correction:

- Stop and shutdown now persist cancellation even after an answer settles, until final drainage is confirmed.
- A drained interrupted job uses trusted recovery assessment before terminal stop. Its uncertain reservations remain retained.
- Completed workspace-only preparation can establish quiescence without a nonexistent execution adapter, permitting stop or explicit linked replacement.

An incomplete crashed preparation still blocks recovery. A completed workspace receipt does not authorize models or repository tools.
The contained execution integration joins tool cleanup before releasing ownership and charges the original persistent tool budget.
