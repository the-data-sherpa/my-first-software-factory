# Bounded published libc metadata

P2 preparation checkpoint for the accepted parent contract in `docs/implementation/dependency-policy-proposal.md` on the parent checkout. The owner selected bounded `glibc`/`musl` recognition on 2026-11-06. This is not permission for real packages, native-code execution, the captured installation, owner readiness, #10 acceptance or publication.

## Prepared first regression

`tests/phase-1/dependencies-libc.test.mjs` and its fixed runner use the existing public `admitDependencies` → `prepareDependencies` → `inspectDependencies` / `verifyDependencyBundle` interfaces with authored archives over trusted loopback acquisition and actual contained Bun 1.3.14.

The first fixture publishes two ordinary Linux/x64 packages with `libc: ['glibc']` and `libc: ['musl']`. Both are required by the root. It expects both installed under the unchanged Linux/x64 selection, their exact declarations retained in the bundle, unchanged manifest and both lockfiles, denied tool network, read-only inputs, hidden private paths, original scratch bounds, suppressed root/dependency scripts and passive verified reuse without more requests. It imports no package code and makes no native ABI claim.

The outer test retains failed or undrained roots; the runner supplies its explicit inner root to the corrected shared fixture, which closes the loopback server without deleting caller-owned evidence. Saved intent, source hashes and observed public outcome remain inside failed roots. `FACTORY_LIBC_EVIDENCE` optionally retains per-scenario terminal receipts in an existing private evidence directory; use a separate directory per attempt because files are exclusive-create.

Syntax checks passed before the slot transfer. The parent subsequently granted the exclusive heavy-test slot for one behavioral red on tracked B revision `e0e27928e39d9be2946c8f9b8f49c90ea426b8c7`.

The permanent positive failed 0/1, exit 1, because public preparation returned `DEPENDENCIES_UNSUPPORTED` before the package-install launch. The worker itself exited 0 with no stderr, reporting incomplete inspection, one exact planned loopback request for the glibc archive, and unchanged manifest/Bun/npm lock bytes. This is the expected behavioral refusal, not a fixture or environment failure. The declared two-package plan remained explicit; preparation stopped at its first rejected archive.

Private evidence: `/home/cowen/.local/state/tiny-software-factory/development-evidence/libc-positive-red-ouFJoM/` includes command, revision, source hashes/copies, log, actual exit, terminal JSON, and a fresh exact-scope audit. The failed root `/tmp/factory-dependency-libc-s9rItN` retains its saved intent, source snapshots, public result and inner repository. Every recorded source hash remained unchanged. The one scope was freshly inactive with an empty cgroup and no processes; the runner is terminal. The slot was released to the parent for the runtime correction.

## Required parent correction

Frozen stream B `24ab341` includes `libc` in `registryArchive`'s generic forbidden-field loop. The loop uses truthiness plus `Object.keys(value).length`. Source inspection therefore predicts rejection of nonempty recognized arrays while null, empty arrays/objects and numeric values can bypass that generic check. This is a source finding, not an executed red.

Validate presence explicitly. Parent confirmed that the accepted P2 contract should follow the existing `os`/`cpu` convention: a recognized scalar string or a unique nonempty array containing only `glibc` and/or `musl`. Reject null, empty values, unsupported objects/numbers/booleans, unknown values, negation and duplicate array values. Do not change Bun's frozen Linux/x64 OS/CPU selection or derive an implicit libc filter.

The parent then factored `validateRegistryManifest`, added the explicit presence/type/value validation, and preserved the other archive checks. The same permanent positive passed before any additional case was authored. No common runtime file was changed by this test stream.

The published declaration is covered by exact archive integrity, acquired archive retention and sealed installed metadata. Passive inspection and verified reuse reject an altered retained declaration; parent still owns policy-version/fingerprint integration.

## Executed follow-up coverage

- The original positive installs both single-value array declarations under Linux/x64.
- A second successful authored graph covers scalar `glibc`, scalar `musl`, a two-value array in its published order, and absent metadata. Exact declarations are retained without ABI filtering.
- Null has a separate explicit-presence guard. One grouped worker covers ten further invalid forms: empty string/array/object, numeric zero, boolean false, unknown scalar, negated scalar, duplicate array values, mixed-type array and an unknown array member. Each refuses with `DEPENDENCIES_UNSUPPORTED`, one exact planned request, no package-install launch, incomplete inspection and unchanged inputs.
- A grouped worker publishes valid libc alongside contradicting OS, CPU or ordinary dependency metadata. All three refuse before installation. The affected existing preparation suite also preserves its five remaining archive-metadata refusals, including bins.
- A real prepared bundle is passively inspected and verified, then its retained libc declaration is changed from `glibc` to `musl`. The original file mode is restored so this checks the data binding rather than a writable-mode difference. Both public inspection and verified reuse return `DEPENDENCIES_UNSAFE`, without another request. No receipt, inventory digest or successful qualification authority was fabricated.

The parent removed the now-legitimate libc declaration from the old archive-refusal group and adjusted its expected count to five. Its boundary is retained here as positive and invalid-declaration coverage, rather than silently dropped.

## Receipts and source binding

| Check | Observed result | Private evidence directory |
| --- | --- | --- |
| Original positive against the old archive policy | 0/1, exit 1; actual recognized-libc refusal | `libc-positive-red-ouFJoM` |
| Same unchanged positive after the parent patch | 1/1, exit 0 | `libc-positive-green-ZnW2iw` |
| Added null-presence case | 1/1, exit 0 | `libc-presence-null-Xfm5Dg` |
| Added scalar/multi-value/absent shape graph | 1/1, exit 0 | `libc-valid-shapes-dUI5tJ` |
| Final libc and affected preparation files | 12/12, exit 0: six libc and six existing preparation cases, no skips/cancellations | `libc-final-selected-MBemQ8` |

All directories are beneath `/home/cowen/.local/state/tiny-software-factory/development-evidence/`. Each retained command, source snapshot, actual exit, output and exact scope journal names its own attempt. The added boundaries are characterization/regression guards on the implemented parent policy; no pre-patch negative-type product red was executed or claimed.

The final run used tracked base `e0e2792` plus the parent's frozen common-source diff, with no graph invocation yet. Every hash in its `source-before.sha256` matched immediately after the final run. Only this stream's test/runner files evolved between the earlier positive, incremental coverage and final run; the counts overlap and are not a full-suite total. Later graph wiring or other common-source changes require affected rechecks before an integrated conclusion.

`all-own-scopes-audit.json` in the final directory freshly verifies all 16 exact scopes from these journals inactive and empty, including the original red. Nine recorded passing libc roots were confirmed removed only after assertion success and drainage; the original failed root remains. No runner or continuation remains, and the exclusive heavy slot was released to the parent before further wiring. No full suite, model or browser check ran in this stream.

No runtime or shared fixture file was edited here, and no shared-checkout commit was made. Controlled success establishes only this preparation contract on the retained source, not real distributions, native code, captured-lock installation, baseline health or owner readiness.
