# Ticket #10 source preflight: selected helper versus qualification grammar

A static, read-only stream A research note: not #10 or owner-readiness acceptance, a Standards or Spec review, or authorization for any operation.
No factory-runtime or Vanguard code, test, package manager, production-model call, or network request was run. Claude Code Opus 5.5 performed development research, not factory runtime execution.

## Inspected revisions and evidence

- Factory: frozen checkout `60cc8a4ed47439443a9bad479c480aacdf8f7002`, clean before this note.
- Vanguard: the parent's private snapshot of working-tree bytes with Git-index membership, captured at `2026-11-06T16:27:13Z`.
  It is not a committed local-main manifest, and does not establish HEAD identity, cleanliness, untracked-file absence, or freshness.
- Captured `convex/syncHelpers.ts`: 15,363 bytes, SHA-256 `7d5655a0…69302408`, matching the private capture manifest and its index blob `fb828fa9…`.
- `lib/__tests__/normalize-address.test.ts` is absent from the capture, as the manifest's `absentCandidateTest` records.
- Private receipt: `/tmp/t10-streamA-receipts-U7Qjij/receipt.json` in a mode-0700 temporary directory.
  It applies the factory's two signature regex literals to the captured file as data with Python `re`: one match at line 92, parameter text `raw: string | null | undefined`, `parameterRegexMatches: false`.
  It does not run the factory parser.

## Finding: predicted refusal of the captured helper as a base (not observed)

The selected helper signature is `normalizeAddress(raw: string | null | undefined): string` (captured `convex/syncHelpers.ts:92`).
Its body has three statements, in this order:

- a guard, `if (!raw) return "";` (line 93)
- `let normalized = raw…;`, a method chain (lines 95–120)
- `return normalized;` (line 122)

The factory grammar has three predicates that refuse this source:

1. **Parameter.** `envelope` takes the parameter text from the signature (`src/qualification-scope.mjs:116`).
   It accepts only one name with an optional `: string` annotation (`:119`).
   The union `string | null | undefined` does not match, so `:120` calls `unsupported()` (`QUALIFICATION_SCOPE_UNSUPPORTED`).
2. **Guard statement.** If the parameter passed, `parseBody` accepts only `const` or `return` as a statement keyword (`:104–110`).
   `if` would fail at `:110`.
   A guard also adds a second `return`, but the grammar allows exactly one return, as the last statement (`:7`, `:100–103`).
3. **`let`.** The `let` declaration would also fail at `:110`.

By reading, the method chain itself (`toUpperCase`, `trim`, `replace` with regex literals and strings, `//` comments) appears within the grammar.

**When the check runs.** `verifyHelperScope` parses the **base** file first (`:127`), before the draft (`:128`).
The failure therefore does not depend on the draft.
Even an unchanged base helper is refused.

The active qualification path calls the function at `src/qualification.mjs:179`. Passive `inspect` revalidates saved qualified evidence with it at `:316`. Neither call resumes execution. Composed resume remains refused.
The active call comes after all of the following:

- The executor finishes with `draft-produced` (`src/qualified-execution.mjs:39–61`).
- Capture finishes (`src/qualification.mjs:163`).
- `verifyDraft` and the prerequisites run (`:173–176`).
- `scope()` passes (`:177`, `:97–110`).

If an admitted local-main base contains this captured helper and all earlier gates pass, a draft-producing run would already have spent model attempts before the predicted `QUALIFICATION_SCOPE_UNSUPPORTED` refusal. Earlier dependency or admission failures can stop a run without model work. This is not a prediction that every start spends its full allowance.
The current admission path has no helper-grammar gate. The only `verifyHelperScope` call sites are these qualification and passive-inspection checks.

**No draft can avoid this.**

- The prefix and suffix envelope (`:121–123`, `:129`) includes the signature.
  Narrowing the draft signature would also violate prefix equality if comparison were reached. It cannot avoid the earlier refusal while parsing this captured base.
