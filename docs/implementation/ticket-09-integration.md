# Ticket #9 integration checkpoint

## Status

The owner accepted this local controlled #9 implementation checkpoint on 2026-11-06, not the live owner path or Phase 1 completion.
Frozen `9c44363` passed the complete 405-test suite and the existing 1-test browser regression. Independent Claude Code Opus 5.5 reviews and follow-up reviews have returned. The later runtime corrections passed targeted public-interface, application/CLI, composition, and qualifier rechecks at `31f5b9a`. This is not an entire-current-suite result. The owner explicitly deferred positive owner-readiness coverage to separately authorized #10 work.
No production-model request, credential read, Vanguard execution, download, push, tracker write, service, or publication was performed by this integration batch.
The real owner/toolchain/provider path and ticket #10 still require separate authorization and acceptance.

Base: `bc06be0`, the accepted shared-quality checkpoint. The earlier qualification modules were cherry-picked through `62a9720` for integration, not accepted by that act.
The parallel implementation commits were C `0b9e1cc` → `82aa3d9`, D `37f9656` → `27662f2`, B `db3cabd` → `a958a4e`, and A `55dc285` → `df781ca`.
Parent corrections and process tests supplement those streams. Their isolated reports are not combined acceptance.

## Owner acceptance and next authority

After the recorded verification and independent reviews, the owner approved option B: accept only the controlled #9 implementation checkpoint and defer positive owner-readiness proof, including stale-evidence downgrade, to #10. This resolves SP-S1 as an explicit coverage deferral, not a passing owner-path test. No data-only test seam, fabricated qualified receipt, or new runtime authority was added.
The same approval permits a bounded read-only Vanguard compatibility preflight: selected helper and relevant tests, manifests/lockfiles, and tracked test/lint configuration. It does not permit target-code execution, credentials or `.env` access, package acquisition/installation, production-model calls, changes to Vanguard, tracker writes, or publication. The local engineering checkpoint is not domain Approval for a Proposal.
Real local-main source admission, contained baseline/toolchain checks, model acceptance, positive owner readiness/invalidation, and the actual maintenance demonstration remain later gates with separately authorized operations.

## Completed read-only #10 compatibility preflight

Two independent Claude Code Opus 5.5 research streams inspected factory source at `60cc8a4` and private Vanguard captures from `2026-11-06T16:27:13Z`. They produced the [source qualification note](ticket-10-source-preflight.md) and [dependency/toolchain note](ticket-10-toolchain-preflight.md). Both completed with no pending child work. These are primary-source research notes, not fresh Standards/Spec reviews or runtime results.

The parent captured 21 selected files, including 13 indexed tests. All captured bytes matched their index blob IDs, and a later byte recheck confirmed the selected working files unchanged. Only the Git index was parsed as metadata: no target Git command, HEAD/ref, Git config, hooks, credentials, or `.env` was read. This does not establish a committed local-main manifest, repository cleanliness, untracked-test absence, or remote freshness. Capture manifest and analysis receipts are under `/tmp/factory-t10-readonly-preflight-4A1hwC/`, `/tmp/t10-streamA-receipts-U7Qjij/`, and `/tmp/t10-streamB-receipts-S3MEiP/`.

The captured helper does not fit the current nullable-parameter/body grammar. The captured dependency inputs also fail current registry and offline predicates: lock version, metadata, names/versions/ranges, ordinary-edge completeness, and vendor-archive requirements. These are source-established incompatibilities, not observed command failures. The five oracle outputs were traced by hand, not reproduced through the real exported helper.

Bun and `bun.lock` remain the accepted authority under Q18; differing npm resolutions do not reopen that decision. Parent integration also corrected the proposed timing: current admission smokes the model before baseline checks, so a pre-model source gate must precede that smoke. No baseline-only CLI operation or revised dependency policy was implemented.

This completes the authorized inspection. A bounded factory compatibility change and controlled tests need new authorization. Real source admission, package acquisition/preparation, Vanguard execution, production-model calls, owner readiness/invalidation, and #10 acceptance remain separate gates. No runtime, test, pin, target lockfile, or factory authority changed during this preflight.

