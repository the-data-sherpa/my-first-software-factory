# Explicit replacement of an interrupted composed run

This completes the bounded local-draft recovery path required by Phase 1 Q22. It does not enable resume, remote cancellation, or live Vanguard acceptance.

Before model/tool work, a composed executor records its run/source identity, foreground scope invocation, backend PID/start time, host boot/namespaces, and user-manager lifetime. The private executor intent binds that immutable record. Repository tools cannot write either store.

Only an explicit control operation assesses retirement. It requires the original backend to be extinct and its exact original unit terminal, with an absent or empty descendant cgroup tree under the same manager. It also validates the retained workspace, dependency bundle, execution profile, and permitted draft scope. Missing legacy evidence, mismatched identities, changed topology/profile, surviving processes, or unexpected effects refuse with `RECOVERY_REQUIRED`. Inspection never runs this assessment or starts work. Resume remains `UNSAFE_RESUME`.

At capture and retirement, `user@UID.service` must be active/running with a live manager process. The manager's invocation ID, PID and process start time must remain unchanged. Both `SystemState=running` and `SystemState=degraded` are accepted; unrelated failed user units do not establish manager loss. Other manager states refuse. The controlled observations in `tests/phase-1/recovery-owner.test.mjs` cover these checks without inducing an actual manager outage.

The explicit replacement receives a new identity and isolated pristine worktree from the original admitted commit, even if local `main` has advanced. The old worktree, partial artifacts, uncertain model/tool reservations, counters and original deadline remain historical evidence. An unknown remote attempt is not declared cancelled or refunded. This guarantee relies on the accepted contained tools having no effects beyond the quarantined worktree and bounded scratch; it does not reconcile arbitrary external effects.

## Controlled proof, 2026-11-06

One public CLI integration case kills the real composed fixture backend after a synced write but before reservation settlement, leaving a trusted fixture descendant alive in the original scope. It observes:

- Passive inspection and refused resume, with no recovery model request.
- `RECOVERY_REQUIRED` while the original descendant survives.
- Five missing/altered ownership-record refusals through the public execution seam, including run, boot, scope invocation and manager identity mismatches.
- Successful explicit linked admission after positive whole-scope drainage, preserving the original partial draft, **3 model attempts**, **6 tool rounds**, **17,408 reserved output tokens**, reservations and deadline.
- A distinct worktree pinned to the original admitted commit after an independently advanced fixture `main`, and idempotent replacement requests.

The new run honestly blocks with `CONTAINMENT_REQUIRED` because the inspection/replacement test backend is uncontained. This proves linked admission and isolation, not a successful replacement maintenance result or owner readiness.

The identical updated harness failed against frozen pre-fix application/executor code at the post-drain CLI replacement (`RECOVERY_REQUIRED`, exit 1, **21.278 seconds**) and passed against the correction (**1/1**, no skips, exit 0, **21.025 seconds**). Source/harness hashes, actual paths/environment, run records and scope receipts are retained under `/home/cowen/Projects/firstmate/data/p1-lifecycle/{red-home,green-home}/`. The fresh `10-final-focused-audit.json` records **4/4 exact scopes inactive and empty**, including the earlier red and setup failure, plus independent original-backend extinction.

An earlier corrected attempt failed during Bun fixture copying because of `/tmp` UID quota; it exercised no recovery behavior. Its evidence and the first red remain retained in verified private archives. The small diagnostic-fixture correction honors per-command Node `os.tmpdir()` for host assets. Large assets now reside in task-private home-state storage; a separate small `/tmp` state root keeps the CLI Unix-socket path valid. Product sandbox mounts/privacy, inner 256 MiB scratch, and acquisition/export/command/run limits are unchanged.

The original CLI-only checkpoint passed 44/44 light lifecycle tests at `afd75ec`; that count is historical, not a fresh suite result for this correction. Current full-suite/browser, independent development review, CI, live provider/toolchain/Vanguard behavior, and real #10 acceptance are not established by this focused proof. The required no-mistakes delivery and final integration own those remaining checks. Actual host/manager failure was not induced; identity/topology uncertainty remains a refusal.
