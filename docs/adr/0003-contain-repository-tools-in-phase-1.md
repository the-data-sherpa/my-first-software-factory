---
status: accepted
accepted: 2026-11-02
---

# Require contained repository tools in Phase 1

Require verified execution boundaries before enabling Phase 1 repository tools, rather than postponing process isolation until unattended scheduling.
A scratch probe showed that an interrupted tool's process can survive backend SIGKILL; worktrees and command hooks do not prevent that or isolate host credentials.
The owner accepted the additional Phase 1 work in exchange for a contained first maintenance run.

Limit repository access to the run's worktree and expose a fixed-command check runner, not unrestricted bash.
The runner must use direct argv invocation, a scrubbed environment, no host-private mounts, no tool network access, and verified parent-death cleanup.
The backend retains its separate access to the chosen model; repository tools do not inherit model credentials.
If the real repository or toolchain cannot run within the boundary, block execution instead of silently weakening it.

The [execution findings](../phase-1-execution-findings.md) establish only minimal scratch properties, not a validated Vanguard sandbox.
The actual filesystem tools, mounts, toolchain, launcher topology, and cleanup behavior must pass verification before use.
This decision does not authorize implementation or live inference during the design interview.
