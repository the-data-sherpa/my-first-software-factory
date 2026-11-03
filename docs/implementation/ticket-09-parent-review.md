# Ticket #9 parent review checkpoint

Reviewed implementation: `15361b393fc64c0a04313f006eb158ff5ac5b039`, based on `48c4058`.
The parent has not integrated or accepted ticket #9.
Ticket #8 remains a separate implementation stream.
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
