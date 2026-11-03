# Phase 0 findings

## Scope and accepted decision

Examined on 2026-11-02: `@earendil-works/pi-durable` **1.5.0**, local Pi configuration discovery, and Durable Pi at commit `37165c619573dbaf425463038bbffecfe576beec`.
The original question was whether the library could support a supervised repository-maintenance factory for `crewroom`.
During the subsequent [Phase 1 design interview](phase-1-plan.md), the owner replaced that target with `vanguard`. The evidence below records the original evaluation.

**Decision accepted by the project owner on 2026-11-02:** embed the pinned library in a small, single-owner Node.js backend.
Pass Pi's `ModelRuntime` as its `models` implementation.
Use SQLite for run state, application documents and immutable entries for proposals and decisions, and one worktree per run.
Do not adopt the upstream multi-machine hub or port its demo.
See [ADR 0001](adr/0001-embed-pi-durable.md).
This completes Phase 0's evaluation and decision work. The backend and approval workflow remain unimplemented, in Phases 1 and 2 respectively.
The acceptance does not authorize those phases or external actions.

The manual-run restart gate passes. The plain Node.js/SQLite fallback is not needed on this evidence.
Approval support is conditional: the fixture's waiting tool exhausts the default restart limit after five consecutive interruptions.
Do not adopt that wait pattern unchanged for consequential actions. See F12.
No library patches, services, schedules, GitHub writes, or `crewroom` changes were made.
The new `.mjs` files are disposable integration probes, not the factory application.

Out of scope: real GitHub effects, unattended execution, full sandbox validation, host/power failure, spend enforcement, and production authentication.
Live inference using the owner's credentials and the upstream browser UI are **not verified**.

## Reproduce

Requires Node.js **22.19.0 or later**, npm, and Linux or another platform with `SIGKILL` support.
The recorded run used Node **22.23.4**, npm **10.9.9**, and system Chromium.
On that Node version, the storage adapter emits an experimental `node:sqlite` warning.
The minimum engine version is not a runtime-stability guarantee.
A subsequent compatibility check passed the 11 unit/integration probes under Node 24.21.0; the owner selected that version for Phase 1.
The repository-local pin remains implementation work. The original browser evidence below remains on Node 22.23.4.

```bash
npm ci --ignore-scripts
npm test

# Use one browser setup:
npx playwright install chromium
npm run test:ui
# Or use an existing Chromium installation:
CHROMIUM_PATH=/usr/bin/chromium npm run test:ui

# Optional: inspect the current user's Pi configuration. No inference or auth resolution.
npm run phase0:credentials
```

`npm test` needs no real credentials or model network access. The model integration test serves a mock API on loopback.
The browser test also uses only loopback. Both suites create temporary state and terminate their child processes.
Browser binaries are not installed by `npm ci --ignore-scripts`.

The credential probe reads the Pi agent directory selected by `getAgentDir()`.
It uses an in-memory model catalog and a read-only credential snapshot.
It does not resolve configured key commands, refresh OAuth, send inference requests, or print credential values or endpoint URLs.
Provider and model identifiers appear in its output. Do not publish configuration files or transcripts containing secrets.

## Observed results

Commands: `npm test` **11/11 pass**. `CHROMIUM_PATH=/usr/bin/chromium npm run test:ui` **1/1 pass**.
`npm audit --omit=dev`: **0 vulnerabilities** in the pinned spike's installed dependency graph.
This audit is not a security assessment of the runtime or of upstream code.

