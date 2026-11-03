---
status: accepted
accepted: 2026-11-02
---

# Phase 1 design

The owner confirmed the complete shared Phase 1 design in Q29 on 2026-11-02, including the outcome-first clarification in Q28.
The design interview is complete. The owner later separately authorized ticket implementation. Production-model requests and the actual Vanguard maintenance run remain separate from controlled implementation checks.
The owner defines the desired result and constraints; the factory owns planning and execution. Specialist routing remains a possible technique, not a Phase 1 requirement.
Remaining runtime checks below are implementation gates, not claims of completed verification.
Terms follow [CONTEXT.md](../CONTEXT.md). [ADR 0001](adr/0001-embed-pi-durable.md) supplies the accepted runtime foundation. [ADR 0002](adr/0002-one-factory-many-projects.md) records one factory managing multiple projects. [ADR 0003](adr/0003-contain-repository-tools-in-phase-1.md) requires verified containment before Phase 1 repository tools. [ADR 0004](adr/0004-operator-controlled-recovery.md) requires operator-controlled recovery. [ADR 0005](adr/0005-isolate-execution-stores-per-run.md) isolates durable execution stores per run.

## Scope

Complete one manually triggered maintenance run and retain an inspectable record.
Use pinned `pi-durable` 1.5.0, SQLite, and Pi's `ModelRuntime`.
Phase 1 does not include a web UI, multiple managed projects, publishing, tracker writes, schedules, unattended execution, installed services, or the Phase 2 approval workflow.
The web UI is required in Phase 2. Multi-project management and concurrency remain planned for Phase 4.

## Settled decisions (round 1)

The owner accepted Q1–Q4 on 2026-11-02.

- **Q1: Task selection.** The person supplies one small, bounded maintenance task and its evidence. Defer autonomous task discovery.
- **Q2: Successful output.** Produce at most one work item with the task and evidence, a plan, a local draft change, test results, and an outcome. A saved prompt and answer alone do not satisfy the milestone.
- **Q3: Execution lifetime.** Closing the viewer does not stop an explicitly started run while its backend remains alive. Backend loss preserves the recorded state and makes interruption or recovery visible. No installed service, automatic boot startup, or invisible retry loop. Q22 supplies the recovery policy.
- **Q4: Concurrency.** Allow one active run total. Q7 specifies rejection of a second start request.

These decisions do not authorize overriding a target repository's instructions or changing its existing checkout.

## Settled decisions (round 2)

The owner answered Q5–Q9 on 2026-11-02. The first answer refers to the first question in that round (Q5), not Q1 about human task selection.

- **Q5: First factory's job.** Vanguard replaces Crewroom permanently, not just as a Phase 1 fixture. The owner chose this over the pilot-only recommendation because Crewroom has substantial custom setup. A future version must support simultaneous work across multiple projects. Phase 1 still has one project and one active run total.
- **Q6: Interface and processes.** Use a manually started foreground backend and a separate CLI to start, inspect, and stop runs. No installed service or automatic startup. The web UI is an explicit Phase 2 deliverable, not an abandoned feature.
- **Q7: Second start.** Reject it clearly, identifying the active run and how to inspect it. Do not queue it or execute it later without a new request.
- **Q8: Budget guarantees.** Enforce duration and tool-round limits and label cost as reported, estimated, or unknown. Do not claim a guaranteed monetary ceiling. Q26 supplies the numerical limits.
- **Q9: Factory runtime.** Select Node 24.21.0 as this repository's local runtime. Applying the pin is implementation work. Do not change the global runtime or Vanguard's configuration.

## Settled decisions (round 3)

The owner answered Q10–Q14 on 2026-11-02.

