# Ticket #9: independent draft qualification module

## Status and scope

This isolated implementation starts from `48c40585972e56bd2bd6fe26d73f488238681ac7`.
It follows the [parallel contract](executor-qualification-contract.md), without importing ticket #8 modules.
The parent must accept #8 before accepting the combined path.
This module does not complete ticket #9 acceptance or the real Vanguard demonstration.

Controlled evidence can reach `status: qualified`, but always has `reviewReady: false`.
The owner profile blocks with `QUALIFICATION_RUNNER_UNSUPPORTED` after validating its source, baseline, and scope.
No real Vitest/ESLint distribution was available in the permitted factory dependencies.
The synthetic packages do not establish compatibility with either real distribution.
Removing that block requires separately verified runner compatibility, not a changed JSON flag.

No real Vanguard read, credential/configuration read, production-model request, public download, service, or global change occurred.
Tests use disposable repositories, dummy in-memory credentials, controlled transports, installed Bun, and the existing containment runner.
Package files, runtime pins, shared fixtures, and the parent-owned application/CLI modules remain unchanged.
No push or tracker operation occurred.

## Parent composition

Import `createDraftQualification` directly from `src/qualification.mjs` until the parent adds shared exports.
Its constructor accepts only the trusted callback described in the contract:

```js
const token = await executor.handoff();
const qualifier = createDraftQualification({
  verifyDraft: expected => verifyExecutorHandoff(token, expected),
});
const qualification = await qualifier.start({
  directory, run, dependencyRun, budget, signal,
  saveQualification: state => persistDetachedQualificationState(state),
});
const verdict = await qualification.finished;
await qualification.close();
await executor.close();
```

`expected` contains `{ runId, kind }` from the admitted run.
The parent binds the opaque token in its closure.
The callback is never a JSON property, model tool, module loader, or CLI argument.
Qualification consumes only the public handoff descriptor, not executor artifact schemas or model completion text.

The parent must preserve the live executor owner until both stages drain.
Stop must cancel both stages.
A `DRAIN_FAILED` or `MODEL_DRAIN_FAILED` rejection must retain application ownership.
Do not convert a handled rejection or failed error report into a stopped or successful run.

`saveQualification` synchronously persists a detached state projection.
It must update `run.qualification` in the parent's retained run record.
Inspection compares that projection with `qualification/state.json`.
The parent must supply the original run budget, signal, explicit dependency run, admission evidence, and immutable workspace intent.
No new budget or dependency selection occurs here.

The returned handle provides `finished`, `cancel`, and `close`.
Both cancellation and closure join the qualification task and containment drainage.
Repeated closure retains any drainage failure.
Duplicate start rejects with `QUALIFICATION_EXISTS`, including after interruption.

`finished` returns a bounded verdict with status, optional reason, run ID, kind, readiness, and private artifact references.
Outcomes include qualified, no-change, blocked, failed, stopped, and interrupted.
An incomplete executor projection never permits checks or a successful qualification.

The parent owns at most one work item per run.
It must combine the brief, plan, transcript, usage, executor artifacts, qualification evidence, and outcome.
This module creates no work-item store, durable scheduler, proposal Approval, draft commit, or publication capability.

## Selection and report contract

`src/qualification-selection.mjs` records the selected task and literal expected outputs.
The source is accepted Phase 1 Q21/Q24 and the retained 2026-11-02 task facts.
No new Vanguard inspection supplied these cases.

| Case | Input | Expected draft output | Required recorded-base output |
| --- | --- | --- | --- |
| Separated unit | `100 Main Street # 2` | `100 MAIN ST 2` | `100 MAIN ST  2` |
| Trailing period | `100 Main St .` | `100 MAIN ST` | `100 MAIN ST ` |
| Compact unit | `100 Main Street #2` | `100 MAIN ST 2` | `100 MAIN ST 2` |
| Unit preservation | `100 Main Street # 23B` | `100 MAIN ST 23B` | `100 MAIN ST  23B` |
| Abbreviation preservation | ` 100  Main Street ` | `100 MAIN ST` | `100 MAIN ST` |

The base outputs are a narrow supported defect signature, not a universal address specification.
Different outputs block this selection rather than being inferred from logs.
The recorded selection precedes capture and check effects.
Both base and draft execute the identical factory-owned test bytes.
The test calls the exported helper and asserts the independent expected strings.
It does not compare two calls to the same helper as its oracle.

The new fixed check is `selected-regression`.
Only a trusted opaque verification source enables it.
Its argv selects factory-owned configuration, test, and reporter files.
Those files mount read-only outside the repository source and dependency mounts.
Agent-supplied commands, argv, environment, executables, roots, or report objects cannot select them.
The existing `boundary`, `vitest`, and `lint` operations retain their argv and behavior.

