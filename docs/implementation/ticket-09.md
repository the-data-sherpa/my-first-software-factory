# Ticket #9: independent draft qualification module

## Status and scope

This isolated implementation starts from `48c40585972e56bd2bd6fe26d73f488238681ac7`.
It follows the [parallel contract](executor-qualification-contract.md), without importing ticket #8 modules.
The parent must accept #8 before accepting the combined path.
This module does not complete ticket #9 acceptance or the real Vanguard demonstration.

The supplied implementation commit was `15361b393fc64c0a04313f006eb158ff5ac5b039`.
This worktree integrated it as `f03519d` on parent checkpoint `00bd62f`, then corrected the parent findings separately.

Controlled evidence can reach `status: qualified`, but always has `reviewReady: false`.
The correction adds a conditional owner reporting path for Vitest 4.0.17 under Node 24.21.0.
It requires executed runtime probes and all qualification checks against the verified exact dependency inventory and toolchain.
No compatibility boolean, JSON override, or fixture result grants owner readiness.
No real Vitest/ESLint distribution was available in the permitted factory dependencies.
Real-distribution acceptance remains unverified. A separate baseline-command implementation conflict also remains for parent resolution, described below.

No real Vanguard read, credential/configuration read, production-model request, package download, service, or global change occurred.
The correction read only public official Vitest documentation and tagged source pages for API facts.
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

The retained candidate test must also expose the defect against the recorded base and pass against the draft.
`qualification/candidate-base/` contains the complete base snapshot with only the retained candidate test overlaid.
Its other file bytes and modes must match the recorded base. Only required test-parent directories may be added.
The overlay test identity must match the draft inventory, complete patch, and later tested snapshots.
No owner-checkout bytes enter this overlay.

Candidate failures must contain the literal selected defect's actual and expected strings in a structured `AssertionError` from `toBe`.
Every failing candidate case must match an intended defect signature. Unrelated failures cannot accompany the intended failure.
At least one intended failure is required. Corresponding draft cases must retain their IDs and names and pass.
The fixed candidate configuration requires assertions. Empty, skipped, missing-dependency, and crashing tests do not qualify.
A tautology passes on the base, so it cannot establish the required failure.
An additional literal assertion does not invalidate an otherwise valid regression. There is no source-string veto.

The trusted fixed checks are `runner-probe`, `selected-regression`, `candidate-regression`, and `qualification-vitest`.
Only a trusted opaque verification source enables them.
Their argv selects the factory-owned reporter and, for focused checks, configuration and oracle/probe files.
Those files mount read-only outside the repository source and dependency mounts.
Agent-supplied commands, argv, environment, executables, roots, or report objects cannot select them.
The existing `boundary`, `vitest`, and `lint` operations retain their argv and behavior.

The report protocol is `factory-vitest-4.0.17-v2`.
`src/qualification-reporter.mjs` implements the tagged public reporter lifecycle, not the previous legacy `onFinished` shape.
It checks the runtime version, package manifest, Node version, and resolved check settings.
It records run start/end, case ready/result events, module states, diagnostics, assertion errors, and unhandled errors.
The reader requires consistent module/case/run states and matching exit status. Names or exit 1 alone are insufficient.
Retries, repeats, missing execution events, and unknown states cannot qualify.

A fixed runtime probe executes a passing assertion, an intended assertion failure, an empty test, and a skipped test.
The probe must report those four distinct results, including the assertion-requirement failure for the empty test.
The observed Vitest manifest hash must match the already verified dependency inventory.
All subsequent reports must match that runtime evidence. The complete inventory and toolchain remain bound through admission prerequisites.
This is runtime evidence, not a saved compatibility flag.

Final one-shot Vitest uses `qualification-vitest` with the same reporter and the repository's unchanged suite configuration.
The fixed argv disables watch, retries, allowed-only tests, empty-suite success, file parallelism, and result caching.
It limits workers to two and selects `--configLoader=runner` to avoid bundled-config writes beside read-only source files.
Focused configurations put Vite cache data under bounded `/tmp` and require assertions.
The final report must contain executed passing cases, including the same retained candidate IDs and names.
Empty, skipped, renamed, and missing candidate cases fail even with exit 0.
Lint uses the unchanged fixed command against the same captured draft.
These commands still use synthetic distributions in controlled tests. Their results do not attest real package compatibility.

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
The capability selects only the predetermined base, candidate-base, or draft snapshot under this run's qualification directory.
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
It reserves ten more original rounds before dispatching any verification check.
Those cover three boundary probes, one runtime probe, two independent oracle checks, two candidate checks, final Vitest, and final lint.
The final controlled execution fixture consumes 17 of the original 30 rounds, including admission and draft tools.
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

## Supplied implementation verification record

