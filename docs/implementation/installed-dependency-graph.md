# Installed dependency graph verification

Controlled implementation checkpoint for the accepted P1 contract in the parent checkout's `dependency-policy-proposal.md`. The parent wired the verifier in isolated stream B; its current dedicated public regression file passed 8/8. The first public red remains retained. Parent integration, broader checks and independent review remain separate gates. No acceptance or readiness follows.

## First vertical regression

`tests/phase-1/dependencies-graph.test.mjs` uses the existing public admission, real contained Bun preparation, passive inspection and opaque bundle verification interfaces. Its authored graph is the already observed controlled rehoist: lock keys put `lowpeer@6` at root and `lowpeer@8` below `holder`; Bun places `lowpeer@8` at root and `lowpeer@6` below `user`. The test independently requires the observed `kw` peer to resolve to root `lowpeer@8` and `user`'s ordinary dependency to resolve to its nested `lowpeer@6`.

The new requirement is `receipt.graph.status === 'verified'`, with deterministic node and relationship observations bound to the installed inventory. On `e0e27928e39d9be2946c8f9b8f49c90ea426b8c7`, the public regression selected one test and failed that exact assertion, exit 1: actual Bun preparation, passive inspection and opaque bundle verification had succeeded, but `graph` was absent. This is a required-feature red, not proof that an actually unsatisfied peer had been accepted.

Evidence: `/home/cowen/.local/state/tiny-software-factory/development-evidence/installed-graph-S29rzg/`, containing exact command, nine source hashes, terminal output/exit, per-test worker result and handoff. Worker exit was 0; outer test exit was 1. The failed root `/tmp/factory-dependency-graph-YwueCH` remains. After actual terminal exit, all nine source hashes still matched and the one exact owned scope was freshly inactive and empty. The heavy slot was explicitly released before implementation, then separately transferred back after parent wiring for the checks below.

## Verifier and parent wiring

The new `src/dependencies-graph.mjs` exports:

`verifyInstalledGraph({ directory, archivesDirectory, inventory, manifest, lock, plan, signal })`

Inputs are the sealed bundle directory, required retained archive directory, already validated inventory, parsed retained root manifest and Bun lock, rederived admitted acquisition plan and original optional AbortSignal. `lock` is needed to prove an absent optional relationship is an admitted non-host exclusion: current `plan.excluded` contains placement keys without their identities or platform metadata. The implementation rederives the plan and compares archives, exclusions and unmet-peer observations, while requiring the admitted official registry and Linux/x64 host.

The verifier reads installed package manifests as bounded duplicate-key-checked JSON through existing nofollow file helpers, identifies package roots structurally from the validated inventory, compares each name/version and relationship metadata with its acquired identity, resolves ordinary/optional/peer providers in the actual layout, requires the complete expected identity set and rejects unexplained or unreachable placements. It does not equate lock keys with installed positions or import package code.

Each identity's installed occurrence count cannot exceed its non-excluded locked occurrence count. This permits matching rehoists and collapsed duplicates while rejecting unexplained extra copies, including a carrier archive's nested payload that otherwise claims a planned identity. If actual pinned Bun demonstrates a legitimate frozen form requiring additional copies, that remains a technical compatibility gap; the bound must not be silently raised. The earlier module snapshot before this additional derived check is retained privately as design history, not behavioral evidence.

Every installed package's own file bytes and types must match its exact acquired archive, rather than assigning archive integrity merely because a name/version matches. Direct nested `node_modules` packages are independently identified and content-bound; ordinary package-owned subdirectories remain part of their package's file comparison. Bin executable-mode changes are permitted, while existing regular-file/link/type rules remain. Archives are read serially through the shared retained-path helper and validated by existing `registryArchive`; compressed, expanded and file-entry totals retain `FETCH_LIMITS`. Only expected hashes/type records are accumulated, not all expanded archive buffers.

Each actual root `.bin` shim must match an installed package's admitted bin name and exact normalized target, in addition to the existing safe-link/regular-target rules. Not every declared bin must win a collision. A parent package's declared target inside its own nested package can match; unexplained shims cannot.

Cancellation is checked between bounded archive/file/relationship operations, with event-loop yields during large iterations. Observation growth uses the existing prepared-receipt byte limit; the parent must additionally cap the whole prepared receipt before saving it, so a graph cannot create an unreadable prepared marker.

Installed inventory file lengths are explicitly required to be safe nonnegative integers, at most the existing 8 MiB per-file limit and 64 MiB total export limit. Rechecking path/type shapes with blank file data is not sufficient to establish those totals; duplicate installed copies count separately.

Parent-supplied shared exports from `dependencies-lock.mjs`:

