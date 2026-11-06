# Shared quality guidance

## Intent and selection

The owner asked to evaluate the available approaches against the factory's intention, implement the best fit, and obtain Opus 5.5 review.
The relevant inputs are the accepted [Phase 1 design](../phase-1-plan.md), existing development skills, and the owner-supplied Warp/Oz HAR.
The comparison is a design judgment, not a measured ranking of agent performance.

The goal remains one useful, independently qualified maintenance draft under human control.
The owner chooses the outcome and constraints. The factory chooses methods within its permissions and original limits.
A finished conversation, a review, and a readiness verdict remain distinct from Approval.

### Options considered

| Option | Decision and reason |
| --- | --- |
| Keep the current instructions unchanged | Rejected. The controls remain useful, but implementation and review lack one explicit quality standard. |
| Import the captured skills globally | Rejected. `code-review` conflicts with an installed skill name. Warp-specific tools would remain unavailable, and global skills do not feed this embedded executor. |
| Add development guidance only | Insufficient. It helps maintainers but leaves the factory executor using different instructions. |
| Share one quality policy between the executor and development reviewers | Selected. It adds judgment and reporting guidance through existing interfaces without another agent or scheduler. |
| Adopt the five-role Foreman/Triage/Spec/Implement/Review workflow | Rejected for Phase 1. It conflicts with outcome-first execution and adds mandatory roles, routing, and coordination without demonstrated need. |
| Add a complexity classifier or mandatory specification stage | Rejected. Investigate technical uncertainty within permissions. Ask the owner only when acceptable outcomes or consequential decisions remain open. |
| Adopt tstack delivery workflows as factory runtime behavior | Rejected. PR creation, monitoring, rebasing, force-pushing, and merging exceed Phase 1 scope or conflict with permanent restrictions. Installed development skills remain separate. |
| Adopt council or repeated model review as a readiness gate | Rejected. Different reviewers and numerical scores do not replace independent runner evidence. Keep the requested Opus review as development validation. |
| Add the five model-based scorers | Deferred. They may support later offline evaluation, but need calibrated examples and separate authorization for inference. Unknown evidence must remain nonpassing. |
| Enable automatic self-improvement | Rejected. Policy changes require explicit owner control. A score cannot change permissions or accepted success criteria. |
| Add visual evidence and human-decision routing to a web workspace | Deferred to Phase 2. Retain the ideas without adding UI, publishing tools, or Proposal state in this change. |
| Copy the one-review cap, blanket test-seam ban, or test-category exemptions | Rejected. Recheck affected behavior by risk. Preserve useful seams and required coverage. Small or configuration-only changes can still affect safety. |
| Copy mutable runner images or automatic model selection | Rejected. Preserve the pinned runtime and explicit selected model route. |

The selected policy also adopts concise, evidence-linked findings and explicit review coverage.
It preserves Standards and Spec as separate review axes.
A finding distinguishes a clear correction, an owner decision, and optional advice.
A corrected defect remains in the history without counting as a current artifact failure.
First-pass quality and final artifact quality are different evaluation questions.

## Implementation

[Shared change quality](../agents/change-quality.md) is the single quality standard.
The root `AGENTS.md` points maintainers to it before implementation or review.
[Review guidance](../agents/review.md) adds coverage, finding disposition, and risk-based recheck rules for development reviews.
These are repository documents, not a replacement global skill catalog.

The repository executor reads the shared policy from a fixed factory-owned path when starting execution.
It snapshots the text once and includes that same text in its model instructions.
The existing intent artifact retains the source path, SHA-256 digest, and full text.
Existing paginated application and CLI inspection expose that snapshot without loading a model or rereading the current policy.
The digest is provenance, not an authority token or a readiness check.
Earlier artifacts without the additional field remain inspectable.

The no-tool preflight does not receive the policy.
No tool, model route, retry, deadline, budget, permission, qualification rule, or storage schema changes.
No live pause/resume protocol or structured review database is added.
The policy tells an executor to report unresolved decisions, not to wait indefinitely or silently choose a wider task.
A report remains model-authored evidence, not a runner verdict.

## Source and limits

The supplied capture contained 15 source files at revision `a122f9fbbcb554f0441f79767ae93a3f6274ae83`.
All extracted file sizes and Git blob hashes matched the captured tree metadata.
The files comprised three skills, five agent definitions, five scorer definitions, and two configuration files.
That establishes capture consistency, not platform authenticity or successful agent execution.

The selection used the captured `code-quality`, `code-review`, and `ui-verification` skills, the five agent definitions, and all five rubrics.
It also considered the installed tstack skills at revision `1085050f3baed1ac724caa4a8166145fb2ac88af`.
No captured instruction was executed or installed.
Raw traffic, account details, and the recovered source remain outside this repository.
This record and the policy are adaptations to this factory's accepted design, not a wholesale import.

## Validation contract

Use the accepted application/CLI and controlled model-transport interfaces.
Verify that the complete policy reaches every executor request and never reaches the no-tool smoke.
Verify that the same snapshot remains inspectable online and after backend closure.
Preserve the existing assertions for tool scope, original counters, duplicate starts, and `reviewReady: false`.

This tests instruction delivery and retained evidence, not whether a production model follows the policy.
Live model acceptance, real Vanguard/toolchain compatibility, and the maintenance demonstration remain separately authorized work.
The unresolved baseline command/profile correction and executor-to-qualifier composition remain outside this change.

## Verification record

Review base: `976eeb8021002628acf89eef01dea381e94f006c`.
The controlled CLI regression failed before the executor change because the shared policy was absent from its outgoing request.
The same regression passed after the change, including retained evidence and offline inspection.
Four focused application/executor cases then passed, including fabricated-success and scope-expansion refusals.
All six recorded scopes, including the red reproduction, were inactive with no remaining processes.
Syntax, whitespace, documentation links, and unchanged package/runtime checks passed.
Full verification and the requested independent Opus 5.5 review remain pending at this checkpoint.
