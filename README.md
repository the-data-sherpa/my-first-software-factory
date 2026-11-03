# Tiny Software Factory

## Status

Phase 0 evaluation is complete, with runnable verification probes, [findings](docs/phase-0-findings.md), and an [accepted integration decision](docs/adr/0001-embed-pi-durable.md). This is not yet a working factory. Dependencies are pinned locally. No credentials, services, or schedules have been installed or changed.

The factory's job is repository maintenance, starting with [`vanguard`](https://github.com/the-data-sherpa/vanguard) as its first project. Vanguard replaces `crewroom` by the owner's decision on 2026-11-02. The restart gate passes for `@earendil-works/pi-durable` 1.5.0. The owner accepted direct embedding with SQLite and Pi's `ModelRuntime`, rather than adopting Durable Pi's applications. The owner accepted the complete [Phase 1 design](docs/phase-1-plan.md) on 2026-11-02, including outcome-first execution. A complexity classifier and specialist team are not required. Implementation has not started. Live inference with the owner's credentials remains unverified.

Terms used in this plan are defined in [CONTEXT.md](CONTEXT.md). [ADR 0002](docs/adr/0002-one-factory-many-projects.md) records the owner's choice of one factory managing multiple projects, not a factory per project. Each run and work item belongs to one project.

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
The owner accepted direct integration in [ADR 0001](docs/adr/0001-embed-pi-durable.md) on 2026-11-02. Backend implementation remains Phase 1 work.

**Time limit:** two working sessions. The manual-run restart gate passes, so the plain Node.js/SQLite fallback is not triggered.

**Exit assessment:** Complete as an evaluation and integration decision, with the documented limits accepted. The upstream UI and live local-model inference remain explicit gaps. Before enabling repository tools in Phase 1, perform a bounded, no-tool live model smoke check. The approval workflow must address the restart-limit finding before consequential actions.

### 1. Complete one manual run

The owner accepted the complete [Phase 1 design](docs/phase-1-plan.md) on 2026-11-02, including the minimal outcome-first baseline. Implementation requires a separate go-ahead.

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
- **Application:** TypeScript and Node.js, as required by `pi-durable`. The owner selected Node 24.21.0 as this repository's runtime for Phase 1 after the existing unit/integration probes passed. Applying the local pin remains implementation work; do not change global runtime settings.
- **Storage:** SQLite, with a factory-level record store and per-run durable execution stores as selected in ADR 0005. The logical application schema remains implementation work.
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