- **Q10: Factory and projects.** One factory manages multiple projects in the future, not one factory per project. Phase 1 is single-project, not a multi-project framework. This overrides the per-project-factory recommendation. Multi-project management and concurrency are currently planned for Phase 4; record project-scoped ownership separately.
- **Q11: Source revision.** Use a recorded local `main` commit for a new factory-owned worktree and branch. This is the owner's Phase 1 exception to Vanguard's documented `dev` base. Leave the existing checkout untouched; do not automatically fetch, pull, or create `dev`. The base is a commit, not a copy of uncommitted working-tree files.
- **Q12: First-task scope.** Choose a small offline-testable logic/test change, with one-shot Vitest and lint as candidate checks. Exclude dependency changes, live-account integrations, authentication/payment behavior, deploy commands, and the Sentry-enabled build from the first milestone. Execution boundaries still need verification.
- **Q13: Initial model.** The owner requested **Sol 6.1** initially, until the web UI, instead of the suggested `local-ai/local-ai-auto` alias. Offline metadata checks found no exact user-declared match and no explicit Pi default selection. The built-in catalog has GPT-6.1 Sol through several providers; Q23 selects `openai/gpt-6.1-sol`. Do not guess or fall back. A bounded no-tool live smoke check remains necessary after final design confirmation and before repository tools.
- **Q14: Incomplete outcomes.** Retain honest no-change, blocked, and failed results, including evidence and any partial draft. Do not manufacture a patch, label incomplete work ready, or count it as the successful Phase 1 demonstration. That demonstration still needs a real draft change and verification evidence.

## Settled decisions (round 4)

The owner accepted Q15–Q18 on 2026-11-02. Earlier overrides remain in force: one factory, Vanguard as the first project, and Sol 6.1 as the requested initial model.

- **Q15: Project-scoped work.** Each run and work item targets one project. Repository access is restricted to that project even when the factory later manages several projects. Phase 1 configures only Vanguard; no cross-project coordination or multi-project admission.
- **Q16: Containment gate.** Verify the actual execution boundary before enabling Phase 1 repository tools. Restrict access to the run's worktree and use limited read/edit tools plus a fixed-command, direct-argv sandboxed check runner. Scrub the environment, hide host-private paths, deny tool network access, and verify parent-death cleanup. The backend retains separate model access. Do not expose unrestricted bash or silently weaken isolation. Minimal scratch probes do not pass this gate.
- **Q17: Private retention.** Keep runtime state, transcripts, patches, check logs, and worktrees outside the public factory repository until explicit owner cleanup. No automatic deletion, publishing, or draft commits in Phase 1. Retain evidence and the local draft across closure or interruption.
- **Q18: Repository tooling.** Use Bun and `bun.lock` for Vanguard, retain npm for the factory, and use plain Git for Phase 1 worktrees rather than installing Worktrunk. Preserve both Vanguard lockfiles. Q20 supplies the dependency-preparation policy; no installations during the interview.

## Settled decisions (round 5)

The owner selected `openai/gpt-6.1-sol` and accepted the other recommendations in Q19–Q23 on 2026-11-02.

- **Q19: Task brief.** Require a short owner-supplied brief with the goal, acceptance criteria, and evidence, as text or a Markdown file. Snapshot the admitted brief in the private run record. Use committed repository paths and pasted context as evidence; URLs are citations, not permission to fetch them automatically.
- **Q20: Dependency preparation.** Require an operator-prepared private dependency bundle matching the recorded source manifest, Bun lockfile, and toolchain. Reuse it read-only. Missing or stale dependencies block agent work and produce explicit preparation instructions. The separate trusted preparation step may fetch locked packages only when the owner invokes it, with scrubbed environment and lifecycle scripts disabled. No agent-triggered installs, copied credentials, or silent lockfile changes. No preparation during the interview; block if the bundle cannot safely support the checks.
- **Q21: First task.** Select address whitespace normalization (A), with focused regression tests, preservation of unit numbers and abbreviation behavior, and no stored-data backfill. The defect still needs executed reproduction after design confirmation.
- **Q22: Stop and recovery.** Stop cancels the model request and contained tools, retains artifacts, and records a terminal stopped result. Graceful backend shutdown does the same. After a crash, inspect passively and show interruption without automatic execution. Explicit resume requires review of partial effects, verified containment, and remaining original limits; it never resets the budget or blindly repeats unsafe effects. If safe resume is unavailable or limits are exhausted, require an explicit new linked run. Inspection and another start must not wake old pending work.
- **Q23: Initial model route.** Select `openai/gpt-6.1-sol` initially, until the web UI. Do not substitute Codex, OpenRouter, or the local auto alias. Credentials and live availability remain unverified; a failed preflight blocks execution rather than causing a fallback. No live inference during the interview.

