# Ticket #6: private dependency preparation and read-only reuse

## Status and scope

The offline implementation started from `49a57c9`. The registry extension starts from `cc515bb` (the integrated offline implementation).
The isolated extension changed only dependency modules, dependency tests, and this document.
The parent subsequently connected application/CLI intent and receipt persistence and the `createRunTools` handoff.
Package files and the factory dependency graph remain unchanged.

**Offline preparation remains the default. Registry preparation requires separate explicit owner authorization.**
Offline mode accepts committed local tarballs with matching Bun lock integrity entries.
Registry mode supports a narrow, validated transitive Bun lock graph through a trusted fixed-registry downloader.
Bun never receives host network access. Unsupported source features fail closed.
These controlled tests do not establish Vanguard compatibility.

No Vanguard source, host credential file, or user Bun configuration was read.
No public package download, live model request, system installation, persistent service, or GitHub write occurred.
The factory dependency graph is unchanged.

## Trusted interfaces

Import the owner operations from `src/dependencies.mjs`:

```js
const intent = await admitDependencies({ workspaceIntent, bunPath });
// Persist the exact JSON intent under the factory lifetime owner lock.
const receipt = await prepareDependencies(intent, { signal });
// Persist the receipt before enabling any executor or repository tools.
const dependencyBundle = await verifyDependencyBundle(intent);
```

`workspaceIntent` is the saved ticket #4 intent, not model input.
`bunPath` is an explicit canonical executable path from trusted owner configuration.
Admission verifies the saved workspace ownership, manifest, input files, and toolchain without running Bun or writing retained state.

For registry packages, the separate owner flow uses:

```js
const intent = await admitDependencies({ workspaceIntent, bunPath, registry: true });
// Persist the exact intent and the parent's original operation limits under lifetime ownership.
const receipt = await prepareDependencies(intent, {
  authorizeRegistryFetch: true,
  signal: ownerOperationSignal,
});
// Persist the receipt before agent admission. Never expose these options to model tools.
```

The standalone `prepareOwnerDependencies(intent, options)` wrapper accepts the same options and owns the lock until drainage finishes.
Admission itself grants no fetch authority. Omitting `authorizeRegistryFetch: true` blocks registry preparation without creating an attempt.
The standalone intent-file command does not expose registry authorization.
The parent factory CLI provides that choice only through its explicit `prepare-dependencies ... --fetch-locked-packages` owner operation.
No start, resume, inspection, verification, check, or agent tool may call preparation implicitly.

Tests pass `registryTransport: { loopbackPort }` to preparation.
This trusted transport adapter changes only the destination to `127.0.0.1` and retains the exact planned archive paths.
It accepts no hostname, URL, credentials, headers, proxy, or redirect configuration.
The default transport targets only `https://registry.npmjs.org`. These tests never use that default transport.

`prepareDependencies` requires the actual accepted foreground scope.
Its caller must already hold factory lifetime ownership and exclude all agent execution.
Only an explicit owner request may invoke it.
Do not call it from worktree creation, run admission, start, resume, read, check, or inspection.

For a separate foreground operation, use:

```js
await prepareOwnerDependencies(intent, { signal });
```

This wrapper takes the factory owner lock itself.
It rejects a live backend and any unresolved active application run.
It releases ownership only after preparation and sandbox cleanup settle.
Do not call this wrapper while holding the same lock.

The launcher exposes that operation:

```sh
/home/cowen/.local/share/mise/installs/node/24.21.0/bin/node \
  bin/factory-contained.mjs prepare-dependencies /absolute/private/saved-intent.json
```

The intent file must be an owned regular file in an owner-only canonical directory.
The command accepts no executable, install arguments, environment overrides, network flag, or alleged preparation receipt.
The existing `serve` and containment diagnostics retain their behavior.

### Passive inspection and failures

```js
const state = await inspectDependencies(intent);
const failure = serializeDependencyError(error);
```