| Requirement | Result and evidence | Limit |
| --- | --- | --- |
| Manual run survives `kill -9` | Pass. `tests/phase-0/recovery.test.mjs`: kill during a model request, reopen SQLite, repeat the request ID, finish with the same submission and one input. | Recovery consumes a retry. This is process-crash recovery, not power-loss testing. |
| Unsafe interrupted call does not silently rerun | Pass. The unsafe fixture appends one local effect before the kill. Recovery writes an error result with diagnostic `interrupted`. The effect count stays one. | The next model response can request a new call. External effects still need reconciliation and idempotency. |
| Replay-safe call resumes | Pass. The safe fixture runs twice, but produces one tool-result entry. | `safe` permits replay. It does not mean exactly once. |
| Pending approval survives restart | Pass for one restart, for approval and rejection. The same child task and proposal remain pending, with zero effects. | With the default restart limit, this wrapper survives four consecutive tool interruptions, not five. Application code supplies the approval protocol. |
| Repeated approval interruptions | Confirmed limit. After the fifth interruption, the wrapper returns `restart_limit`. The model then answers, so the submission is `done` while the proposal record remains pending. The fixture refuses a subsequent decision for the dead task. | A completed submission is not proof of a completed proposal. Change the wait design or choose an explicit restart policy plus a separate crash-loop breaker. |
| Decision is recorded | Pass for fixture metadata only. The mutable record stores a constant proposal reference, test approver and timestamp. Repeated or invalid decisions fail. Approval produces one fake local effect. Rejection produces none. | The command chooses the pending item. It does not bind the decision to a supplied proposal ID or revision, authenticate an approver, or preserve immutable history. The local effect and receipt share a transaction. |
| Committed approval survives a crash before the effect | Pass. A deterministic gate stops the task after the decision commit, before the fake local effect. Recovery preserves the decision and produces one effect. A further reopen does not repeat it. | This is a transaction-local fake effect, not an external API. |
| Retry exhaustion is visible | Pass. Three killed model attempts exhaust two retries. The submission becomes `unanswered` with `interrupted` and reports `task_interrupted`. Reusing its request ID returns that failure. | A deliberate retry needs a new request ID linked to the original run. |
| UI reconnect shows current state | Pass in a minimal Chromium fixture, `tests/ui/phase-0.test.mjs`. The same open page shows `Disconnected` during a worker outage, then recovers the pending task. A new tab after completion shows the final transcript. | The read-only fixture polls fresh conversation-watch snapshots. Its HTTP adapter does not restart. It does not validate upstream Vue, SSE, HTTP-server reconnection, long transcript pagination, or a production UI. |
| `beforeTool` blocks a forbidden command | Pass. A `git push` call to the built-in bash tool gets a `blocked` diagnostic. The execution environment is never invoked. | The fixture blocks one exact string. Its environment refuses all real shell execution as a second precaution. This is not a command policy or sandbox. |
| Local Pi model/credential integration | Pass against a mock OpenAI-compatible endpoint. A Harness uses `ModelRuntime` and a temporary `local-ai` provider. Separate cases resolve a bearer key from `auth.json` and a literal `models.json` key. | This tests configuration plumbing, not any real service's compatibility or credential validity. |
| Existing local configuration | Pass for discovery. `local-ai/local-ai-auto` loads. `requestAuthSource` is `models_json_key`, not stored auth. `hasStoredCredential` is false for this provider. | This is declaration metadata, not a validated credential or precedence result when both stored and configured keys exist. No inference, OAuth refresh, configured key command, or real endpoint request was attempted. |

## Upstream local example

The reference was checked out as a detached **git worktree**, separate from this repository and the local Pi installation.
Worktrunk (`wt`) is not installed, so this experiment used git directly.

```bash
git clone --bare https://github.com/disler/durable-pi.git /tmp/tiny-factory-durable-pi.git
git --git-dir=/tmp/tiny-factory-durable-pi.git worktree add --detach \
  /tmp/tiny-factory-durable-pi-example 37165c619573dbaf425463038bbffecfe576beec
cd /tmp/tiny-factory-durable-pi-example/apps/proactive-dpi-demo
npm ci --ignore-scripts
npm run reset
npm run build
env -u OPENROUTER_API_KEY -u TYPESAFE_API_KEY -u ELEVENLABS_API_KEY \
  npm start -- --tts off --rate 1 --bug-at off
```