## Target repository

The factory's initial project is `~/Projects/vanguard`; see the updated [project plan](../README.md#first-factory-repository-maintenance).
Q11 settles the local `main` baseline. Q12 settles the initial task/check scope.
Neither authorizes target-checkout edits during the interview. Q16 settles the required isolation properties, but the actual verification environment remains unvalidated.
Crewroom is no longer the initial implementation target; its checkout-policy conflict is outside the Phase 1 path.

## Verified Vanguard and runtime facts (2026-11-02)

- Read-only inspection found Vanguard clean on `main` at `db42aa6`, with no worktree-specific policy. This is a local snapshot, not a remote freshness guarantee.
- `vanguard/docs/README.md` asks for branches from `dev`, but no local or remote-tracking `dev` ref exists. Q11 records the owner's explicit local-`main` exception for Phase 1.
- `vanguard/package.json` defines one-shot `test:run` and `lint` commands. Its plain `test` command uses watch mode. No Vanguard checks have been executed during this interview.
- Vanguard wraps its Next.js build in Sentry's upload-capable plugin (`next.config.ts`). Do not assume a build is local-only. Verify a no-publication configuration before permitting it.
- Both Bun and npm lockfiles exist. Q18 selects Bun for Vanguard; do not silently regenerate either lockfile.
- The factory's existing Phase 0 unit/integration suite passed 11/11 under installed Node 24.21.0. No dependencies, global settings, or runtime pins changed. This does not verify live inference or Vanguard's own checks.

## Model-selection and first-task facts

Offline metadata discovery loaded no credentials and made no model or network request.
The user-declared model configuration contains only `local-ai/local-ai-auto`; the built-in catalog separately includes GPT-6.1 Sol through several providers.
The inspected Pi settings have no explicit default provider or model. This does not establish which credentials are usable or which route a live Pi session uses.
The owner subsequently selected `openai/gpt-6.1-sol` in Q23. That is a routing decision, not evidence that authentication or live inference works.

Static Vanguard inspection found two plausible first tasks, neither reproduced by executing its code:

- **A: Address whitespace normalization.** In `vanguard/convex/syncHelpers.ts:99–120`, whitespace collapses before punctuation removal. `100 Main Street # 2` and `100 Main Street #2` can therefore normalize differently; removing a final standalone period can also leave trailing whitespace. Proposed scope: final whitespace canonicalization and regression tests, preserving abbreviations and unit numbers, without modifying stored incident data.
- **B: Literal text in templates.** `vanguard/convex/postTemplates.ts:427–490` supplies user text as replacement strings, so JavaScript interprets patterns such as `$$` and `$&`. Proposed scope: pure formatter tests and literal substitution behavior, with no live posting or integration calls.

Q21 selects A; B is not in the first demonstration. These findings are not implementation tickets or permission to modify Vanguard.

## Execution-boundary facts

The [execution findings](phase-1-execution-findings.md) record the scratch probes, public-source citations, remaining unknowns, and a disclosed breach of the loopback-only research restriction.
A plain tool child survived parent SIGKILL. A minimal direct-argv bubblewrap probe enforced selected boundaries, but it did not run Vanguard or its toolchain.
The inspected SDK timeout is not a full-stream deadline, and SDK counters do not provide a cumulative factory-run budget across continuations.
These findings informed Q16's containment gate, Q22's recovery policy, and Q26's numerical limits. They do not validate the actual Vanguard execution profile or authorize implementation.

## Design tree and current frontier

