# Phase 1 integrated verification

This records lane A's completed repository checks on 2026-11-07 UTC. Final pipeline review and the real degraded-manager criterion remain pending. This is neither Phase 1 completion nor real Vanguard/provider acceptance.

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

## Remaining gates

- The selected no-mistakes pipeline must perform Claude Opus 5.5 high Standards and Spec review of the **complete historical implementation diff from `721cdd54374f3077f6f201621c823e214a9dced4` through its actual head**, including the native-fetch Test repair beyond the earlier Opus-reviewed head. Separate examined/unexamined coverage is required. No independent review was run here.
- Pipeline Test must obtain the bounded real healthy-but-degraded manager proof using the existing owned memory diagnostic and public lifecycle interfaces. Mocked observations and this suite's normal lifecycle pass do not satisfy it.
- Pipeline lint/documentation/publication and actual hosted CI remain pending. Hosted CI covers Phase 0 and JavaScript syntax; it cannot substitute for these local full-suite/browser receipts. Unchanged Test may consume these source-bound results without repeating the entire suite.
- Real packages, provider OAuth/server acceptance, Vanguard baseline/regression/final checks and positive owner readiness belong to p1-live. Firstmate separately reported an intentional publisher-`devDependencies` preparation refusal; controlled green does not resolve that policy choice or complete the live run.

The immutable private `verification-plan.txt` specifies the exact historical diff command, final review coverage, pinned runtime, owned-scope rules and remaining scenario. `artifact-sha256.json` binds the retained receipts. Later runtime changes require affected fresh proof and review; historical checkpoints remain historical.
