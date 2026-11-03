---
status: accepted
accepted: 2026-11-02
---

# Keep crash recovery operator-controlled

After a backend crash, expose the interrupted run for passive inspection without automatically executing models or tools.
The owner chose explicit recovery over automatic restart. Tools may have partial effects or surviving subprocesses. A durable record alone does not establish safety.
Stop requests and graceful backend shutdown cancel active work, retain its artifacts, and produce a terminal stopped result.

An explicit resume may continue the same run only after the operator reviews partial effects, verifies containment, and checks its remaining original budget.
Do not reset the run's budget, blindly repeat unsafe effects, or let inspection or another start wake its pending work.
If safe resume is unavailable or the run has exhausted its limits, require an explicit new linked run instead of a silent retry.
A control command is not a proposal-specific Approval. The Phase 2 approval workflow remains out of scope.

The [execution findings](../phase-1-execution-findings.md) describe passive inspection and the SDK calls that enable session-wide scheduling.
The implementation must pass tests for cancellation, fencing, and recovery. This decision does not claim the implementation already meets those guarantees.