| Branch | Settled decision | Next decision or verification |
| --- | --- | --- |
| Project ownership | One factory; project-scoped runs and work items (Q10, Q15) | Preserve ownership in application records; no multi-project management in Phase 1 |
| Repository and dependencies | Local `main`, plain Git, Bun, operator-prepared private bundle (Q11, Q18, Q20) | Verify frozen dependency preparation, script suppression, and the real toolchain profile |
| Task input | Immutable owner brief; address normalization selected (Q19, Q21) | Capture the exact admitted source and brief without altering the original checkout |
| Models and limits | `openai/gpt-6.1-sol` and numerical profile (Q23, Q26) | Verify cap-compatible authentication, bounded live availability, and actual enforcement |
| Output and retention | Runner-backed readiness, honest incomplete outcomes, private retention (Q14, Q17, Q24) | Capture complete patches and receipts bound to the tested source |
| Tool boundary | Containment before repository tools (Q16) | Validate real mounts, environment, network denial, resource limits, and cleanup before use |
| Stop and recovery | Explicit control and per-run execution stores (Q22, Q25) | Verify cancellation, reconciliation, budget continuity, and no accidental wakeups |
| Concurrency | One active run; reject a second start (Q4, Q7) | Verify admission, idempotency, and single-owner locking |
| Runtime | Node 24.21.0 selected (Q9) | Apply the repository-local pin without changing global settings |
| Outcome-first execution | Minimal bounded proof accepted; no required classifier, specialist team, or role-specific router (Q28) | Judge the result by acceptance evidence, not by completion of an agent workflow |
| Delivery plan | Complete shared design accepted (Q29) | Draft implementation slices when requested; implementation and publication need explicit authorization |

## Settled decisions (round 6)

The owner accepted Q24–Q26 on 2026-11-02.

- **Q24: Completion criteria.** Require a healthy baseline, regression evidence for the selected bug, and passing final Vitest/lint checks before presenting the draft as ready for review. Block before agent work on unrelated baseline failures; do not broaden the task silently. Demonstrate that the regression fails against the recorded base and passes with the draft. Bind check receipts to the tested source/diff, include untracked test files in the retained patch, and require the intended helper/test scope without unrelated changes. Test results come from the runner, not the model's claim. Also verify close/reopen, crash/inspect/explicit-resume, stop, second-start rejection, and failed-preflight behavior. Ready for review is not approval to publish.
- **Q25: Execution-store isolation.** Use one factory-level SQLite record store and a separate durable execution store/session for each run. Only an explicit start or resume enables the selected run's scheduler; inspection stays passive and another run cannot wake it. Keep this behind the factory-owned execution module's interface, with one backend and one factory, not per-project factories. Accept the extra files and reconciliation work: persist admission intent and stable request IDs before enabling execution, then reconcile interrupted or completed receipts after a crash.
- **Q26: Numerical profile.** Adopt the following initial limits for the small first task. Persist counters and deadlines before execution; resumes and retries never replenish them.

### Accepted limit profile

| Control | Accepted Phase 1 value |
| --- | --- |
| Run wall-clock deadline | 20 minutes from admission, including interruption downtime |
| Tool rounds | 30 cumulative per factory run |
| Model attempts | 40 total, including the initial smoke, retries, and resumed requests |
| Full model-request deadline | 180 seconds, covering the complete stream |
| Check-command deadline | 120 seconds |
| Requested output cap | 8,192 tokens per normal request, including reasoning under the documented API contract |
| Reasoning effort | Explicit `low`, not the unsupported `off` setting |
| Automatic retries | Zero provider retries; at most one durable transient retry per generation, within the total attempt budget |
| Automatic extra work | Disable compaction, continuation hooks, queued follow-up execution, and background/deferred responses |
| Backend plus tool descendants | 4 GiB total memory, no swap allowance, 256 tasks including threads |
| Check parallelism | One check at a time; at most two Vitest workers |
| Writable check scratch | 256 MiB size-limited temporary filesystem |
| Check logs | 1 MiB per command; exceeding it stops the check and records a limit failure |
| Input and file-tool bounds | 64 KiB task brief and text writes; 16 KiB per file-read response, with explicit pagination |
| Initial no-tool smoke | One attempt, 60-second full-stream deadline, 1,024 requested output tokens; counts within run limits |

