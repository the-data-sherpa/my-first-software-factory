# Phase 1 integrated verification

This records lane A's completed repository checks on 2026-11-07 UTC and the subsequent evidence-publication pipeline outcome. Its bounded degraded-manager criterion passed; pipeline Review covered the evidence document only. Historical Standards and Spec audits returned findings and incomplete coverage. Phase 1 and real Vanguard/provider acceptance remain incomplete.

## Source and runtime

Tested merged revision: `d95364493c8627f98b1ea67a1cb5b4fe7a2a5b93`, tree `bc2bff5535066ab13bfae3eb035c4bdec06545d7`. It includes the dependency retention, lifecycle replacement, and capped Sonnet OAuth corrections, including the later native-fetch drainage repair.

The recorded commands used `/home/cowen/.local/share/mise/installs/node/24.21.0/bin/node` and its adjacent npm CLI, with command-local PATH selecting that Node for children. Node reported `v24.21.0`; executable SHA-256: `7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c`. No runtime distribution or global configuration changed.

All 199 tracked file hashes matched before and after each invocation. The 58-file runtime manifest covers `src/`, `bin/`, package files and `.mise.toml`; its SHA-256 is `8cd68fc03aae665e79a79a9606da185af2c224a8c60386b9370f6a40708f9e60`. Its exact encoding and constituent hashes are retained in `runtime-binding.json`; this is a source manifest, not a product readiness attestation.

## Executed checks

Private receipts are under `/home/cowen/Projects/firstmate/data/p1-acceptance/`. Each `*-start.json` records exact argv, cwd, allowlisted environment, timeout and source hashes; corresponding stdout/stderr logs and `*-exit.json` preserve actual outcomes.

| Check | Observed result | Receipts |
| --- | --- | --- |
| Frozen factory-only `npm ci --ignore-scripts --no-audit --no-fund` | Exit 0; 128 packages; source unchanged | `factory-npm-ci.*`, `factory-npm-ci-{start,exit}.json` |
| Complete `npm test`: Phase 0 and Phase 1, `--test-concurrency=1`, no selection/exclusions | **561/561 passed**, zero failures/cancellations/skips/todos; 3,319,552.125 ms; exit 0 | `full-suite.*`, `full-suite-{start,exit}.json` |
| Existing `CHROMIUM_PATH=/usr/bin/chromium npm run test:ui` | **1/1 passed**, zero failures/cancellations/skips/todos; exit 0 | `browser.*`, `browser-{start,exit}.json` |

Chromium was the installed `155.0.8059.84` Arch Linux build. The browser check covers the Phase 0 polling/outage/reconnect probe. The suite includes the native-fetch held-Messages-body cancellation regression and public CLI linked replacement after whole original scope extinction. These executed checks do not establish final review coverage.

Large fixtures used canonical disk-backed `/var/tmp/p1-acceptance-host-_3nxzp9w`, outside every Git ancestor and the quota-limited `/tmp` filesystem. Small control-state storage was separately owned; `/tmp/p1-acceptance-nxz3tfcl` was reserved for this lane. Existing fixed small diagnostics retained their prescribed `/tmp` paths. HOME/configuration were disposable, Pi was offline, and no operator credentials, real target acquisition/execution or production-model request was used. Product limits and pins stayed unchanged.

The existing cleanup hook recorded **310 exact scopes**. Fresh `fresh-scope-audit.json` confirms every recorded unit terminal/absent with empty/absent cgroup trees, and no recorded survivors. This audit covers those registered scopes, without a shared-unit prefix scan or a claim about unrecorded ownership. Original logs and artifacts remain at their recorded paths; no historical evidence was relocated or broadly deleted.

## Subsequent pipeline outcome and review limits

No-mistakes run `01M6SYG38NPR4FQ2BZ90XPY910` completed Review, Test, Document, Lint, publication and hosted CI. Actual Claude Opus 5.5 high Review examined only the new evidence document, explicitly excluding the historical runtime diff and native-fetch drainage repair. Its two informational findings recorded that coverage limit and the missing current-record pointer; publication added pointers. This pass does not establish historical Standards/Spec coverage.