## Implemented path

The existing `serve --execute-agent` CLI selects `createQualifiedRepositoryExecution`, exported through `src/execution.mjs`.
The module-only `createRepositoryExecution` API remains available and does not silently opt in.
The application persists a pending qualification before dispatch only for the composed adapter's explicit `qualifiesDrafts: true` capability.
No execution-mode flag, model route, runtime reviewer, Approval workflow, storage schema, or scheduler was added.

Only a real `draft-produced` executor outcome reaches qualification. The wrapper obtains the live opaque executor handoff and binds the real verifier in-process; saved JSON and model claims cannot supply authority.
The qualifier uses the original explicit dependency run, budget, signal, source, and owner. The executor stays live until qualifier drainage finishes.
The retained candidate test bytes must fail the intended assertion on the recorded base and pass on the draft. An independent oracle, full final suite, lint, source/profile freshness, and complete new-file patch supplement that evidence.

After confirmed drainage, passive evidence revalidation, and final original-deadline checks, the application can persist one stable project/run-scoped Work item.
It references the admitted task/evidence, actual plan and transcript, complete private patch/new files, checks, usage, and outcome.
Controlled evidence never sets readiness true. Conditional owner readiness is not live acceptance or Approval.
Lists show unverified summaries; per-run online/offline inspection revalidates current evidence without execution or record repair.
A crash before application finalization remains interrupted, even with a saved qualified artifact. No inspection-created Work item, replay, resume, or budget reset occurs.

See the [composition](qualified-execution.md), [application](qualification-application.md), [baseline correction](vitest-baseline-correction.md), and [shared contract](executor-qualification-contract.md).

## Corrections and adversarial dispositions

- **Baseline argv:** execute and bind `vitest run --maxWorkers=2 --no-file-parallelism`, not unsupported `--minWorkers=1`. The controlled executable parses options; it is not the real Vitest package.
- **Policy profile:** permit and require exactly `../docs/agents/change-quality.md` beside supported fixed module names. Other parent-relative keys, missing modules, and changed policy/code fail closed.
- **Implementation binding:** composed profiles include the wrapper, qualifier modules, application/Work item projection, execution/storage, workspace/Git, and the previously omitted containment lifetime/entry/host/test-profile modules. Legacy profiles exclude these conditional additions. This is a fixed reviewed set, not a claim to hash every possible transitive dependency.
- **Assertion mutation:** replace the lexical helper check with a complete conservative allowlist parser. The oracle also checks primitive type and strict equality. Mutating `Object.is` or using unsupported helper constructs blocks.
- **Parser correction:** parent regressions proved that U+2028/U+2029 line-comment terminators hid a global assignment from the new parser. Both qualified before the correction. The parser now recognizes all ECMAScript line terminators; CR is covered too. Regex escape handling rejects escaped line terminators.
- **Accounting:** after confirmed drainage, settle only provably never-dispatched reservations with bounded evidence. Keep them counted, with no refund. Entered operations without receipts and failed drainage remain uncertain.
- **Reporting versus drainage:** qualifier reporting errors remain on `finished`; `close`/`cancel` confirm drainage. Preserve `QUALIFICATION_PERSIST_FAILED` even when the failing callback could not save a verdict. True drainage failures remain sticky and fence ownership. An unexpected cleanup rejection also fences ownership instead of being ignored for an unfamiliar error code.
- **Stop/deadline:** cancellation during capture reports the actual stop/deadline cause. Parent tests caught deadline expiry after execution closed still creating a Work item. The timer now remains active through finalization, with clock checks before and after revalidation. A second regression caught cancellation requested during finalization not being joined. Ownership and Work item persistence now wait for that late request too.
- **Passive evidence:** a qualified verdict without descriptor, capture, runtime, implementation, and all ten stages is invalid. Run-level interruption, stop, and failure outrank saved qualified evidence.
- **Report pool:** qualification argv pins forks; config, reporter, and report parser validate the resolved pool and reject custom runners. This precaution is not an end-to-end proof against every report forgery.

## Executed parent evidence