The output-cap requirement needs the API-key path that emits `max_output_tokens`. If the selected authentication path omits or rejects that cap, block preflight; do not switch routes or silently run uncapped. ModelRuntime continues to own credential integration.
Unknown usage consumes the attempt and conservatively reserves its requested output allowance, without presenting the reservation as measured consumption or billed spend. The profile is not a guaranteed monetary ceiling.
For the initial single-run backend, use an explicit foreground transient resource scope only after verifying enforcement. This installs no service or boot startup. If the OS envelope, scratch size, script suppression, or actual toolchain cannot meet the profile, block instead of weakening it. An OOM kill may terminate the backend itself; Q22's interrupted/passive-recovery contract still applies.

These values define required behavior, not tested capabilities, implementation approval, or permission for live inference during the interview.

## Settled clarification: outcome-first execution (Q27–Q28)

The owner raised adaptive complexity assessment and stage-specific specialist agents in Q27, then clarified the objective: dictate outcomes rather than maintain a process.
On 2026-11-02, the owner accepted Q28's minimal outcome-driven baseline.

- The owner supplies the task brief: desired result, acceptance criteria, and evidence. The factory owns the plan and methods within explicit permissions and limits.
- Phase 1 starts with one accountable executor and runner-backed verification. It does not require a complexity classifier, specialist team, or stage-specific model router.
- Judge success by the useful draft and its evidence, not by which roles participated or how many stages completed. Preserve honest blocked and incomplete outcomes.
- Keep safety and recovery controls explicit. Autonomy over methods does not let an agent redefine success, expand the task, grant permissions, expose credentials, or replenish limits.
- Treat specialization and model routing as possible later techniques. Add them only when a concrete task or observed limitation justifies their coordination and configuration costs.

Delivery phases remain capability milestones, not a mandatory agent sequence that the owner must configure for each task.
The original specialist idea remains recorded for later consideration; no fixed role taxonomy, generic dispatcher, extra model route, or additional runtime concurrency is approved for Phase 1.
Any future delegation must retain project-scoped access and cumulative run limits. Different role-specific models before the web UI would require an explicit revision to Q23.
The earlier draft autonomy/timing questions were superseded, not separately accepted.

## Design confirmation (Q29)

The owner confirmed the complete shared design on 2026-11-02. No Phase 1 policy questions remain open.
This accepts the design, not implementation or live inference.
The confirmed public test seams are:

- The factory's application interface for starting, inspecting, stopping, resuming, and explicitly retrying runs, with CLI lifecycle tests across process boundaries.
- The execution module's interface for bounded model requests and contained checks, using controlled providers and OS fixtures rather than private SDK or SQLite assertions.
- Vanguard's exported `normalizeAddress` helper, with independently specified expected outputs and regression evidence against the recorded base and draft.

No Phase 1 product code, runtime pin, dependency bundle, credentials, installed service, or tracker ticket has been created during the interview.
Vanguard checks, selected-model live inference, real sandbox/toolchain behavior, script suppression, and OS limit enforcement remain unverified.
Those are explicit implementation gates: failure blocks work instead of causing a fallback or silent scope expansion.
Keep the existing process-crash evidence distinct from host/power-failure guarantees, which remain outside the evaluated scope.

## Ticket handoff

When ticket planning is requested, draft demoable vertical slices with explicit blocking edges and identify which slices can proceed in parallel.
Review granularity and dependencies with the owner before publishing.
Use GitHub Issues in `the-data-sherpa/my-first-software-factory`, as configured in the [issue-tracker setup](agents/issue-tracker.md), with the [configured triage labels](agents/triage-labels.md).
The owner approved the ten-ticket breakdown. All ten tickets are published with `ready-for-agent` and eleven verified native blocking relationships.
Publication does not start implementation or authorize live inference.

### Published implementation tickets

