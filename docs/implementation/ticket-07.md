# Ticket #7: startup admission gates

Baseline: `29292d4`. Runtime: Node 24.21.0, with existing Bun 1.3.14, bubblewrap, systemd, and pinned Pi packages.
This slice implements admission only. It installs no agent executor and produces no work item.
Tickets #8, #9, and the real #10 run remain separate.

No real Vanguard source, credential/configuration file, public package endpoint, or production model was accessed.
No dependency installation into the factory, runtime-pin change, persistent service, global configuration change, GitHub write, or push occurred.
The owner credential-initialization path exists but was not exercised.

## Owner operations

These commands describe the owner interface. They do not authorize or record a real run.
Use a private state directory outside the repository and the selected project's canonical path.

First, prepare source and dependencies through the existing separate owner operation:

```sh
NODE=/home/cowen/.local/share/mise/installs/node/24.21.0/bin/node
"$NODE" bin/factory-contained.mjs serve --prepare-workspace \
  --state-dir "$STATE" --project-path "$PROJECT"

# From a separate terminal:
"$NODE" bin/factory.mjs start --state-dir "$STATE" \
  --request-id preparation-1 --brief "$BRIEF"
"$NODE" bin/factory.mjs inspect "$PREPARATION_RUN" --state-dir "$STATE"
"$NODE" bin/factory.mjs prepare-dependencies "$PREPARATION_RUN" \
  --state-dir "$STATE" --bun-path "$BUN"
```

The existing preparation command defaults to offline archives.
Registry acquisition still needs its separate `--fetch-locked-packages` authorization.
Admission never installs or fetches packages.

After preparation finishes, close that foreground backend.
Start the admission-only owner backend with the same project and state directory:

```sh
"$NODE" bin/factory-contained.mjs serve --admit-agent \
  --state-dir "$STATE" --project-path "$PROJECT"

# From a separate terminal:
"$NODE" bin/factory.mjs start --state-dir "$STATE" \
  --request-id admission-1 --brief "$BRIEF" --dependency-run "$PREPARATION_RUN"
"$NODE" bin/factory.mjs inspect "$ADMISSION_RUN" --state-dir "$STATE"
"$NODE" bin/factory.mjs stop "$ADMISSION_RUN" --state-dir "$STATE"
```

`--admit-agent` opts into startup gates, not an installed executor.
It cannot combine with `--fixture`, `--prepare-workspace`, or `--model-preflight`.
The start command requires explicit dependency selection. It never selects a latest bundle.
The CLI accepts no new runtime executable, module, URL, credential, or transport override.

Admission creates a new run with its own original 20-minute deadline and cumulative budget.
It does not change the preparation run's budget or promote that run into agent authority.
A duplicate request returns the original record without work.
A different dependency selection under that request ID returns `REQUEST_CONFLICT`.

## Factory-owned interface

The application still uses `openFactory`, with workspace preparation and an execution adapter:

```js
import { createAdmissionExecution, verifyAdmissionHandoff } from '../../src/execution.mjs';

const execution = createAdmissionExecution(); // Lazy owner configuration only.
// openFactory({ stateDir, project, workspace, execution })
// factory.startRun({ requestId, brief, dependencyRunId })
```

`createAdmissionExecution` hides gate order, evidence binding, cancellation, drainage, and handoff validation.
Its constructor, passive recovery assessment, and ordinary inspection create no credential runtime.
The application supplies saved run records and a narrow `saveAdmission` callback under lifetime ownership.
No scheduler or SDK handle reaches the CLI or factory record interface.

The adapter saves each stage before its effects:

1. Validate the recorded workspace, explicit preparation-run selection, and verified matching dependency bundle.
2. Bind actual pristine snapshot inputs and the execution profile.
3. Run the actual contained boundary probe with the read-only dependency mount.
4. Initialize Pi's existing ModelRuntime integration, then run the bounded no-tool model smoke in this run.
5. Run fixed one-shot Vitest, then lint, stopping at the first failed gate.
6. Join model and tool drainage, revalidate the binding, and save the verified admission result.