The report protocol is `factory-vitest-selection-v1`.
It contains the exact selected file, ordered case identities, case states, structured assertion errors, and other errors.
Base evidence requires exit 1 and the exact expected assertion failures.
It also requires the unaffected cases to pass.
Draft evidence requires exit 0 and every selected case to pass.
Unknown, malformed, missing, skipped, crashing, wrong-case, wrong-assertion, or unrelated-error results fail qualification.
A nonzero exit or a log substring cannot substitute for this report.

Final one-shot Vitest and lint execute through the existing fixed operations.
The controlled final Vitest report must contain executed passing tests, including the draft test file.
Empty and skipped final results fail even with exit 0.
Lint must pass against the same captured draft.
These final commands still use synthetic distributions in tests.

The reporter's legacy `onFinished` shape has controlled coverage only.
Its real version compatibility, test discovery, configuration behavior, and serialization remain unverified.
The owner gate prevents that uncertainty from granting readiness.
There is no alternate faux checker in the owner path.

## Source, scope, and patch

The base comes from the retained private Git object store and the exact admitted commit.
Trusted Git plumbing verifies object identities and the saved source manifest.
It never reads the owner's current checkout or resolves a mutable branch for qualification.
A regression advances the disposable owner's `main` before qualification and still verifies the recorded base.

The draft snapshot includes all owned source files, including normally tool-excluded configuration files.
Native `.git` metadata is excluded.
A source `node_modules` directory or unsafe filesystem entry blocks complete capture rather than silently disappearing.
Checks still receive the existing filtered source view, without credentials or private metadata.

`qualification/patch.json` is a complete reversible replacement patch, not a tracked-files-only Git diff.
Its format is `complete-file-replacements-base64`.
Each changed path retains before/after bytes, hashes, sizes, and executable bits.
A null side means an addition or deletion.
The patch also records before/after directory inventories and full source digests.
The snapshots retain unchanged files.
No stage, commit, install, fetch, or draft repair occurs.

The supported scope is exactly:

- `convex/syncHelpers.ts`
- `lib/__tests__/normalize-address.test.ts`

Both files must change.
Deletion, executable-mode changes, unrelated paths, hidden configuration edits, and unrelated directory changes block qualification.
A conservative lexical check also requires unchanged bytes outside the `normalizeAddress` function body.
It supports the narrow function syntax exercised here, quoted strings, comments, and regex literals in `.replace` calls.
Templates and ambiguous syntax block with `QUALIFICATION_SCOPE_UNSUPPORTED`.
This is not a TypeScript parser or a proof that every possible address preserves semantics.
The selected cases establish only their stated behavior.

Capture failures never label an incomplete patch complete.
The original worktree and partial qualification artifacts remain private after failure or cancellation.
A completed capture describes its capture-time bytes, not an indefinitely current draft.
Later changes invalidate that evidence.

## Containment extension

`createContainedExecution` gains one optional trusted argument, `verificationSource`.
`src/qualification-source.mjs` issues that process-local opaque capability after validating retained workspace and capture identities.
The capability selects only the predetermined base or draft snapshot under this run's qualification directory.
A fabricated JSON object cannot select a source.

The original dependency handle still mounts against its original workspace identity.
No forged workspace intent, retargeted handle, alternate dependency root, or weaker dependency check is used.
Both source snapshots derive from validated retained evidence.
Every mount rechecks the original bundle, dependency inputs, and toolchain.

The existing runner owns all namespace startup, process lifetime, resource limits, output bounds, logs, and drainage.
There is no second runner.
Checks remain sequential with the accepted worker limits.
The private source helper preserves executable bits when copying snapshots.
Base materialization follows workspace preparation's owner-executable convention.

Qualification reserves one original tool round before trusted capture.
It reserves six more original rounds before dispatching any verification check.
Those cover two boundary probes, two selected regressions, final Vitest, and final lint.
Failed or unused reservations do not refund the original allowance.
Qualification has no model role and makes no model request.

## Passive inspection and freshness

```js
const evidence = await qualifier.inspect({ directory, run, dependencyRun });
```

Inspection starts no process, check, model, scheduler, credential discovery, repair, or replay.
It never calls `verifyDraft` or issues a source capability.
It returns bounded status, artifact references, and check-stage references, without transcript pagination.
Executor transcript inspection remains the parent's responsibility.

Inspection validates retained source inventories, patch bytes, selection files, logs, start/result/launch identities, dependencies, toolchain, and implementation fingerprints.
Historical admission baselines must match their retained snapshots and original manifest.
Their JSON passed flags alone do not qualify the draft.
Qualified evidence requires the complete ordered check sequence and the supported selected reports.

