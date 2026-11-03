# Parallel executor and qualification contract

This implementation contract splits tickets #8 and #9 at the factory-owned execution interface.
It does not change the accepted Phase 1 design or authorize live operations.
The parent accepts #8 before accepting the combined #8/#9 path.

## Ownership

Both implementations start from the same committed #7 checkpoint.
Each uses an isolated checkout and implements through the existing application/execution test seams.
Neither writes tracker state or pushes commits.

- **Executor stream (#8):** new executor/model/tool-adapter modules, executor tests, and `docs/implementation/ticket-08.md`.
  It may extend `src/admission.mjs`, the model modules, and `src/execution.mjs` as needed.
  It preserves the default no-tool request policy and all existing gate tests.
- **Qualification stream (#9):** new qualification/artifact modules, qualification tests, and `docs/implementation/ticket-09.md`.
  It owns any necessary targeted additions to `src/containment.mjs` and `src/containment-files.mjs` for independent verification.
  Existing admission commands and file/check behavior must remain compatible.
- **Parent integration:** `src/factory.mjs`, `src/control-server.mjs`, `bin/factory.mjs`, shared README/phase-plan updates, final composition, and acceptance.
  Neither stream edits those files or the other stream's modules.

Neither stream changes `AGENTS.md`, `CONTEXT.md`, ADRs, package files, or runtime pins.
Avoid changing shared fixtures. Add stream-specific fixtures instead.
Raise a contract conflict rather than silently changing another stream's interface.

## Existing invariants

The factory owns the backend lifetime lock, immutable run identity, saved source intent, and explicit dependency-run selection.
It supplies the original `budget` and `signal` to every stage.
No stage starts another run, resets a budget, discovers another bundle, installs packages, or reopens a scheduler during inspection.
All operations remain within the original 20-minute deadline, 40 model attempts, and 30 tool rounds, including verification.
Checks remain sequential and contained. Live ownership cannot end before model and namespace drainage completes.
Unknown drainage remains `DRAIN_FAILED` or `MODEL_DRAIN_FAILED`, including when error reporting fails.

A saved JSON record is evidence, not permission to execute.
Opaque tokens and trusted adapter callbacks are in-process interfaces, never CLI inputs or model tools.
Controlled fixtures cannot issue owner-profile authority or establish real maintenance readiness.

## Executor interface

Export `createRepositoryExecution`, `verifyExecutorHandoff`, `validateExecutorScope`, and `inspectExecutor` through `src/execution.mjs`.
The execution adapter has the existing `start`, `resume`, and `assessRecovery` lifecycle interface.
Its mode is `repository-executor`. Its `admissionKind` is `owner` or `controlled-fixture`.
Construction, passive inspection, and recovery assessment load no credentials and perform no execution.
Injected runtime/transport options require explicit fixture identity, as in ticket #7.

The parent supplies these existing start inputs:

```js
{
  directory, runId, requestId, brief, run, budget, signal,
  dependencyRun, saveAdmission,
  saveExecutor // Persist a detached executor-state snapshot synchronously.
}
```

The parent saves this initial projection before dispatch:

```js
run.executor = {
  version: 1,
  kind: run.admission.kind,
  status: 'pending',
  scope: { writePaths: [/* explicit owner-selected relative file paths */] }
};
```

Export a pure `validateExecutorScope(scope)` function returning a normalized detached scope or a fixed-code error.
Scope paths name files, not globs or directories. Scope never grants access to protected configuration, dependency inputs, or private metadata.
The parent includes normalized scope in immutable admission and duplicate-request comparisons.
The executor revalidates scope before use. Model arguments cannot expand it.
Path permissions are not an owner-authored execution plan.

The executor consumes the live #7 handoff before registering agent tools or sending tool-enabled model requests.
It validates pristine admission inputs at that transition, then permits only authorized draft mutations.
Normal draft changes must not be confused with permission to reuse stale admission evidence for a different execution.
Preserve the historical baseline binding and verify dependencies, profile, ownership, and budgets throughout execution.

Use pinned pi-durable for durable model/tool execution, not a second workflow engine.
The same run retains one durable execution store/session, with distinct stable phase request identities where needed.
An old smoke receipt cannot masquerade as executor completion, and opening the executor cannot replay incomplete admission work.

Persist stage intent, plan/transcript references, actual tool effects, checks, and draft state through `saveExecutor` and private artifacts.
Keep the admitted scope unchanged in every saved projection.
Artifact files belong under `directory/executor/`; the worktree remains the authoritative retained source.
Artifact references are relative to the run directory and validated before reading.
The exact internal artifact schema belongs to #8. #9 must not parse that schema or derive authority from model text.
`inspectExecutor({ directory, run })` passively validates and exposes retained executor evidence, including incomplete runs.
Use bounded output or pagination for large transcripts. Document any pagination arguments for parent integration.
It must not initialize credentials, open a scheduler, execute tools, or repair records.

The returned handle supplies the existing `finished`, `cancel`, and `close` methods, plus `handoff()`.
A normally completed executor returns:

```js
{
  status: 'draft-produced', // Or 'no-change'; neither means review-ready.
  runId, requestId, reviewReady: false
}
```

Failed, stopped, interrupted, budget-limited, and uncertain outcomes remain distinct.
Partial drafts and earlier evidence survive them. No successful handoff may hide an incomplete mutation or output-limit stop.
Do not fabricate a plan, patch, successful check, or completion receipt when none exists.

After a completed draft, but before `close()`, `handoff()` can issue an opaque token.
`verifyExecutorHandoff(token, { runId, kind })` revalidates its live owner, budget, immutable policy, dependencies/profile, and exact current draft.
It returns detached descriptive evidence with this shape:

```js
{
  version: 1,
  runId,
  kind, // 'owner' or 'controlled-fixture'
  admissionBinding: { /* Original verified #7 binding, unmodified. */ },
  scope: { writePaths: [/* Original admitted scope. */] },
  draft: {
    sourceDigest, // Same snapshot digest convention as contained checks.
    artifactDirectory: 'executor'
  }
}
```

New files participate in the digest. Changes after issuance invalidate the token.
A JSON copy, wrong run/kind, closed owner, stop, or expired budget cannot pass validation.
The token does not itself establish readiness. #9 must gather independent evidence.

## Qualification interface

Implement `src/qualification.mjs` with:

```js
createDraftQualification({ verifyDraft })
  // -> { start(input), inspect(input) }
```

`verifyDraft` is a trusted in-process callback supplied by the parent composition.
It calls `verifyExecutorHandoff` with the actual token and expected run/kind, returning the descriptor above.
It is not supplied through JSON, model arguments, arbitrary module loading, or a caller-selected command.
This callback lets #9 develop independently without importing unfinished #8 modules.

`start` accepts:

```js
{
  directory, run, dependencyRun, budget, signal,
  saveQualification // Persist a detached qualification-state snapshot synchronously.
}
```

It returns `{ finished, cancel, close }` with joined drainage on every exit.
`finished` returns a bounded verdict containing `status`, `reason` when applicable, `runId`, `kind`, and `reviewReady`.
Use `status: 'qualified'` only when all required independent evidence passes.
Controlled profiles may report passing controlled evidence but must retain `reviewReady: false`.
An owner-profile qualification may report readiness only after every accepted criterion passes.
No-change and incomplete executor outcomes do not become successful qualifications.

Qualification artifacts belong under `directory/qualification/`.
`inspect({ directory, run, dependencyRun })` is passive: it checks retained evidence and current artifact freshness without calling `verifyDraft` or starting work.
Later source, dependency, toolchain, test-selection, or profile changes invalidate readiness.
The parent owns persistence of at most one work item and the public inspection projection.
The qualifier supplies private artifact references and bounded evidence, not a second record store or workflow engine.

Qualification must independently:

1. Validate the original healthy baseline and intended helper/test scope.
2. Capture the complete draft, including new files and relevant file modes.
3. Execute the same selected regression against recorded base and draft inputs.
4. Distinguish the intended assertion failure from missing dependencies, crashes, skipped tests, and unrelated assertions.
5. Run final one-shot Vitest and lint against the exact current draft.
6. Bind evidence to base/draft bytes, selected tests, complete diff, dependencies, toolchain, and execution profile.
7. Revalidate the draft and inputs before issuing the verdict.

The base comes from retained private source/object evidence, not the owner's current checkout or a mutable branch name.
Regression selection must be recorded and independently attributable to the accepted task, not inferred from a model success claim.
A nonzero exit code alone is never regression evidence.
Unsupported or unverifiable runner output blocks qualification instead of producing a passing verdict.
Controlled fixture packages do not establish compatibility with real Vitest/ESLint.

Use the existing contained runner and opaque matching dependency handles.
Any new verification-specific command/source selection is a trusted fixed operation, not new model-controlled argv or arbitrary mounts.
Reserve original tool rounds before verification and checks. Never replenish limits for qualification.
A serialized receipt or boolean cannot substitute for actual execution and artifact validation.

## Composition and acceptance

The parent wraps the executor handle and keeps it owned through qualification.
After `draft-produced`, it obtains the opaque handoff and supplies the verifier callback to the qualifier.
Stop cancels both stages. Close drains both before releasing ownership.
No qualification runs after a failed or interrupted executor, and passive reopen never repeats either stage.

Each stream proves its module through controlled application/execution fixtures using the contract above.
A narrow fixture adapter may bridge existing application wiring while the parent integration is pending.
It must call the real implementation and original factory budget, not simulate its effects or claim final CLI acceptance.
#9 fixtures can supply a controlled trusted verifier, but this does not prove the final #8/#9 composition.
The parent must test the actual composition with executor-produced drafts, new files, stale evidence, cancellation, and crash/passive inspection.
It then runs full verification and independent review before accepting #9.

Live credentials/model calls, real Vanguard access, public package downloads, services, and global changes remain outside this implementation authorization.
Ticket #10 needs separate owner authorization after the controlled implementation gates pass.
