---
status: accepted
accepted: 2026-11-02
---

# Embed pi-durable 1.5.0 rather than adopt Durable Pi's applications

The Phase 0 probes pass the manual-run restart gate, unsafe-tool recovery, one-restart approval persistence, and minimal polling-page recovery checks.
We will embed `@earendil-works/pi-durable` 1.5.0 in a single-owner Node.js backend, with SQLite and Pi's `ModelRuntime`.
This reuses checkpointed execution without adopting the upstream hub, OpenRouter wiring, or demo code pinned to 1.0.3.
The plain Node.js/SQLite fallback remains unnecessary unless the required recovery behavior fails.

The factory must supply work items, proposal-specific approvals, immutable decisions, external-effect reconciliation, process ownership, limits, and scheduling.
The fixture's waiting approval tool fails after five consecutive interruptions under the default restart limit, leaving a pending proposal record.
Before consequential actions, use a protocol that ends the run while pending and starts new work after a decision.
Alternatively, deliberately configure the restart policy with a separate application crash-loop breaker. Validate task liveness before accepting decisions.
A `done` submission is not proof of a successful proposal or external action.
Tool hooks and worktrees are not a sandbox. Unattended execution requires verified process isolation.
The mock endpoint proves model integration, but the owner's live credentials and endpoint still need a bounded smoke check before repository tools are enabled.
The API is experimental and changed across several recent releases. Keep durable calls behind a factory-owned adapter and budget for upgrade work.
Pin dependencies and rehearse database migration and backup/restore because storage changes can prevent rollback.
Node 22.23.4 also marks `node:sqlite` experimental. A tested runtime must be pinned before Phase 1 implementation.
In the subsequent [Phase 1 interview](../phase-1-plan.md), the owner selected Node 24.21.0 after the unit/integration probes passed 11/11 under that runtime.
Applying the repository-local pin remains Phase 1 implementation work; the original browser evidence remains on Node 22.23.4.

The project owner accepted this decision on 2026-11-02 after three rounds of consensus review.
This completes the Phase 0 integration decision, not the backend implementation.
Phase 1 implementation, the Phase 2 approval workflow, and external actions remain outside this authorization.
See [Phase 0 findings](../phase-0-findings.md) for evidence and limits.
