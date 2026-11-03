# Ticket #6: private dependency preparation and read-only reuse

## Status and scope

This implementation starts from `49a57c9` and leaves application, workspace, model, recovery, and package files unchanged.
It adds a separate owner preparation operation and a verified dependency handle for contained checks.
The parent must connect that handle to the application and `createRunTools`.

**The supported preparation policy is offline-only.**
It accepts committed local tarballs with matching Bun lock integrity entries.
It does not fetch registry packages, including during owner preparation.
Registry packages, transitive dependency graphs, and unsupported source features fail closed.
This is a controlled implementation of preparation and reuse, not a claim of full Vanguard compatibility.

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

The parent must add the optional handle to its trusted `createRunTools` adapter input.
That adapter must retain its existing cumulative reservations, workspace validation, signals, and drainage.
No owner preparation export belongs in a model tool schema or execution dispatcher.

The handle is process-local and stored in a private `WeakMap`.
A JSON copy, boolean, path, or fabricated receipt cannot authorize a mount.
Every check revalidates source inputs, toolchain fingerprints, script-suppression proof, bundle bytes, types, permissions, and paths.
A later source draft is allowed, but changing dependency inputs blocks reuse.

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

The target invocation is fixed:

```text
/runtime/bun install --no-cache --backend=copyfile --frozen-lockfile --ignore-scripts
```

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

The current policy accepts direct local tarballs under `vendor/` with no transitive dependency graph.
Tar admission supports ordinary ustar files and directories only.
It rejects escaping paths, symlinks, hardlinks, special nodes, archive extensions, credential files, and package-manager configuration.
It rejects directory dependencies, links, Git sources, registry URLs, registry credentials, workspaces, patches, overrides, and package publication configuration.
Unsupported JSON syntax or package features also block preparation.

Bun-generated `.bin` links are allowed only when their normalized targets are regular files inside the sealed `node_modules` tree.
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

## Verification record

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
The cause remains unresolved. Do not treat those later passes as proof that the cleanup failure cannot recur.
The evidence directory retains the failed and successful suite logs and the scoped cleanup observation.

## Remaining integration and compatibility gates

- Investigate the intermittent descendant-cleanup failure before enabling real agent execution. This slice does not resolve that containment caveat.
- The parent must persist dependency intents/receipts and pass the validated handle through `createRunTools`.
- The parent must retain its application ownership, original deadlines, recovery fencing, and tool-budget controls.
- Registry fetching is deliberately unavailable. No network-enabled preparation mode has been implemented or authorized here.
- Real Vanguard Bun lock syntax, transitive packages, Vitest, and ESLint remain unverified and may fail the conservative policy.
- Real baseline health, model-driven execution, and work-item qualification remain later tickets.
- Existing backup code rejects symlinks, including validated Bun `.bin` links. Do not advertise dependency-bundle backup/restore support yet.
- Explicit cleanup is required before retrying an incomplete preparation. No automatic repair or relocation is provided.

Do not claim real preparation, real Vanguard checks, or Phase 1 maintenance success from these fixtures.
