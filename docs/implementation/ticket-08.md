# Ticket #8: bounded repository executor

Baseline: `48c40585972e56bd2bd6fe26d73f488238681ac7`.
This isolated implementation follows [the executor/qualification contract](executor-qualification-contract.md).
It adds executor modules, controlled execution tests, and this record.
It does not connect the owner CLI or implement qualification.

All normal outcomes remain unqualified and have `reviewReady: false`.
The worktree contains the retained draft. Model claims and durable completion cannot establish maintenance readiness.
No real Vanguard source, credential file, production model, public registry, or service was accessed.
No package installation into the factory, runtime change, tracker write, push, publishing, or draft commit occurred.

## Factory-owned interface

`src/execution.mjs` exports:

```js
createRepositoryExecution(options)
validateExecutorScope(scope)
verifyExecutorHandoff(token, { runId, kind })
inspectExecutor({ directory, run, page, offset, length })
```

The adapter has `mode: 'repository-executor'` and `admissionKind: 'owner' | 'controlled-fixture'`.
Construction and recovery assessment load no credentials and execute no work.
Injected runtime, transport, and clock options require explicit controlled-fixture identity.
The owner adapter accepts no such overrides.
The executor reuses the runtime initialized by admission, without another credential loader.

The parent supplies the original contract inputs:

```js
const execution = createRepositoryExecution(); // Lazy owner configuration.
const handle = await execution.start({
  directory, runId, requestId, brief, run, budget, signal,
  dependencyRun, saveAdmission, saveExecutor,
});

const outcome = await handle.finished;
// outcome.status: draft-produced | no-change | failed | stopped |
//                 budget-limited | interrupted
// outcome.reviewReady is always false.
```

`saveExecutor` must synchronously persist a detached snapshot under the factory lifetime lock.
The parent must save the normalized scope before dispatch:

```js
run.executor = {
  version: 1,
  kind: run.admission.kind,
  status: 'pending',
  scope: validateExecutorScope({ writePaths: ownerSelectedFiles }),
};
```

Scope normalization sorts and detaches the explicit file paths.
It rejects duplicates, globs, traversal, private paths, dependency inputs, configuration paths, and unsupported names.
The conservative policy also rejects JSON, YAML, TOML, lockfiles, and configuration directories.
Existing parent directories are required. The tools do not create directories.
An existing scoped file must fit within 64 KiB and retain its executable mode.
Path selection grants permission, not an execution plan.

The handle supplies `finished`, `cancel`, `close`, and `handoff`.
The parent must join `close()` before releasing ownership.
Drainage failures reject with `DRAIN_FAILED` or `MODEL_DRAIN_FAILED`, including failures before handle transfer or during error reporting.
`resume` rejects with `UNSAFE_RESUME`.
Recovery assessment reports neither quiescence nor resumability.

## Admission and draft authority

The executor composes the real `createAdmissionExecution` adapter.
It completes containment, same-run smoke, and healthy baseline checks before consuming the live admission handoff.
Consumption revalidates pristine source and the execution profile.
It is a one-time in-process transition, not a JSON flag or caller-supplied verifier.

After activation, the original admission binding remains unchanged.
The execution profile includes the admitted scope and executor implementation fingerprints.
Every model/tool operation rechecks live ownership, dependencies, profile, budget, and source restrictions.
A detached expected manifest permits changes only to the admitted files.
The existing snapshot validator checks every other visible file, directory, and executable mode against the original manifest.
Ordinary draft mutations therefore do not require reusing or weakening pristine admission authority.

After a completed draft, the parent can request an opaque token before closing the handle:

```js
const token = await handle.handoff();
const descriptor = await verifyExecutorHandoff(token, {
  runId,
  kind: execution.admissionKind,
});
```

The detached descriptor follows the contract exactly:

```js
{
  version: 1,
  runId,
  kind,
  admissionBinding,
  scope: { writePaths },
  draft: { sourceDigest, artifactDirectory: 'executor' },
}
```

The digest uses the contained-check snapshot convention, including new files and executable modes.
Verification checks lifetime again after the final asynchronous source read.
A foreign run, wrong kind, JSON copy, closed owner, stop, expired budget, or changed draft cannot pass.
An observed draft mismatch permanently revokes the issued authority, even if someone restores the earlier bytes.
No-change and incomplete outcomes cannot issue a successful handoff.
The token grants no review readiness.

## Durable model and tool execution

Pinned pi-durable 1.5.0 owns model generations and tool execution.
The executor uses the smoke's existing per-run SQLite store and session, with a separate conversation and stable executor-phase request identity.
It checks that the smoke is complete and that the session has no unfinished tasks or submissions before scheduling.
The execution receipt retains the smoke identity but points to the executor conversation and submission.
Passive receipt lookup cannot mistake completed smoke for completed executor work.
A duplicate direct start refuses the existing executor artifact directory before overwriting evidence or opening a scheduler.

The factory-owned model path retains the existing transport, route, credential integration, accounting, and cap checks.
Default preflight and ordinary `createModelRequests` requests still reject tools.
Only the opaque activated admission permits the internal executor request path.
That path accepts exactly three registered schemas:

