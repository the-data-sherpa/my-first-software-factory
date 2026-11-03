---
status: accepted
accepted: 2026-11-02
---

# Isolate durable execution stores per run

Use a factory-level SQLite record store and a separate durable execution store/session for each factory run.
The SDK enables scheduling session-wide and has no public per-conversation hold, so a shared execution session could wake an interrupted run during another start.
The owner chose per-run isolation over indirect fencing within a shared session, accepting extra files and crash-reconciliation work.

The factory store owns project and run identity, admitted configuration, and application outcomes, with references to execution receipts and artifacts.
Only an explicit start or resume enables the selected run's scheduler. Inspection remains passive.
Persist admission intent and stable request IDs before enabling execution, then reconcile interrupted or completed receipts after a crash.
Do not claim atomic commits across the separate stores or use resubmission as a passive lookup.

Hide this behavior behind the factory-owned execution module's interface, not raw SDK handles exposed to callers.
This is still one factory and one backend, with project-scoped work and one active run total in Phase 1.
Separate execution stores do not create per-project factories or authorize multi-project execution.

See [the execution findings](../phase-1-execution-findings.md) for scheduler behavior and [ADR 0004](0004-operator-controlled-recovery.md) for the recovery contract.
This decision does not claim the implementation or its recovery tests already exist.