- `registrySatisfies(version, spec)`, delegating to existing bounded version/range parsing and matching; do not mirror SemVer logic or inject a matcher callback.
- `validateRegistryManifest(manifest, entry)`, extracting the existing archive manifest checks so installed metadata and archive admission use the same rules, including the parent's accepted bounded libc implementation.
- `registryBins(bin, name)`, reusing the existing string/object bin normalization for actual shim consistency.

Other small shared exports: `retainedArchivePath(archivesDirectory, index)` from `dependencies-registry.mjs`, reused by acquisition/verification/graph reading, and `DEPENDENCY_FILE_BYTES`, `DEPENDENCY_EXPORT_BYTES`, `DEPENDENCY_RECEIPT_BYTES` from `dependencies-files.mjs`, naming the existing 8 MiB, 64 MiB and 16 MiB limits. The parent owns these common-file changes.

The graph receipt shape is `{ version: 1, status: 'verified', policy: 'bun-installed-graph-v1', inventoryDigest, nodes, relationships, absentOptional }`. Nodes and relationships are deterministically sorted. Relationship entries explicitly name source placement, kind, declared name/range, actual target placement/version and optionality. Absence entries must explain the admitted optional rule rather than silently drop missing edges.

Parent wiring calls it after sealing and before writing any prepared result. Passive `inspectDependencies` first verifies inventory, recomputes the graph from validated retained inputs, requires the graph marker and compares the full observation with the saved receipt; `verifyDependencyBundle` and mounts already transit inspection. The registry preparation fingerprint includes the graph implementation and its shared dependencies. Common execution evidence lists still require the parent's integration changes. A policy identifier alone is provenance, not verification.

## Executed controlled evidence

The same public feature regression passed 1/1 after wiring (`green1`). Further cases were added and checked vertically; the final current dedicated file passed **8/8, exit 0**, with no skips, in `final/output.log`. The final source snapshot and complete copied sources are `final/source.sha256` and `final/source/`; all thirteen recorded source files matched after the run. The runtime graph module remained byte-identical throughout these green checks: SHA-256 `cbaa441baf71eb252e37a36a0d399b6d5c210acd054b542c23e562f3ade12f1b`.

| Case | Public observation |
| --- | --- |
| Rehoisted ordinary and peer relationships | Prepared dependency bundle, verified graph receipt, literal observed placements, matching passive inspection and opaque bundle verification. This is not factory Work item qualification. |
| Unsatisfied installed required peer | Actual Bun exported and sealed `kw` requiring `lowpeer ^8`, with `lowpeer@6` installed. Graph refused with `DEPENDENCIES_UNSUPPORTED`; no prepared result; inspection incomplete. |
| Unplanned nested package payload | Actual Bun retained the carrier archive's nested `phantom` manifest. Graph refused after seal; no prepared result. This is not an earlier admission/Bun refusal. |
| Spoofed planned identity | A nested payload's manifest claimed a planned identity and stayed within locked multiplicity, but its installed file bytes differed from that identity's acquired archive. Graph refused with `DEPENDENCIES_UNSAFE` after seal. |
| Extra matching copy | Actual nested and root file contents matched, but the install exceeded that identity's non-excluded locked occurrence count. Graph refused with `DEPENDENCIES_UNSUPPORTED`. |
| Scoped/nested and optional relationships | Root scoped provider 3 and nested provider 2 resolved as explicitly expected. Missing optional peer and non-host optional dependency had distinct recorded absence reasons; only the three planned host archives were requested. |
| Missing/forged graph or stale implementation | Started from genuine prepared state, then changed only retained graph observations (missing marker, digest, relationship, policy). Passive inspection and bundle verification refused, exact restoration inspected prepared, and no new requests occurred. A forged graph source hash in a saved intent refused stale before an attempt/request. No initial prepared success was fabricated. |
| Forged bin observation | Started from genuine prepared state and redirected its shim to another planned regular file, updating the saved inventory and digest to match. Generic link/type checks could pass, but graph bin consistency refused. Exact link/receipt restoration inspected prepared without new requests. |

All foreground runners exited. `final/all-scope-audit.json` freshly checked **17/17 exact scopes** inactive and empty, including the red, selected checks and final file; this overlaps their individual journals. Successful fixtures were removed only after assertions and drainage. The failed feature-red fixture remains. The heavy slot was explicitly released; no owned runner or native session remains. These counts are not additive test totals or a full-suite claim.

Examined: controlled content/identity/placement and ordinary/peer/optional graph outcomes, receipt/digest/source and bin forgery guards, and static original byte/cancellation checks. Unexamined here: direct maximum-byte stress and abortion precisely during graph traversal, legacy-only behavior, the broader current dependency/application suites, full suite/browser, real packages, captured-lock installation, target baseline and owner readiness. Missing required peers are already covered by an earlier admission guard; this file does not claim to move that case into the post-install verifier. No model, imported package code, real acquisition or target execution occurred.
