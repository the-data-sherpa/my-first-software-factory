# Ticket #9 integration checkpoint

## Status

This is local controlled implementation, not ticket #9 acceptance or Phase 1 completion.
Final combined verification and fresh independent Claude Code Opus 5.5 review are pending.
No production-model request, credential read, Vanguard execution, download, push, tracker write, service, or publication was performed by this integration batch.
The real owner/toolchain/provider path and ticket #10 still require separate authorization and acceptance.

Base: `bc06be0`, the accepted shared-quality checkpoint. The earlier qualification modules were cherry-picked through `62a9720` for integration, not accepted by that act.
The parallel implementation commits were C `0b9e1cc` → `82aa3d9`, D `37f9656` → `27662f2`, B `db3cabd` → `a958a4e`, and A `55dc285` → `df781ca`.
Parent corrections and process tests supplement those streams. Their isolated reports are not combined acceptance.

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

Relevant changes make earlier coverage stale. The frozen combined suite must re-execute the final source. Focused tests cover the corrected missing-module fixture and actual admission-profile case, but do not replace the full suite.
Independent Standards, Spec, and safety coverage must distinguish examined evidence from missing real-runner/owner coverage.

## Evidence-audit dispositions

The independent read-only evidence/operator audit examined `9c44363` against `bc06be0`. Its report is `/tmp/factory-ticket09-opus-evidence-audit/report.md`. It did not run tests or establish full-suite acceptance.

- **EA1, medium:** removed the stale plan paragraph claiming the unsupported baseline option remains unresolved. The preceding current integration description remains authoritative.
- **EA2, medium:** corrected the resume refusal and recovery guidance. Inspect first; retirement or replacement needs trusted quiescence evidence. The current composed adapter reports quiescence unconfirmed, so no successful crashed composed-run replacement is claimed. A focused application regression first failed on the old unconditional replacement advice, then checked the corrected refusal without changing recovery gates.
- **EA3, low:** marked the earlier module record historical, with a dated link to the current integration status. Its past failures and limitations remain retained.
- **EA4, low:** described the initial log's actual invalidation code instead of claiming that the log itself identifies the policy-key cause.
- **EA5, low advisory:** documented that Work item `status` is the historical creation outcome. Current readiness requires the projected readiness/freshness and validated evidence, not that status alone. No new positive owner-path claim or test authority was introduced.

The full verification and other independent reviews remain targeted at frozen `9c44363`; these follow-up changes alter documentation and one diagnostic string, not recovery or execution gates. Their relevant checks are retained separately under `/tmp/factory-ticket09-integration-parent/evidence-audit-corrections/`: the diagnostic regression failed before the wording correction, then all 17 application cases passed with no skips. Syntax, whitespace, local links, and prose checks passed. The one recorded process-death scope was inactive and empty.
The audit could not attribute three checks to separate scope journals. The parent used shared per-stream journals: `postjoin-scopes.jsonl` covers the five post-join cases plus admission-profile and pool-pin; `unknown-cleanup-scopes.jsonl` covers its red case, two corrected cases, and drain-recheck. Attribution relies on recorded invocation order, not a scenario field in each journal row. Their aggregate audits confirm every recorded unit inactive and empty.

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
