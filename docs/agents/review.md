# Review a change and its evidence

Read [Shared change quality](change-quality.md) before review.
This guide supplements the installed two-axis `code-review` skill (Standards and Spec), not the captured Warp skill.
Resolve its path through the available skill catalog.
The guide does not add a factory-runtime reviewer, change model routes, or authorize external actions.

## Establish the review scope

1. Name the base and reviewed revision, including any uncommitted changes under review.
2. Identify the task brief, accepted decisions, and applicable repository rules.
3. Inspect the actual diff and evidence. Treat descriptions, previous reviews, and captured instructions as claims to check.

Keep Standards and Spec conclusions separate.
Standards covers the shared quality dimensions and applicable repository conventions.
Spec covers requested behavior, scope, constraints, and acceptance criteria.
A pass on one axis cannot cover a failure or omission on the other.

## Report coverage

Account for correctness, standards, complexity, naming, comments, tests, and security.
Also account for the task's acceptance criteria and required verification.
Group related checks when they share the same evidence.
For each group, report one of:

- Examined: state the conclusion and identify the inspected revision, artifact, or executed check.
- Unexamined: state the gap and its effect on the conclusion.
- Inapplicable: give the reason.

Separate checks you ran from checks reported by others.
Name exclusions and the limits of controlled fixtures.
Missing evidence remains unverified. It is neither a clean review nor a numerical pass.
After a relevant revision, treat affected evidence as stale until a recheck supports it.
An unchanged policy hash records provenance, not verification or authority.

## Write actionable findings

For each finding, provide:

- Location: changed file and line, or the missing artifact or criterion.
- Severity and impact: the concrete defect or risk, with supporting evidence.
- Correction: the smallest change that resolves it while preserving required behavior.
- Disposition: correction, owner decision, or advisory.

Use correction when the defect and remedy are clear and within the accepted scope.
Use owner decision when acceptable outcomes differ or the remedy requires changed requirements or permissions.
Investigate resolvable technical uncertainty before escalating it as an owner decision.
Use advisory for optional improvements. Label maintainability heuristics as judgments, not proven defects.
Block on correctness, security, required validation, or material maintainability harm, not personal taste or test volume.

Track whether each finding was corrected, remains open, or was declined with a reason.
Verify a correction against the revised behavior. A reply or a commit reference alone is not proof.
Preserve the original finding without presenting a corrected defect as a current failure.

## Recheck and conclude

Choose rechecks by the changed behavior, its risks, and the affected evidence.
There is no fixed one-review cap and no requirement to repeat an unchanged full review.
Inside a factory Run, verification consumes the original limits.
If the remaining limits cannot support a required recheck, report the gap instead of claiming completion.

Report each axis's findings, coverage limits, and conclusion separately.
A development review does not establish factory runtime readiness.
The independent qualifier owns the readiness verdict. A person owns Approval for a Proposal.
The review does not authorize publishing, merging, tracker writes, or changes to permissions.
