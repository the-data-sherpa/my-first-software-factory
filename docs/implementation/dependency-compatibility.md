# Dependency compatibility: bounded Bun 1.3.14 lock profile

Historical development record: the status/profile headers below describe earlier isolated checkpoints. B/G, the accepted graph/libc contracts and prerelease correction are now combined. See the [owner-requested publication checkpoint](publication-checkpoint.md) for current verification limits; earlier “unintegrated” and “unapproved” status statements are superseded there and by the accepted policy record.

Stream B record for the [bounded Vanguard compatibility work](vanguard-compatibility.md).
It changes registry admission (`admitDependencies` with `registry: true`) and the archive check during acquisition.
It does not establish real archive availability, sizes, native-package behavior, actual Vitest, a healthy baseline, owner readiness, or #10 acceptance.

## Status

**Blocked partial checkpoint, not accepted or integrated.** Required-peer tolerance is an unapproved policy candidate. Three owner decisions remain open: peers, `libc`, and prerelease preparation. Passing tests do not resolve those gates.

- **Admission:** candidate behavior implemented and exercised through the public seam with authored fixtures and the captured lock bytes as data.
- **Pinned Bun behavior:** controlled authored-package evidence exists. See [Controlled Bun 1.3.14 evidence](#controlled-bun-1314-evidence). Prerelease identities do not prepare.
- **Archive check during acquisition:** exercised through real controlled acquisition. The supported metadata forms prepare; mismatches refuse before Bun installation starts.

## Profile

The registry toolchain policy is now `bun-registry-cache-v2`.
The policy name is part of every registry intent, so earlier `v1` intents become stale instead of being reused under the new planning rules.

The preparation host is explicit: `{ os: 'linux', cpu: 'x64' }` (`HOST` in `src/dependencies-lock.mjs`).
It matches the pinned glibc x86-64 runtime libraries that preparation already binds.
Registry admission refuses with `DEPENDENCIES_UNSUPPORTED` when `process.platform` or `process.arch` differs.
The intent records the host, the planned archives, the excluded placements, and every tolerated unmet peer.

## Accepted lock forms

Anything outside these forms refuses with `DEPENDENCIES_UNSUPPORTED` before any request.

- **Top level:** `lockfileVersion` 1, and `configVersion` 0 or 1. Only the root workspace `''` is allowed. Other existing top-level rules are unchanged.
  Accepting configuration version 0 does not, by itself, make a lock compatible. Controlled frozen preparation of authored single-root graphs produced the same bundle at 0 and 1, with the lock unchanged. That evidence covers only the exercised shapes.
- **Names:** existing npm name rules, plus `.` anywhere except the first character of a scope or name segment. Examples: `@nodelib/fs.scandir`, `array.prototype.flat`. The 150-character limit is unchanged.
- **Versions:** strict SemVer `MAJOR.MINOR.PATCH`, with an optional prerelease such as `1.0.0-beta.2`, `2.0.0-next.5`, or `19.0.0-rc-de68d2f4-20241204`. Build metadata (`+…`), leading zeros, `v` prefixes, and unsafe integers refuse. Prereleases are ordered as SemVer specifies.
- **Ranges** (root and locked specs): at most 256 characters, at most 16 `||` alternatives, and at most 4 comparators per alternative.
  - Comparators: `*`, or x-ranges and partials (`4`, `17.x`, `1.x.x`, `^16.8`).
  - Comparators: `^` or `~` with a partial or full version.
  - Comparators: `>=` or `<` with a numeric partial or full version. Spaces may follow the operator, as in `>= 4.21.0`.
  - Comparators: one hyphen range `A - B`.
  - Semantics follow npm. Missing parts lower-bound to zero, and upper bounds exclude the bound's prereleases. A prerelease satisfies an alternative only when a comparator in that alternative names a prerelease of the same release.
  - `>`, `<=`, `=`, `~>`, tags, aliases, URLs, files, workspaces, and git refuse. None of these appears in the captured lock.
- **Tuple metadata:** only `dependencies`, `optionalDependencies`, `peerDependencies`, `optionalPeers`, `os`, `cpu`, and `bin`.
  - A name can appear under only one relationship kind.
  - `optionalPeers` must be unique names declared in `peerDependencies`.
  - `bin` is a safe relative path string, or a non-empty map of safe names to safe paths.
  - `libc` and other unknown keys refuse.
- **Platform values:** a single value, a non-empty list without duplicates, or Bun's `none`.
  - `os`: `aix`, `android`, `darwin`, `freebsd`, `linux`, `openbsd`, `sunos`, or `win32`.
  - `cpu`: `arm`, `arm64`, `ia32`, `ppc64`, `s390x`, or `x64`.
  - Negations and other values refuse.

## Graph rules

Every relationship resolves with the existing hoisted ancestor lookup over lock keys. The resolved placement must carry the declared name.
Lock keys check the lock's internal consistency; they are not Bun's installed layout. Controlled frozen installs re-hoisted packages differently from their keys while installing the same identities.

1. **Planned.** Placements are reached from the root manifest's `dependencies` and `devDependencies` through these edges:
   - `dependencies`;
   - non-optional peers whose provider satisfies the range;
   - host-applicable `optionalDependencies`.

   Each edge must satisfy its range. A planned placement must be host-applicable, so a required dependency or required peer on a non-host package refuses.
2. **Unmet peers: unapproved candidate.** Whether Bun 1.3.14 preserves this locked layout and accepts it is unverified. The current candidate allows an out-of-range peer only when its provider is already planned through satisfied edges, and records `{ placement, peer, range, provider, version }`. This does not authorize a new archive. Generic tolerance is held for a separate owner-policy decision after controlled Bun evidence; it is not an accepted factory rule.
3. **Optional peers.** These are constraints only. A provider that is absent is ignored. A provider that is present must be planned and satisfy the range.
4. **Excluded.** A non-host optional target, and every placement reached only from it, is locked but not installed on this host. Its edges must still resolve and satisfy their ranges. The intent lists the excluded placement keys.
5. **Orphans.** A placement that is neither planned nor excluded refuses. This includes platform-shaped entries with no optional edge.

Acquisition plans one archive per planned `name@version` identity.
Duplicate identities must carry identical tuples, as before.

## Archive check during acquisition

`registryArchive` keeps the existing checks:

- SHA-512 integrity;
- ustar path, link, and size admission;
- duplicate-key JSON parsing;
- refusal of nested configuration, workspace, override, publish, and credential fields.

It now compares the published manifest with its lock tuple:

- `dependencies`, `optionalDependencies`, and `peerDependencies` must be equal;
- `peerDependenciesMeta` may contain only `{ optional: boolean }` entries, and the optional names must equal `optionalPeers`;
- `os` and `cpu` must be equal as sets;
- `bin` must be equal after mapping a string to the unscoped package name and removing a leading `./`;
- `directories.bin` refuses.

`libc` in an archive still refuses. See [Open decisions](#open-decisions).

## Preserved controls

Preparation behavior beyond admission did not change:

- official-registry-only paths and explicit fetch authorization;
- loopback test transport only;
- durable reservations before any request;
- every `FETCH_LIMITS` value, deadline, and containment limit;
- denied tool network, suppressed scripts and their proof, frozen lockfile, and unchanged manifest and lock bytes;
- the 1 MiB plan cap and the 2000-entry lock cap;
- symlink and path checks on export, and passive inspection;
- the offline `file:vendor` route, which still requires `configVersion` 1;
- no npm fallback and no new dependencies.

## Evidence (admission only)

The private evidence root is `/tmp/factory-streamB-evidence-SlX0M8` (0700). Commands used Node 24.21.0 with `umask 077`.

| Step | Source | Result |
| --- | --- | --- |
| Captured red (`reds/01`) | `04ae0db`, clean | `admitDependencies` on a disposable repository holding the captured `package.json`, `bun.lock`, and `package-lock.json` (SHA-256 verified against the capture manifest): `DEPENDENCIES_UNSUPPORTED`, probe exit 0 |
| Authored red (`reds/09`) | `04ae0db` source export plus the final test files | 55 tests: 17 fail (every positive admission), 38 pass (refusal guards); exit 1 |
| Authored green (`greens/07`, fresh rerun `greens/11`) | working tree as committed | 55 tests, 55 pass, 0 skipped; exit 0 |
| Captured green (`greens/06`) | working tree | admitted. 776 archive identities (797 planned placements), 148 excluded placements, 1 unmet peer (`ajv-keywords` peer `ajv ^8.8.2`, provider `ajv@6.12.6`), plan 295 977 bytes |
| Mutation (`greens/08`) | `satisfies` forced true, then restored (hash identical) | 19 of 55 fail |
| Existing admission scenarios (`greens/10`) | working tree | 16 `reject-locks` cases and 2 scoped substitutions refuse, with 0 requests |

The red for the captured data first came from the configuration-version check. An intermediate version that required every peer to satisfy its range still refused the captured lock at the `ajv-keywords` peer. That observation produced rule 2.

Captured-data admission shows only that the planner accepts these bytes. It does not establish:

- that Bun 1.3.14 installs this exact set;
- archive availability or published-manifest agreement;
- the musl variants' `libc` behavior;
- archive sizes within `FETCH_LIMITS` (776 archives against a 64 MiB total);
- native packages without scripts;
- real Vitest behavior or a healthy baseline.

## Controlled Bun 1.3.14 evidence

Evidence root: `/tmp/factory-streamB-evidence-SlX0M8/heavy`, kept after the heavy-slot transfer. Each probe ran in its own owned `factory-contained-*` scope.
Bun ran only in the existing preparation sandbox, with kernel-denied network, a frozen lockfile, and suppressed scripts. The trusted host served authored archives over loopback. No real package, registry metadata, or target code was used.
Bun binary SHA-256 `9fd36f87…ad74`; `bunVersion` reported `1.3.14`.

| Probe | Result |
| --- | --- |
| Ordinary graph, `configVersion` 0 (`h04`) | prepared, lock unchanged, no sentinels |
| Dotted names with nested placement (`h05`) | prepared; the nested `@nodelib/fs.walk/node_modules/@nodelib/fs.scandir@2.1.5` placement was preserved |
| Host-only optional with non-host sibling (`h07`) | prepared; `native-linux-x64` installed; `native-darwin-arm64` neither requested nor installed |
| String and object `bin` (`h08`, `h09`) | prepared; `.bin` links match the lock |
| Combined profile at `configVersion` 0 and 1 (`h11`, `h12`) | identical bundles; requests exactly equal the plan (10) |
| Prerelease identity `1.0.0-beta.2` with caret or exact spec (`h06`, `h10`) | **`DEPENDENCIES_INSTALL_FAILED`** after acquiring the planned archives; lock unchanged; inspection `incomplete` |
| Peer layout `lowpeer@6/8`, `kw` (peer `^8`), `holder`, `user`; lock keys hoisted or nested; `configVersion` 0 and 1 (`h-peer-*`) | all four prepared with the same 5 requests. Bun installed `lowpeer@8.0.0` at the root, `lowpeer@6.0.0` under `user`, and `kw` at the root, regardless of the lock keys. In the hoisted shape the planner recorded an unmet peer that the installed layout does not have |
| Archive metadata not recorded by the lock (`h-arch-*`) | undeclared peer, optional-peer metadata on a required lock peer, dependency also published as an optional peer, different `os`, different `bin`, and `libc`: each `DEPENDENCIES_UNSUPPORTED` after exactly one request; Bun installation not launched |
| Archive `bin` `{ name: './bin/cli.js' }` against lock `bin/cli.js` (`h-arch-bin-normalized`) | prepared |
| Lifecycle scripts in root and host optional packages (`h-scripts`) | prepared; sentinels `[]`; suppression proof 6 positive, 0 suppressed |
| Forged saved intent: different host, or a non-host archive with recomputed identity (`h-forged`) | `DEPENDENCIES_STALE`, 0 requests, no attempt directory; the genuine intent then prepared |

These two probes were diagnostics, not product routes. Both reused the existing contained sandbox with denied network:

- **`h01` lock writing:** the fixed fixture mode wrote a lock for authored `file:` tarballs.
  - `peerDependenciesMeta.optional` becomes `optionalPeers`, and the peer range is kept.
  - A meta-only optional peer becomes `peerDependencies: { name: "*" }` plus `optionalPeers`.
  - `bin` is recorded exactly as published, including `./` and single-entry objects.
  - For `file:` tarballs Bun recorded no `os`, `cpu`, or `libc`, and installed darwin- and musl-tagged packages. This path does not show registry-packument encoding or platform filtering.
- **`h-seeded-libc`:** registry mode ran over a self-seeded cache, bypassing factory acquisition.
  - With no `libc` in the lock, Bun installed both the musl-declared and the glibc-declared `linux/x64` optional packages.
  - It linked `.bin` to the lock's `bin` path, not the cached manifest's.
  - So installation takes platform and `bin` from the lock.

Committed regressions from this evidence are in `tests/phase-1/dependencies-compatibility-preparation.test.mjs`:

- configuration versions 0 and 1;
- archive-metadata refusals;
- forged intents.

They encode no peer-tolerance or `libc` policy.

Focused checks on the final source were run serially, each with owned scope audits:

| Check | Result |
| --- | --- |
| `dependencies-compatibility-preparation.test.mjs` (`h20`) | 4/4 pass, exit 0; 4 scopes drained |
| Existing `dependencies-registry.test.mjs` (`h21`) | 11/11 pass, exit 0; 11 scopes drained |
| Existing `dependency-application.test.mjs` (`h22`) | 9/9 pass, exit 0; 12 scopes drained |
| Admission-only `dependencies-compatibility.test.mjs` (`h23`) | 57/57 pass, exit 0; no scopes |

These counts apply only to this revision. They are not additive and are not a full-suite result.

Not established:

- the Bun cache-folder name for prerelease identities;
- how Bun encodes registry-packument peer or optional metadata (lock writing from a registry requires network);
- real archives, sizes, and native behavior;
- installation of the captured lock.

## Open decisions

- **`libc` (owner decision):** controlled evidence shows Bun installs lock entries with no `libc` field, even when the cached manifest declares musl. So the musl variants in the captured lock must be planned. Their published archives are expected to declare `libc`, which the archive check refuses during acquisition. The options are:
  1. keep refusal, which blocks the captured lock;
  2. accept archive `libc` only as a list of `glibc`/`musl` when the lock has no `libc`, recording that the lock's `os`/`cpu` govern installation.
- **Prerelease preparation (blocker):** prerelease identities refuse at Bun installation. This fails closed after a bounded planned acquisition. The captured lock has two (`gensync`, `resolve`), so its preparation would fail. A fix needs Bun's actual prerelease cache naming, which these probes could not establish within the network boundary. Refusing prereleases at admission would avoid the wasted acquisition, but it is a behavior choice for the parent or owner.
- **Unmet peers (owner decision, still unapproved):** rule 2 tolerates an internally unsatisfied required-peer relationship in the captured layout. In the authored analog, frozen Bun 1.3.14 did not install the lock-key layout. It hoisted the satisfying provider, so the recorded mismatch did not describe the installed bundle. This shows the planner's lock-key provider is not authoritative for installed layout. It does not approve tolerance, and it says nothing about the captured lock's real installation. The alternatives are:
  1. strict refusal of any lock-key peer mismatch, which blocks the captured lock;
  2. an exact owner-acknowledged exception bound to `{ placement, peer, range, provider@version }` and the lock hash;
  3. recording only, with a post-install check that each recorded peer is satisfied in the actual bundle.

  Bun tolerance of the captured layout is still a hypothesis. The independent source/data investigation in `/tmp/factory-compat-peer-investigation-RixWNH/REPORT.md` confirms that the locked root `ajv-keywords@5.1.0` resolves `ajv@6.12.6`, outside `^8.8.2`; it found no concrete authority bypass. No owner permission for generic tolerance has been granted.
- **Archive normalization:** the archive check now runs with real acquisition and refuses each unrecorded-metadata form above. Bun's `file:` lock writing keeps optional peers as `optionalPeers`, but its registry-packument encoding remains unobserved. The independent investigation found 64 planned identities whose peer/optional metadata differs between the Bun lock and same-version npm-lock records. If published archives match the npm records, the candidate archive equality checks would refuse. This is a conditional data finding, not executed acquisition or proof about real archives. Pinned-Bun authored-package probes must establish the supported encoding before corrections; do not merely ignore peers.
- **Captured-lock regression:** the 258 KB captured lock is not committed as a test fixture. Committed tests use authored equivalent shapes.

## Parent correction: absolute bin paths

The parent inspected the read-only adversarial matrix at `/tmp/factory-compat-dependency-adversarial-Rpyx3V/report.md` and reproduced an input-admission defect through `admitDependencies`: both string and object `bin` forms admitted `/usr/bin/x`, contrary to the safe-relative-path requirement. The object-form pattern predates this batch; extending it to strings exposed the same gap. This is not a demonstrated sandbox escape.

The validator now rejects a leading `/` in either form. No authority, limit, toolchain pin, or peer policy changed. Evidence is retained at `/tmp/factory-vanguard-compatibility-aIwVNC/`:

- `bin-path-red.log` and `bin-path-probe.json`: relative control admitted, absolute string path admitted unexpectedly; probe exit 1. Exact failed fixture `/tmp/factory-dependency-compatibility-mAKfXF` retained. The relative control's disposable fixture was removed.
- `bin-tests-red.log`: both retained public-interface regressions fail before the fix; 0/2 pass, exit 1.
- `bin-tests-green.log`: the full admission-only compatibility file passes 57/57 after the fix, exit 0.
- `bin-tests-final-green.log`: final 57-case recheck after correcting unverified Bun wording in the source/test label, recorded separately from the causal red/green.

These are ordinary disposable admission fixtures with synchronous native Git setup, not contained preparation. No Bun, scoped runner, download, model, or target code was executed. They do not consume or transfer the exclusive heavy slot. The new 57-case result is not a full factory-suite result and does not approve the peer candidate. Existing fixture teardown removes the two selected test-run roots; the separately retained failed probe preserves its input and state.

## Integration needs (parent)

- No new runtime module. All grammar lives in `src/dependencies-lock.mjs`, which the admission profile already hashes.
- `dependencies-registry.mjs`, `dependencies-process.mjs`, and `dependencies-worker.mjs` are unchanged in this stage. They are not in the admission profile today.
- New test-only files: `dependencies-compatibility-preparation.test.mjs` and `dependencies-compatibility-runner.mjs`. The compatibility fixture gained optional extra archive files and an explicit root.
- The policy rename and the new `acquisition` fields (`host`, `excluded`, `unmetPeers`) change the intent identity and the admission profile digest for registry runs.

## Bounded prerelease follow-up (2026-11-06)

The follow-up used stream B `981560ce968462009cd99d7731a18e3def2bfdef` runtime source with the parent's preparation-test failure-retention callback edit. No dependency runtime correction was made. Private receipts, commands, source hashes, terminal results and exact-scope audit are retained at `/home/cowen/.local/state/tiny-software-factory/development-evidence/prerelease-diagnosis-mH6n9P/`.

- A minimal public `admitDependencies` → `prepareDependencies` → `inspectDependencies` regression expected `prepared` for one authored `gensync@1.0.0-beta.2` package. It failed 0/1, exit 1: `DEPENDENCIES_INSTALL_FAILED`, incomplete inspection, one exact planned loopback request, and unchanged lock bytes. The controlled root `/tmp/factory-dependency-prerelease-xtGYgk` is retained. This is an observed behavioral red, not a passing preparation check.
- One contained diagnostic generated a lock from authored local tarballs, then performed a frozen, script-suppressed install with an empty cache. Bun 1.3.14 produced `@T@96786473bd91c7aa@@@1` for `stable.dotted@1.0.0` and `@T@c3c4997f73e0774b@@@1` for `pre.dotted@1.0.0-beta.2`. The diagnostic passed 1/1, exit 0, with kernel-denied network, unchanged generated lock and no sentinels. Root `/tmp/factory-dependency-prerelease-Pr15jg` is retained. These are local-tarball cache observations; they do not establish a general registry prerelease naming rule. The investigation stopped without guessed names, broad aliases, or a runtime fix.
- The diagnostic temporarily exported at most 100 cache names and 16 KiB of package-only name/version metadata from the existing contained worker. The worker was restored byte-identically (`c473074962b9ebb164cd1a24f4952bb3db8dc015f6707799652d2a1497f41386`) before subsequent checks. All existing mounts, limits, network denial and script suppression remained in place.
- The current preparation test file passed 4/4, exit 0, after restoration. This verifies its existing successful preparation/refusal cases against the parent's callback edit; it does not prove failure-evidence retention. An inspected remaining retention gap is that the child runner invokes fixture cleanup before parent assertions, potentially deleting inner repositories even when the outer wrapper preserves its root.
- Six exact owned scopes across these three commands were freshly observed inactive and empty. All foreground runners exited, no owned runner remained, no dependency symlink was created, and the heavy slot was returned to the parent. No full suite ran.

Prerelease registry preparation remains a technical blocker, not an established owner-policy choice. Peer tolerance and libc relaxation remain unapproved. These diagnostics establish no real-package, captured-lock installation, baseline, readiness or #10 acceptance.

## Parent correction: retain failed preparation evidence

The parent corrected both cleanup layers after the diagnostic checkpoint. The outer test wrapper performs assertions before declaring success and removes its root only after success and confirmed scope drainage. `compatibilityRepository` still closes its loopback server, but an explicitly supplied root belongs to its caller; the child runner no longer deletes that caller-owned repository before the parent's assertions. Default fixture-owned roots keep their existing cleanup behavior.

Private receipts: `/home/cowen/.local/state/tiny-software-factory/development-evidence/retention-correction-tOgKTa/`.

- A deliberate wrong assertion in the existing configuration-0 case produced exit 1 before correction. The outer root remained, but `profile/owner/package.json` was absent (`before-observation.json`).
- With the inner-root correction, the same deliberate assertion still produced exit 1, and the inner manifest remained with a retained SHA-256 (`after-observation.json`). These are harness-retention observations, not product preparation red/green results. Both failed roots remain.
- The original test wrapper was restored byte-for-byte after that probe. The unmutated preparation file then passed 4/4, exit 0, on the source bound by `final-source.sha256`.
- All six exact scopes for these commands were freshly inactive and empty (`final-parent-scope-audit.json`). The worker remained restored and no new runtime source or policy was introduced. These results supersede the earlier preparation check only for the affected cleanup behavior; they are not a full suite or dependency compatibility acceptance.

## Source-established prerelease cache correction (2026-11-06)

This cache-only correction starts at stream B `24ab341b67ea0f00f51260b450f74901c3dfdf26`, after the parent corrected failure retention. It supersedes the prerelease blocker above for the controlled forms exercised here. The owner separately accepted installed-graph validation and bounded libc recognition; that implementation is outside this cache correction. This section does not accept generic peer tolerance, change libc handling, or integrate B/G.

### Source and implementation

The parent authorized read-only official-source research. The source research identifies Bun tag `bun-v1.3.14` as commit `0d9b296af33f2b851fcbf4df3e9ec89751734ba4`. The [pinned default-registry formatter](https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/PackageManager/PackageManagerDirectories.zig) uses `name@M.m.p-<16 lowercase hexadecimal hash digits>@@@1` for prereleases. The hash input is the prerelease suffix alone, preserving byte case and dots, with no introducing hyphen, name or version triple.

New `src/dependencies-cache.mjs` ports the stateless seed-zero [pinned Wyhash11 implementation](https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/wyhash/wyhash.zig), including 32-byte rounds, swapped 32-bit short-tail halves, all tail lengths, unsigned 64-bit multiply/fold, and leading-zero padding. It uses Node built-ins and BigInt, with no dependency or extra Bun invocation. Bun identifies that algorithm as copied from Zig `v0.11.0-dev.2609+5e19250a1`; the module retains the full [upstream MIT notice, Copyright 2015–2023 Zig contributors](https://github.com/ziglang/zig/blob/5e19250a1/LICENSE). Bun's own pinned `LICENSE.md` identifies Bun as MIT licensed. No downloaded source was executed.

Only the cache basename changes. Complete locked versions, archive request paths, metadata/integrity checks, limits, manifests and both lockfiles retain their existing meaning. Stable cache paths remain unchanged. Build metadata, custom registry and patch forms remain refused; no new support for them was added. `dependencies.mjs` now includes the cache-module bytes and mode in registry preparation's recorded toolchain file fingerprints, preserving Bun as `files[0]`. Validation rederives that fingerprint; a forged saved cache-module hash is refused as stale before requests or an attempt directory. This is executed tamper evidence, not merely a recorded hash.

### Executed evidence

Private evidence root: `/home/cowen/.local/state/tiny-software-factory/development-evidence/prerelease-cache-fix-5Rz2Q3/`. Each command has its exact source hashes, output and terminal exit; the preparation wrapper additionally retains the actual result, owned scope and root path. The causal red uses unchanged `24ab341` product code with the permanent regression already added.

| Check | Observed result | Limits |
| --- | --- | --- |
| Permanent public prerelease regression before correction | 0/1, exit 1: `DEPENDENCIES_INSTALL_FAILED`, installation attempted, one exact planned request, incomplete inspection and unchanged manifest/Bun/npm-lock bytes | `red/`; failed root `/tmp/factory-dependency-compatibility-XCmyZL` and its inner repository remain retained |
| Same regression after correction | 1/1, exit 0: prepared and passively verified authored `gensync@1.0.0-beta.2` bundle | `green/`; actual contained pinned Bun, trusted loopback, no real package |
| Public preparation boundary graph | 1/1, exit 0, with 66 exact installed authored identities | `boundaries/`; suffix lengths 1–58 cover every tail length and a 32-byte round through the existing 64-byte version limit; exact/caret, case-distinct suffixes, dotted/scoped names, leading-zero suffix `zero44` and two stable controls |
| Final preparation file | 6/6, exit 0 | `final-preparation/`; includes the two prerelease cases, existing config/metadata negatives and forged host/cache-module/non-host intents |
| Registry file | 11/11, exit 0 | `registry/`; existing acquisition, integrity, refusal, cancellation and reuse boundaries |
| Non-model application cases | 8/8, exit 0 | `application/`; explicit positive name selection excludes the existing model-bearing bundle-reuse case; no model was run |
| Admission-only compatibility file | 57/57, exit 0 | `admission/`; no contained process or acquisition; includes build-metadata and other refusal guards |

Successful prerelease preparations assert exact installed name/version/path sets, exact planned request paths and GET requests without authorization, unchanged manifest and both lockfiles, kernel-denied network, empty lifecycle sentinels and the existing six positive suppression controls. Actual Bun cache lookup is the independent oracle: no private hash unit test, mirrored hash expected value, guessed alias or seeded alternate basename supplies success. `zero44` was selected as an authored fixture input after a data-only candidate search; its real Bun preparation verifies the padded basename, rather than treating that candidate search as compatibility evidence.

The affected runtime/test source hashes were checked again after the selected tests. All 31 exact scopes across the red, green, boundary and selected contained commands were freshly inactive and empty (`final-scope-audit.json`), including the failed regression. Successful roots used the corrected drained-and-passed cleanup. The failing root remains. Every foreground runner reached an actual terminal exit. The owned temporary B `node_modules` symlink was removed only after this audit; the parent dependency directory was preserved. No worker source instrumentation, background runner or pending continuation remains. Counts from reruns overlap and are not a full-suite total.

### Parent integration and unverified work

Add `dependencies-cache.mjs` to the common admission/execution profile implementation list when integrating the new module. The existing qualification module-name verifier accepts its filename, but the parent must verify the actual integrated evidence/profile bindings; this cache-only check did not do so. No common admission or qualification files were edited here. New test-only `dependencies-prerelease-fixture.mjs` supplies authored identities, not hash expectations.

The omitted model-bearing application case, integrated full suite, browser regression, complete independent Standards/Spec reviews, installed-graph/libc contracts, real distributions and native behavior, target baseline, production model, owner readiness and #10 remain outside this result. The unchanged security/retention/resource boundaries were exercised only by the described controlled checks.
