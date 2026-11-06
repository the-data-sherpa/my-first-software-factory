# Ticket #9 parent review checkpoint

> Historical parent review, superseded for current status on 2026-11-06.
> The [integration record](ticket-09-integration.md) describes the combined implementation, corrections, and remaining acceptance gates.
> Present-tense integration and baseline-command gaps below refer to the earlier reviewed checkpoint, not the current branch.

Reviewed implementation: `15361b393fc64c0a04313f006eb158ff5ac5b039`, based on `48c4058`.
The parent has not integrated or accepted ticket #9.
Ticket #8 was a separate implementation stream at this first review. Its controlled checkpoint is now accepted; #9 is still not integrated.
This is a focused parent correctness check, not the final independent review.

## Reproduced: the patch test need not expose the defect

The accepted first task includes a normalization fix with focused regression tests.
Issue #9 also requires the same selected regression to fail on the recorded base and pass with the draft.

The qualifier proves that its factory-owned test fails on the base and passes on the draft.
It does not prove that the regression test retained in the patch exposes the defect.
Its final suite validator requires passing cases and the candidate test filename, but does not run that candidate test against the base.

Relevant code at the reviewed commit:

- `src/qualification.mjs:175–181` runs the factory-owned selected test, then the final draft suite.
- `src/qualification-selection.mjs:39–46` accepts passing final cases without candidate-test base evidence.
- `tests/fixtures/qualification-project.mjs` supplies the candidate test written through the actual run tools.

The parent ran the existing controlled application/execution fixture twice.
The first run retained the intended normalization assertion.
For the second run, the parent changed only that candidate assertion:

```js
// Before
expect(normalizeAddress('100 Main Street # 2')).toBe('100 MAIN ST 2');

// Reproduction
expect(1).toBe(1);
```

Both runs returned `status: qualified`.
The captured complete patch contained the tautological assertion in the second run.
A separate assertion requiring its rejection failed.
This is a controlled qualification defect. Both verdicts retained `reviewReady: false`; neither granted owner readiness.

Required correction: execute the retained candidate regression tests against the recorded base and draft.
Use the same bound test bytes, attribute the intended failure, and reject unrelated assertions and tautologies.
Keep the independent literal oracle as additional evidence.
Do not detect bad tests through source-string patterns or trust their names.

Evidence under `/tmp/factory-ticket09-parent-review/`:

- `baseline.log` and `baseline/green.json`: positive comparison.
- `noop.log` and `noop/green.json`: actual controlled execution with the unrelated assertion.
- `noop-fixture.diff`: the single test-fixture change.
- `noop-assertion.log`: failing parent assertion and bounded observed result.
- `scope-audit.json`: both recorded scopes inactive and empty.

The parent restored the fixture and removed the temporary dependency symlink.
The reviewed checkout remains clean. The retained disposable artifacts remain private.

## Remaining implementation: real runner protocol

`src/qualification.mjs:147` unconditionally rejects owner-profile qualification with `QUALIFICATION_RUNNER_UNSUPPORTED`.
This is a disclosed safe refusal, not a false claim of production readiness.
It is still a missing implementation path, not merely a live acceptance check.

The current final validator expects the fixture protocol from the ordinary fixed Vitest command.
That command installs no structured reporter for the final suite.
The synthetic executable writes the expected protocol directly and does not load the supplied selected reporter or configuration.
Thus its passing tests do not exercise the reporter adapter itself.

The follow-up must define and test a supported, fail-closed structured reporting path for selected and final checks.
Controlled runners must exercise the actual emitted reporter and configuration contracts rather than manufacture qualification reports directly.
Unsupported versions or malformed/incomplete reports must still block.
Do not remove the owner refusal merely because fixtures pass or add a boolean that declares compatibility.
A conditional owner path needs runtime evidence bound to the exact verified dependency/toolchain profile.
Live distribution compatibility remains a separate acceptance gate.