The boundary probe checks actual mounts, environment scrubbing, network denial, scratch, resources, and namespace drainage.
It precedes credential-discovering initialization. It is a trusted probe, not agent tool access.
Trusted baseline checks also do not expose file tools or a dispatcher.
The smoke uses the route and authentication requirements in [Selected-model preflight](../../README.md#selected-model-preflight), with the existing no-tool payload policy.

The fixed commands remain:

```text
/runtime/node /work/node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1
/runtime/node /work/node_modules/eslint/bin/eslint.js . --no-cache
```

No package scripts, arbitrary argv, builds, deployment, live integrations, authentication/payment changes, or dependency updates are enabled.
Bundle-backed file tools now reject writes to the manifest, both lockfiles, and `vendor/` inputs.
Existing configuration exclusions remain in effect.

## Evidence and invalidation

The application retains `run.admission`, including the selected preparation run, gate stage, binding, containment result, smoke identity, baselines, and failures.
Each baseline includes its runner receipt and the admission binding digest.
Logs and source snapshots remain under the private run's `checks/` directory.
The smoke has its existing per-run durable store and cumulative model reservation.

The binding covers:

- Run, workspace intent, exact base commit, and committed manifest identity.
- Actual snapshot bytes, paths, directories, and executable modes, including new files.
- Dependency intent, sealed inventory digest, and the verified toolchain fingerprints.
- Model route, reasoning, fixed commands, numerical limits, profile kind, and relevant factory implementation fingerprints.

`inspectWorkspace` alone remains a metadata check, not proof of pristine source.
Admission separately validates the visible snapshot against the committed manifest.
It rechecks source, dependency inputs, toolchain, and profile before and after checks and at handoff.
A changed check snapshot also fails even if the current workspace later matches the binding.
Live invalidation is permanent for that adapter. It never reruns smoke or resets budgets.

Passive inspection reports stale terminal evidence as `admission.readiness: invalidated` and `artifactStatus: invalid`.
This is a read-only projection, not a repair or persisted effect reconciliation.
The retained receipts remain historical evidence. No passive lookup can issue authority.

## Outcomes and ownership

A successful admission-only run reports:

```text
status: blocked
outcome.kind: admission-only
outcome.reason: EXECUTOR_NOT_IMPLEMENTED
outcome.reviewReady: false
admission.readiness: baseline-healthy
capabilities.repositoryTools: false
```

Missing prerequisites and failed baselines retain fixed reason codes and owner instructions.
The owner must inspect evidence, correct prerequisites outside agent execution, and explicitly start a new run.
Failures do not permit fallback models, implicit preparation, broader task scope, or retries under stale evidence.

The original budget includes workspace preparation, containment, smoke, baselines, and final drainage.
A healthy controlled admission consumes one model attempt and three tool rounds: containment, Vitest, and lint.
Stop, shutdown, and deadline cancellation remain active during initialization, model streaming, checks, and final drainage.
`MODEL_DRAIN_FAILED` and `DRAIN_FAILED` retain interrupted status, active-run exclusion, and lifetime ownership.
A failure to save the admission error cannot replace an unconfirmed-drain error.

An SDK smoke completion is not completion of admission.
After a crash, inspection remains interrupted, including when the smoke receipt says done.
Duplicate requests, backend reopen, and recovery assessment start no model or check.
Production resume and effect reconciliation remain unavailable. This slice does not invent quiescence evidence.

## Trusted handoff for later work

The execution handle has `finished`, `cancel`, `close`, and `handoff` methods.
It exposes no read, write, check, model runtime, or SDK handles.
After gates complete, `handoff()` can issue a process-local opaque token to trusted execution code.
The application does not consume that token in this slice.

```js
const token = await handle.handoff();
const evidence = await verifyAdmissionHandoff(token, { runId, kind: 'owner' });
```

Validation rechecks the live run budget and source/profile binding.
A foreign-run token, JSON copy, fabricated passed flag, closed owner, or invalidated adapter fails validation.
Fixture tokens require explicit `kind: 'controlled-fixture'` and fail the owner-profile check.
Returned evidence is descriptive, not a replacement token.
Ticket #8 must retain ownership and revalidate the token before installing its executor.
It must also retain the original model/tool budgets and dependency protections.
This handoff does not relax `model.mjs` or add a workflow engine.

## Controlled verification

The agreed seams are the factory application, CLI processes, and factory-owned execution/preparation interfaces.
Tests use controlledRuntime/controlledTransport, dummy in-memory auth, real Pi integration, actual OS containment, and disposable synthetic packages.
The packages named Vitest and ESLint are fixture entry points, not the real distributions.
Their receipts do not establish real Vanguard compatibility or baseline health.

`serveFactory` in `src/control-server.mjs` supplies the trusted in-process server seam for controlled CLI verification.
It retains the private Unix socket, request bounds, ownership, and sanitized errors.
There is no command-line plugin or transport loader.
Injected runtime/transport/clock options require explicit fixture identity.
Owner admission rejects those overrides.

Coverage includes successful and failed CLI admission, model refusal without baseline work, explicit selection, stale/foreign-source bundles, and failed Vitest/lint.
It includes source changes before smoke, during smoke, between baselines, before handoff, and after token issuance.
Toolchain changes invalidate both live and passive evidence.
Other cases cover original budget exhaustion, stop/shutdown/deadline, delayed stream drainage, model-drain failure, and failed error reporting.
Crash tests inspect through the actual CLI and verify no replay on duplicate requests or reopen.
Existing scoped and nested registry tests remain part of the full suite.

Evidence is retained under `/tmp/factory-ticket07-evidence/`.
The first vertical test failed because admission did not exist (`01-red.log`), then passed (`02-green.log`).
The initial focused selection passed 30/30 (`03-focused.log`).
Further budget/drain tests exposed an imprecise exhausted-model outcome and a test-only streaming wait deadlock.
Both corrected cases pass in `05-limits-drain-green.log`.
The deadlock's exact-owned watchdog drained its scope before returning.

The first full run passed all existing tests but failed 35 new test teardowns with `EACCES` on sealed bundle directories.
Earlier retained-evidence runs had not exercised artifact deletion.
The test teardown now makes only its disposable directories writable after confirmed exact-scope drainage.
It retains artifacts if drainage does not return successfully.
`07-cleanup-green.log` records the corrected ordinary-cleanup case.

A final source-binding regression found that a committed directory containing only excluded files incorrectly failed the pristine-source gate.
The source fingerprint now derives visible directories from the full committed manifest, without reading excluded file contents.
`11-excluded-directory-red.log` and `12-excluded-directory-green.log` retain that red/green cycle.

Final verification under Node 24.21.0:

- Full `npm test`: **222/222 passed**, with no skips or exclusions (`13-full-suite-final.log`).
- Browser regression: **1/1 passed** (`14-browser-final.log`).
- Final retained CLI success/refusal selection: **2/2 passed** (`15-final-cli-evidence.log`).
- JavaScript syntax and `git diff --check` passed.
- Package files, lock graph, runtime pin, and shared design documents are unchanged.
- Separate exact-name audit: **357/357 scopes inactive**, with empty cgroups (`scope-audit.json`).

`final/cli-success.json` and `final/cli-refusal.json` index retained disposable repositories and private run evidence.
The success case also deliberately changes source after completion to verify passive invalidation.
Its baseline snapshots remain intact. The later changed workspace must not reuse those receipts as current readiness.

The isolated implementation's full suite includes all 184 baseline tests and 38 admission tests.
The temporary factory `node_modules` link used existing parent dependencies and was removed before commit.
Documentation uses the strict technical-prose rules. Its local style check reports no banned-word hits.

## Parent integration checkpoint

The parent integrated the implementation and found a capability-reporting omission.
Owner admission could initialize the selected production model but still reported `capabilities.productionModel: false`.
A new application regression failed before correction and now confirms the enabled owner adapter reports true.
The regression blocks source preparation and forbids execution dispatch, so it loads no credentials and sends no request.
Controlled admission paths continue to report false. This field identifies enabled configuration, not live provider acceptance.

Parent verification passed **223/223**, without exclusions or skips, and the browser regression passed **1/1**.
Syntax, documentation links/anchors, whitespace, and unchanged dependency/runtime checks passed.
The parent suite log is `/tmp/factory-ticket07-parent-full-suite.log`; browser results are in `/tmp/factory-ticket07-parent-browser.log`.
All **104** scopes recorded by the parent's exact-owned harness were inactive with empty cgroups in `/tmp/factory-ticket07-parent-scope-audit.json`.
These results do not establish acceptance of the real Vanguard/model profile.

## Independent review and acceptance

Independent review compared frozen checkpoint `e355ec6` with baseline `29292d4` and found no concrete correctness/safety defects or missing ticket #7 requirements.
It covered evidence binding, lazy initialization, original budgets, handoff authority, passive recovery, cancellation, failure propagation, and CLI restrictions.

Under Node 24.21.0, the reviewer passed **39/39** admission tests and **2/2** focused boundary regressions.
The focused cases cover bundle-backed write/read-only reuse and the handled-drain fence.
All **39** recorded scopes were inactive with no remaining processes.
The reviewer did not repeat the full suite or browser regression.
No source edits, credential discovery, Vanguard access, factory production-model calls, or public downloads occurred.

Review evidence:

- `/tmp/factory-ticket07-review-admission.log`
- `/tmp/factory-ticket07-review-boundaries.log`
- `/tmp/factory-ticket07-review-scopes.jsonl`
- `/tmp/factory-ticket07-review-scope-audit.json`

The parent accepted this controlled implementation checkpoint after its own verification and the independent review.
Ticket #8 can now build on the live handoff. Qualification remains ticket #9, and the real demonstration remains ticket #10.
This acceptance changes no tracker status and authorizes no live operation or push.

## Limits

No fixture completes the real Phase 1 demonstration.
Real credentials, provider acceptance, real Vitest/ESLint, Vanguard dependencies, and Vanguard baseline health remain unverified.
The conservative dependency parser can block a real profile. Admission does not weaken it.
The existing backup limitation for bundles containing `.bin` symlinks remains unchanged.

Cleanup guarantees still require Linux namespace teardown, an available user manager, and a schedulable launcher-loss monitor.
Manager failure plus owner loss, simultaneous backend/launcher death, host loss, and durable standalone recovery remain outside the established guarantees.
The tests do not claim that local model cancellation stops provider billing.