1. [#1: Start a run and inspect it after reconnecting](https://github.com/the-data-sherpa/my-first-software-factory/issues/1)
2. [#2: Stop and recover runs without restarting their budgets](https://github.com/the-data-sherpa/my-first-software-factory/issues/2)
3. [#3: Exercise bounded file tools and checks inside verified containment](https://github.com/the-data-sherpa/my-first-software-factory/issues/3)
4. [#4: Admit an exact source revision into a private worktree](https://github.com/the-data-sherpa/my-first-software-factory/issues/4)
5. [#5: Preflight the selected model and enforce bounded requests](https://github.com/the-data-sherpa/my-first-software-factory/issues/5)
6. [#6: Prepare and reuse a matching private dependency bundle](https://github.com/the-data-sherpa/my-first-software-factory/issues/6)
7. [#7: Admit agent work only after preflight and healthy baseline checks](https://github.com/the-data-sherpa/my-first-software-factory/issues/7)
8. [#8: Let the executor produce a bounded local draft](https://github.com/the-data-sherpa/my-first-software-factory/issues/8)
9. [#9: Qualify a work item using evidence, not the model's claim](https://github.com/the-data-sherpa/my-first-software-factory/issues/9)
10. [#10: Complete the first real Vanguard maintenance run](https://github.com/the-data-sherpa/my-first-software-factory/issues/10)

Implementation starts with #1. After it completes, #2, #3, and #4 can proceed in parallel.
Use a common committed baseline before isolated implementation worktrees.

### Implementation record

Ticket #1 is implemented and verified locally as of 2026-11-03. It supplies the foreground backend, separate CLI, immutable admission snapshots, private application and per-run execution stores, stable request IDs, lifetime ownership, passive inspection, and closed-store backup/restore. It applies the repository-local Node 24.21.0 pin and preserves the Phase 0 probes.

The independent reliability review found three defects, all corrected with regressions:

- The SDK SQLite opener ignores a `readOnly` option. The execution adapter now uses native read-only connections, validates the pinned schema, and refuses migrations. It preserves committed WAL receipts rather than ignoring them.
- A cancellation/SDK-close race could release ownership before finalization. Shutdown now drains the job before releasing the owner lock.
- Backup and restore trusted declared execution versions without validating the stores. Both now check the actual schema and retained receipt identity.

Additional regressions cover compact `Goal:Text` brief fields and redirected run directories. CLI brief reads loop to EOF or the byte limit. Offline inspection acquires ownership before treating a store as closed. Backup excludes rebuildable SQLite shared-memory indexes and verifies repeated restoration of an interrupted run, including its WAL receipt, through CLI inspection.

Verification used Node 24.21.0:

- `npm test`: **37/37 passed** (11 Phase 0 and 26 Phase 1 tests).
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:ui`: **1/1 passed**.
- JavaScript syntax checks and `git diff --check` passed. Dependencies and the lock graph are unchanged.

These checks use controlled providers and disposable state. A fixture completion is not maintenance success and always records `reviewReady: false`.
At the ticket #1 checkpoint, the remaining implementation belonged to tickets #2–#10. No factory production-model request or Vanguard execution was performed.

### Parallel tickets #2–#4

The owner authorized parallel implementation from committed baseline `9ed9439`.
Each implementation used an isolated checkout. The parent integrated the modules and exercised their shared interfaces.

- [Ticket #2](implementation/ticket-02.md): explicit stop, reviewed resume, linked replacement, persistent deadlines and cumulative reservations, and passive crash recovery.
- [Ticket #3](implementation/ticket-03.md): actual foreground resource enforcement, bounded file tools and fixed checks, hidden private metadata, denied network access, and descendant cleanup.
- [Ticket #4](implementation/ticket-04.md): exact local `main` admission, committed-source manifests, private native Git worktrees, retained failures, and application/CLI source inspection.

The application saves source intent before preparation and the workspace receipt before executor dispatch.
The execution interface binds contained tools to that workspace, the run abort signal, and its original cumulative budget.
Workspace-only preparation remains `blocked / MODEL_NOT_READY`. A diagnostic or controlled fixture is not maintenance readiness.

Independent recovery/workspace review found three defects, now covered by passing regressions:

- Stop and shutdown must cancel during final drainage, even after the answer settles.
- A drained interrupted run must use trusted recovery assessment before terminal stop.
- Completed workspace-only preparation must permit stop or linked replacement without requiring a nonexistent execution adapter.

Independent containment review found no concrete correctness or safety defects and passed all 12 containment/integration tests without skips.
The accepted 4 GiB memory, zero-swap, and 256-task kernel settings were verified through the actual foreground scope.
Destructive resource tests used smaller disposable limits, not production-sized stress.

Incomplete crashed preparation remains fenced until trusted reconciliation establishes quiescence.
Workspace archives retain the artifacts, but restore rejects absolute-path relocation before creating a destination.
Fixture-only backup/restore remains supported. No factory production-model request, package fetch, real Vanguard access, or persistent service installation occurred.

Final combined verification under Node 24.21.0:

- `npm test`: **104/104 passed** (11 Phase 0 and 93 Phase 1 tests), with no skips.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:ui`: **1/1 passed**.
- JavaScript syntax, documentation paths/anchors, and whitespace checks passed.
- Package files, the dependency graph, and the runtime pin are unchanged.
- The transient test scopes have stopped. No installed service or global configuration change remains.

### Tickets #5 and #6 controlled integration

Ticket #5 now supplies bounded selected-model requests and an explicit no-tool CLI smoke operation.
Its independent safety review found a startup-drain ownership defect and a disposable-home test mismatch.
Both corrections passed their regressions. The model, CLI, factory, and recovery suites passed **63/63** after integration.
See the [ticket #5 record](implementation/ticket-05.md) for limits and evidence.

Ticket #6 supplies offline Bun preparation, explicit locked-registry acquisition, and verified read-only reuse with controlled packages.
The application now retains explicit preparation intent, receipts, cancellation, crash fencing, and the original budget.
The CLI exposes that owner operation separately from start and agent tools.
Registry fixtures cover transitive, scoped, and nested versions without giving Bun network access.
The lifecycle integration review found no concrete defects. Independent registry review found a scoped-name substitution defect, now rejected before acquisition with root and nested-placement regressions.
Its test run also exposed an intermittent descendant-cleanup failure. The [containment correction](implementation/containment-cleanup-correction.md) reproduced a startup race and added namespace drainage and foreground-owner-loss cleanup.
The integrated containment, registry, and dependency-application selection passed **38/38**, with no skips.
The [preparation correction](implementation/dependency-cleanup-correction.md) then shared verified namespace drainage with both installer stages.
Parent review also corrected a handled-check failure that disappeared during close and a persistence error that masked preparation drainage failure.
Both new regressions failed before their corrections.

Final combined verification under Node 24.21.0 passed **184/184**, with no exclusions or skips, plus the **1/1** browser regression.
Syntax, documentation links/anchors, whitespace, and unchanged dependency/runtime checks passed.
The final exact-scope audit found all 67 recorded scopes inactive with empty cgroups.
Manager failure plus owner loss, simultaneous backend/launcher death, and durable standalone recovery remain outside the established cleanup guarantees.
Real agent execution stays disabled. Real Vitest/lint, Bun/Vanguard compatibility, live model acceptance, baseline health, and readiness qualification remain later gates.

### Ticket #7 admission checkpoint

[Ticket #7](implementation/ticket-07.md) now joins source, dependency, containment, model-preflight, and baseline checks through the application and CLI.
The owner explicitly selects `serve --admit-agent` and names the preparation run with `start --dependency-run RUN_ID`.
The new run retains its own original deadline and cumulative budget; the preparation run is not promoted or replenished.
Fixed Vitest and lint checks run sequentially after the same-run bounded model smoke.
Source and execution-profile changes invalidate evidence, and passive inspection never replays work.

Passing gates records `blocked / EXECUTOR_NOT_IMPLEMENTED`, not maintenance success.
Repository tools remain disabled, and controlled-fixture receipts cannot authorize the owner profile.
The future executor must use the live opaque handoff and preserve original ownership and budgets.

Parent review corrected a capability-reporting omission: the enabled owner admission adapter now reports `productionModel: true`, without claiming live provider acceptance. Controlled adapters report false.
Parent verification passed **223/223**, with no exclusions or skips, plus the **1/1** browser regression.
Independent admission review remains pending. Tickets #8–#10 and real model/Vanguard acceptance have not been performed.