Historical retained research recorded Vitest `4.0.17` in Vanguard on 2026-11-02.
That record is not a fresh target inspection or execution permission.
Public first-party API documentation can inform implementation without downloading or executing packages.

## Remaining acceptance order

1. Correct the reproduced regression-coverage defect and implement the supported reporting path.
2. Accept ticket #8 after parent integration and review.
3. Compose #9 with the actual opaque executor handoff and executor-produced drafts.
4. Verify application/CLI lifecycle, retained work-item evidence, stale invalidation, and original budgets.
5. Run combined verification and independent review before accepting #9.

No production-model call, real Vanguard access, public package download, installed service, global change, tracker write, or push occurred.

## Returned correction and parent follow-up

The correction worktree integrated the supplied module as `f03519d`, then returned `a6f5c88` with candidate-base overlays and structured Vitest 4.0.17 reporting.
It runs identical retained candidate bytes against base code and draft code, in addition to the independent oracle.
The synthetic runner now imports the emitted configuration and reporter rather than writing qualification JSON directly.
The child reported **286/286** full tests, **1/1** browser test, and **255/255** recorded scopes inactive and empty.
These are child-checkpoint results, not combined parent verification or real-package acceptance.

The parent independently reran the retained tautology and valid-extra-literal cases: **2/2** passed.
The former returned `blocked / REGRESSION_UNVERIFIED`; the latter qualified only as controlled evidence with `reviewReady: false`.
The code retains the complete candidate test overlay and validates unchanged base bytes outside that file.
Actual #8 handoff composition is still absent from those fixtures.

### Additional reporter defect reproduced and corrected

At `a6f5c88`, every qualification command disabled file parallelism, but the reporter required two resolved workers.
The retained tagged [Vitest 4.0.17 config contract](https://github.com/vitest-dev/vitest/blob/v4.0.17/packages/vitest/src/node/types/config.ts) states that serial file execution overrides `maxWorkers` to one.
The fixture had masked this by always reporting two workers.

The parent changed only fixture config resolution to follow that documented behavior.
The valid-extra-literal regression then failed: the actual emitted reporter rejected `onInit` with `Unsupported qualification runtime`.
The qualifier returned `blocked / REGRESSION_UNVERIFIED` instead of the expected controlled qualification.
This is a controlled contract reproduction, not a run of the real Vitest distribution.

The parent corrected the reporter, retained and validated the resolved settings, and added negative worker/parallelism cases.
That separate correction is committed as `d1b17b9` in the completed qualification worktree, not on parent `main`.
The positive reproduction now passes; tautologies remain rejected.
Verification passed **4/4** focused cases, **65/65** qualification cases, **1/1** browser test, and a separate **73/73** exact-scope audit.
Syntax, whitespace, and unchanged dependency/runtime checks passed. The temporary dependency symlink was removed and the checkout is clean.
The parent did not repeat the unrelated 223-test baseline in that branch.

Evidence and private fixture indexes: `/tmp/factory-ticket09-parent-workers/`.
`red.log`, `red/input.json`, and `red/result.json` retain the failure and its source/check location.
`green.log`, `focused.log`, `qualification.log`, and `scope-audit.json` retain correction evidence and cleanup observations.
No fetched source was executed. No new public request, real target/model operation, factory dependency installation, tracker write, or push occurred.

### Shared implementation gap still open

The existing admission command still contains `--minWorkers=1`, which is absent from the retained Vitest 4.0.17 CLI definitions.
The qualifier's corrected reporting path does not repair that earlier gate.
Resolve the baseline command and admission profile together without bypassing healthy-baseline validation or inventing compatibility evidence.
This is an implementation gap, separate from unperformed real-distribution acceptance.

Next: resolve that shared conflict, integrate the returned commits after #8's controlled acceptance, compose actual executor drafts and the live handoff, persist at most one work item, and verify lifecycle and freshness through the application/CLI.
Run combined verification and independent #9 review before accepting qualification.
The complete owner path and Phase 1 maintenance demonstration remain unfinished.