Evidence directory: `/tmp/factory-ticket09-integration-parent/`.
These are controlled transport/package/OS fixtures, not production runner or model evidence.

- `owner-cli-red.log` → `owner-cli-green.log`: existing owner CLI mode failed before application opt-in, then initialized the pending owner qualification. No model call occurred.
- `composed-green-red.log`: actual combined application/CLI success initially blocked with `QUALIFICATION_INVALIDATED`; that log alone does not identify the invalidated input. After B integration, `composed-pre-finalization-fix.log` passed the positive path and reproduced the deadline and persistence-code defects.
- `combined.log`: 11/11 application/CLI cases passed after those fixes: actual executor-produced draft/test/patch, one Work item, passive reconnect and late source invalidation; tautology and final lint rejection with a later explicit start; no-change/refusal; stop during qualification/finalization; deadline after execution close; reporting failure; actual process death during a contained check and after the qualified projection.
- `parser-behavioral-red.log` → `parser-green.log`: both Unicode comment cases genuinely qualified before correction, then blocked. The earlier `parser-red.log` hit SQLite disk-I/O errors and is not behavioral red evidence.
- `profile-red.log` → `profile-green.log`: edits to the disposable Work item projection and containment-entry modules incorrectly remained current without the supplemental hashes, then invalidated after binding them. The missing-module case in the first green run failed in the test client before it reached the backend; that fixture setup needed correction.
- `compat.log`: eight qualification scenarios passed, including additional module keys, missing modules, traversal/missing-policy rejection, three comment terminators, and fork-pool override. The admission-profile name pattern selected no case; its file-level TAP entry is not a tested admission-profile behavior.
- `composition-parent.log`: 26/26, comprising 17 application refusals/lifecycle cases and nine real composition cases, including the original tool allowance and sticky namespace drain/reporting failure.
- `cancel-red.log` → `postjoin.log`: late cancellation incorrectly finalized before its promise settled, then remained active and rejected a second start until cancellation joined. The post-correction selection passed 5/5, including missing-module admission, stop-finalization, deadline-finalization, and persistence-failure paths. `admission-profile.log` passed the actual profile case; `pool-pin.log` passed the positive fork-pool override case.
- `unknown-cleanup-red.log` → `unknown-cleanup-green.log`: an unexpected qualifier-close rejection in a disposable factory copy was incorrectly ignored and created a Work item. After correction, it fences the backend and creates none, while an ordinary reporting failure remains an unfenced failed outcome. Both cases passed, as did the separate sticky namespace drain/reporting recheck (`drain-recheck.log`).

Relevant changes make affected earlier coverage stale. The complete suite below verifies `9c44363`, not the later runtime corrections. Focused tests and the later 51-case public-interface recheck did not automatically carry the full result forward. The separate current-source recheck below now covers the changed behavior and actual composition without claiming a new entire-suite result.
Independent Standards, Spec, and safety coverage must distinguish examined evidence from missing real-runner/owner coverage.

## Completed frozen verification

The sole complete-verification owner tested `9c44363bb5d0ebb126bef4527cedf112d34e1525` against base `bc06be0`. Its final continuation completed with no pending child work. The parent read the actual exit records and full logs, rather than treating the earlier background-start summary as completion.

- `npm test` ran once, unchanged and serial, from `2026-11-06T07:19:09-05:00` to `2026-11-06T08:06:54-05:00`. It exited **0**, with **405 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**. These totals come from Node's default spec reporter, not TAP lines. The log contains no reported quota or SQLite I/O failure.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:ui` ran once and exited **0**, with **1 passed, 0 failed, 0 skipped**. This is the existing Phase 0 polling regression, not a #9 UI.
- The verifier reported syntax checks for 123 tracked JavaScript files, clean range/working-tree whitespace, and 91 local links across 35 Markdown files. Dependency/pin diffs against `bc06be0` were empty. Prose scores are diagnostic measurements, not content acceptance: strict policy scores were 0–1.47, changed-document scores 0.75–3.02, with zero banned-word hits.
- The child audit and the parent's independent audit each found **267 unique recorded scopes**, all inactive and empty, with no survivors or remaining processes. These are the same scopes checked twice, not 534 scopes. No cleanup signals or root-cgroup reads were needed.
- The parent confirmed the frozen checkout remained clean at `9c44363`, its own temporary dependency link was absent, and the parent's dependency directory remained present. The report's claim that the parent checkout was also at `9c44363` was stale metadata: the parent was at `4351b10`. The harness was byte-identical in both checkouts, SHA256 `bd183bbd3e23ffa1af985d8e6d65c83861c8b822a6a9f7b8d2334e78b450a86c`, so the audit used unchanged code.

