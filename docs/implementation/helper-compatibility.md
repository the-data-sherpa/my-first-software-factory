# Helper eligibility for the selected nullable helper (stream A)

A development record for the bounded factory-only compatibility batch in [Bounded Vanguard compatibility work](vanguard-compatibility.md).
It is not #10 acceptance, owner readiness, a Standards or Spec review, or authorization for any live operation.
No Vanguard code, real package, credential, production model, or network was used.

## Inputs

- Starting revision: `04ae0db3a6a5ebd9b89d018c4b79259b1e1cd2b4` on the stream A worktree. Comparison base: `721cdd54374f3077f6f201621c823e214a9dced4`.
- Static findings: [source preflight](ticket-10-source-preflight.md). They were hypotheses until the reds below ran.
- Captured helper: `convex/syncHelpers.ts`, SHA-256 `7d5655a0…69302408`. It was read as inert data only.

## Behavior change

### Grammar (`src/qualification-scope.mjs`)

The conservative allowlist now accepts three additional forms and nothing else:

- **Nullable parameter.** Exactly the observed text `name: string | null | undefined`, with single spaces around each `|`. Optional parameters, defaults, two-member unions, compact or reordered unions, and other types remain unsupported.
- **Leading empty-value guard.** At most one `if (!parameter) return "";` (or `''`) as the first statement.
  A nullable parameter requires it, so `null`, `undefined`, and `""` return `""` in base and draft.
  The guard belongs to the immutable prefix with the signature. Base and draft must contain identical bytes, so a draft cannot remove or change it.
  A non-empty literal, braces, `else`, a second or later `if`, and any other condition remain unsupported.
  A line terminator between the guard's `return` and its literal, including one inside a comment, is unsupported. JavaScript would otherwise return `undefined`.
- **`let` binding.** Parsed like `const`. The grammar has no assignment, so a `let` binding cannot be reassigned.

The single final `return`, method allowlist, string and regex rules, ASCII-only token separation, comment handling, and the `QUALIFICATION_SCOPE` envelope comparison are unchanged.
Existing helpers without a guard keep their previous prefix.
Invalid UTF-8 in either helper now refuses with `QUALIFICATION_SCOPE_UNSUPPORTED`, at the gate and in the late check. Before this change, the late check failed with the generic `QUALIFICATION_FAILED`.

### Composed eligibility gate (`src/admission.mjs`)

For a composed qualifying Run (`run.qualification` present), admission runs an eligibility gate after the existing prerequisite capture.
The gate runs before the containment boundary and its tool-round reservation, `ModelRuntime` construction, and the smoke request.
It saves stage `helper-eligibility` first, then checks the following in order:

1. **Selected write pair.** The executor's `writePaths` must be exactly the selected helper and test. Otherwise it refuses with `QUALIFICATION_SCOPE`. The late `scope()` check gave the same code only after model work.
2. **Admitted helper.** The helper must have an entry in the admitted source manifest. Otherwise it refuses with `QUALIFICATION_BASE_INVALID`.
3. **Admitted bytes.** The gate reads the worktree helper through `privateRoot` and `withFile`. That read does not follow links, requires an owned single-link regular file, and is capped at the manifest size. The bytes must match the manifest's `bytes` and `sha256`. Otherwise it refuses with `ADMISSION_SOURCE_CHANGED`. No Git process or scratch directory is used.
4. **Grammar.** The bytes must decode as UTF-8 and parse under the grammar above. Otherwise it refuses with `QUALIFICATION_SCOPE_UNSUPPORTED`.

After the asynchronous read, the existing `active()` check applies the stop, cancellation, and deadline.
A refusal ends admission as `blocked`, with the code on the admission record. The executor reports `failed`.
No model attempt, tool round, baseline, executor submission, draft, qualification directory, or Work item is created.
Earlier prerequisite failures keep their specific codes.
The qualifier's draft-time `verifyHelperScope` check, its `scope()` check, and passive inspection stay unchanged as defense in depth.

Legacy admission-only and non-qualifying executor Runs do not run the gate.
Admission loads the qualification module only on the composed path, so legacy admission has no new module dependency.

## Bindings and modules

No new module was added, and no profile list was edited.
`src/qualification-scope.mjs` is already in the composed admission profile (`qualifiedFiles`) and the qualifier's `implementation` list.
Its imports (`qualification-artifacts.mjs`, `qualification-selection.mjs`, and through them `containment-files.mjs`) are also already bound in the composed profile.
A change to any of them invalidates a composed binding before the gate runs.

## Tests

`tests/phase-1/helper-compatibility.test.mjs` drives the factory application, CLI, the composed executor, admission, and the real qualifier.
Each case runs in an owned systemd scope, with a controlled model transport and the existing synthetic runner packages.
Authored helpers in `tests/fixtures/helper-compatibility.mjs` have the captured signature, guard, and `let` shape. They are not the captured module.