This section records the supplied commit before parent corrections. It does not establish the correction's behavior.

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
5. Resolve the version-aware baseline-command/profile implementation conflict described below. Preserve healthy-baseline gating and existing command compatibility.
6. Verify actual supported Vitest/ESLint distributions, configuration loading, and report semantics under separate live-acceptance authorization.
7. Review the narrow selection, supported helper syntax, dependency profile, and real repository compatibility under that authorization.
8. Run parent full verification and independent review before accepting ticket #9.

No controlled fixture is real Vanguard proof.
Readiness would still grant neither Proposal Approval nor permission to publish.

## Parent correction: retained-test behavior and runtime reporting

### Reproduction and correction

The parent checkpoint is `docs/implementation/ticket-09-parent-review.md`.
The first correction regression changed only the candidate assertion to `expect(1).toBe(1)` through the actual application/execution fixture.
The supplied implementation incorrectly returned `qualified`. The new behavioral assertion failed before implementation changes.
The correction now returns `blocked / REGRESSION_UNVERIFIED` for that same patch.
The independent oracle still fails on the base and passes on the draft, but no longer substitutes for candidate-test evidence.

The retained positive comparison includes the valid regression plus an additional `expect(1).toBe(1)` case.
It returns `qualified / reviewReady: false`, which confirms that source-string rejection did not replace behavioral evidence.
Another positive case advances the disposable owner's `main` before qualification.
Its checks still use the admitted commit's private objects and retained candidate bytes.

The final ordered sequence is:

1. Verify the recorded-base containment boundary.
2. Run the structured runtime probe.
3. Run the independent literal oracle on the base.
4. Verify the candidate-base containment boundary.
5. Run the retained candidate test on the base overlay.
6. Verify the draft containment boundary.
7. Run the independent literal oracle on the draft.
8. Run the identical retained candidate test on the draft.
9. Run the full final suite with the structured reporter.
10. Run final lint.

All rounds are reserved from the original budget before check dispatch. Failed or unused rounds are not refunded.
Checks remain sequential. No new scheduler, callback authority, dependency selection, or model request is introduced.
Stop and deadline checks continue through final persistence and revalidation.
A final projection-write failure records an incomplete failure where possible, rather than leaving a successful qualification.
Drainage failures still override handled errors and failed persistence. Repeated close retains the ownership fence.

### Structured transport and containment

The reporter writes one length-prefixed UTF-8 JSON frame to fd 6.
The reader requires exactly one complete frame with no trailing data.
The payload limit is 256 KiB. Reports, stdout, and stderr share the existing combined 1 MiB command-output cap.
Banners and test logs remain ordinary output. They cannot supply report evidence.

The receipt retains `report.frame`, its hash, byte count, and report binding.
That binding includes the check ID, fixed operation, tested source digest, dependency intent, and emitted adapter digest.
Inspection validates the report file, receipt, launch identities, source snapshot, emitted files, and private projection.
The overlay separately binds the candidate test hash and complete base/draft inventories.
Stale or mismatched evidence invalidates the result without replay.

This uses the existing bwrap launcher and `namespaceLifetime`, including verified namespace startup and all-pipe drainage.
Fd 5 remains namespace information. Fd 6 follows the preparation runner's existing separate-export-channel pattern.
No new launcher, host-private mount, environment override, network access, or credential access was added.
The existing stopped-namespace and failed-manager fault regression exercises this report-enabled path and preserves `DRAIN_FAILED`.

### Public API facts and narrow support

The correction read the following first-party pages. It did not execute fetched source or retrieve package archives.
The tagged source is authoritative for the supported 4.0.17 shape. The unversioned guide supplies context only.
Copies and SHA-256 hashes are under `/tmp/factory-ticket09-corrections/sources/` and `source-sha256.txt`.

