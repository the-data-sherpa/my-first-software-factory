# Tiny Software Factory

## Status

This is a project plan, not a working application. No code, dependencies, credentials, or schedules have been installed.

The first factory's job is chosen: maintaining the [`crewroom`](https://github.com/the-data-sherpa/crewroom) repository. The plan uses `@earendil-works/pi-durable`, the library behind [Durable Pi](https://github.com/disler/durable-pi), as the proposed foundation for persistent agents. Phase 0 verifies that choice.

Terms used in this plan are defined in [GLOSSARY.md](GLOSSARY.md).

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

## First factory: repository maintenance for `crewroom`

The factory maintains one repository, [`the-data-sherpa/crewroom`](https://github.com/the-data-sherpa/crewroom).

**Output.** Each run produces at most one work item: a small task chosen from open issues, the roadmap, or recent commits. The work item contains:

- The reason for the selection, with links as evidence.
- A plan.
- A draft change in a git worktree, with test results.

**Usefulness.** A work item is useful if the approver would approve it with minor edits or none. The factory meets its goal if the approver approves 3 of its first 5 work items.

**Actions.**

| Category | Actions |
| --- | --- |
| Allowed without approval | Read the repository, issues, pull requests, and commits. Create a worktree and a local branch. Edit files and run tests in the worktree. |
| Requires approval | Push a branch. Open a pull request. Comment on an issue or pull request. Any other change to GitHub or another external system. |
| Never allowed | Merge. Force-push. Change repository settings or labels. Change the factory's own permissions or approval rules. |

**Approver.** One person, the project owner, approves or rejects proposals. Each decision is recorded with the approver and a timestamp.

## Proposed workspace

The first UI can use a three-part layout:

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

This is a design sketch, not a requirement to copy the video UI. A simpler interface is acceptable for the first working run.

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
| Agent runtime | Embed `pi-durable` in a small backend, following the pattern of Durable Pi's `proactive-dpi-demo`. Use the existing local `pi` model configuration and credentials. Do not adopt Durable Pi's multi-machine hub. |
| Work store | Keep work items, runs, messages, decisions, and artifacts. SQLite is a candidate. |
| Scheduler | Built into the backend. Store schedules with runs, start each due run with an idempotency key, and allow pause and run-now. After downtime, start one catch-up run and record the skipped slots. A systemd user service keeps the backend running. |
| Web interface | Show the work and let the person communicate, start runs, approve, and reject. |
| Sandbox | Phases 0 to 2: one git worktree per run (managed with [Worktrunk](https://worktrunk.dev/)) and `beforeTool` hooks that block forbidden commands. Before unattended scheduled runs in Phase 3: add process isolation, for example `bubblewrap`. |

These are responsibilities, not a commitment to build six separate services. `pi-durable` provides checkpointed runs, tool replay rules, and durable approval waits. It does not provide a scheduler or a sandbox.

## Persistence and recovery

A process that runs after the browser closes is useful, but that alone does not prove safe recovery after a crash. Durable Pi describes persistent agents and recovery of interrupted work. Verify its behavior for the tools and workflows this project uses.

The factory must record run state and make interruptions visible. Do not assume retries are safe. A repeated read may be harmless, while a repeated message, pull request, or other side effect can create duplicates. Define retry and deduplication behavior for each consequential action.

## Safety defaults

- Give each factory only the filesystem access, tools, network access, and credentials it needs.
- Run untrusted or agent-generated commands in a restricted sandbox. Confirm the sandbox's actual isolation before relying on it.
- Require explicit approval before publishing, sending messages, deploying, or changing external systems.
- Do not let the agent change its permissions or approval rules without human authorization.
- Keep an audit trail of prompts, tool calls, proposals, decisions, and outcomes. Avoid storing secrets in logs.
- Set limits for run duration, model spend, concurrency, and scheduled execution.
- Show failed and interrupted runs. Provide a way to pause schedules and stop work.

## Build stages

### 0. Choose a job and examine Durable Pi

The job is chosen (see [First factory](#first-factory-repository-maintenance-for-crewroom)). The remaining work verifies `pi-durable` 1.5.0 against that job.

- Run Durable Pi's documented local example in a git worktree.
- Confirm that `pi-durable` can use the existing local `pi` credentials and `models.json`, including the `local-ai` provider, without OpenRouter.
- Verify the following, with the faux model where possible:
  1. A manual run survives `kill -9` and resumes.
  2. An unsafe tool that was interrupted mid-call returns an "interrupted" result and does not run again silently.
  3. A pending approval survives a restart.
  4. The UI reconnects and shows the current run state.
  5. A `beforeTool` hook blocks a forbidden command.
- Record facts, gaps, and risks in `docs/phase-0-findings.md`.
- Record the integration decision in an ADR in `docs/adr/`.
- Update this README.

**Time limit:** two working sessions. If a recorded manual run cannot survive a restart, use a plain Node.js and SQLite runner instead, and do not patch `pi-durable`.

**Done when:** We can explain how the first factory will use `pi-durable` and identify any gaps or risks.

### 1. Complete one manual run

- Configure the factory for one task and a minimal set of tools.
- Start a run manually using the simplest practical interface.
- Save its status, transcript, findings, and outcome.
- Make failures visible and provide a way to inspect the result.

**Done when:** A person can close and reopen the interface and still inspect the recorded run.

### 2. Add the workspace and review loop

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

### 4. Extract reusable factory features

- Separate the first factory's domain-specific behavior from shared capabilities.
- Reuse configuration, run history, scheduling, workspace features, and tools where appropriate.
- Test the design by creating a second factory for a different job.

**Done when:** A second factory can use shared capabilities without copying the first factory's domain logic.

## Candidate technology

- **Agent foundation:** `@earendil-works/pi-durable` 1.5.0, matching the local `pi` 1.5.0 installation, subject to Phase 0.
- **Models:** The existing local `pi` model configuration and credentials. Not OpenRouter.
- **Application:** TypeScript and Node.js, as required by `pi-durable`.
- **Storage:** SQLite is a candidate for local state and history.
- **Interface:** A small web application.
- **Scheduling:** A scheduler built into the backend. `pi-durable` has none.
- **Execution:** Git worktrees and tool hooks first. Process isolation before unattended runs.

## Open questions

1. Should it run only on this machine or on an always-on host?
2. Which budget limits apply to model spend, run duration, and concurrency?
3. Which `pi-durable` features can we reuse as-is, and what must we build? Phase 0 answers this.
4. How should the factory notify a person when work is ready or a run fails?

## References

- [Project repository](https://github.com/the-data-sherpa/my-first-software-factory): this plan and the factory code. The repository is public. Do not commit credentials or `pi` authentication files.
- [Tiny Software Factories video](https://www.youtube.com/watch?v=1v7ldJiyH-Y): inspiration and description of the factory concept.
- [Durable Pi](https://github.com/disler/durable-pi): proposed agent foundation and documented local setup.
- [Super Simple Software Factory](https://github.com/disler/super-simple-software-factory): a related public project with a different workflow design.