Use fresh scratch paths when repeating these commands. Do not put credentials in the clone's `.env`.
The reset creates only the demo's mock checkout repository and local databases.

Observed: install, reset and build passed on Node 22.23.4, below the demo's documented Node 24.14+ requirement.
Startup failed before a usable UI, with `Jev needs TYPESAFE_API_KEY or OPENROUTER_API_KEY`.
The backend exited 1. The wrapper exited 13 after an unsettled top-level await.
No upstream end-to-end incident or browser flow was tested. No keys were supplied.
The upstream dependency install reported four vulnerabilities. No fixes or dependency changes were applied to that checkout.

The demo pins **1.0.3**, not 1.5.0, and binds its agent wiring to OpenRouter.
Its approval phase calls the removed `runtime.sleep()` API. Its documents omit the now-required `checkpointWhen` predicate.
The 1.5.0 changelog also removes `viewState()` and replaces tool result `content` with `output` via the intervening releases.
The demo is a pattern reference, not source to copy into a 1.5.0 application.
The checked-in probes use public 1.5.0 APIs without modifying the package.

## Accepted integration boundary (not yet implemented)

1. A single backend process owns each run database. Add an application lock before Phase 1 execution.
2. Create a `ModelRuntime` from the existing Pi configuration. Pass it to `Harness.open()` as `models`.
3. Store submission IDs and request IDs. Reopen the same SQLite storage, register the same extensions, and call `resume()`.
4. Treat a factory run as an application record, not as a synonym for a conversation.
   A work item can gather several runs, and approval authorizes one specific proposal, never a whole run.
5. Model approval as application state plus a durable task. A replay-safe wrapper atomically creates or finds its child task.
   In 1.5.0, the child ends each pending phase with `sleepUntil()` and checks the committed decision on waking.
   The fixture's replay-safe wrapper holds a tool task while awaiting the child. Five interruptions exhaust its default restart limit.
   Before consequential actions, choose an approval flow that ends the run while pending and starts new work after a decision.
   Alternatively, deliberately configure the restart limit and supply an application crash-loop breaker. Do not set unlimited retries without one.
   A decision must reject a missing, terminal, completing, or abort-requested approval task.
6. Record the proposal revision, approver, timestamp and decision as immutable audit entries in the application.
   Keep a separate execution receipt and reconcile ambiguous external outcomes before another attempt.
7. Render current state from `Conversation.watch()` and application state. Use `ConversationTranscript` when paging becomes necessary.
8. Provide explicit failed/interrupted states and retry controls. A deliberate retry uses a new request ID linked to the original run.
   Reusing a failed submission's ID returns its stored failure. Do not interpret a completed input as a completed external action.
9. Keep durable APIs behind a factory-owned adapter. Budget for experimental API changes and rehearse data migration before upgrades.
   The package warns that APIs change without notice. Version 1.5.0 was released on the evaluation date.

The fixture's 50 ms approval polling is a fast test clock, not a production wait interval.
Each `sleepUntil()` writes durable state. Longer polling intervals or a separately designed wake protocol need workload measurements.

`ModelRuntime` loads built-in providers and `models.json`. It does not automatically load Pi extensions or their provider registrations.
Credentials stay in the host. Agent shell environments must not inherit provider secrets.
The credential probe is deliberately read-only, not an implementation of production OAuth refresh.

## Consensus ledger

Ground rules: severity is `blocker | major | minor | nit`. Evidence must be checkable, not an assertion.
Round cap: **4**. Each review is a fresh Opus 5.5 dispatch in Pi, as requested.
This is cross-model review, not the skill's usual cross-harness review.
Round 1 accepted F1–F4 and F7, objected to F5–F6, and added six findings.
The originator verified the source claims and reproduced the metadata behavior before responding.
Round 2 accepted F1–F9 and F11, lived with F10 pending stronger evidence, and added three findings.
**Outcome: consensus after 3 rounds.** Round 3 accepted all 14 entries and added no findings.
There are no live-with reservations or disputed entries in the final ledger. Consensus alone did not authorize implementation.
The owner subsequently accepted ADR 0001 on 2026-11-02, within Phase 0's evaluation scope. Later-phase actions remain unimplemented.

