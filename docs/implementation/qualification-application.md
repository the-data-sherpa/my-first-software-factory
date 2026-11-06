# Qualification application opt-in (ticket #9, stream D)

This records the application side of the #8/#9 composition.
It is not #9 acceptance, real toolchain or provider readiness, or Phase 1 completion.
The parent has integrated the composed adapter, exports, CLI wiring, and controlled process proofs. See the [integration record](ticket-09-integration.md) for current evidence and open validation; this stream record retains the historical module checks.

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
| Started | Matching-kind, false-readiness `failed / QUALIFICATION_PERSIST_FAILED` | Specific failed outcome even when reporting could not save a verdict |
| Started, no verdict | Anything else | `failed / QUALIFICATION_UNVERIFIED` |
| Complete verdict | Different status, kind, readiness, or reason | `failed / QUALIFICATION_UNVERIFIED` |
| Complete verdict | Matching | `qualified`/`no-change` → `completed`; others keep their status and reason |

`LIMIT` reasons and `RUN_DEADLINE` keep the exact reason with `outcome.kind: 'budget-limited'`.
This applies to matching qualifier verdicts and, only for opted-in runs, to the application's deadline stop. Legacy outcomes are unchanged.
Passive reconciliation and uncertain tool reservations still take precedence and produce `interrupted`.

## Finalization and Work item

A matched `qualified` receipt is only provisional.
After the handle's `close()` confirms drainage, and only without a stop fence or expired original deadline, the application:

1. Runs passive qualifier inspection against the saved record.
2. Requires `qualified` and `verified` evidence, a descriptor, a capture, complete artifacts, and the full ordered ten-stage check list in both the evidence and the saved state.
3. Requires retained, current executor evidence and an executor draft digest equal to the descriptor's digest.
4. Rechecks the original deadline, then saves at most one `run.workItem` with the final status in the existing single record save. The deadline timer remains active during passive revalidation.

Any failure gives `blocked / QUALIFICATION_INVALIDATED` and no Work item.
A stop requested before or during finalization still produces `stopped` (or `budget-limited / RUN_DEADLINE`), and no Work item is saved.
A drain failure keeps the existing fence: `interrupted / drain_failed`, rejected close, and retained ownership.

The Work item has explicit kind and `controlled` fields. Controlled output has `status: 'qualified-evidence'` and `reviewReady: false`.
An owner-profile result can have `status: 'review-ready'` only after fresh qualified owner evidence and the final executor/artifact checks. The positive owner path remains unverified, not enabled by a fixture boolean.
It holds private references only:

- brief digest and record references for the task and its evidence;
- the executor plan artifact or `null` (never fabricated) and the transcript directory with its event count;
- the draft digest, `qualification/patch.json` with its digest, and new-file paths under `qualification/draft/`;
- check receipt paths, `qualification/state.json`, counters and the reservations reference, and the outcome reference.

It contains no Proposal, Approval, publication, or commit field.
Readiness is never Approval or permission to publish. Inspection clears projected readiness when evidence is stale or unverified; the saved verdict remains historical evidence.
Incomplete outcomes keep the run's actual draft and evidence without a Work item.

## Passive projection

`inspectRun` and `inspectHistory({ runId })` run passive qualifier inspection against the stored, unobserved record.
They add `qualificationEvidence` and replace `qualification` in the returned copy with a bounded summary: no check logs, reports, or inventories. The stored snapshot is never changed.

- No `qualification/` directory: `not-started`, `missing`.
- A directory without `state.json`: `interrupted`, `incomplete`.
- Mismatched or stale artifacts: the qualifier's `blocked / QUALIFICATION_INVALIDATED` with `artifactStatus: invalid`. Nothing is repaired.
- A qualified verdict without a descriptor or the full check list is projected as invalid. Both qualifier and application enforce this shape.
- A qualified verdict on a run that is not `completed` is projected with the run's status and `recordedStatus: 'qualified'`. A crash after qualification but before finalization stays interrupted, with no Work item.
- A Work item shows `freshness: 'current'` only when the run is completed and its evidence revalidates. Otherwise it shows `invalidated`.

`listRuns` and `inspectHistory` without a run ID do not hash artifacts.
They show the bounded summary with `status: 'unverified'`, and a Work item with `freshness: 'unverified'`. This is never presented as current readiness.
Inspection never calls the live verifier, loads a model, runs Git or checks, or schedules work. Opted-in interrupted runs refuse `resumeRun` with `UNSAFE_RESUME`. The existing external-reconciliation fence and linked-replacement path are unchanged.

## Verification performed

Tests use the in-process application seam with real disposable Git workspaces and a controlled refusal adapter.
That adapter runs no executor, qualifier, or checks, so it can only show refusals.
Its passing cases are not composition acceptance.

At stream D commit `37f9656`, `tests/phase-1/qualification-application.test.mjs` passed 17/17 cases:

- legacy behavior unchanged and opt-in validation;
- snapshot validation, detachment, and the synchronous callback;
- refusal of nominal, missing, mismatched, readiness-claiming, kind-overriding, incomplete, descriptor-less, and artifact-less qualified receipts;
- limit normalization, not-started and claimed-directory projection, stop precedence, and the drain fence;
- process death in an exact-owned scope after a persisted qualified verdict, followed by passive offline and online reopen.

On that stream's source, the focused file plus existing `factory`, `workspace-application`, `recovery`, `cli`, and `executor-application` regressions passed **82/82** (`regressions-final.log`). The exact-scope audit recorded 16 scopes, all with no survivors or remaining processes (`scope-audit-final.jsonl`).
The full suite, the browser test, and qualification module tests were not run in this stream.

Mutation checks, with the source restored afterward:

- Trusting nominal evidence made the descriptor-less case fail.
- Removing the claimed-directory branch and the limit normalization made both corresponding cases fail.

Evidence and the scope audit are under `/tmp/factory-ticket09-streamD/`.

## Integration dispositions and remaining proof

The parent integrated B's exact policy-key validation, incomplete-qualified-state refusal, and settlement of provably never-dispatched reservations after confirmed drainage. Entered operations without receipts remain uncertain; the application does not exempt them.
The qualifier now reports persistence failures through `finished` and uses `close`/`cancel` for drainage. The parent preserves the specific failure code without requiring that a failed reporting operation saved its own verdict.
Controlled process checks now cover a real executor-produced Work item, new retained test, online/offline equality, late-edit invalidation, stops during qualification/finalization, original-deadline expiry after execution closes, actual process death during a check and after the qualified projection, no-change, and model refusal.
The parent also keeps the deadline timer through finalization and rechecks the clock before saving the Work item.

These corrections do not replace the final combined suite and independent review. Real owner/toolchain/provider acceptance and ticket #10 remain unverified and separately authorized.