Primary evidence: `/tmp/factory-t09-final-verify-LQSVjt/`, including `full-test.log`, `full-start.txt`, `full-exit.txt`, `ui-test.log`, `ui-exit.txt`, the journal/audit, and static-check files. Parent confirmation is in `final-review-corrections/frozen-full-parent-scope-audit.json` and `final-review-corrections/frozen-full-checkout-audit.log` under the parent evidence directory.
The verifier did not independently measure filesystem fixture-root cleanup. Stable `/tmp` usage and disabled retention flags do not prove that every temporary root was removed. Scope drainage is the separately audited claim.
No failure, exclusion, rerun, timeout increase, installation, or production operation is hidden in these totals. Controlled synthetic reporter/package fixtures and finite address examples remain the tested scope. This result is not #9 acceptance, live owner/toolchain/provider acceptance, #10, Phase 1 completion, or permission to publish.

## Completed changed-runtime verification

A fresh sole verification owner tested `31f5b9a496fa35808f5b13f58c6ef6dde0463bbb`. Runtime and test files were byte-identical to independently reviewed `9d04c8f`. Its continuation finished with no pending child work. The parent read the actual runner, four command exit records, and complete logs.

| Selection | Exit | Node spec-reporter result |
| --- | --- | --- |
| All factory, recovery, and qualification-application cases | 0 | 51/51 passed |
| All qualification application/private-socket/CLI integration scenarios | 0 | 16/16 passed |
| All composed execution scenarios and passive construction/recovery case | 0 | 9/9 passed |
| Explicit qualifier lifetime, original-budget, reporting, and pool selection | 0 | 12/12 passed |

Each command ran once, serially and in order, with zero failed, cancelled, skipped, or todo cases. The fourth command deliberately selected 12 qualifier scenarios and excluded the others. Their exact anchored pattern is retained in `cmd4-command.txt` and `run.sh`. No failure, quota error, SQLite I/O error, altered watchdog, retrying test command, or stand-in is hidden in these results.
These selections are not the entire current suite. Do not add them to the older 405-test count or claim that the full current suite or all qualifier scenarios were rerun. The browser was not rerun. Its existing 1/1 result remains at `9c44363`.

The child audit and the parent's independent audit each confirmed the same **37 recorded scopes** inactive and empty, with no survivors or remaining processes. The parent also checked the clean frozen checkout, removed own dependency link, intact parent dependencies, and matching harness bytes. No root-cgroup reads or broad cleanup were needed. Filesystem fixture-root deletion was not independently measured.
The child disclosed one evidence-mode correction: `runner-exit.txt` briefly had mode 0644 inside the private 0700 directory, then was corrected to 0600. The parent confirmed the final directory and marker modes. No runtime permission or containment change followed.

Primary evidence: `/tmp/factory-t09-current-runtime-verify-qcpGzy/`, including `summary.md`, `run.sh`, each `cmdN-command.txt`, `cmdN-start.txt`, `cmdN-exit.txt`, `cmdN.log`, `runner-exit.txt`, scope journal/audit, and static outputs. Parent confirmation is in `final-review-corrections/current-runtime-parent-scope-audit.json` and `final-review-corrections/current-runtime-parent-checkout-audit.log` under the parent evidence directory.
The verifier reported 123 syntax checks with no failures, clean range/working-tree whitespace, empty dependency/pin diffs, all six source/test hashes matching, and 94 local links across 35 Markdown files with no errors. Its changed-document prose scores were 0.80–2.15, with no banned-word hits. These static measurements are not content or runtime acceptance.