### Major

F1 [major] Process recovery passes, but checkpointed execution does not give exactly-once external effects.
  evidence: `tests/phase-0/recovery.test.mjs:15-60`; safe executes twice, unsafe once with `interrupted`; [library replay contract][library].
  action: Recommend the pinned library, preserve request IDs, reconcile unsafe interruptions, and require idempotency for external effects.
  status: agreed (round 1 accepted)
  history: Round 1 accepted. The safe and unsafe local-effect counts are red-capable assertions, not inferred from completion.

F2 [major] Approval persistence works only because the application supplies a durable proposal, decision and child-task protocol.
  evidence: `tests/phase-0/worker.mjs:23-76`; `tests/phase-0/recovery.test.mjs:62-89`; [upstream approval implementation][approval-source].
  action: Build an application approval protocol with immutable decision history and a proposal revision. Do not claim a built-in approval service or exactly-once publication.
  status: agreed (round 1 accepted)
  history: Rounds 1 and 2 accepted. NEW-3 adopted: fixture metadata does not bind a submitted decision to a proposal revision or preserve immutable history. The results table now states those limits. F12 further qualifies the restart claim.

F3 [major] Tool hooks can block calls, but shell-string checks and git worktrees do not enforce isolation.
  evidence: the blocked-command test in `tests/phase-0/recovery.test.mjs`; `tests/phase-0/worker.mjs`; [upstream boundaries][demo]; installed `pi-durable/dist/tools/bash.js:36-37` sets `inheritEnv: true`.
  action: Keep early runs supervised and tools narrow. Keep credentials out of child environments. Add verified process isolation before Phase 3.
  status: agreed (round 1 accepted)
  history: Round 1 accepted. Added the library's inherited-environment default as concrete evidence for keeping host secrets out of tools.

F4 [major] The upstream demo is not a drop-in 1.5.0 integration or a no-OpenRouter example.
  evidence: the worktree commands above; [demo package][demo-package] pins 1.0.3; [Jev constructor][jev-source] requires keys; [1.5.0 changelog][changelog] records breaking changes.
  action: Embed the pinned library directly. Reuse the demo's ideas, not its old API calls or network hub. Keep upstream UI execution marked unverified.
  status: agreed (round 1 accepted)
  history: Round 1 accepted. Upstream remains an unmodified 1.0.3 reference, not a verified no-OpenRouter application.

F8 [major] Experimental API churn creates integration and data-upgrade risk even when the tested version passes.
  evidence: [library warning][library] and [changelog][changelog] show breaking releases from 1.0.3 through 1.5.0. The 1.5.0 release date matches this evaluation date.
  action: Use a factory-owned adapter, pin dependencies, budget for upgrades, and rehearse migration and backup/restore before changing versions.
  status: agreed (round 2 accepted)
  history: NEW-1 adopted after verifying the warning and changelog. Added the trade-off to ADR 0001.

F12 [major] A replay-safe tool that waits for approval can exhaust its restart limit while its proposal still says pending.
  evidence: the repeated-approval-interruptions test in `tests/phase-0/recovery.test.mjs` kills the active wrapper five times. The next process reports restart_limit, returns a done submission, leaves a pending proposal with zero effects, and rejects a stale decision. The library's default restartLimit is 5.
  action: Do not use the fixture's wait pattern unchanged. End the run while approval is pending and start new work after the decision, or configure a deliberate restart policy with an application crash-loop breaker. Check task liveness before accepting a decision. Distinguish input completion from proposal execution.
  status: agreed (round 3 accepted)
  history: Round 2 NEW-A major adopted after reproducing it in a checked-in deterministic test and checking the library's restart accounting. The fixture now rejects dead-task decisions. Findings, README, and ADR qualify approval durability. No library patch or unlimited-retry setting was applied.

