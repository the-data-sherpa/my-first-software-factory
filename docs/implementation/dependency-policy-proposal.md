---
status: accepted
accepted: 2026-11-06
---

# Dependency compatibility policy decisions

The owner selected “Implement installed-graph verification” and “Recognize bounded glibc/musl metadata” on 2026-11-06. P1 and P2 below are accepted development contracts; implementation and verification are still required. These are not Approval for a factory Proposal or permission for real packages, target execution, credentials, production inference or publication.

## Evidence and why a decision is needed

The [controlled preparation record](vanguard-compatibility.md#controlled-preparation-observations-and-retention) describes isolated stream B; its receipts are under `/tmp/factory-streamB-evidence-SlX0M8/heavy/`. Bun 1.3.14 rearranged an authored peer graph so that a peer recorded as mismatched by lock-key ancestry was satisfied in the installed bundle. This disproves that placement assumption for the fixture; it does not prove the captured installation is healthy. Generic peer tolerance in the candidate remains unapproved.

The same controlled diagnostics installed both musl- and glibc-declared Linux/x64 packages when the text lock omitted `libc`. Official pinned source leaves text-lock libc serialization as TODO code, while registry manifest parsing reads it. See the [source research](bun-1.3.14-cache-research.md). Current archive validation refuses any such declaration. No real distribution metadata has been acquired or verified.

## P1: validate the installed dependency graph

Recommended for continuing compatibility work: let Bun determine placement under the original frozen lock and denied tool network, then require independent validation of the actual prepared bundle before it can be marked prepared or reused.

- Preserve complete planned identities, versions, archive paths/integrity, archive-metadata checks and explicit OS/CPU selection. No unplanned acquisition or version substitution.
- Do not treat an unmet peer inferred only from lock-key placement as a compatibility success. Retain that admission observation until installed-graph verification resolves it.
- After installation, inspect package metadata as data, without importing package code. Resolve each required relationship against the actual validated bundle layout. Required peers must satisfy their declared ranges; optional absence is permitted only by the admitted optional rules. Unknown or ambiguous identities, relationships or placements refuse.
- Verify ordinary and optional relationships affected by rehoisting as well as peers. Preserve existing file, symlink, size and containment checks. A known matching version elsewhere in the archive plan is insufficient.
- Bind the verifier, policy, observed graph and installed inventory to preparation receipts and subsequent inspection/reuse. Never promote an incomplete verification to prepared.
- Controlled counterexamples must cover a satisfying rehoist, a genuinely unsatisfied installed peer, missing/optional peers, nested versions, unexpected identity/placement, altered metadata and stale verification. No package acquisition, limits or runtime authority expands.

This proposes a stronger final check, rather than accepting the candidate's generic tolerance. Source and controlled execution must still establish the implementation; no health verdict follows from approving this contract.

Alternative: preserve strict refusal of a required peer mismatch inferred from lock-key ancestry. That is bounded and fail-closed, but the captured lock remains blocked and the compatibility goal is incomplete.

## P2: recognize bounded published libc metadata

Recommended for continuing compatibility work: permit absent libc metadata or an explicit nonempty declaration containing only `glibc` and/or `musl`, subject to existing metadata-size limits. Keep unknown values, negation, unsupported types and contradictory metadata refused.

- Keep the preparation profile explicitly Linux/x64 with Bun/text-lock OS/CPU selection. Do not invent libc filtering that Bun's frozen text lock does not perform.
- Preserve the published declaration through archive integrity and retained metadata/receipt binding. Record that recognizing the declaration does not verify that native code works on the host.
- Keep frozen inputs, all archive safety checks, script suppression, denied tool network and installed-file limits. No native setup or package code is run to repair compatibility.
- Controlled tests must show permitted declarations prepare with the expected Bun selection and that invalid declarations refuse before installation. Existing metadata contradictions must continue to refuse.

Alternative: continue refusing every archive with libc metadata. That preserves the current policy but leaves these captured platform-package forms unsupported.

## Still separate

Prerelease cache formatting is a technical correction, not either policy decision. The owner has authorized official-source research for it; a factory correction still needs public controlled red/green evidence. Neither decision here authorizes real distributions, the actual captured installation, baseline health, owner readiness, #10 acceptance or publication. Integration, fingerprint coverage, current full-suite/browser checks and fresh complete independent Standards/Spec reviews remain required afterward.