- [Official custom reporters guide](https://vitest.dev/advanced/reporters.html): custom reporter interface and warning about report API changes.
- [4.0.17 reporter interface](https://github.com/vitest-dev/vitest/blob/v4.0.17/packages/vitest/src/node/types/reporter.ts): `onInit`, `onTestRunStart`, `onTestRunEnd`, and case execution callbacks.
- [4.0.17 reported tasks](https://github.com/vitest-dev/vitest/blob/v4.0.17/packages/vitest/src/node/reporters/reported-tasks.ts): stable case IDs, `fullName`, module IDs, collections, results, errors, and diagnostics.
- [4.0.17 core](https://github.com/vitest-dev/vitest/blob/v4.0.17/packages/vitest/src/node/core.ts): the runtime's `version` property comes from its package manifest.
- [4.0.17 CLI definitions](https://github.com/vitest-dev/vitest/blob/v4.0.17/packages/vitest/src/node/cli/cli-config.ts): reporter/config selection and the fixed flags used here.
- [4.0.17 config creation](https://github.com/vitest-dev/vitest/blob/v4.0.17/packages/vitest/src/node/create.ts): forwards `configLoader` to Vite. The CLI documents runner loading for Vite 6.1 or later.
- [4.0.17 test runner](https://github.com/vitest-dev/vitest/blob/v4.0.17/packages/vitest/src/runtime/runners/test.ts): `expect.requireAssertions` rejects zero-assertion cases with the checked error message.
- [4.0.17 `toBe`](https://github.com/vitest-dev/vitest/blob/v4.0.17/packages/expect/src/jest-expect.ts): `Object.is` comparison and structured expected/actual assertion values.
- [4.0.17 error processing](https://github.com/vitest-dev/vitest/blob/v4.0.17/packages/utils/src/error.ts): string actual/expected values remain strings during error processing.

Only Node 24.21.0 and Vitest 4.0.17 are accepted by this reporter.
The Vite loader must actually work in the verified exact bundle. A declared version range does not establish support.
Unsupported package versions, loader behavior, event shapes, or runtime probe results block qualification.
The full-suite configuration must work with the fixed flags, read-only mounts, and bounded scratch space.
This is intentionally narrower than general Vitest support.

The retained Vanguard fact sheet reported Vitest 4.0.17 on 2026-11-02.
That historical observation supplied no fresh target access or compatibility evidence.
No real Vitest, ESLint, Vanguard configuration, or owner-profile qualification ran during this correction.
Synthetic framework packages exercise the emitted adapter contract only. They cannot attest owner or Vanguard readiness.

### Remaining implementation conflict outside this slice

The existing admission command still contains `--minWorkers=1`.
The tagged Vitest 4.0.17 CLI definitions do not contain that option.
The correction leaves both baseline commands and the admission execution-profile binding unchanged, as required.
The new qualification commands omit that option, but cannot bypass the required healthy baseline.

The parent must resolve the baseline command/profile combination for the exact supported runtime.
This needs coordinated shared admission/composition work and backward-compatibility tests, not a qualification JSON override.
Until then, do not describe the complete owner path as implemented or ready for live acceptance.
The conditional qualifier path exists, but it does not repair that upstream implementation gap.
Actual #8 handoff composition and final work-item persistence also remain parent implementation work.
Live distribution/configuration acceptance remains a separate, unverified gate after those changes.

### Correction verification and cleanup

The agreed seams remain the factory application and trusted execution/preparation interfaces.
The synthetic runner now imports the actual emitted reporter and config, executes fixture test functions, and delivers framework events.
It no longer writes hard-coded final qualification JSON.
A temporary mutation disabled the reporter's run-end callback. The positive application regression failed with unverified evidence.
Restoring the callback restored the passing result.

Additional cases cover candidate tautologies, unrelated assertions, empty/skipped tests, crashes, missing imports, and mixed empty cases.
They cover valid extra literals, live candidate-byte changes, stale overlay code, stale candidate bytes, and stale reports.
Report cases include ignored reporters, unsupported versions, stdout-only claims, truncated/duplicate frames, overflow, missing events, and inconsistent states.
The runtime probe rejects runners that accept empty tests or execute skipped cases.
Final-suite cases reject missing or renamed candidate cases. All earlier invalid cases remain in the suite.

Evidence is under `/tmp/factory-ticket09-corrections/`:

- `01-tautology-red.log`: the supplied implementation incorrectly qualified the tautological patch.
- `02-candidate-green.log`: the positive and corrected tautology cases passed.
- `03-focused.log`: 17/18 initial focused cases passed. The stale-overlay fixture needed explicit permission to modify its read-only artifact.
- `04-qualification.log`: 62/63 passed. A new green-case assertion read the admission result instead of the qualification result.
- Both fixture issues were corrected without changing limits or excluding cases.
- `05-full-suite.log`: **286/286 passed**, comprising all 223 baseline tests and 63 qualification tests. No skips or exclusions.
- `06-browser.log`: **1/1 passed** with `CHROMIUM_PATH=/usr/bin/chromium` and no installation.
- `07-reporter-mutation-red.log`: disabling the actual emitted reporter callback broke the positive application case.
- `08-retained-green.log`: **3/3 passed** after restoring the reporter.
- `09-scope-audit.json`: a separate audit found **255/255 recorded scopes inactive**, with empty cgroups.
- `10-syntax.log`: JavaScript syntax checks passed. Whitespace checks also passed.

`final/candidate-tautology.json` indexes the rejected complete patch and its actual candidate-base check.
`final/candidate-valid-literal.json` indexes passing controlled evidence with the additional literal assertion.
`final/owner-advance.json` indexes passing controlled evidence against an independently advanced disposable owner branch.
Each retained fixture consumed one controlled model attempt and 17 original tool rounds. No budget was replenished.
The scopes are drained. The indexed private artifacts remain for explicit owner cleanup.

Package files, dependency graph, runtime pins, contract, shared application modules, design documents, glossary, and ADRs are unchanged.
The temporary link to existing factory dependencies was removed before commit.
No parent checkout or other child checkout was modified. No subagent, tracker write, push, real target execution, or production-model request occurred.