### Minor

F5 [minor] The model/credential path works against a mock endpoint and discovers the real local-ai configuration, but real inference remains unverified.
  evidence: `tests/phase-0/models.test.mjs` covers auth.json and literal models.json key sources. The real probe reports `local-ai-auto`, `models_json_key`, no stored local-ai credential, and `liveInference: not tested`.
  action: Use ModelRuntime rather than a custom credential loader in the application. Run a bounded, no-tool live smoke check before giving the first real model repository tools.
  status: agreed (round 2 accepted)
  history: Round 1 objected: disabled availability refresh makes configured-auth metadata describe models.json request auth, not stored auth. Conceded after inspecting provider-composer.js and model-runtime.js. The probe now reports source category and stored-credential presence separately. A second mock case tests the actual source kind, a literal models.json key. Round 2 accepted. Its reservation about mixed stored/configured credentials is now explicit in the table.

F6 [minor] A live read-only polling page recovers across a worker outage, but HTTP-server and production UI reconnection remain unverified.
  evidence: `tests/ui/phase-0.test.mjs:25` now retains the same page, asserts `Disconnected` after SIGKILL, and then asserts the original pending task after worker recovery. [Watch semantics][library].
  action: Use current snapshots as authoritative state. Validate the eventual UI's streaming, pagination, HTTP-server restart and reconnect behavior separately.
  status: agreed (round 2 accepted the stronger test)
  history: Round 1 objected that the old test only opened a fresh page after restart. Verified and agreed about the old test. Counter: strengthened the test to exercise the same page through a failed read and recovery. The HTTP adapter remains running and decisions use IPC, not the UI. Documentation now says so. Round 2 verified the stale page cannot pass and accepted the narrower claim.

F7 [minor] SQLite recovery still requires single-owner operation and does not establish power-loss durability or upgrade safety.
  evidence: [library Storage section][library] specifies one owner, no cross-process lock, WAL and synchronous NORMAL; [changelog][changelog] describes irreversible schema-v2 migration.
  action: Pin dependencies and a tested Node runtime, lock backend ownership, back up before upgrades, retain immutable audits, and expose storage failures. Do not claim host-failure coverage.
  status: agreed (round 1 accepted, extended for NEW-2)
  history: Round 1 accepted. NEW-2 adopted after reproducing the experimental node:sqlite warning on Node 22.23.4. The findings and ADR now require deliberate runtime selection.

F9 [minor] The approval crash window is now probed, but the fixture's 50 ms durable polling interval is not a production wait design.
  evidence: `tests/phase-0/worker.mjs` calls sleepUntil with now+50. The committed-decision crash test in `tests/phase-0/recovery.test.mjs` proves recovery before a fake local effect.
  action: Preserve the regression test. Measure write churn and choose a longer polling interval or a separate wake protocol for the application.
  status: agreed (round 2 accepted)
  history: NEW-4 adopted. Verified the 50 ms source interval. Added a deterministic post-decision/pre-effect kill point and test rather than relying on a timing race. The exact scratch WAL-growth figure is not a project benchmark and is not adopted.

F10 [minor] Exhausted model retries leave a terminal failed submission that does not restart when its request ID is reused.
  evidence: the retry-exhaustion test in `tests/phase-0/recovery.test.mjs` kills all three attempts, asserts unanswered/interrupted and task_interrupted, and reopens with the same request ID.
  action: Show this failure explicitly. A person-authorized retry uses a new request ID linked to the original run, without duplicating ambiguous external effects.
  status: agreed (round 3 accepted, replacing round 2 live-with)
  history: NEW-5 adopted after reproducing the scenario in a checked-in test. Added retry identity semantics to the integration boundary. Round 2 lived with the claim after independently confirming it, but found a vacuous no-request assertion (F14). The regression now counts every faux request unconditionally and waits for idle before its final snapshot. Round 3 accepted the stronger evidence and withdrew the reservation.