This closes the selected changed-runtime verification gap. The later owner decision above explicitly defers SP-S1's positive coverage rather than claiming it was tested. The complete owner readiness path, actual Vitest/ESLint distributions, real base grammar/toolchain, provider credentials/caps/billing, Vanguard maintenance, #10, and Phase 1 completion remain unverified or separately authorized. The test owner did not perform Standards or Spec review. The documentation-only update recording these results changes no runtime or test file.

## Evidence-audit dispositions

The independent read-only evidence/operator audit examined `9c44363` against `bc06be0`. Its report is `/tmp/factory-ticket09-opus-evidence-audit/report.md`. It did not run tests or establish full-suite acceptance.

- **EA1, medium:** removed the stale plan paragraph claiming the unsupported baseline option remains unresolved. The preceding current integration description remains authoritative.
- **EA2, medium:** corrected the resume refusal and recovery guidance. Inspect first; retirement or replacement needs trusted quiescence evidence. The current composed adapter reports quiescence unconfirmed, so no successful crashed composed-run replacement is claimed. A focused application regression first failed on the old unconditional replacement advice, then checked the corrected refusal without changing recovery gates.
- **EA3, low:** marked the earlier module record historical, with a dated link to the current integration status. Its past failures and limitations remain retained.
- **EA4, low:** described the initial log's actual invalidation code instead of claiming that the log itself identifies the policy-key cause.
- **EA5, low advisory:** documented that Work item `status` is the historical creation outcome. Current readiness requires the projected readiness/freshness and validated evidence, not that status alone. No new positive owner-path claim or test authority was introduced.

The full verifier and four completed read-only reviews targeted frozen `9c44363`. The evidence-audit follow-up `ffd5566` changed documentation and one diagnostic string, not recovery or execution gates.
Its checks remain under `/tmp/factory-ticket09-integration-parent/evidence-audit-corrections/`. The diagnostic regression failed before the wording correction, then all 17 application cases passed with no skips. Syntax, whitespace, local links, and prose checks passed. The one recorded process-death scope was inactive and empty.
The later runtime corrections below have their own evidence boundary.
The audit could not attribute three checks to separate scope journals. The parent used shared per-stream journals: `postjoin-scopes.jsonl` covers the five post-join cases plus admission-profile and pool-pin; `unknown-cleanup-scopes.jsonl` covers its red case, two corrected cases, and drain-recheck. Attribution relies on recorded invocation order, not a scenario field in each journal row. Their aggregate audits confirm every recorded unit inactive and empty.

## Frozen final-review dispositions

The remaining read-only reports are `/tmp/factory-ticket09-standards-opus/report.md`, `/tmp/factory-ticket09-spec-review-opus/report.md`, and `/tmp/factory-ticket09-opus-safety-review/report.md`. They examined frozen `9c44363` against `bc06be0`, not the subsequent corrections. Standards reported one file-free Node descriptor probe. Spec and lifecycle ran no checks. None verified the full suite or accepted ticket #9.

### Standards

- **ST-S1, low, corrected:** qualification used wall-clock time against an application-clock deadline. The trusted budget now exposes its remaining original duration. A public application test with clock `1000` reached a controlled handoff refusal after the correction instead of falsely stopping during capture. This supplies no qualified authority or owner-readiness proof.
- **ST-S2, advisory, deferred:** stage lists, limit classifications, and report caps have some duplication. Their current values agree. Consolidation is not required to correct the observed behavior. The standalone sandbox reporter also needs its own cap. This remains a maintainability judgment, not a verified defect.
- **ST-S3, advisory, deferred:** the admission and qualification hash lists serve different scopes and remain fixed reviewed sets. No claim covers every transitive module or automatic discovery of future files.
- **ST-S4, advisory, corrected:** qualification receipt handling now uses explicit control flow and an early return instead of an empty side-effecting conditional branch.
- **ST-S5, low advisory, corrected in the public projection:** rejected captures now expose at most 32 change summaries, their total count, and a truncation flag. Full private artifacts and saved inventories remain complete. Durable inventory storage remains unchanged.

