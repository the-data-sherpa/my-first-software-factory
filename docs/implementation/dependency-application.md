# Dependency preparation through the application

This integration connects offline and locked-registry dependency preparation to retained application records and the separate CLI.
Registry safety review and the reported containment cleanup failure remain open gates.
It does not enable real agent execution, claim Vanguard compatibility, or establish maintenance readiness.

## Explicit owner operation

Start a workspace-only backend through the foreground resource launcher.
Use the separate CLI to admit a brief and prepare its exact source.
After that run reaches `blocked / MODEL_NOT_READY`, the owner can request dependency preparation:

```sh
npm run factory -- prepare-dependencies RUN_ID --bun-path /absolute/canonical/path/to/bun
```

The backend must retain the same private state and project identity.
The Bun path is an explicit owner input, never a model argument or package-selected command.
Offline preparation is the default and accepts only supported committed tarballs.
Locked registry preparation requires a separate, explicit owner choice:

```sh
npm run factory -- prepare-dependencies RUN_ID --bun-path /absolute/canonical/path/to/bun --fetch-locked-packages
```

That flag can authorize public requests in production. Implementation tests used only a controlled loopback registry.
Unsupported lock features block before acquisition. The CLI cannot select arbitrary registries, credentials, archive URLs, or transport adapters.

The application interface is:

```js
await factory.prepareDependencies(runId, { bunPath, registry: false }); // Offline default.
await factory.prepareDependencies(runId, { bunPath, registry: true });  // Explicit locked acquisition.
```

The application saves the boolean registry choice before dependency admission.
It then saves the dependency intent before passing fetch authorization to trusted preparation code.
A package manifest cannot grant that authority. A duplicate request cannot change it or restart a failed attempt.

It returns the admitted operation without waiting for installation.
Use `inspect`, `stop`, or foreground shutdown to observe or cancel it.
No ordinary start, inspection, read, or check installs dependencies.
No preparation function appears in an agent tool schema.

Preparation requires an unused workspace-only run with no model submission or consumed model/tool allowances.
It uses that run's existing identity, saved source, task brief, deadline, and budget.
The original 20-minute deadline includes the owner's waiting time. Preparation never extends it.
An expired run needs an explicit reviewed, linked replacement.

## Ownership and persistence

The operation uses the existing lifetime owner lock, active-run exclusion, abort signal, and draining job lifecycle.
A second start cannot overlap preparation.
The application verifies the live foreground resource envelope before dependency admission.
It saves `dependencies.intent` before any installer or retained preparation effect.
It saves `dependencies.receipt` before returning to `blocked / MODEL_NOT_READY`.
No executor runs after preparation.

The record retains the dependency operation, selected Bun path, intent, receipt, and sanitized failures.
`dependencies.status` records the application result.
`dependencies.artifactStatus` reports the current passive verification result.
A changed source or bundle reports `invalid` and an inspection failure, not current readiness.
A duplicate successful request revalidates the bundle without installing again.
An incomplete or failed attempt never restarts implicitly.

Stop, shutdown, and the original deadline cancel preparation and wait for drainage before releasing admission or ownership.
Stop remains effective through finalization.
A dependency startup drain failure uses the same ownership fence as an execution startup drain failure.

## Crash recovery

Inspection never invokes an installer, fetcher, toolchain executable, or scheduler.
A crash leaves the dependency operation interrupted, even if its source workspace is complete.
A saved dependency intent without a completed artifact receipt cannot establish quiescence.
Stop and replacement then reject with `DEPENDENCIES_RECOVERY_REQUIRED`.

A complete verified artifact receipt can reconcile the crash window before the application saved that receipt.
It permits a terminal stop or explicit linked replacement, not automatic execution or resume.
Admission before the dependency intent launches no subprocess and cannot start preparation.
Model recovery remains a separate, unavailable production gate.

## Trusted execution handoff

`createRunTools` accepts an optional `dependencyBundle` from trusted execution code.
The bundle must be the opaque handle from `verifyDependencyBundle`, not a path, JSON receipt, or prepared flag.
The contained runner validates that handle and rechecks its source, toolchain, and bundle before mounting it read-only.

Verification and each read, write, or fixed check still consume the supplied original tool budget.
Vitest/lint entry points are fixed. There is no install command or editable argv.
A later private workspace can reuse the bundle only after verification binds an opaque handle to that matching target.
The target must retain the same project, private state, repository, exact source, dependency inputs, and toolchain.
No new fetch or installation occurs during reuse.
The controlled packages used in these tests are not real Vitest or ESLint distributions.

## Evidence and remaining gates

The application/execution tests use disposable repositories, actual Bun and bubblewrap, and exact-owned transient scopes.
They cover intent-before-effects ordering, retained receipts, no implicit installation, and original deadlines/counters.
They also cover actual process cancellation, shutdown, crash windows, passive inspection, stale inputs, and opaque bundle handoff.
The CLI regression confirms that an uncontained backend refuses installation before dependency admission.

The initial run-tools handoff test uses an in-memory implementation of the trusted budget interface.
The registry integration also exercises a later explicit controlled run with application-backed tool/model accounting and no registry server available.
That run uses a tool-free model fixture, not live inference.
Additional cases cover absent fetch authorization, saved authorization before requests, duplicate-policy mismatch, and cancellation of a stalled HTTP body.
All model credentials and transports remain controlled. No real credentials, Vanguard access, or public downloads are needed.

Existing backup code rejects symbolic links, including Bun's validated `.bin` links, before creating a backup destination.
Dependency-bundle backup/restore support is not claimed. Retain the original private state until explicit owner cleanup.
After registry application wiring, the Phase 0/1 selection passed **145/145**, with no skips.
That selection explicitly excluded `containment.test.mjs` and `containment-crash.test.mjs` while the cleanup failure remains under investigation.
It still exercised the dependency preparation and run-tools OS fixtures.
The browser recovery probe passed **1/1**.
The lifecycle integration review found no concrete defects and passed **45/45** targeted tests plus two startup-drain failure probes.
It excluded the registry implementation and new registry application worker from independent acceptance.
After registry wiring, the dependency module and application suites passed **27/27**, with no skips.
These are not full-suite acceptance results. Combined verification and independent registry review remain pending.