Stale evidence returns `blocked / QUALIFICATION_INVALIDATED` with `artifactStatus: invalid` and the recorded historical status.
A missing terminal verdict remains interrupted.
Neither lookup changes the retained record.

## Controlled tests and limits

Tests cross the existing factory application, execution, and preparation seams.
Actual installed Bun creates disposable bundles through the existing preparation implementation.
Actual contained checks execute real disposable source changes.
The fixture adapter supplies only unfinished #8 handoff issuance and controlled draft generation.
It does not substitute source results, dependency handles, check results, or OS containment.
The application retains its existing admission-only outcome because parent composition is not implemented here.

Coverage includes:

- Passing independent regression evidence, new-file patch capture, and unchanged/no-change rejection.
- Unrelated files, changes outside the helper body, deletion, executable modes, and hidden configuration edits.
- Fabricated model/JSON success and incomplete executor outcomes.
- Missing dependencies, crashes, malformed output, wrong cases/assertions, skipped tests, and unrelated errors.
- Failed final checks and empty/skipped final Vitest reports.
- Source, patch, selected-test, check-log, toolchain, profile, and retained-new-file invalidation.
- An edit after final lint, insufficient original tool rounds, stop, deadline, and failed error reporting.
- Actual process death followed by passive inspection outside a resource scope, without callback invocation or replay.
- Actual namespace signal refusal plus manager refusal, combined with failed qualification error reporting.

The drain-failure test confirms repeated close rejection, interrupted application status, active-run exclusion, and backend ownership retention.
Its exact-owned harness then drains the intentionally surviving namespace before removing fixtures.
This is fault-injected evidence, not a claim about natural manager-outage recovery.
Existing host/kernel, simultaneous owner/launcher death, and manager-loss recovery limits remain unchanged.

## Verification record

All commands use Node 24.21.0 and existing dependencies.
The temporary factory `node_modules` symlink is removed before commit.
The test harness records exact scopes through `FACTORY_TEST_SCOPE_AUDIT`.
No broad process kill or root-cgroup read is used.

Evidence is under `/tmp/factory-ticket09-evidence/`:

- `01-red.log`: initial missing-module failure.
- `02-green.log`: first passing retained-base/draft qualification.
- `03-focused.log`: 26 controlled qualification cases passed.
- `04-drain.log`: qualification drainage/reporting fence passed.
- `05-scope-red.log` and `06-scope-green.log`: unrelated changes in the helper file reproduced, then rejected.
- `07-additional.log`: nine additional cases passed.
- `08-full-suite.log`: intermediate full suite passed 259/259, without skips or exclusions.
- `09-mode-red.log` and `10-mode-green.log`: executable base convention reproduced, then corrected.
- `11-crash-inspect.log`: process-death/passive-inspection case passed.

Final validation passed under Node 24.21.0:

- `npm test`: **261/261 passed**, including all 223 baseline tests and 38 qualification tests. No skips or exclusions.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:ui`: **1/1 passed**, without installation.
- Final retained qualification selection: **2/2 passed**.
- JavaScript syntax checks and `git diff --check` passed.
- Package files, dependency graph, runtime pins, shared fixtures, and parent-owned files are unchanged.
- Separate audit: **331/331 recorded scopes inactive**, with empty cgroups.

Final logs are `12-full-suite-final.log`, `13-browser-final.log`, `14-retained-final.log`, and `16-syntax.log`.
The separate audit is `15-scope-audit.json`.
The scope journals include watchdog, crash, and injected drainage-failure cases.

`final/owner-advance.json` indexes retained passing controlled evidence against a changed owner branch.
`final/green.json` indexes the passing checks and a deliberate later source edit that invalidates inspection.
Earlier retained evidence predates implementation changes and must not establish current freshness.
All associated scopes have stopped. The indexed artifacts remain private for explicit owner cleanup.

Documentation uses the strict technical-prose rules. Its local style check reports zero banned-word hits.

## Remaining acceptance gates

1. Accept ticket #8 independently.
2. Bind this callback to #8's actual opaque handoff verifier under the same live owner.
3. Add parent application/CLI persistence, exports, stop/close composition, and work-item inspection.
4. Test executor-produced drafts, new files, stale evidence, cancellation, and crash/reopen through that combined path.
5. Verify actual supported Vitest/ESLint distributions and report semantics before enabling owner qualification.
6. Review the narrow selection, supported helper syntax, dependency profile, and real repository compatibility under separate authorization.
7. Run parent full verification and independent review before accepting ticket #9.

No controlled fixture is real Vanguard proof.
Readiness would still grant neither Proposal Approval nor permission to publish.