### Spec

- **SP-S1, medium, explicitly deferred by owner:** controlled runs must never become review-ready. Positive owner readiness and its stale-evidence downgrade remain unverified. The owner chose option B on 2026-11-06, accepting only the controlled checkpoint and deferring that positive coverage to separately authorized #10 work. No fabricated qualified receipt supplies readiness proof.
- **SP-S2, medium, unresolved real-target compatibility:** the real recorded base might not fit the helper grammar or the retained `baseActual` examples. The preconditions below are explicit. The completed read-only #10 preflight found grammar incompatibility for the captured helper and dependency-profile incompatibilities. No executed recorded-local-main compatibility evidence exists yet. Inspection did not authorize a maintenance attempt.
- **SP-S3, low, deferred:** a mismatched explicit write scope still fails closed during qualification, not before the executor spends its allowance. Start-time rejection would improve feedback but is not implemented by this correction. Only the exact selected two-file scope is eligible.
- **SP-S4, low, corrected at `ffd5566`:** the stale baseline-gap paragraph was removed and the old module record was marked historical. The frozen review did not cover that later documentation.
- **SP-S5, advisory, retained:** the non-draft guard remains useful for standalone module callers, even though composition filters those outcomes earlier. A comment describes that distinction. The existing `incomplete` module case is relevant coverage, not composed-path success.

### Lifecycle and trust boundaries

- **LC-A1, advisory, hypothesis not established:** the existing comment says worker threads share the descriptor, not that every fork configuration prevents inheritance. Standards reported `EBADF` for a plain Node fork, contradicting the unexecuted blanket inheritance hypothesis. Actual Vitest worker spawning remains unverified. The forks pin remains a precaution, not universal report-forgery protection. The baseline record now names the plain-Node probe rather than claiming that every fork configuration prevents descriptor access.
- **LC-A2, advisory, deferred:** the helper parser can accept a line terminator after `return`, including inside a block comment. JavaScript automatic semicolon insertion then returns `undefined`. The independent oracle refuses the result. This is a refusal-only parser divergence, not supported semantics or a proven qualification bypass. A future correction must retain behavioral evidence through the agreed execution seam.
- **LC-A3, advisory, deferred:** admission currently supplies and binds the composed implementation set. Duplicating that requirement inside the qualifier is optional hardening; no missing-set route was established.
- **LC-A4, real-target gap:** the final suite rejects skipped/todo cases. Real-suite compatibility remains a precondition below.
- **LC-A5, advisory, documented:** unfamiliar *close* rejection fences ownership. The application records a late cancellation rejection as `cancellationError` after close already confirmed drainage. This does not claim that every cancel error creates a new drainage fence. The review found no real post-close drain regression.
- **LC-A6:** the public change-list cap is the same correction as ST-S5. It does not truncate private patch evidence.

### Correction evidence and revision boundary

`/tmp/factory-ticket09-integration-parent/final-review-corrections/` retains the checks. `projection-red.log` reproduced all 65 summaries escaping the public projection. `clock-behavioral-red.log` reproduced false `RUN_STOPPING` with the original wall-clock timer. `clock-green.log` reached the intended controlled refusal after correction.
The first clock test used a stale pre-dispatch executor projection. It failed before its handoff boundary even after the timer change. `clock-red.log`, the 18/19 `application-final-green.log`, and `clock-fixture-diagnosis.log` retain that fixture problem. They are not the final clock regression proof.
`public-seams-green.log` passed **51/51** factory, qualification-application, and recovery cases, with no skips. The scope audit covers all three recorded process-death units from the light application rechecks. Each was inactive and empty.
At that correction checkpoint the frozen full suite and browser result were still pending. Their completed results above did not replace the separate changed-runtime composed-path recheck, which has now also completed. No heavy package fixture ran alongside the full verifier for these corrections.

### Follow-up Opus rechecks