Inspection returns `not-prepared`, `incomplete`, or the verified `prepared` receipt.
It never runs a process, installs, repairs, retries, acquires execution authority, or enables a scheduler.
Missing, stale, and unsafe inputs produce fixed errors with explicit owner-preparation instructions.
The parent must save sanitized failures that occur before retained preparation begins.

A preparation directory is never adopted or overwritten by another invocation.
A repeated explicit invocation returns `DEPENDENCIES_EXISTS`, even after failure.
For an interrupted attempt, inspect first and require owner review and explicit cleanup before another attempt.
There is no automatic cleanup or retry API.

## Application integration ordering

1. Hold the factory lifetime owner lock and disable all agent tools.
2. Save the ticket #4 workspace intent and prepared receipt.
3. Admit dependency inputs for that saved workspace.
4. Save the dependency intent before starting preparation.
5. Invoke preparation only for the explicit owner request.
6. Forward stop, shutdown, and the original deadline through its trusted abort signal.
7. Await preparation settlement before releasing ownership.
8. Save the returned receipt or sanitized failure.
9. Verify the bundle again before constructing contained execution.
10. Pass only the validated opaque handle through trusted execution input.

A crash can leave a complete artifact receipt before the application saves it.
Passive inspection can recover that receipt without repeating preparation.
An incomplete receipt never permits a retry, a successful baseline claim, or agent admission.
Parent recovery must retain its existing quiescence requirements.
This slice adds no budget, scheduler, baseline-readiness, or recovery-policy changes.

## Execution handoff

```js
const tools = await createContainedExecution({
  worktree: workspaceIntent.worktree,
  receiptDirectory: privateCheckDirectory,
  signal: runAbortSignal,
  protectedPaths,
  dependencyBundle: await verifyDependencyBundle(intent),
});

await tools.check('vitest');
await tools.check('lint');
await tools.close();
```

`createRunTools` now accepts that optional handle through trusted execution input.
The adapter retains its cumulative reservations, workspace validation, signals, and drainage.
No owner preparation export belongs in a model tool schema or execution dispatcher.

The handle is process-local and stored in a private `WeakMap`.
A JSON copy, boolean, path, or fabricated receipt cannot authorize a mount.
Every check revalidates source inputs, toolchain fingerprints, script-suppression proof, bundle bytes, types, permissions, and paths.
Registry reuse also revalidates the retained acquisition records and archive digests.
A later source draft is allowed, but changing dependency inputs blocks reuse.

To reuse the bundle in a later private workspace:

```js
const dependencyBundle = await verifyDependencyBundle(intent, {
  workspaceIntent: laterSavedWorkspaceIntent,
});
```

The optional target must be a prepared ticket #4 workspace in the same private state directory.
Its project ID, repository path, base ref, exact base commit, and source-manifest ID must match the original.
Both workspaces must retain the admitted manifest, lockfiles, and any committed tarballs.
Package-manager configuration must still match committed source. New configuration files also block reuse.
The original bundle, inputs, and toolchain remain required. This is not relocation or cleanup authority.

The opaque handle snapshots the target when verification succeeds.
`dependencyMount(handle, worktree)` retains its existing signature and rejects a different target.
Each mount revalidates both workspaces. JSON copies and modified caller objects cannot retarget the handle.

Checks use only these direct argv forms:

```text
/runtime/node /work/node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1
/runtime/node /work/node_modules/eslint/bin/eslint.js . --no-cache
```

They never execute `package.json` scripts or accept model-selected command arguments.
The bundle mounts read-only at `/work/node_modules` inside the existing read-only source snapshot.
Kernel mounts, not owner permissions or a prepared boolean, enforce read-only use.
The original network denial, private scratch, output bounds, deadline, resources, parentage verification, and cancellation remain in effect.
The snapshot and file tools now also exclude `.npmrc`, Yarn configuration, and `bunfig.toml`.

Repository check receipts include `dependencyIntentId` and `kind: repository`.
They still have `reviewReady: false`.
The boundary diagnostic separately proves that the dependency mount rejects writes with `EROFS`.

## Preparation boundary

