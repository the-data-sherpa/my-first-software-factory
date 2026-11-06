# Tiny Software Factory

## Status

Phase 0 evaluation is complete, with runnable verification probes, [findings](docs/phase-0-findings.md), and an [accepted integration decision](docs/adr/0001-embed-pi-durable.md). Phase 1 tickets #1–#8 have accepted controlled implementation checkpoints. Ticket #9 has local executor-to-qualification integration and controlled application/CLI proofs. Frozen `9c44363` passed 405 tests and the existing browser regression, with independent reviews. Later runtime corrections await a targeted recheck, and owner-readiness coverage remains an open decision. The complete owner path remains unverified. This is not yet a working maintenance factory. Dependencies and Node 24.21.0 are pinned locally. No credentials, services, or schedules have been installed or changed.

The factory's job is repository maintenance, starting with [`vanguard`](https://github.com/the-data-sherpa/vanguard) as its first project. Vanguard replaces `crewroom` by the owner's decision on 2026-11-02. The restart gate passes for `@earendil-works/pi-durable` 1.5.0. The owner accepted direct embedding with SQLite and Pi's `ModelRuntime`, rather than adopting Durable Pi's applications. The owner accepted the complete [Phase 1 design](docs/phase-1-plan.md) on 2026-11-02, including outcome-first execution. A complexity classifier and specialist team are not required. The owner separately authorized ticket implementation. See [Running the controlled CLI](#running-the-controlled-cli) and the [implementation record](docs/phase-1-plan.md#implementation-record). Production-model availability and Vanguard execution remain unverified.

Terms used in this plan are defined in [CONTEXT.md](CONTEXT.md). [ADR 0002](docs/adr/0002-one-factory-many-projects.md) records the owner's choice of one factory managing multiple projects, not a factory per project. Each run and work item belongs to one project.

The executor and development reviewers use one [change quality standard](docs/agents/change-quality.md).
Executor evidence retains the policy snapshot prepared for model instructions, available through existing inspection.
[Review guidance](docs/agents/review.md) separates findings from unexamined evidence and owner decisions.
See the [options and implementation record](docs/implementation/quality-guidance.md) for the selected approach and its verification limits.
This adds guidance, not another workflow or permission to publish.

## Motivation

A Tiny Software Factory is a small system built around one recurring job. Its agent can work without an open browser, maintain a record of its work, and bring decisions back to a person.

The aim is to move from opening an agent for every task to supervising a system that prepares useful work. The person remains near the loop: able to inspect, steer, approve, or reject proposed actions.

This plan is inspired by IndyDevDan's [Tiny Software Factories video](https://www.youtube.com/watch?v=1v7ldJiyH-Y). It is based on the video description and related public projects, not an inspection of the video's factory source code. It is not a verified description of that implementation.

## Core concepts

1. **One purpose.** Each factory serves a specific problem rather than acting as a general-purpose assistant.
2. **Persistent agent.** The agent and its work are not tied to an open browser tab.
3. **Workspace.** A person can see work items, inspect results, and communicate with the agent.
4. **Triggers.** A person, a schedule, or an event can start work.
5. **Human supervision.** The factory prepares work independently and requests approval for consequential actions.
6. **Agent access parity.** Where practical, the agent and the UI use the same underlying operations, subject to permissions.

## First factory: repository maintenance

The initial project is [`the-data-sherpa/vanguard`](https://github.com/the-data-sherpa/vanguard). The same factory must support simultaneous work across multiple projects in a future phase. Phase 1 remains limited to Vanguard and one active run total.

**Output.** Each run produces at most one work item: a small task chosen from open issues, the roadmap, or recent commits. The work item contains:

- The reason for the selection, with links as evidence.
- A plan.
- A draft change in a git worktree, with test results.

For Phase 1, the person supplies a short task brief with a goal, acceptance criteria, and evidence; the factory saves its immutable snapshot. URLs are citations, not permission to fetch context. Autonomous selection from issues, roadmaps, or commits is deferred. The first demonstration is Vanguard's address-whitespace normalization helper with focused regression tests, not a stored-data backfill. The successful demonstration must include a real local draft change, test results, and an outcome, not just a transcript. No-change, blocked, and failed runs retain their evidence and partial drafts but do not count as that demonstration.

**Outcome-first execution.** The owner defines the desired result and constraints; the factory owns planning and execution. Phase 1 starts with one accountable executor and runner-backed verification. Complexity scoring, specialist teams, and stage-specific model routing are possible later techniques, not required architecture or a workflow the owner must configure.

**Usefulness.** A work item is useful if the owner would use its draft with minor edits or none. The factory meets its goal if 3 of its first 5 work items meet that standard. This quality assessment is not a proposal-specific Approval.

**Actions.**

| Category | Actions |
| --- | --- |
| Allowed without approval | Read the repository, issues, pull requests, and commits. Create a worktree and a local branch. Edit files and run tests in the worktree. |
| Requires approval | Push a branch. Open a pull request. Comment on an issue or pull request. Any other change to GitHub or another external system. |
| Never allowed | Merge. Force-push. Change repository settings or labels. Change the factory's own permissions or approval rules. |

**Approver.** One person, the project owner, approves or rejects proposals. Each decision is recorded with the approver and a timestamp.

## Proposed workspace

Phase 1 uses a manually started foreground backend and a separate CLI for starting, inspecting, and stopping runs. Closing the CLI does not stop a run while the backend remains alive. A second start request is rejected while a run is active; it is not queued.

The web UI is an explicit Phase 2 deliverable. It can use a three-part layout:

```text
+--------------------------------------------------------------+
| Factory: chosen purpose                            [Run now]  |
+----------------+----------------------------+----------------+
| Work items     | Selected item              | Agent          |
|                |                            |                |
| Item A         | Summary                    | Conversation   |
| Item B         | Findings and evidence      | and steering   |
| Scheduled run  | Proposed next action       |                |
|                | Run history                | [Message...]   |
|                | [Approve] [Reject]         |                |
+----------------+----------------------------+----------------+
```

This is a design sketch, not a requirement to copy the video UI. The Phase 1 CLI does not replace the planned Phase 2 web workspace.

## Longer-term direction: conversational coordination

The owner approved this product direction on 2026-11-02:

> The meta-thread coordinates what needs to happen; the Vanguard workflow owns how the work gets done.

- **Meta-thread:** requirements, priorities, dependencies, lead assignments, and decisions that need the owner.
- **Lead:** accountability for one bounded outcome through the factory's workflow.
- **Workflow:** planning, execution, verification, and retained evidence.
- **Completion report:** the achieved result, supporting evidence, unresolved work, and decisions needed.

The meta-thread uses the factory application interface rather than duplicating the delivery workflow.
Leads can report newly discovered dependencies so the meta-thread can adjust coordination.
A finished lead thread can report a blocked, failed, or partial outcome. Thread completion alone does not prove success.
The owner requests outcomes rather than assembling agent teams or prescribing each step.

This is longer-term direction, not a Phase 1 scope change or implementation authorization.
The accepted Phase 1 design and ten published tickets remain unchanged in scope.
Transport, models, and coordination topology for this layer remain future decisions. Existing permissions and approval rules still apply.

## Proposed architecture

```text
Manual request, schedule, or event
                 |
                 v
          Create a recorded run
                 |
                 v
       Durable Pi agent and allowed tools
                 |
                 v
       Store findings and proposed action
                 |
                 v
       Human review, when required
                 |
                 v
       Execute approved action and record outcome
```

| Part | Responsibility |
| --- | --- |
| Factory configuration | Define the purpose, workspace, tools, model, schedule, and approval rules. |
| Agent runtime | Accepted foundation: embed pinned `pi-durable` 1.5.0 in a small backend with Pi's `ModelRuntime` for local model configuration and credentials. Implementation starts in Phase 1. Reuse the pattern of `proactive-dpi-demo`, not its 1.0.3 API calls or OpenRouter wiring. Do not adopt the multi-machine hub. |
| Work store | [ADR 0005](docs/adr/0005-isolate-execution-stores-per-run.md): use one factory-level SQLite record store and a separate durable execution store/session per run. Keep project/run identity and application outcomes in the factory store, referencing execution receipts and artifacts. Add review messages and proposal decisions in Phase 2. |
| Scheduler | Phase 3: build scheduling into the backend. Store schedules with runs, start each due run with an idempotency key, and allow pause and run-now. After downtime, start one catch-up run and record the skipped slots. A systemd user service keeps the backend running. Phase 1 installs no service. |
| Web interface | Phase 2: show the work and let the person communicate, start runs, approve, and reject. |
| Execution boundary | Use plain Git for one worktree per run; do not install Worktrunk in Phase 1. Hooks enforce policy but are not a sandbox. [ADR 0003](docs/adr/0003-contain-repository-tools-in-phase-1.md) requires verified containment before repository tools, not just before unattended execution. Limit read/edit access and expose a fixed-command, direct-argv check runner without host-private mounts or tool network access. Verify the actual Vanguard toolchain and parent-death cleanup before use. |

These are responsibilities, not a commitment to build six separate services. `pi-durable` provides checkpointed tasks, tool replay rules, and durable sleeps. The factory builds its approval protocol on those primitives. The library does not provide an approval service, scheduler, or sandbox.

## Persistence and recovery

A process that runs after the browser closes is useful, but that alone does not prove safe recovery after a crash. Durable Pi describes persistent agents and recovery of interrupted work. Verify its behavior for the tools and workflows this project uses.

The factory must record run state and make interruptions visible. Do not assume retries are safe. A repeated read may be harmless, while a repeated message, pull request, or other side effect can create duplicates. Define retry and deduplication behavior for each consequential action.

[ADR 0004](docs/adr/0004-operator-controlled-recovery.md) requires passive inspection after a crash, with no automatic execution. Explicit resume requires review of partial effects, verified containment, and remaining original limits. It never resets the run's budget. If safe resume is unavailable or limits are exhausted, require an explicit new linked run. Stop and graceful backend shutdown cancel active work, retain artifacts, and record a terminal stopped result.

## Safety defaults

- Give each factory only the filesystem access, tools, network access, and credentials it needs.
- Run untrusted or agent-generated commands in a restricted sandbox. Confirm the sandbox's actual isolation before relying on it.
- Require explicit approval before publishing, sending messages, deploying, or changing external systems.
- Do not let the agent change its permissions or approval rules without human authorization.
- Keep an audit trail of prompts, tool calls, proposals, decisions, and outcomes. Avoid storing secrets in logs. Keep runtime state, transcripts, patches, check logs, and worktrees outside the public repository until explicit owner cleanup. Phase 1 performs no automatic deletion, publishing, or draft commits.
- Set limits for run duration, model spend, concurrency, and scheduled execution. Phase 1 enforces operational limits and labels cost as reported, estimated, or unknown. It makes no hard billing-cap claim.
- Show failed and interrupted runs. Provide a way to pause schedules and stop work.

## Running the controlled CLI

Ticket #1 supplies a tool-free fixture path, not a Vanguard maintenance run.
Use Node 24.21.0, selected by the repository-local `.mise.toml` and package engine.
No live model, credentials, repository tools, or package downloads are needed for this path.
The normal backend refuses production execution until its later gates are implemented. It never substitutes a fixture.

Start the explicit fixture backend in one terminal:

```bash
npm run factory -- serve --fixture
```

In another terminal, submit a text brief with all three sections:

```bash
npm run factory -- start --request-id fixture-demo-001 --brief-text 'Goal: Exercise retained run history.
Acceptance criteria: Inspect the same result after reconnecting.
Evidence: Controlled fixture context.'
```

Alternatively, use `--brief path/to/brief.md`. Markdown headings named `Goal`, `Acceptance criteria`, and `Evidence` are also accepted.
The raw brief is snapshotted at admission and limited to 64 KiB of UTF-8 text.
URLs remain citations; the factory does not fetch them.
Reuse the same request ID and brief to retrieve the same run. Changed input with that ID is rejected.

Replace `RUN_ID` below with the application's `run_…` identity returned by `start`, not the SDK submission ID:

```bash
npm run factory -- inspect RUN_ID
npm run factory -- list
npm run factory -- info
```

Closing the CLI leaves work with the foreground backend. Use Ctrl-C in the backend terminal to shut it down.
Completed history remains available through `inspect` and `list` with the backend closed.
A crashed run remains interrupted and blocks a new start. Reopening never resumes it automatically.
Ticket #2 adds explicit stop, reviewed resume, and linked replacement controls:

```bash
npm run factory -- stop RUN_ID
npm run factory -- resume RUN_ID --review 'Reviewed the retained partial effects.'
npm run factory -- replace RUN_ID --request-id replacement-001 \
  --review 'Safe resume is unavailable. Start a new linked run.'
```

Resume requires trusted safety evidence and remaining original allowances. The operator's review cannot certify containment.
A stopped run cannot resume. Replacement requires confirmed quiescence and retains the old run, its counters, and the link.
The original 20-minute deadline includes downtime. Model attempts and tool rounds consume persistent allowances before effects.
The controlled fixture proves only tool-free recovery, not production containment.
Fixture outcomes always have `reviewReady: false` and do not satisfy the real maintenance milestone.
Production request limits and OS resource enforcement require their separate implementation gates.
See the [recovery implementation record](docs/implementation/ticket-02.md) for the execution adapter contract and verification.

State defaults to `~/.local/state/tiny-software-factory`, outside the public repository.
Use `--state-dir DIRECTORY` consistently on all commands to select another private location.
Directories and files are owner-only. The backend listens only on its private Unix socket, not a TCP port.

After shutting down the backend, back up and restore closed stores:

```bash
npm run factory -- backup --to "$HOME/.local/state/tiny-factory-backup-001"
npm run factory -- restore --from "$HOME/.local/state/tiny-factory-backup-001" \
  --state-dir "$HOME/.local/state/tiny-factory-restored-001"
npm run factory -- inspect RUN_ID --state-dir "$HOME/.local/state/tiny-factory-restored-001"
```

Backup and restore destinations must be new, private directories outside Git repositories.
Backups retain factory records and per-run execution files, including committed WAL data, with storage versions and SHA-256 digests.
SQLite rebuilds shared-memory indexes; backups exclude those indexes and backend control files.
Backup and restore verify actual execution schema compatibility, not just the manifest's declarations.
Restore verifies the inventory and digests before copying. Existing state is never overwritten.
Backups contain private task briefs and transcripts. Keep them private; cleanup remains an explicit owner operation.
These checks cover process crashes, not host or power failure guarantees.

Run the combined unit/integration suite with `npm test`, or select `npm run test:phase0` and `npm run test:phase1`.
The original browser probe remains available through `CHROMIUM_PATH=/usr/bin/chromium npm run test:ui`.

## Selected-model preflight

Live acceptance requires a separate owner decision. The commands below can read Pi credentials and send a paid request after admission.
They were not used with real credentials during implementation.

```bash
# Foreground terminal: explicitly enable only the no-tool smoke operation.
node bin/factory-contained.mjs serve --model-preflight

# Separate terminal: admit the diagnostic brief and start one bounded smoke.
npm run factory -- start --request-id model-smoke-001 --brief /absolute/path/to/brief.md
```

Starting this backend does not discover credentials or issue a request. Only an admitted `start` creates Pi's `ModelRuntime`.
That owner operation requires the live foreground resource scope before credential discovery. A plain, uncontained backend refuses it.
The selected route is `openai/gpt-6.1-sol`, with explicit low reasoning and cap-compatible API-key authentication.
OAuth, missing credentials, unsupported caps, and provider failures block instead of choosing another route.
The smoke allows one attempt, at most 1,024 requested output tokens, and a 60-second complete-stream deadline.
It uses the original run deadline and persistent budget. It enables no repository tools and cannot combine with workspace preparation or a fixture.

Inspection retains request accounting and fixed failure reasons without loading credentials.
A successful smoke records `model-preflight-completed` with `reviewReady: false`, not maintenance success.
Unknown terminal usage retains the full output reservation. Estimated cost is not a bill or a guaranteed monetary ceiling.
Stop and shutdown abort and drain requests. Unconfirmed drainage, including startup cleanup failure, keeps admission and ownership fenced.
Crashed model execution cannot resume or be replaced without trusted reconciliation.
See the [model implementation record](docs/implementation/ticket-05.md) for controlled evidence and remaining live acceptance gates.

## Preparing an exact-source workspace

Workspace preparation is explicit. Starting a fixture backend without this option does not access the configured repository.
Use the foreground resource launcher when exercising repository tools:

```bash
node bin/factory-contained.mjs serve --prepare-workspace --project-path /absolute/path/to/local/repository
```

Submit a brief through the separate CLI as above. The factory records the exact local `main` commit and its committed-file manifest.
It creates an independent private Git store, branch, and locked worktree without changing the owner checkout.
Inspection shows the saved source intent, prepared receipt, or sanitized failure.
Preparation alone ends `blocked` with `MODEL_NOT_READY`. It does not call a model or substitute a fixture.
An explicitly selected `--fixture` can exercise the preparation-to-fixture path against a disposable repository.

Stop and shutdown cancel preparation and wait for its owned work to drain.
After a crash, inspection discovers retained receipts without preparing again.
A complete preparation receipt can establish quiescence for a workspace-only stop or linked replacement.
An incomplete crashed preparation stays blocked pending trusted reconciliation. It is not silently retried.

Workspace backups are private archives, not relocatable working states.
Restore refuses archives containing workspace identities before creating a destination because their Git pointers contain absolute paths.
Fixture-only backup/restore remains supported. Retain the original workspace and archive until explicit cleanup.
See the [workspace implementation record](docs/implementation/ticket-04.md) for supported source features and retention behavior.

## Explicit dependency preparation

Ticket #6 provides controlled preparation for committed offline tarballs and a limited locked-registry grammar with transitive dependencies.
The full controlled integration suite passes, including startup cleanup for both preparation sandboxes. Real Vanguard tooling remains unverified.

With a workspace-only backend inside the foreground resource scope, prepare an admitted run explicitly:

```bash
npm run factory -- prepare-dependencies RUN_ID --bun-path /absolute/canonical/path/to/bun
npm run factory -- inspect RUN_ID
```

Offline preparation is the default. An explicit `--fetch-locked-packages` flag permits only the supported locked registry acquisition path.
That option can make public requests in production. Tests used only controlled local registry fixtures.
Unknown lock features, arbitrary registries, and supplied archive URLs fail closed.

The application saves the owner choice and intent before acquisition or installation, then saves the verified receipt before any later executor can use it.
It retains the original deadline and counters, excludes other active work, and drains preparation on stop or shutdown.
Preparation does not run an agent. Success still leaves the run `blocked / MODEL_NOT_READY`.
Inspection and ordinary start never install. Failed or incomplete attempts do not retry implicitly.

A crashed installer stays interrupted. A completed source workspace alone cannot justify stop or replacement without dependency-quiescence evidence.
Dependency bundles with Bun `.bin` links cannot use the existing backup path. Keep their private state until explicit cleanup.
See the [dependency application record](docs/implementation/dependency-application.md) for lifecycle evidence and remaining gates.

## Repository admission gate

Ticket #7 connects the existing prerequisites without installing an agent executor.
After a separate source/dependency preparation run finishes, close that backend and start admission-only mode with the same state directory and project:

```bash
node bin/factory-contained.mjs serve --admit-agent --state-dir "$STATE" --project-path "$PROJECT"

# From a separate terminal:
npm run factory -- start --state-dir "$STATE" --request-id admission-1 \
  --brief "$BRIEF" --dependency-run "$PREPARATION_RUN"
```

These owner commands can initialize Pi credentials and send a paid model request. They describe the interface, not authorization or evidence of a live run.
Admission never selects a latest bundle, installs dependencies, or fetches packages.
It verifies pristine recorded source, the matching bundle, and actual containment before bounded same-run model preflight.
Only then does it run fixed Vitest and lint checks, sequentially, within the original deadline and cumulative budget.
Changed source or execution-profile inputs invalidate the evidence. Inspection and duplicate starts never rerun the gates.

Passing all gates in admission-only mode records `blocked / EXECUTOR_NOT_IMPLEMENTED`, `admission.readiness: baseline-healthy`, and `reviewReady: false`.
This mode exposes no agent tools. Ticket #8's separate executor consumes the live, revalidated handoff; JSON receipts and controlled-fixture tokens cannot authorize the owner profile.
`capabilities.productionModel` identifies the enabled owner adapter, not successful live authentication or provider acceptance.

Parent verification passed **223/223** tests with no exclusions or skips, plus the **1/1** browser regression.
Independent review found no concrete defects and passed **39/39** admission tests plus **2/2** focused boundary regressions.
The parent accepted this controlled implementation checkpoint. No real Vanguard or production-model acceptance is claimed.
See the [ticket #7 implementation record](docs/implementation/ticket-07.md) for interfaces, evidence, and recovery limits.

## Bounded draft executor

Ticket #8 now connects the repository executor to the application and CLI.
The parent accepted its controlled checkpoint after independent review, two reproduced corrections, and full verification.
After separate dependency preparation, close that backend and explicitly select executor mode:

```bash
node bin/factory-contained.mjs serve --execute-agent --state-dir "$STATE" --project-path "$PROJECT"

# From a separate terminal:
npm run factory -- start --state-dir "$STATE" --request-id draft-1 \
  --brief "$BRIEF" --dependency-run "$PREPARATION_RUN" \
  --write-path convex/syncHelpers.ts \
  --write-path lib/__tests__/normalize-address.test.ts
```

These commands can load Pi credentials and make paid model requests. They describe the interface, not authorization or evidence of a live run.
The owner selects explicit writable files as permissions, not a stage plan. Scope is immutable and part of duplicate-request identity.
Admission gates still precede tool-enabled requests. Reads, writes, and fixed checks use the original limits and verified dependency handle.
There is no install, shell, publication, or scope-expansion tool.
`capabilities.repositoryTools` identifies the configured adapter, not a claim that admission has passed or a token remains live.

Inspect retained plan, model/tool events, and actual draft evidence through `executorEvidence`:

```bash
npm run factory -- inspect RUN_ID --state-dir "$STATE" --event 0 --offset 0 --length 16384
```

Use the event index and returned `nextOffset` to page evidence, including after the backend closes.
Admission remains historical baseline evidence after authorized edits.
The module-only executor reports `draft-produced / QUALIFICATION_REQUIRED`, never readiness. The CLI now selects composed qualification after a produced draft; no-change and incomplete outcomes remain distinct.
Reopening after a crash does not resume work or equate completed smoke with completed execution.
Uncertain drainage retains backend ownership, even if failure reporting also fails.

Independent reviews found two executor defects: output-limit stops retained handoff authority, and SDK truncation removed file-read pagination metadata.
Both have behavioral regressions and parent corrections. Encoded responses now preserve bounded valid JSON and exact UTF-8 continuation offsets.
Check output-limit stops block further work and handoff; ordinary assertion failures remain feedback.
Final parent verification passed **274/274**, with no exclusions or skips, plus the **1/1** browser regression.
All **328/328** parent-recorded exact scopes were inactive and empty.

The baseline command and admission profile now use supported serial options instead of the unsupported `--minWorkers=1`; see the [command correction](docs/implementation/vitest-baseline-correction.md).
Controlled CLI consumers and reporters do not establish real Vitest or ESLint compatibility.
The later qualification corrections still need a targeted combined recheck. Live provider acceptance, real Vanguard compatibility, and the #10 demonstration remain separate gates.
See the [ticket #8 implementation record](docs/implementation/ticket-08.md) for interfaces, retained examples, and recovery limits.

### Unavailable executor policy

A startup policy-read failure records `blocked` with reason `EXECUTOR_POLICY_UNAVAILABLE`.
Inspection retains this code, not the execution adapter's restore message.
This failed executor attempt dispatches no model requests or executor tools.

Starting a new run still needs owner authorization and can make paid model requests.

1. Restore the factory's `docs/agents/change-quality.md` from the intended trusted revision, not from the managed project.
2. Verify that the backend user can read the restored file.
3. If the task is still wanted and authorized, explicitly start a new run with a new request ID.

Keep the blocked run for inspection. Restoring the file does not resume it.
Reusing its request ID returns the same retained run rather than retrying it.

## Retained draft qualification

The existing `serve --execute-agent` mode now selects `createQualifiedRepositoryExecution`; no second execution-mode flag or model route was added.
After the real executor produces a draft, the adapter retains its live opaque handoff and runs the independent qualifier with the same budget and owner.
The qualifier requires the same retained test bytes to fail the intended assertion on the recorded base and pass on the draft, an independent behavioral oracle, and passing final suite/lint checks.
Qualification commands pin the fork pool and validate its resolved configuration. Controlled reporter fixtures are not real-distribution acceptance.

For the selected address task, qualification supports only the exact helper/test scope and a conservative helper language: `const` declarations, a final `return`, and literal-argument string-method chains.
Assignments, global references, arbitrary function calls, control flow, operators, and templates are unsupported and block with `QUALIFICATION_SCOPE_UNSUPPORTED`, even if a broader implementation might be correct.
The fixed examples cannot prove general correctness or exclude every overfitted implementation.

After confirmed drainage, fresh evidence, and a final original-deadline check, the application can retain one stable `workItem` on the run.
It references the original task/evidence, actual plan/transcript, complete private patch and new files, checks, usage, and outcome.
`inspect RUN_ID` revalidates evidence; `list` shows unverified summaries. Neither executes, repairs, or completes old work.
Later edits invalidate projected freshness and readiness without changing saved history.
The Work item's `status` retains its creation outcome; it is historical, not a current-readiness claim. Use the current `reviewReady`, `freshness`, and revalidated evidence together, never `status` alone.
Controlled Work items always have `reviewReady: false`; conditional owner readiness is not Approval or permission to publish and has no live acceptance yet.
No-change, blocked, failed, stopped, and interrupted attempts retain their actual partial evidence without a manufactured successful Work item.

Inspect an interrupted composed run first. It remains fenced pending trusted external reconciliation; `resume` refuses with `UNSAFE_RESUME`.
Retirement or linked replacement requires a trusted quiescence assessment. The current composed adapter reports quiescence unconfirmed, so the CLI cannot retire or replace a crashed composed run merely from review text. No successful replacement of such a run is established.
A qualified private artifact recorded just before a crash does not finalize the application run or create a Work item through inspection.
Unconfirmed drainage outranks reporting failures. A reporting failure after confirmed drainage is a failed outcome, not an invented drain failure.
See the [integration record](docs/implementation/ticket-09-integration.md), [composition](docs/implementation/qualified-execution.md), and [application contract](docs/implementation/qualification-application.md).
Frozen `9c44363` passed **405/405** tests with no skips and the existing **1/1** browser regression. Independent reviews and follow-up reviews have returned. These results do not automatically verify the later runtime corrections.
Ticket #9 remains unaccepted pending a current-source composed-path recheck and the owner-readiness coverage decision. No live model, Vanguard, dependency-download, or #10 operation is authorized by these results.

## Contained execution tools

The execution interface verifies the live foreground scope and actual bubblewrap launcher before exposing bounded file tools.
It requires Linux x86-64, cgroup v2, user-systemd, Node 24.21.0, and the tested bubblewrap features.
Missing controls block execution rather than selecting a weaker path.

The accepted scope limits backend and descendants to 4 GiB memory, zero swap, and 256 tasks.
Checks use read-only source snapshots, a 256 MiB writable scratch filesystem, a 120-second deadline, and 1 MiB combined output.
File reads paginate at 16 KiB. Text writes are limited to 64 KiB.
The sandbox hides Git metadata, private control paths, credentials, and other runs, and denies network access.
The factory retains diagnostic receipts outside editable source. A passing diagnostic is never maintenance readiness.

`createRunTools` binds these tools to the run's saved workspace, cancellation signal, and cumulative budget.
It conservatively charges each bounded operation as one tool round and drains before releasing ownership.
Repository Vitest/lint checks require a verified private dependency handle. Without one, they reject with `DEPENDENCIES_NOT_PREPARED`.
Controlled installed packages exercise this handoff and its read-only mounts, not real Vanguard test or lint compatibility.
Ticket #7 implements admission checks; ticket #8 registers bounded agent tools after those checks. Both have controlled verification, not real Vanguard toolchain acceptance.
See the [containment implementation record](docs/implementation/ticket-03.md) for verification evidence and host restrictions.
A later #6 test exposed an intermittent descendant-cleanup failure. The [cleanup correction](docs/implementation/containment-cleanup-correction.md) reproduces a startup race and adds verified namespace drainage plus foreground-owner-loss cleanup.
The [preparation correction](docs/implementation/dependency-cleanup-correction.md) shares those namespace-lifetime rules with both installer stages and preserves failed-drain ownership through finalization and reporting errors.
Final combined verification passed **184/184**, with no exclusions or skips, plus the **1/1** browser regression.
Manager failure with owner loss and simultaneous backend/launcher death remain unverified recovery cases.
Owner execution requires explicit executor mode. Qualification is integrated locally. The later corrections still need a targeted combined recheck, and live model/toolchain acceptance remains unverified.

## Build stages

### 0. Choose a job and examine Durable Pi

The job is chosen (see [First factory](#first-factory-repository-maintenance)). The 1.5.0 verification probes pass:

- A manual run survives `SIGKILL` during a model request and finishes after SQLite is reopened.
- An unsafe mid-call tool returns `interrupted` without repeating its local effect. A replay-safe tool reruns as declared.
- A pending proposal and its approval task survive one restart. This fixture survives four consecutive tool interruptions with the default restart limit, not five. On the fifth, the wrapper fails while the proposal still says pending. Decisions for dead tasks are rejected.
- A live read-only Chromium page recovers the same pending task across a worker outage. A new tab shows completion after all tabs were closed. The test's HTTP adapter remains running.
- A committed approval survives a crash before its fake local effect. Exhausted model retries become visible failures, not silent new attempts.
- A `beforeTool` hook blocks a forbidden bash call before execution.
- `ModelRuntime` resolves a `local-ai` provider against a mock API, with separate bearer-key cases for `auth.json` and a literal key in `models.json`. Real configuration discovery reports `local-ai/local-ai-auto` and the `models_json_key` source. Live inference and credential validity remain unverified.

The upstream demo installed, reset and built in an isolated git worktree. Startup stopped at its Jev credential check, so its UI remains unverified. It pins 1.0.3 and requires different provider wiring. No upstream code or library was patched.

Run the probes:

```bash
npm ci --ignore-scripts
npm test
npx playwright install chromium
npm run test:ui
npm run phase0:credentials  # Optional read-only local discovery. No inference.
```

For an existing browser, use `CHROMIUM_PATH=/usr/bin/chromium npm run test:ui` instead of installing Chromium.
See [Phase 0 findings](docs/phase-0-findings.md) for the commands, evidence, gaps, safety limits, and consensus ledger.
The owner accepted direct integration in [ADR 0001](docs/adr/0001-embed-pi-durable.md) on 2026-11-02. The Phase 1 backend includes accepted controlled checkpoints through the #8 executor. Real maintenance execution remains unverified.

**Time limit:** two working sessions. The manual-run restart gate passes, so the plain Node.js/SQLite fallback is not triggered.

**Exit assessment:** Complete as an evaluation and integration decision, with the documented limits accepted. The upstream UI and live local-model inference remain explicit gaps. Before enabling repository tools in Phase 1, perform a bounded, no-tool live model smoke check. The approval workflow must address the restart-limit finding before consequential actions.

### 1. Complete one manual run

The owner accepted the complete [Phase 1 design](docs/phase-1-plan.md) on 2026-11-02, including the minimal outcome-first baseline, then separately authorized implementation. Tickets #1–#6 supply the controlled foundation, and #7 joins the startup gates. The parent accepted #7 after independent review. The parent also accepted #8's controlled checkpoint after review corrections. The baseline-command correction and qualification are integrated locally. Frozen verification and independent reviews have completed, but the later runtime recheck and owner-readiness coverage decision remain open. Ticket #10 and live model/Vanguard acceptance remain before the real maintenance demonstration.

- Configure Vanguard for one human-selected offline logic/test change and a minimal set of tools. Use one-shot Vitest and lint as candidate checks, not the Sentry-enabled build or live-account integrations.
- Record a local `main` commit and create a factory-owned worktree and branch from it using plain Git. Leave the existing checkout untouched; do not automatically fetch, pull, or create `dev`.
- Use Bun and `bun.lock` for Vanguard while preserving both tracked lockfiles. Require a matching operator-prepared private dependency bundle; mount it read-only. Missing or stale dependencies block agent work. Only an explicit trusted preparation step may fetch locked packages, with scrubbed environment and lifecycle scripts disabled.
- Verify the real repository/toolchain execution boundary before enabling agent tools; block rather than weaken containment.
- Start a run through a CLI connected to a manually started foreground backend.
- Allow one active run total; reject a second start rather than queue it.
- Require a healthy baseline, a regression that fails against the recorded base and passes with the draft, and passing final Vitest/lint checks. Do not repair unrelated baseline failures silently.
- Save the task, evidence, plan, complete local patch including new files, runner receipts bound to the tested source, transcript, and outcome. Do not infer readiness from the model's claim alone.
- Enforce the [accepted limit profile](docs/phase-1-plan.md#accepted-limit-profile) without resetting it on resume or retry. Verify actual request caps, deadlines, resource controls, and cleanup before use.
- Make failures and interruptions visible. Keep crash inspection passive and require explicit operator recovery.

**Done when:** A person can close and reopen the CLI and inspect a real draft with regression evidence, passing final checks, and its outcome. Lifecycle tests must also demonstrate safe crash recovery, stopping, second-start rejection, and failed-preflight blocking. Ready for review does not authorize publishing.

### 2. Add the workspace and review loop

- Add the web UI; it is required in this phase, not replaced by the Phase 1 CLI.
- Show work items and previous runs.
- Let the person inspect evidence and ask follow-up questions.
- Record approval or rejection of proposed actions.
- Route UI and agent operations through shared application logic where practical.

**Done when:** A person can steer the factory and review its proposal without reading terminal output.

### 3. Add proactive work

- Add one schedule, a manual run control, and a pause control.
- Prevent overlapping runs for the same scheduled task.
- Show failures and interruptions, with explicit retry behavior.
- Apply the approval and execution limits defined for the task.

**Done when:** The factory produces useful work while the person is away and makes its status and failures visible.

### 4. Manage multiple projects in the same factory

- Register a second repository as another project of the same repository-maintenance factory, not as a separate factory.
- Reuse the factory's management, workspace, run-history, and scheduling capabilities across its projects.
- Keep runs and work items project-scoped. Define concurrency and resource policies before allowing overlapping project work.
- Support simultaneous work across multiple projects with correct attribution of work and results.

**Done when:** The same factory can maintain two projects concurrently while keeping their work and results correctly attributed.

## Candidate technology

- **Agent foundation:** `@earendil-works/pi-durable` 1.5.0, matching the local `pi` 1.5.0 installation, accepted in ADR 0001.
- **Models:** `openai/gpt-6.1-sol` initially, until the web UI, using Pi's existing model and credential integration. Do not substitute Codex, OpenRouter, or `local-ai-auto`. Authentication and live availability remain unverified; preflight failure blocks execution rather than triggering a fallback.
- **Application:** Node.js ES modules, using the repository's `.mjs` style. Ticket #1 applies the selected Node 24.21.0 pin through `.mise.toml`, the package engine, and the CLI version check. Global runtime settings remain unchanged.
- **Storage:** SQLite, with a factory-level record store and per-run durable execution stores as selected in ADR 0005. Ticket #1 records storage versions, enforces native read-only execution inspection, and verifies closed-store backup/restore.
- **Interface:** Phase 1 CLI with a foreground backend; a web workspace in Phase 2.
- **Scheduling:** A scheduler built into the backend. `pi-durable` has none.
- **Execution:** Plain-Git worktrees, limited read/edit tools, and a fixed-command sandboxed check runner. Verified containment is mandatory before Phase 1 repository tools; its actual Vanguard profile remains unvalidated.

## Questions for later phases

1. Should later unattended deployments run on this machine or an always-on host?
2. How should future concurrency and resource policies extend the selected project-scoped work model and Phase 1 limits?
3. How should the factory notify a person when work is ready or a run fails?

The [Phase 1 design tree](docs/phase-1-plan.md#design-tree-and-current-frontier) records the accepted decisions and remaining implementation verification gates.

## References

- [Project repository](https://github.com/the-data-sherpa/my-first-software-factory): this plan and the factory code. The repository is public. Do not commit credentials or `pi` authentication files.
- [Tiny Software Factories video](https://www.youtube.com/watch?v=1v7ldJiyH-Y): inspiration and description of the factory concept.
- [Durable Pi](https://github.com/disler/durable-pi): reference applications and documented local setup. ADR 0001 selects direct library embedding, not these applications.
- [Super Simple Software Factory](https://github.com/disler/super-simple-software-factory): a related public project with a different workflow design.