| Case | Expected result |
| --- | --- |
| `nullable-qualified` | Qualified controlled Work item, 10 check stages, 18 of the original tool rounds, `reviewReady: false`. The retained candidate includes passing `null`, `undefined`, and `""` cases. |
| `nullable-candidate-mismatch` | A wrong `null` expectation in the authored candidate is refused with `REGRESSION_UNVERIFIED`, which shows that those cases execute |
| `changed-guard`, `changed-signature` | Draft refused late with `QUALIFICATION_SCOPE`, no checks, no Work item |
| `removed-guard`, `draft-reassignment` | Draft refused late with `QUALIFICATION_SCOPE_UNSUPPORTED`, no checks, no Work item |
| `wrong-write-pair` | Zero-effect refusal with `QUALIFICATION_SCOPE` at the gate |
| `changed-before-read` | Worktree helper changed after capture and before the gate read: zero-effect refusal with `ADMISSION_SOURCE_CHANGED` |
| `stop-at-eligibility`, `deadline-at-eligibility` | A stop or deadline during the gate ends the run `stopped` or `failed` (`RUN_DEADLINE`) with zero effects |
| 22 unsupported admitted bases in six groups | Zero-effect refusal at `helper-eligibility`: `QUALIFICATION_SCOPE_UNSUPPORTED`, or `QUALIFICATION_BASE_INVALID` for an absent helper |
| `reassignment` then legacy executor | The legacy executor still constructs one runtime and produces its draft on the same base |

A zero-effect refusal means no runtime construction, model request, model attempt, tool round, baseline, containment receipt, executor submission, draft, qualification directory, or Work item. The refusal code is on the admission record.

The unsupported bases cover:

- reassignment, an unguarded nullable parameter, and an uninitialized `let`
- non-empty, duplicate, late, braced, `else`, and equality guards
- compact, two-member, and reordered unions, and an optional parameter
- a non-listed call and an operator
- a line terminator after the guard's `return`, bare or inside a comment
- a U+2028 comment terminator, a Unicode escape in a name, and a `/` inside a regex character class
- invalid UTF-8, and an absent helper

`tests/phase-1/admission-worker.mjs` (`qualified-profile`) was narrowly adapted.
Its stand-in composed admission now commits the selected helper and supplies the exact write pair, as a real composed run has.
Without them, the new gate correctly refused the stand-in before its baselines.

## Evidence

Private evidence root: `/tmp/factory-streamA-helper-evidence-oQCxES` (mode 0700). Node 24.21.0.

- **Red 1**, unchanged source at `04ae0db`: `nullable-qualified` ended `blocked` with `QUALIFICATION_SCOPE_UNSUPPORTED` after 5 model attempts and 8 tool rounds. 1 test selected, exit 1.
- **Red 2**, unchanged source: unsupported `reassignment` base constructed one `ModelRuntime` and spent 5 model attempts before the late refusal. 1 test selected, exit 1.
  An earlier command for this red selected zero tests and is retained as invalid, not as a red.
- **Green 1**, grammar change only: `nullable-qualified` passed. 1 test selected, exit 0.
- **Green 2**, with the gate: `reassignment` refused at `helper-eligibility` with no runtime or attempt, and the legacy executor still produced its draft. 1 test selected, exit 0.
  This first gate read the helper from the Git object snapshot. The steering below replaced that reader.
- An intermediate serial regression batch then ran on that first gate.
  `admission-profile` failed: its stand-in composed run had no selected helper, so the gate refused it before its baselines. The other suites passed.
  That batch is stale for the final source.
- After the gate/binding steering, new reds ran on the source at that point, one test selected each, all exit 1:
  - compact union: accepted early, refused late after 5 attempts
  - absent helper: wrong code
  - changed bytes: caught only after the boundary tool round, as `ADMISSION_INVALIDATED`
  - wrong write pair: refused only after model work
- Greens: the grammar tightening passed (2 tests). The read rewrite and the write-pair check were applied in one edit, then passed together (6 tests).
- `stop-at-eligibility`, `deadline-at-eligibility`, and `nullable-candidate-mismatch` had no prior red. They are characterization coverage.
- Affected regression suites ran serially on the final source. See the stream A report for their counts.

The captured helper's bytes (SHA-256 `7d5655a0…69302408`) were parsed as data through `verifyHelperScope` with identical base and draft copies, under the initial and the final grammar. Both results were an unchanged supported envelope. The admission gate's manifest-bound read was not applied to the capture, which has no admitted manifest.
This is not evaluation, TypeScript loading, Vitest compatibility, or base-regression evidence.

## Limits

- Executed nullable coverage comes only from the authored candidate cases on the controlled runner. The fixed five-case oracle and its version are unchanged and have no null case.
- A helper above the manifest size, and a symlinked or hard-linked helper, are refused by the nofollow read or by the earlier capture. They have no dedicated case.
- Synthetic runner output is not real Vitest. Real TypeScript loading of `/work/convex/syncHelpers.ts`, the real baseline, and a real maintenance run remain unverified.
- The grammar still refuses most valid TypeScript. It cannot judge whether a supported change is correct; the oracle and checks do that.
- Dependency compatibility belongs to stream B and is not covered here.