F13 [minor] The architecture summary must not describe an application-owned approval protocol as a built-in durable approval wait.
  evidence: README's architecture summary now names checkpointed tasks and sleeps as primitives for building the protocol.
  action: Keep the summary consistent with F2 and F12.
  status: agreed (round 3 accepted)
  history: Round 2 NEW-B conceded after finding the old wording left over from the plan. Corrected it.

### Nit

F11 [nit] Credential-discovery output must distinguish network policy from a measured request count.
  evidence: `scripts/phase-0/check-credentials.mjs` now reports modelNetwork as disabled by configuration, not a measured count. Mock tests separately assert zero discovery requests to their endpoint.
  action: Keep the policy label and do not present it as network instrumentation.
  status: agreed (round 2 accepted)
  history: NEW-6 conceded after verifying that networkRequests was a hardcoded zero. Renamed the output and removed the implied measurement.

F14 [nit] A no-retry assertion must observe every model request, including requests after a release gate opens.
  evidence: `worker.mjs` now logs every faux response invocation before checking the gate. The retry-exhaustion test waits for idle and asserts exactly three requests, no new answer, and the stored failure.
  action: Keep unconditional request instrumentation in this probe instead of a gate-dependent event check alone.
  status: agreed (round 3 accepted)
  history: Round 2 NEW-C conceded. Previously the worker emitted model-request only when the gate was closed, so its absence after releasing the gate proved nothing. Replaced that weak evidence with an unconditional log and idle synchronization.

## What the review changed

- Corrected credential-source attribution and added the real source kind to the mock integration tests (F5).
- Replaced the fresh-page-only browser check with a live page recovering across a worker outage (F6).
- Added post-decision crash and exhausted-retry probes, then replaced a vacuous assertion with unconditional request logging (F9, F10, F14).
- Added experimental API/runtime risks and corrected the remaining built-in approval wording (F7, F8, F13).
- Discovered and reproduced the approval wrapper's fifth-interruption limit. The fixture now rejects dead-task decisions, and the proposed design no longer treats that wrapper as an unlimited wait (F12).
- Removed the hardcoded request-count claim from credential-discovery output (F11).

The final reviewer accepted every entry. F10's round 2 live-with reservation was resolved in round 3.
The owner accepted ADR 0001 on 2026-11-02. This records the integration decision only.
No Phase 1 implementation or consequential action follows automatically from consensus or this acceptance.

## Sources

[library]: https://github.com/earendil-works/pi/blob/v1.5.0/packages/durable/README.md
[changelog]: https://github.com/earendil-works/pi/blob/v1.5.0/packages/durable/CHANGELOG.md
[demo]: https://github.com/disler/durable-pi/blob/37165c619573dbaf425463038bbffecfe576beec/apps/proactive-dpi-demo/README.md
[demo-package]: https://github.com/disler/durable-pi/blob/37165c619573dbaf425463038bbffecfe576beec/apps/proactive-dpi-demo/package.json
[approval-source]: https://github.com/disler/durable-pi/blob/37165c619573dbaf425463038bbffecfe576beec/apps/proactive-dpi-demo/apps/proactive-dpi-be/src/extensions.ts#L242-L276
[jev-source]: https://github.com/disler/durable-pi/blob/37165c619573dbaf425463038bbffecfe576beec/apps/proactive-dpi-demo/apps/proactive-dpi-be/src/jev.ts#L25-L44

- [Pi SDK, v1.5.0](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/docs/sdk.md)
- [ModelRuntime, v1.5.0](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/src/core/model-runtime.ts)
- [Durability specification, v1.5.0](https://github.com/earendil-works/pi/blob/v1.5.0/packages/durable/docs/spec.md)