Fresh independent Standards and Spec rechecks examined `9c44363` → `9d04c8f`, including `ffd5566`. Their reports are `/tmp/factory-ticket09-followup-standards-recheck-opus/report.md` and `/tmp/factory-ticket09-followup-spec-recheck-opus/report.md`.
Both found no material new implementation defect and confirmed the six source/test files match the retained target hashes. They ran no runtime tests. Standards inspected the diagnostic and correction logs. Spec did not inspect the earlier diagnostic or static-check logs. Neither examined a completed full suite or a composed-path recheck at the changed source.

The Spec recheck found one low documentation gap: this batch now also marks `ticket-09-parent-review.md` historical, preserving its earlier failures. It also clarified that the qualifier uses the application's remaining duration with global scheduling. The factory's own scheduler remains authoritative through its abort signal.
The malformed-change-list summary advisory remains open: a non-array list displays zero summaries while separate inspection evidence reports its validity. No qualified authority follows from that summary. Historical owner Work item status remains a disclosed, untested owner-path advisory.
The projection red predates insertion of the clock test. Its 65-versus-32 assertion was unchanged, but it is not evidence on the byte-for-byte final test file. The final hash manifest identifies the reviewed source, not every earlier red invocation.
These documentation-only follow-ups do not alter the runtime or test files reviewed at `9d04c8f`. Parent static/link/prose checks cover them. The frozen full-verification result is now recorded separately above. The current-source composed-path recheck has now completed separately above. The later owner acceptance above resolves SP-S1 by explicit deferral, not by supplying positive readiness evidence.

## Preconditions before separately authorized #10 work

Before a real maintenance attempt, separately authorize and establish all of the following:

- The actual recorded base helper fits the supported declaration and body grammar, not only the synthetic fixture. Its executed outputs match the selected defect's retained `baseActual` examples. An incompatibility requires a scoped correction or a new task decision before model drafting, not a weakened parser or substituted success.
- The real pinned Vitest/ESLint distributions and dependency preparation work within the unchanged containment, command, worker, deadline, and output limits. Synthetic reporter events and Node fork probes do not establish this.
- The real full suite is compatible with the refusal of skipped/todo or incomplete report cases. Any change to that policy needs an explicit decision. No skip is silently accepted.
- The explicit write scope is exactly `convex/syncHelpers.ts` and `lib/__tests__/normalize-address.test.ts`. Generic start validation does not yet enforce this selected-task pair before execution.
- Positive owner readiness and its invalidation have the coverage chosen for SP-S1. Provider access, credentials, billing/caps, real Vanguard reads/execution, and any downloads still need their own authorization.

This section is a gate and a disclosure, not permission to perform those operations or a new implemented pre-admission command.

## Evidence handling and limits

Exact recorded scopes were audited inactive and empty before temporary fixture cleanup. No broad process-name kill, root-cgroup read, deadline increase, or survivor-hiding rerun was used.
Shared `/tmp` quota exhaustion affected implementation streams and the first parent parser attempt. Passing reruns do not erase those failures.
To relieve quota without deleting other streams' roots, the parent archived seven exact owned, confirmed-drained fixture roots on private disk-backed storage, verified every file byte, type, mode, and link, then removed only those temporary copies.
The archive indices are referenced by `archived-parent-fixtures.json`, `archived-profile-fixtures.json`, and `archived-recheck-fixtures.json` in the parent evidence directory.
These are disposable development-fixture archives, not product backup/restore or relocation acceptance. Their artifacts retain original absolute paths.

The helper checker supports only its documented string-expression language, not arbitrary TypeScript. Finite oracle examples cannot prove general semantics or eliminate all overfitting; source-inspecting candidate tests remain a limitation.
A pre-spawn check rejection without a confirmed non-launch receipt can leave an entered reservation uncertain and the run fenced. The application does not invent reconciliation for it.
Reporter fixtures execute emitted config/reporter code with synthetic framework events. Real Vitest/ESLint distributions, owner readiness, production HTTPS acquisition, provider auth/caps/billing, and a Vanguard maintenance result remain unverified.
Inherited interrupted-executor reconciliation, backup/bundle, relocation, and host/manager-failure limitations remain. A controlled Work item is not the real maintenance demonstration.
