# Helper checkpoint follow-up review

Scope: helper eligibility and its retained evidence, comparison base `721cdd54374f3077f6f201621c823e214a9dced4` through `f58e3fb` plus the parent corrections. B/G remain unintegrated and the compatibility batch remains partial. This review does not authorize publication or establish factory readiness.

Round 1 inspected the five files bound by `/tmp/factory-vanguard-compatibility-aIwVNC/helper-followup/helper-final-source.sha256`. The later exact-limit test is bound separately by `boundary-corrected-source.sha256`; both runtime module hashes are unchanged. Full tool receipts are retained as `review-standards-round1.json` and `review-spec-round1.json` in that evidence directory.

Standards: <t3-thread://v2/b125544a-38ec-4f1d-8050-d77493e4c713/thread:delegated-task:command%3Amcp%3A4c84ab10-ba31-4aed-a34b-45c7e77dcbbe%3Adelegate-task%3A1fcc5433-5fb3-4bea-bcb5-11eafe0627ef>

Spec: <t3-thread://v2/b125544a-38ec-4f1d-8050-d77493e4c713/thread:delegated-task:command%3Amcp%3A4c84ab10-ba31-4aed-a34b-45c7e77dcbbe%3Adelegate-task%3Ad3254321-da2c-4ba0-b329-67e6f9473d2b>

Standards round 2: <t3-thread://v2/b125544a-38ec-4f1d-8050-d77493e4c713/thread:delegated-task:command%3Amcp%3A4c84ab10-ba31-4aed-a34b-45c7e77dcbbe%3Adelegate-task%3A4bc16edf-1431-4893-b0d6-b8501ae50124>

Outcome: consensus on the examined helper ledger after two rounds, with the recursive-parser reservation below. Standards coverage remains incomplete for the unread repository documents; this is not an unconditional clean Standards review or the final whole-batch review. Round 2 verified the boundary correction, unchanged runtime hashes, terminal receipts and 42-scope audit, accepted F7, retained F5 as live-with, and added no finding. Its receipt is `review-standards-round2.json`.

Severity scale: blocker, major, minor, nit. Claims require inspectable source or receipts. Consensus round cap: four. Development review is not runtime qualification or owner acceptance.

| ID | Severity | Claim, evidence and disposition | Round 1 |
| --- | --- | --- | --- |
| F1 | major | The composed gate checks actual manifest-bound helper bytes and grammar before runtime construction, smoke or tool rounds; the late check remains. `admission.mjs` and `qualification-scope.mjs`; size red and focused green receipts. Corrected using the existing 65,536-byte limit shared with `scopedSource`. | Both accept. |
| F2 | minor | The observed recursive-parser overflow now gives `QUALIFICATION_SCOPE_UNSUPPORTED`; signature/guard comparison remains unchanged. `nesting-red.log`, retained EDQUOT setup failure, then fresh focused green. No claim of deterministic nesting support. | Spec accepts; Standards can live with the stack reservation in F5. |
| F3 | minor | A same-size parseable mutation verifies the existing admitted hash guard. `hash-mutation-red.log`, restoration hashes, `hash-green.log`, focused green. Retain as coverage, not a discovered product defect. | Both accept. |
| F4 | major | Controlled success does not establish dependency compatibility, real Vanguard/Vitest, owner readiness or #10 acceptance. B/G and full integration remain incomplete. | Both accept. |
| F5 | minor | Standards N1: recursion has no deterministic depth bound. Different early/late stack thresholds might permit a late refusal after model spend; this discrepancy has not been reproduced. Source: recursive `expression()` and the envelope's `RangeError` mapping. | Parent accepts the development reservation and narrows F2 to observed error reporting. A suggested arbitrary depth of 64 is not adopted; no new grammar-depth contract is established. Round 2: live-with, no required change. This is not an owner decision. |
| F6 | nit | Standards N2: other 65,536 literals remain in executor policy, artifact capture and factory code. This predates the patch. | Advisory deferred; this correction shares only the two bounds whose mismatch was reproduced. |
| F7 | nit | Standards N3: exact-limit acceptance lacked coverage. | Corrected with `nullable-qualified-at-write-limit`: 1/1 passed through real composition and qualification after a retained obsolete test assertion was fixed. Round 2 verified and accepted. |
| F8 | nit | Spec: the exact nullable union is more conservative than arbitrary whitespace. | Advisory; keep the explicitly observed signature and conservative refusal tests. No grammar broadening. |
| F9 | nit | Standards judgment: importing containment for its limit loads a larger module. No new cycle or unbound module was found. | Advisory; the module already participates in the admission/qualification fingerprints. No new limits module added. |

## Coverage and limits

Standards examined source/test diffs, the gate call path, artifact reads, imports, selected receipts and status lines. It accounted for correctness, complexity, naming, comments, tests and security through those paths, but did not fully read the ADRs, glossary, phase plan, preflight bodies or shared brief; that portion of standards coverage remains unexamined. It ran no tests. The stack reservation and boundary follow-up prevent treating its result as an unconditional clean review.

Spec examined the helper requirements: preserved nullable signature/guard, no reassignment/control-flow expansion, exact write pair, legacy gate exclusion, fingerprints and unchanged limits/authority. It found no required helper correction. It inspected receipts, not its own test runs. The later test addition and terminal affected result were outside that first review.

The parent subsequently observed 30/30 affected cases and the separate 1/1 boundary case, with unchanged runtime source. Its final exact-scope audit covers 42 inactive, empty scopes. Full suite, browser, real target/toolchain/provider, dependency integration and the final whole-batch reviews remain unverified. Dependency implementation is outside this checkpoint review, not inapplicable to the overall task.

Round 2 examined only F5/F7, the later test addition, dispositions and terminal evidence. No runtime correction followed round 1. It read `review.md` but did not complete the other mandatory standards documents; those gaps remain explicit and cannot establish compliance with their unexamined rules.