Final pipeline Test passed **3/3 controlled scenarios**: native HTTP cancellation, Phase 0 browser outage/reconnect without duplicate effects, and real healthy/degraded-manager linked replacement. The last scenario retained the existing memory diagnostic's failed scope while the same manager stayed active/running with `SystemState=degraded`; the public lifecycle test refused replacement with a surviving descendant, then admitted linked replacement after drainage, preserving the original draft, counters, reservations and deadline. This later composed Test closes the bounded criterion; the earlier minimum ownership capture/retirement proof alone did not cover linked replacement under degradation.

Raw receipts are under `/home/cowen/.no-mistakes/evidence/01M6SYG38NPR4FQ2BZ90XPY910/`: `degraded-manager.json`, `lifecycle/replacement.json`, `execution-receipts.json` and `final-audit.json`. Retained copies and summary are in `data/p1-acceptance/nm-final-test-proof/` under `/home/cowen/Projects/firstmate/`. All started children were awaited; the three exact final-Test scopes were absent/inactive, recorded backends extinct and cgroups absent. Normal exact-unit cleanup restored manager state to running. Initial workspace diagnostic refusal, missing user-bus environment and Chromium socket-path setup failures remain in the logs; successful later invocations do not erase them. These are local synthetic SDK/browser/lifecycle results, not real provider or Vanguard acceptance, and the complete suite was not repeated.

[The evidence publication](https://github.com/the-data-sherpa/my-first-software-factory/pull/15) received **2/2 hosted Phase 0/JavaScript syntax checks** at head `db298779342ed8aa44349f609db0be625799fa0a` and merged at `fbd11a8105eae4090f8743e162d5b094f91bb3fe`. Hosted CI did not run full Phase 1 or Chromium. `data/p1-acceptance/merged-final-audit.json` binds both published/merged runtime identity to the unchanged 58-file `d953644` baseline manifest above and records 315 exact retained scopes terminal/empty. That later audit does not alter the original 310-scope baseline. These historical CI results make no claim about a later documentation follow-up's CI.

The separately authorized knowledge-only historical audits cover `721cdd54374f3077f6f201621c823e214a9dced4` through `d95364493c8627f98b1ea67a1cb5b4fe7a2a5b93`, including the native-fetch repair. Their FINAL reports are `/home/cowen/Projects/firstmate/data/p1-standards/report.md` and `/home/cowen/Projects/firstmate/data/p1-spec/report.md`; each has actual two-round Claude Opus 5.5 high invocation/results and `audit-evidence.json` coverage receipts. Neither audit executed tests or establishes complete historical coverage. This knowledge-only exception is separate from the no-mistakes path for code repairs, tests and publication.

- Standards retained four minor findings: published `os`/`cpu` type validation, an omitted recovery-owner assertion in the independent admission list, incomplete native-fetch causal provenance, and stale approval/review wording. Nine advisory judgments remain. Surrounding source in three modules and admission after line 140, underlying pipeline artifacts and document-only target equivalence remain unverified.
- Spec withdrew the earlier missing-peer finding, retained a low native-fetch evidence correction and a low wording advisory. Equivalent cancellation probes support pre-repair failure and later success, but r3 driver bytes, exact source bindings and the retained regression's red receipt remain missing; copied `nm-postfix` artifacts do not prove green. Referenced unprovided workers/fixtures, SDK internals and raw degraded/lifecycle artifacts were unexamined by that audit; its lifecycle conclusion relied on pipeline summaries.

## Remaining work

Historical audit findings and coverage gaps remain for disposition; this factual correction neither repairs runtime nor upgrades incomplete audit coverage to complete. Real packages, provider OAuth/server acceptance, Vanguard baseline/regression/final checks and positive owner readiness remain incomplete. The first actual locked `@alloc/quick-lru@5.2.0` input was intentionally refused for nonempty publisher `devDependencies`. `/home/cowen/Projects/firstmate/data/p1-live/diagnostic-001/causal-report.md` records causal evidence; `/home/cowen/Projects/firstmate/data/p1-live/semantic-001/report.md` records a synthetic two-package Bun primitive comparison, not product admission. `p1-registry-policy` retains the unanswered owner scope choice. No metadata admission change or policy interpretation follows from those observations. Pi reported Anthropic OAuth ready, but no real provider request, target baseline or draft completed. Controlled green does not resolve the policy choice or complete the live run.

The immutable private `verification-plan.txt` preserves the original historical review requirement, limits and then-pending scenario; it is not rewritten by these subsequent outcomes. `artifact-sha256.json` binds the original retained receipts. Later runtime changes require affected fresh proof and review; historical checkpoints remain historical.
