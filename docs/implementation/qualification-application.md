# Qualification application opt-in (ticket #9, stream D)

This records the application side of the #8/#9 composition.
It is not #9 acceptance, real toolchain or provider readiness, or Phase 1 completion.
The composed adapter (`createQualifiedRepositoryExecution`, stream C), shared exports, CLI wiring, and the combined process proofs belong to the parent.

## Ownership

- `src/factory.mjs`: opt-in, snapshot persistence, receipt mapping, post-drain finalization, passive projection.
- `src/work-items.mjs` (new): qualification snapshot validation, receipt mapping, Work item construction, bounded projection.
- `tests/phase-1/qualification-application.test.mjs`, `-fixture.mjs`, `-worker.mjs` (new).

No wrapper, qualifier, CLI, storage, schema, or Approval change. Run records are already versioned JSON; no migration.

## Opt-in

`openFactory` reads `execution.qualifiesDrafts` once.
`true` is accepted only with `mode: 'repository-executor'`. A non-boolean value, or `true` on another mode, fails with `INVALID_EXECUTION` before backend ownership is taken.
Absent or `false` keeps the legacy module-only executor path unchanged: no `qualification` field, no `saveQualification` callback, and `draft-produced` remains `completed / QUALIFICATION_REQUIRED`.

An opted-in run is admitted with:

```js
run.qualification = { version: 1, runId, kind, status: 'pending', reviewReady: false };
```

It is created in `makeRecord`, before admission, and never deleted, so a conditional admission profile can depend on it.
Duplicate request comparisons, replacement scope, and the original budget are unchanged. A linked replacement is a new run with its own pending qualification and, at most, its own Work item. It does not join the original run's Work item. This is the Phase 1 per-run reading of "a work item may gather further runs".

## Detached snapshots

The start input gains `saveQualification(state)` only when the adapter opts in.
It is synchronous and returns `undefined`.
Each snapshot is validated against the current saved record, then stored verbatim, because qualifier inspection requires equality with `qualification/state.json`:

- `version: 1`, the run's `runId` and `kind`, a known status, a boolean `reviewReady`, and `reviewReady: false` for a controlled kind.
- A descriptor must match the run, kind, normalized executor scope, and saved admission binding. Once saved, it cannot change.
- A verdict must match the run, kind, status, and readiness. A recorded non-qualified verdict cannot later become `qualified`.
- No updates are accepted after the run's final save.

A refused snapshot throws `QUALIFICATION_CONFLICT`. The qualifier then fails closed.
Readiness is never derived from these fields.

## Receipt mapping

Opted-in runs use the persisted verdict, not the receipt alone:

| Saved qualification | Receipt | Run |
| --- | --- | --- |
| Not started | `draft-produced` | `failed / QUALIFICATION_MISSING` |
| Not started | `qualified` | `failed / QUALIFICATION_UNVERIFIED` |
| Not started | Other executor outcome | Existing executor mapping |
| Started, no verdict | `interrupted` | `interrupted` |
| Started, no verdict | Anything else | `failed / QUALIFICATION_UNVERIFIED` |
| Complete verdict | Different status, kind, readiness, or reason | `failed / QUALIFICATION_UNVERIFIED` |
| Complete verdict | Matching | `qualified`/`no-change` → `completed`; others keep their status and reason |

`LIMIT` reasons and `RUN_DEADLINE` keep the exact reason with `outcome.kind: 'budget-limited'`.
This applies to matching qualifier verdicts and, only for opted-in runs, to the application's deadline stop. Legacy outcomes are unchanged.
Passive reconciliation and uncertain tool reservations still take precedence and produce `interrupted`.

## Finalization and Work item

A matched `qualified` receipt is only provisional.
After the handle's `close()` confirms drainage, and only without a stop fence, the application:

1. Runs passive qualifier inspection against the saved record.
2. Requires `qualified` and `verified` evidence, a descriptor, a capture, complete artifacts, and the full ordered ten-stage check list in both the evidence and the saved state.
3. Requires retained, current executor evidence and an executor draft digest equal to the descriptor's digest.
4. Saves at most one `run.workItem` with the final status in the existing single record save.

Any failure gives `blocked / QUALIFICATION_INVALIDATED` and no Work item.
A stop requested before or during finalization still produces `stopped` (or `budget-limited / RUN_DEADLINE`), and no Work item is saved.
A drain failure keeps the existing fence: `interrupted / drain_failed`, rejected close, and retained ownership.