- `read_file({ path, offset })`: bounded UTF-8 evidence reads.
- `write_file({ path, text })`: replacement of an admitted file after model-authored plan text.
- `run_check({ name })`: fixed `vitest` or `lint`, with no caller arguments.

Model arguments cannot supply roots, environment, URLs, commands, modules, argv, dependency handles, budgets, or authentication.
The adapter passes the original budget, abort signal, and verified opaque dependency handle to `createRunTools`.
Checks remain sequential and contained.

The pinned SDK normally uses incremental tool declarations for this model.
The bounded executor model copy disables incremental additions and tool search.
The final Responses payload must contain exactly the registered function schemas.
The real SDK request includes system guidance and the immutable brief, criteria, evidence, source identity, scope, limits, and deadline.
Controlled transport assertions verify those outgoing fields and subsequent function-call/results, not a faux provider transcript.

The numerical limits remain unchanged:

- Original 20-minute run deadline, 40 model attempts, and 30 tool rounds, including smoke and verification.
- Normal model requests: 180-second full-stream deadline and at most 8,192 output tokens, including reasoning.
- Smoke: one attempt, 60 seconds, and at most 1,024 output tokens.
- Exact `openai/gpt-6.1-sol`, API-key-compatible `max_output_tokens`, explicit low reasoning, and zero provider retries.
- At most one durable transient retry per generation, charged to the original budget.
- No compaction, automatic continuation, queued follow-ups, background responses, or alternate model route.
- Checks: 120 seconds, one at a time, at most two Vitest workers, and 1 MiB output.
- Envelope: 4 GiB memory, zero swap, 256 tasks, and 256 MiB scratch.
- Briefs and writes: 64 KiB. File reads: 16 KiB pages.

Cancellation, deadline, overflow, authentication failure, or rejected payloads remove tool-call authority before dispatch.
The model controller joins response-body drainage before returning a callable response.
Tools also check the live run before and after each operation.
Duplicate model tool-call identities cannot repeat an effect.

Writes declare `replay: 'unsafe'`.
Reads and checks declare `replay: 'safe'`, but those declarations do not authorize recovery.
No executor resume path opens the scheduler.
A process crash after a real write can retain an uncertain reservation and an unfinished tool intent.
Inspection never repeats that write or repairs the reservation.

## Private evidence and passive inspection

Executor artifacts live under `directory/executor/` as numbered, owner-only JSON event files.
The adapter synchronizes each event before requesting application projection persistence.
Events include immutable intent, model request intent, model responses, model-authored plan references, tool intents/results, completion, and failure.
Tool intents retain arguments and replay declarations.
Tool results retain actual file/check results rather than a model success claim.
Contained snapshots and full check logs remain in the existing private `checks/` directory.
The durable store retains the SDK transcript. The worktree remains authoritative for draft bytes.

The factory record, execution store, event files, and worktree do not share an atomic transaction.
A failed projection save cannot undo a real file mutation.
Passive inspection reads the event files independently of the last saved projection and exposes retained effects and uncertain operations.
It does not fabricate missing receipts.
Provider error text and failed-response content remain sanitized by the existing model policy.
Incomplete requests retain their intent and accounting, not a claim that every partial provider token was captured.

`inspectExecutor` validates private paths, ownership, file types, bounds, JSON event types, artifact references, and the saved intent identity.
It compares completed draft evidence with current source bytes.
It exposes incomplete evidence after stop, failure, or process death.
It creates no ModelRuntime, opens no scheduler or SQLite connection, and performs no repair or persistence.
The parent must supply its passively inspected run status and hold or fence ownership.

Pagination parameters:

- `page`: zero-based event index, default `0`.
- `offset`: byte offset returned by the previous page, default `0`.
- `length`: `4..16384` bytes, default `16384`.

The result contains a bounded event index and one UTF-8 page with `nextOffset`.
Each artifact is at most 2 MiB. Inspection accepts at most 256 events and 128 MiB total event data.
Large or unsupported evidence fails closed instead of silently discarding an effect.
Full runner logs remain separately inspectable through the existing contained-check interface.

## Parent wiring required

No parent-owned application, CLI, containment, run-tools, package, runtime, shared design, or qualification file changed.
The current application still recognizes only the earlier admission-only mode.
The controlled fixture supplies a narrow adapter and saves executor projections separately.
It calls the real executor with the application's original budget and signal.
It does not simulate model formatting, file effects, contained checks, or durable execution.
Its synthetic `CONTROLLED_EXECUTOR_BRIDGE` application outcome is not final CLI integration.

The parent still needs to:

1. Select `repository-executor` through an explicit owner operation.
2. Normalize and persist the initial executor scope before dispatch.
3. Include that scope in immutable admission and duplicate-request comparisons.
4. Supply synchronous `saveExecutor` and expose passive executor inspection with pagination.
5. Map executor outcomes without promoting smoke or a model claim to completion or readiness.
6. Preserve original admission as historical baseline evidence after authorized draft changes.
7. Avoid applying the admission-only pristine-source inspection projection to a legitimate draft as current readiness.
8. Keep the executor handle alive through qualification and supply the actual opaque verifier to ticket #9.
9. Cancel both stages and join both drains before releasing ownership.
10. Keep interrupted or uncertain runs fenced, without resubmission or assumed quiescence.