- `scope()` also requires both the helper and the new test to change (`src/qualification.mjs:103–104`).
- Rewriting the target base outside the run is an unrelated target edit that narrows a legitimate exported contract.
  Inside the snapshot, the only caller passes `IncidentData.fullAddress: string` (lines 31, 143–144).
  Callers outside the snapshot are unexamined.

## Oracle cases traced statically, not run

Five fixed cases (`src/qualification-selection.mjs:9–13`), hand-traced through the captured chain (uppercase, trim, collapse whitespace, abbreviations, remove `.`, then `#`).

| Case | Hand-traced base | Oracle `baseActual` | Base expected to |
| --- | --- | --- | --- |
| hash-separated-unit | `100 MAIN ST  2` | same | fail |
| trailing-period | `100 MAIN ST ` | same | fail |
| compact-unit | `100 MAIN ST 2` | same | pass |
| unit-preservation | `100 MAIN ST  23B` | same | fail |
| abbreviation-preservation | `100 MAIN ST` | same | pass |

All five agree with the independently fixed `baseActual` values.
The `expected` values keep the abbreviations (`STREET` becomes `ST`) and the unit numbers (`2`, `23B`).
This agrees with Q21 (`docs/phase-1-plan.md:67`, `:96`).
None of the cases exercises `null`, `undefined`, or `""`.
The guard returns `""` for those inputs, and the oracle should keep that behavior.
This table is not base-regression evidence and not a `baseActual` verification.

## Minimal future correction boundary

This is an owner decision. It is not implemented here.

**1. Factory grammar.** Make a narrow, fail-closed extension in `src/qualification-scope.mjs` only:

- Parameter: accept exactly `name: string`, `name: string | null | undefined`, or no annotation. No other types.
- Guard: accept at most one leading `if (!param) return <string literal>;`.
  Treat it as part of the **immutable prefix**, so the base and the draft must contain identical bytes.
  This keeps the null contract, and the draft cannot remove the guard.
  `!` applied to a primitive parameter calls no user code.
- `let`: accept `let` like `const`, without reassignment. The grammar has no assignment, so `let` still cannot be reassigned.
- Keep everything else as it is:
  - exactly one final `return`
  - the method allowlist
  - comment and escape rules
  - the envelope comparison and `QUALIFICATION_SCOPE` semantics
- Do not otherwise weaken the allowlist.

**2. Earlier preflight.** Run the same `envelope` parse against the admitted base helper bytes before ModelRuntime construction and the admission smoke, not merely before executor dispatch. The existing admission smoke precedes the executor (`src/admission.mjs:176–188`).
The bytes come from the recorded base object snapshot, not from the owner's checkout.
Only that earlier placement can refuse the incompatible helper before the first factory model request.
The qualification-time check stays as defense in depth.

**3. Tests.** Fixture tests must use the real signature and body shapes: the union parameter, the guard, and `let`.
They must also keep the existing refusal cases, and they need a regression that fails before the correction.

Each item needs separate authorization.

## Coverage

| Area | Status | Reason or effect |
| --- | --- | --- |
| Signature, guard, and `let` versus the parser | Examined | Static; two regular expressions checked against the data. |
| Oracle cases | Examined | Hand traces only; not run. |
| Call order and envelope | Examined | Read from source. |
| Other captured tests | Examined | No helper references; behavior unexamined. |
| Runtime TypeScript loading through `/work/convex/syncHelpers.ts` | Unexamined | No Vitest or transform evidence. |
| Live Vanguard, committed main or HEAD, untracked files, and callers outside the capture | Unexamined | Outside the snapshot. |
| Dependencies and toolchain | Unexamined here | Owned by stream B. |
| Credentials, providers, and models | Inapplicable | Not authorized and not accessed. |
| Real baseline health and runtime reproduction | Unexamined | Not run. |

## Next authorization

Before a #10 run that can pass, the owner must authorize one of these:

- the scoped factory grammar and preflight correction above, with tests
- a different selected task

If the admitted base matches this captured helper and earlier gates pass, an unchanged grammar would refuse a draft-producing run only after model work. Do not start a paid run to discover this known static incompatibility.