The Work item has explicit kind and `controlled` fields, `status: 'qualified-evidence'`, and `reviewReady: false`.
It holds private references only:

- brief digest and record references for the task and its evidence;
- the executor plan artifact or `null` (never fabricated) and the transcript directory with its event count;
- the draft digest, `qualification/patch.json` with its digest, and new-file paths under `qualification/draft/`;
- check receipt paths, `qualification/state.json`, counters and the reservations reference, and the outcome reference.

It contains no Proposal, Approval, publication, or commit field.
This slice never sets Work item readiness to true, including for an owner kind. Owner readiness needs a separate parent decision once real-runner evidence exists.
Incomplete outcomes keep the run's actual draft and evidence without a Work item.

## Passive projection

`inspectRun` and `inspectHistory({ runId })` run passive qualifier inspection against the stored, unobserved record.
They add `qualificationEvidence` and replace `qualification` in the returned copy with a bounded summary: no check logs, reports, or inventories. The stored snapshot is never changed.

- No `qualification/` directory: `not-started`, `missing`.
- A directory without `state.json`: `interrupted`, `incomplete`.
- Mismatched or stale artifacts: the qualifier's `blocked / QUALIFICATION_INVALIDATED` with `artifactStatus: invalid`. Nothing is repaired.
- A qualified verdict without a descriptor or the full check list is projected as invalid. See the integration note below.
- A qualified verdict on a run that is not `completed` is projected with the run's status and `recordedStatus: 'qualified'`. A crash after qualification but before finalization stays interrupted, with no Work item.
- A Work item shows `freshness: 'current'` only when the run is completed and its evidence revalidates. Otherwise it shows `invalidated`.

`listRuns` and `inspectHistory` without a run ID do not hash artifacts.
They show the bounded summary with `status: 'unverified'`, and a Work item with `freshness: 'unverified'`. This is never presented as current readiness.
Inspection never calls the live verifier, loads a model, runs Git or checks, or schedules work. Opted-in interrupted runs refuse `resumeRun` with `UNSAFE_RESUME`. The existing external-reconciliation fence and linked-replacement path are unchanged.

## Verification performed

Tests use the in-process application seam with real disposable Git workspaces and a controlled refusal adapter.
That adapter runs no executor, qualifier, or checks, so it can only show refusals.
Its passing cases are not composition acceptance.

`tests/phase-1/qualification-application.test.mjs` passed 17/17 cases:

- legacy behavior unchanged and opt-in validation;
- snapshot validation, detachment, and the synchronous callback;
- refusal of nominal, missing, mismatched, readiness-claiming, kind-overriding, incomplete, descriptor-less, and artifact-less qualified receipts;
- limit normalization, not-started and claimed-directory projection, stop precedence, and the drain fence;
- process death in an exact-owned scope after a persisted qualified verdict, followed by passive offline and online reopen.

On the final source, the focused file plus existing `factory`, `workspace-application`, `recovery`, `cli`, and `executor-application` regressions passed **82/82** (`regressions-final.log`). The exact-scope audit recorded 16 scopes, all with no survivors or remaining processes (`scope-audit-final.jsonl`).
The full suite, the browser test, and qualification module tests were not run in this stream.

Mutation checks, with the source restored afterward:

- Trusting nominal evidence made the descriptor-less case fail.
- Removing the claimed-directory branch and the limit normalization made both corresponding cases fail.

Evidence and the scope audit are under `/tmp/factory-ticket09-streamD/`.

## Integration notes and remaining proof

- **Stream B:** `qualifier.inspect` returns `qualified/verified` for a saved state with a qualified verdict but no descriptor, capture, or checks. The application compensates. A module fix belongs to B.
- **Stream B:** the qualifier's `prerequisites` currently rejects the admission profile key `../docs/agents/change-quality.md`. Until B lands, no real composed run can qualify at this base. That is why this stream has no positive Work item proof.
- **Stream B:** undispatched upfront qualification reservations remain `uncertain`. The application deliberately does not exempt them, so such runs currently end `interrupted`.
- **Stream C:** after confirmed drainage, the wrapper must report non-drain reporting errors as a receipt rather than a close rejection. The application treats any close rejection as a drain failure.
- **Parent:** the following need combined process tests through the real composed adapter and CLI:
  - composed green with exactly one Work item, CLI online and offline equality, and invalidation after a later worktree edit;
  - stop during qualification and during finalization;
  - deadline within the original limit;
  - real process death mid-qualification;
  - executor no-change and failure.