The executor handle does not expose a top-level submission ID at start because admission precedes executor submission.
`saveExecutor` later supplies the executor submission ID.
The parent must use that projection for any application execution-receipt identity check.
The durable receipt retains the original application request ID and a separate phase request ID.

The parent must independently exercise actual executor/qualifier composition, CLI lifecycle, public outcomes, new files, stale evidence, and cancellation.
Qualification owns regression-against-base evidence, final independent checks, complete patch capture, and work-item readiness.
This module does not implement any of those claims.

## Red-green and verification record

Tests use the agreed application/execution interfaces, actual installed Pi packages, actual OS containment, disposable repositories, and dummy in-memory credentials.
The synthetic package entry points exercise the fixed Vitest/ESLint command paths.
They are not the real Vitest or ESLint distributions and establish no Vanguard compatibility.

Recorded corrections:

- The first scope test failed because the required export did not exist, then passed.
- The first draft request failed the payload gate because the SDK emitted incremental tool declarations.
  The authorized fixed-schema path corrected it without weakening default no-tool requests.
- A post-write persistence test showed that inspection omitted effects absent from the last application projection.
  Inspection now reads the retained event evidence.
- Finalization stop attempted to abort an already closed Harness and reported false drain uncertainty.
  Cancellation now joins the existing close result.
- A handoff test restored changed bytes and exposed reusable stale authority.
  An observed mismatch now permanently revokes the token.

One cancellation fixture initially waited for drainage before triggering cancellation.
Its exact-owned watchdog drained the scope. The fixture ordering changed, without increasing the watchdog or production deadlines.
Namespace-failure fixture assertions also moved overlap checking before backend shutdown, preserving the expected lifecycle error.

Coverage includes real evidence reads, model-authored plans, allowed helper edits, new test files, fixed checks, no-change, and fabricated success.
It includes schema/tool/path/scope denial, failed preflight, dependency/source/profile changes, duplicate identities, output limits, and original cumulative budgets.
It includes transient retry, stop/shutdown/deadline, terminal-toolUse cancellation, finalization stop, and failed model/namespace drainage.
The namespace cases cover startup before handle transfer, handled tool failure, failed error reporting, repeated close, and retained owner locks.
The process-crash case kills the worker after a synced mutation but before reservation settlement.
Passive inspection, duplicate admission, reopen, and rejected resume preserve the partial draft without replay.

Verification under Node 24.21.0:

- Full `npm test`: **258/258 passed**, including the 223-test baseline and 35 executor tests, with no skips or exclusions.
- Existing browser regression with `CHROMIUM_PATH=/usr/bin/chromium`: **1/1 passed**.
- JavaScript syntax and whitespace checks passed.
- Package files, lock graph, runtime pin, and all non-owned files remain unchanged.

Logs and retained fixture indexes live under `/tmp/factory-ticket08-evidence/`.
`retained/draft.json`, `retained/crash.json`, `retained/model-drain-report.json`, and `retained/tool-drain-report.json` identify private disposable state.
These retain actual draft bytes, model/tool events, check snapshots, accounting, and incomplete or uncertain evidence.
They require explicit owner cleanup.
The final separate audit found **334/334** recorded exact scopes inactive, with empty cgroups.
`scope-audit.json` records that audit, including both full-suite runs, focused cases, retained examples, and failed-watchdog teardown.
No root-cgroup read, name-pattern kill, or host-wide process kill was used.
The temporary link to existing factory dependencies was removed before commit.

Key evidence files:

- `01-scope-red.log` and `05-draft-green.log`: initial interface and real draft path.
- `03-payload-red.log`: real SDK tool-payload mismatch before correction.
- `06-persistence-red.log` and `07-focused.log`: retained effects after failed projection persistence.
- `08-lifecycle.log` and `09-finalization-green.log`: cancellation and finalization correction.
- `13-namespace-green.log`: failed namespace drainage through startup and reporting failures.
- `17-handoff-revocation-red.log` and `18-handoff-green.log`: permanent stale-token revocation.
- `19-full-suite-final.log`: final 258/258 full-suite result.
- `20-retained-final.log`: final 4/4 retained draft, crash, and failed-drain examples.
- `21-browser-final.log`: final 1/1 browser result.

This record uses strict technical prose. Its local style score remains below the configured threshold, with no banned-word hits.

## Limits

The controlled implementation is not the Phase 1 maintenance demonstration.
Real credentials, provider acceptance, billing, Vanguard source/dependencies, actual Vitest/ESLint, and baseline health remain unverified.
Local model cancellation does not prove that provider billing stopped.
No trusted production effect reconciliation or safe resume is available.
There is no host/power-loss atomicity claim.

Existing cleanup limits remain: manager failure with owner loss, simultaneous backend/launcher death, and an unschedulable launcher-loss monitor need external quiescence review.
The existing dependency parser and bundle-backup restrictions remain unchanged.
The parent owns final application/CLI acceptance and integration with ticket #9.
