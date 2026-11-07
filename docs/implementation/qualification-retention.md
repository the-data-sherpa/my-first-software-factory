# Retaining controlled helper qualification evidence

Scope: publication checkpoint `e9fcb87ca6e1c8025142bb9cd905b067cc1b19a7`, with a correction to the helper test wrapper and its README description. Runtime code, dependency/runtime pins, qualification policy, budgets and authority are unchanged. This is a focused development check, not Phase 1 completion or live owner-readiness evidence.

## Defect and correction

`tests/phase-1/helper-compatibility.test.mjs` saved the requested evidence receipt, then deleted a successful fixture root even when `FACTORY_HELPER_COMPATIBILITY_EVIDENCE` was set. The receipt therefore referenced deleted patch, source and check artifacts. The wrapper now retains successful roots when evidence is requested, matching the existing qualification and composed-execution wrappers. Default successful cleanup and failed-case retention keep their existing behavior.

The README also described the older helper grammar. It now records the supported nullable parameter, immutable leading guard, non-reassigned `let`, and pre-model eligibility gate. No parser change was needed.

## Focused proof

Private evidence: `/home/cowen/Projects/firstmate/data/p1-qualification/`. Node 24.21.0. The reusable `retention-proof.mjs` invokes the existing helper test through Node's test runner and then reads the actual retained patch and check receipts referenced by its CLI-produced Work item. It does not supply a verifier, handoff, successful receipt or readiness flag.

The positive case uses the factory application and CLI, actual admission/executor/qualifier, controlled model transport and synthetic Vitest/ESLint packages. It verifies:

- the retained candidate regression on base and draft, independent oracle and ten ordered qualification stages;
- a complete helper/new-test patch, including nullable cases, with the original checkout unchanged;
- one controlled Work item, 18 original tool rounds, unchanged deadline, and `reviewReady: false`;
- duplicate request identity without repeated model work.

The changed-guard case checks that a byte-different but behaviorally equivalent empty-string guard is refused with `QUALIFICATION_SCOPE`, before qualification checks or Work item creation. The passive-construction case separately checks no runtime initialization, refused injected authority, and unsafe resume refusal.

- Red: the unchanged wrapper's `nullable-qualified` case passed **1/1**, then the retention assertion failed with `ENOENT` for `/tmp/factory-dependencies-8HBK06`. This is an evidence-retention failure, not a failed qualification. See `retention-red.log` and `red/test.log`.
- Green: after the one-line cleanup correction, `nullable-qualified` and `changed-guard` passed **2/2**, with no skips. The same retention assertion verified the actual two-file patch/new test and all ten check receipts. See `retention-green.log`, `green/test.log` and `green/retention-verified.json`.
- Positive fixture: `/tmp/factory-dependencies-K4Az9n`, run `run_cacf1d19-4c43-4385-9842-605cdb43140c`; the qualified controlled outcome used 5 model attempts, 18 tool rounds and 33,792 reserved output tokens. These are controlled requests and reservations, not paid model usage.
- Guard-refusal fixture: `/tmp/factory-dependencies-3VIb4b`; `QUALIFICATION_SCOPE`, no Work item, 5 model attempts and 8 tool rounds. No qualification check was dispatched.
- Light passive-construction check passed **1/1**, no skips (`passive-construction.log`). The red and green harness audits plus a fresh exact-unit audit found **3/3** scopes inactive and empty (`scope-audit.json`). No broad cleanup was performed; both green fixture roots remain retained.
- A fresh offline CLI `inspect` of the retained positive run verified complete current evidence, ten stages, unchanged counters and controlled `reviewReady: false` after the backend closed (`offline-positive.json`). Syntax, local link destinations and whitespace checks passed.
- `source-before.json` and `source-after.json` bind 140 source/config/test hashes: 139 unchanged, with only the helper test wrapper changed. All runtime modules and dependency/runtime pins are unchanged.

For subsequent integrated checks, review coverage and remaining gates, see [Phase 1 integrated verification](phase-1-integrated-verification.md). Historical adversarial coverage remains revision-bound in the [helper review](helper-followup-review.md) and [ticket #9 integration record](ticket-09-integration.md); it is not a fresh test total for this change.

## Real #10 qualification still required

The [publication checkpoint](publication-checkpoint.md) records the historical integration state. The [controlled #9 acceptance](ticket-09-integration.md#owner-acceptance-and-next-authority) deferred positive owner readiness and its stale-evidence downgrade to #10; this fixture does not resolve that deferral.

The proposed coordinated run must admit an exact local-main Vanguard commit, explicitly prepare/reuse its real locked Bun bundle with scripts disabled, and use `factory-contained.mjs serve --execute-agent` with the existing CLI `start --dependency-run` and exactly the selected helper/test write paths. It must use the selected capped `anthropic/claude-sonnet-5-5` route through Pi OAuth at low adaptive effort ([ADR 0006](../adr/0006-use-capped-anthropic-oauth-in-phase-1.md)), real healthy baselines, actual executor writes, the same candidate failing on base/passing on draft, independent oracle, and real final full Vitest/lint receipts within the unchanged original limits.

Observe an actual owner Work item with current verified evidence and `reviewReady: true` online and after graceful backend closure. With separately scoped authority, preserve the completed private draft helper bytes, append one newline only in that factory-owned worktree, and inspect offline for a readiness/freshness downgrade without execution or historical evidence repair. Restore the exact draft bytes and record the next inspection. Keep the original checkout, retained patch/check artifacts, counters, deadline and receipts unchanged throughout.

A detailed command/input/resource proposal is retained as `live-qualification-proposal.md` under the private evidence root for Firstmate's final acceptance task. Source admission, real packages, target execution, credentials/model calls and the reversible freshness probe were not performed here. No-change, blocked, failed, interrupted or stale outcomes remain incomplete; synthetic framework events cannot establish real distribution compatibility or owner readiness.