Preparation uses direct Node-to-bubblewrap launch inside the verified foreground scope.
The launcher observes the actual child PID, parent, start time, and cgroup before releasing its startup pipe.
Bubblewrap uses parent-death termination, private PID/network namespaces, and the existing seccomp network denial.

Only these inputs enter the sandbox:

- The selected Node and Bun executables and required system libraries.
- Factory-owned preparation code.
- Verified `package.json`, `bun.lock`, `package-lock.json`, and admitted local tarballs.

It mounts no host home, credentials, user configuration, sockets, or other run state.
The preparation environment is fixed and does not inherit credentials, proxies, or loader options.
The source inputs mount read-only.
Bun installs into the bounded scratch filesystem, not a host-writable source or cache directory.
The sandbox has no public or host-loopback network access.

The target invocations are fixed:

```text
# Committed local tarballs:
/runtime/bun install --no-cache --backend=copyfile --frozen-lockfile --ignore-scripts
# Verified registry cache:
/runtime/bun install --backend=copyfile --frozen-lockfile --ignore-scripts
```

Registry mode supplies a private cache containing only integrity-checked, strictly validated archives.
The trusted extractor writes Bun 1.3.14's `<name>@<version>@@@1` cache layout, including scoped names.
The worker copies that cache into bounded scratch. It still has the same network namespace and seccomp denial.
Missing cache entries therefore fail instead of letting Bun fetch metadata, archives, or arbitrary URLs.
A different Bun version blocks before registry acquisition. Cache-format portability is not claimed.

### Trusted registry acquisition

Only the factory downloader runs outside the package sandbox.
It derives archive paths from locked names and versions, never from archive metadata or lock-supplied URLs.
It performs sequential direct GET requests with no redirects, retries, metadata requests, authentication, proxies, or environment-derived configuration.
It does not launch Bun, a shell, or package code on the host.

Before the first request, `acquisition.json` saves the complete finite request set, intent ID, transport origin, deadline, and conservative byte reservations.
The parent must already have saved its intent and original operation limits.
An existing attempt cannot replenish limits or retry implicitly.

Acquisition limits are fixed:

- At most 2,000 locked package entries and a 1 MiB serialized acquisition plan.
- At most 16 MiB compressed per archive and 64 MiB compressed in total.
- At most 32 MiB decompressed tar data per archive, 64 MiB file contents in total, and 20,000 entries.
- A 120-second acquisition deadline and 10-second socket-idle timeout.
- At most 16 KiB HTTP response headers. Non-200 responses and content encoding other than identity fail.

SHA-512 verification precedes extraction. Archive names, versions, dependency maps, and bin maps must agree with the lock.
Retained archives remain private. The downloader counts bytes but does not retain server diagnostics.
Abort and timeout destroy and drain the response, request, and socket before returning.
The parent's original abort signal covers acquisition, both sandboxes, and sealing.

The accepted scope supplies 4 GiB memory, zero swap, and 256 tasks.
Scratch is 256 MiB.
Each sandbox has a 120-second outer deadline and a 1 MiB combined diagnostic-output limit.
Bun's synchronous child also has a 100-second deadline.
The parent must still enforce the original overall run or owner-operation deadline.

Raw package diagnostics are counted but never retained or returned.
The trusted worker exports installed files through a separate bounded pipe.
Export has a 128 MiB serialized limit, a 64 MiB decoded-content limit, and 20,000 entries.
Individual bundle files have an 8 MiB limit.
The host validates that export before writing or sealing a bundle.

### Script-suppression gate

Every owner preparation first runs a fixed factory-owned positive and negative control with the selected Bun binary.
The positive control executes only synthetic factory scripts inside the same network-denied sandbox.
It does not execute target package scripts.
The negative control uses `--frozen-lockfile --ignore-scripts`.
These mandatory controls use the fixed local sentinel archive, not downloaded package scripts.
Registry target fixtures separately confirm zero sentinels with root, direct, and transitive packages declared trusted.
Preparation blocks unless both controls produce the required observations.

Measured with installed Bun **1.3.14**:

- Root `preinstall`, `install`, and `postinstall`: all three positive sentinels appeared.
- Dependency `preinstall`, `install`, and `postinstall`: all three positive sentinels appeared.
- The dependency was explicitly listed in `trustedDependencies`.
- With scripts disabled, none of those six sentinels appeared.
- The target fixture preparation also produced zero script sentinels.
- Controlled TCP and UDP attempts returned `EPERM` in the preparation sandbox.
- Writes to its mounted inputs returned `EROFS`.
- Kernel observations confirmed 256 MiB scratch, seccomp filtering, no new privileges, and zero effective capabilities.
- Private host paths and configuration files were absent, and the environment matched the fixed allowlist.

The proof records the Bun executable SHA-256 and version.
Reuse verifies the retained proof against the preparation receipt and current toolchain fingerprint.
Help text and offline flags are not evidence for these claims.

## Fingerprints and supported inputs

The dependency intent includes the complete saved workspace intent and source-manifest identity.
It records exact SHA-256 values for both lockfiles, the manifest, and every admitted tarball.
The Bun lock must also contain each archive's matching SHA-512 integrity.
Preparation compares both lockfiles and the manifest again after Bun exits.
It never rewrites the owner checkout or admitted workspace.

The toolchain fingerprint includes paths, modes, and bytes for Bun, Node, bubblewrap, and mounted system libraries.
It also includes the Node version and preparation-policy version.
Changes block reuse instead of silently preparing a replacement.

Offline mode still accepts only direct local tarballs under `vendor/`, without transitive dependencies.
Registry mode accepts these Bun 1.3.14 text-lock forms:

- `lockfileVersion: 1`, `configVersion: 1`, and exactly the root workspace.
- Root `dependencies` and `devDependencies`, with matching root lock maps.
- Registry tuples `["name@version", "", metadata, "sha512-..."]`. The empty registry field denotes the fixed default registry.
- Ordinary and scoped package names, hoisted or nested lock keys, and multiple locked versions.
- Exact numeric `major.minor.patch` specifications, or their simple `^` and `~` forms. Components must be safe integers.
- Tuple metadata containing only `dependencies` and object-form `bin` maps.
- Matching `trustedDependencies` arrays. Script suppression remains mandatory regardless of trust declarations.

All lock entries must be reachable from root dependencies. Shared archives must have identical integrity and metadata.
No network resolution is needed to validate the graph. Bun then verifies the original frozen lock without rewriting it.
The parser accepts emitted trailing commas, but rejects duplicate keys, comments, unknown lock fields, and invalid UTF-8.

Registry mode rejects optional, peer, platform-specific, bundled, aliased, Git, URL, file, link, workspace, patched, and override dependencies.
It also rejects prerelease/build versions, tags, wildcard/comparator/union ranges, custom registries, authentication, and string-form bin maps.
Nonempty development dependencies inside downloaded package manifests also block this conservative policy.
These are explicit compatibility blockers, not evidence that real Vanguard dependencies work.

Tar admission supports ordinary ustar files and directories only.
It rejects escaping paths, symlinks, hardlinks, special nodes, archive extensions, credential files, and package-manager configuration.
It rejects directory dependencies, links, Git sources, supplied archive URLs, registry credentials, workspaces, patches, overrides, and package publication configuration.
Unsupported JSON syntax or package features also block preparation.

Only Bun-generated root `node_modules/.bin` links are accepted.
Their normalized targets must be regular files inside the sealed `node_modules` tree.
Nested bin-link layouts fail closed.
Archive paths use a restricted ASCII filename alphabet. Names with spaces, backslashes, or non-ASCII characters also fail closed.
The verifier never follows them while hashing.
Extra files, missing files, hardlinks, redirects, executable-mode changes, modified bytes, and modified proof records block reuse.
The host owner, factory code, and private metadata remain trusted.
This boundary does not defend against a hostile same-UID host operator or compromised kernel.

## Retention and cancellation

Artifacts live outside the repository:

```text
<state>/runs/<run>/dependencies/<intent-id>/
  intent.json
  started.json
  input/
  acquisition.json            # Registry request plan and reservations, before requests.
  acquired.json               # Completed acquisition record.
  archives/*.tgz              # Verified exact archives, registry mode only.
  cache/                     # Strictly extracted private Bun cache, registry mode only.
  script-proof/input/
  script-proof/filter.bpf
  script-proof/launch.json
  script-proof/result.json
  filter.bpf
  launch.json
  bundle/node_modules/
  result.json                 # Only after successful verification and sealing.
  failure.json                # Sanitized failure, when the backend survives.
```

Receipt writes synchronize a pending file before atomic rename.
These are process-crash guarantees, not host power-loss guarantees.
Bundle files use owner-only read permissions, but checks still require kernel read-only mounts.
No agent sandbox can access the ownership records or receipts.

Cancellation kills and drains the direct sandbox child.
The PID namespace removes its descendants.
Preparation checks cancellation during sealing and retains partial artifacts rather than deleting them.
The standalone owner wrapper releases its lock only after that drainage.
The cancellation fixture observed at least two sandbox processes and found no surviving observed process after return.

## Offline baseline verification record

The tests use the preparation and contained-execution interfaces with disposable repositories and actual OS fixtures.
They do not use private SQL, command help, source-string assertions, a substitute Bun, or a substitute sandbox.

The installed fixture packages use the names `vitest` and `eslint` to exercise the fixed entry-point paths.
Their entry points perform filesystem and network assertions.
**They are controlled packages, not the real Vitest or ESLint distributions.**
Their success proves installed-bundle reuse and containment, not real Vanguard test or lint compatibility.

Coverage includes:

- Actual frozen Bun installation and the per-toolchain script-suppression gate.
- Both source lockfiles remaining byte-identical.
- Actual owner-command admission and owner-lock exclusion.
- Missing bundles, changed inputs/toolchain, and content/type/path tampering.
- Fixed Vitest/lint argv and kernel read-only source/bundle mounts.
- Denied check networking, rejected arbitrary argv, and rejected install commands.
- Revalidation after a handle was issued and later bundle tampering.
- Frozen-lock failure, sanitized retained failures, passive inspection, and refusal to retry implicitly.
- Abort drainage and release of owner locking only after settlement.

Retained controlled evidence is indexed at:

```text
/tmp/factory-dependency-evidence-oQ8n17/manifest.json
```

It includes preparation, reuse, integrity, frozen failure, cancellation, unsupported inputs, and explicit owner-command results.
All associated transient scopes have stopped.
Artifacts remain private for owner inspection and explicit cleanup.

Under Node 24.21.0, the final full `npm test` rerun passed **113/113**, with no skips.
The dependency-specific suite passed **9/9**.
JavaScript syntax checks and `git diff --check` passed.

An earlier full-suite attempt passed 112/113 and timed out in the existing descendant-cleanup test.
The timeout left bubblewrap and two fixture descendants alive in that test's scope.
Only the exact owned scope, `factory-contained-67d4b482-1fa2-4251-959f-b5c79b25a1bf.scope`, was stopped.
An isolated rerun and the final full rerun passed without changing the diagnostic.
At that checkpoint, the cause remained unresolved. Those later passes were not proof that the cleanup failure could not recur.
The later [containment correction](containment-cleanup-correction.md) reproduced a startup race, without claiming to identify the exact mode in the historical timeout.
The evidence directory retains the failed and successful suite logs and the scoped cleanup observation.

## Registry extension verification

The extension tests use Node 24.21.0, actual Bun 1.3.14, disposable private Git workspaces, and loopback HTTP servers.
The package names `vitest` and `eslint` still denote synthetic fixtures, not the real distributions.

The dependency suite covers:

- Actual frozen registry installation, including a transitive import and scoped/nested multi-version packages.
- Byte-identical Bun and npm lockfiles, with no host or sandbox metadata downloads.
- The mandatory six positive script sentinels and zero suppressed sentinels, including trusted dependencies.
- Exact requested archive paths, no authorization headers, and saved intents/reservations observed before requests.
- Missing explicit fetch authorization and stale input rejection before requests.
- Unknown or ambiguous lock features, arbitrary URLs, credentials, Git/file escapes, missing edges, and orphan archives.
- Redirect rejection, byte limits, idle timeout, wrong integrity, unsafe archive paths/configuration, and undeclared archive dependencies.
- Tampered retained archives/acquisition records and target configuration changes.
- Verified reuse in a second private workspace, with cross-project and different-base rejection.
- Cancellation during a stalled download and during an observed actual `/runtime/bun install` process.
- Socket and descendant drainage before owner-lock release, retained incomplete attempts, and no implicit retry.

Verification under Node 24.21.0:

- Full `npm test`: **140/140 passed**, without skips.
- Dependency suites: **18/18 passed**, including nine new registry tests.
- JavaScript syntax checks and `git diff --check` passed.

Private retained evidence is at `/tmp/factory-dependency-registry-evidence-Jde8eZ/`.
It contains suite logs and complete nested-registry, later-workspace reuse, download-cancellation, and Bun-install-cancellation artifacts.
The loopback servers and associated transient scopes have stopped.
This registry extension did not resolve the containment cleanup caveat in the baseline record.
A passing rerun was not evidence of a cleanup correction.

These tests do not establish public-registry TLS/availability, real Vitest/ESLint compatibility, or real Vanguard baseline health.
No public egress, package install into factory dependencies, host credential access, tracker write, or live model call occurred.

## Parent application checkpoint

The parent now exposes `factory.prepareDependencies(runId, { bunPath, registry })` and the corresponding CLI operation.
Offline preparation remains the default. `--fetch-locked-packages` is an explicit owner choice, saved before dependency admission.
The application retains intent and receipts, original deadlines/counters, stop/shutdown drainage, and interrupted-preparation fencing.
`createRunTools` forwards only verified opaque bundle handles.
See the [application record](dependency-application.md) for lifecycle tests, registry opt-in, and later-workspace reuse evidence.

The parent dependency/application selection passed **27/27** after this wiring.

## Independent registry review correction

The review found that a scoped lock key such as `@fixture/vitest` could contain the unscoped tuple `vitest@1.0.0`.
A suffix-only placement check and version-only graph lookup admitted this undocumented alias.
The reviewer reproduced a successful frozen Bun installation with the wrong package identity at the scoped path.
No sandbox or arbitrary-origin escape was observed.

Owner-admission regressions reproduce both root and nested scoped substitutions.
Both failed before the correction, returning an admitted intent rather than `DEPENDENCIES_UNSUPPORTED`.
The parser now compares complete package names at placements and requires each resolved tuple to match its dependency edge's name.
Both cases reject before acquisition with zero requests. Supported scoped and nested graphs still install and pass their controlled checks.

After this correction and the containment integration, **38/38** tests passed across the containment, registry, and dependency-application suites, with no skips.
This is targeted verification, not complete containment acceptance.

## Remaining integration and compatibility gates

- Apply and verify namespace-lifetime cleanup in the separate dependency-preparation launcher, which still uses the earlier outer-bwrap-only cancellation pattern. Complete combined verification before enabling real agent execution.
- Preserve the application's intent/receipt ordering, lifetime ownership, original deadlines, recovery fencing, and tool-budget controls.
- Keep registry acquisition owner-only. A package, agent tool, or repeated failed request cannot authorize fetching.
- The production fixed-registry transport exists but has not made a public request. Production/public requests remain unauthorized in this task.
- Real Vanguard Bun lock syntax, transitive packages, Vitest, and ESLint remain unverified and may fail the conservative policy.
- Broader Bun lock features require explicit validation and tests. Do not weaken the parser or enable Bun networking as a compatibility fallback.
- Real baseline health, model-driven execution, and work-item qualification remain later tickets.
- Existing backup code rejects symlinks, including validated Bun `.bin` links. Do not advertise dependency-bundle backup/restore support yet.
- Explicit cleanup is required before retrying an incomplete preparation. No automatic repair or relocation is provided.

Do not claim real preparation, real Vanguard checks, or Phase 1 maintenance success from these fixtures.
