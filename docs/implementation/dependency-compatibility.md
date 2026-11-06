# Dependency compatibility: bounded Bun 1.3.14 lock profile

Stream B record for the [bounded Vanguard compatibility work](vanguard-compatibility.md).
It changes registry admission (`admitDependencies` with `registry: true`) and the archive check during acquisition.
It does not establish real archive availability, sizes, native-package behavior, actual Vitest, a healthy baseline, owner readiness, or #10 acceptance.

## Status

- **Admission:** implemented and verified through the public seam with authored fixtures and the captured lock bytes as data.
- **Pinned Bun behavior:** not yet established. Bun fixture work waits for the exclusive heavy-test slot. See [Pending Bun fixture work](#pending-bun-fixture-work).
- **Archive check during acquisition:** implemented and not yet exercised. It runs only after the Bun script-suppression proof, so it needs the heavy slot.

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
  Accepting configuration version 0 does not, by itself, make a lock compatible. The claim that both values select Bun's hoisted layout for a single root package is unverified until the Bun fixture runs.
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

1. **Planned.** Placements are reached from the root manifest's `dependencies` and `devDependencies` through these edges:
   - `dependencies`;
   - non-optional peers whose provider satisfies the range;
   - host-applicable `optionalDependencies`.

   Each edge must satisfy its range. A planned placement must be host-applicable, so a required dependency or required peer on a non-host package refuses.
2. **Unmet peers.** Bun installs an out-of-range hoisted peer with only a warning. Such an edge never causes acquisition. Its provider must already be planned through satisfied edges. The intent records each mismatch as `{ placement, peer, range, provider, version }`.
3. **Optional peers.** These are constraints only. A provider that is absent is ignored. A provider that is present must be planned and satisfy the range.
4. **Excluded.** A non-host optional target, and every placement reached only from it, is locked but not installed on this host. Its edges must still resolve and satisfy their ranges. The intent lists the excluded placement keys.
5. **Orphans.** A placement that is neither planned nor excluded refuses. This includes platform-shaped entries with no optional edge.

Acquisition plans one archive per planned `name@version` identity.
Duplicate identities must carry identical tuples, as before.

## Archive check during acquisition (implemented, unverified)

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

## Pending Bun fixture work

The heavy-test slot is required. Use controlled packages and loopback only:

1. Frozen preparation under `configVersion` 0 with an unchanged lock, hoisted placements, and suppressed scripts.
2. Prerelease archives, checking that Bun finds the planned `name@version@@@1` cache layout.
3. Optional, peer, unmet-peer, and platform relationships. Bun must install exactly the planned set, and excluded packages must stay absent.
4. Archive-check negatives: mismatched peer, optional, platform, or bin metadata, and an archive that carries `libc`.
5. Confirmation that no request goes to an unplanned path.
6. A rerun of the existing `dependencies-registry` suite. Its `platform` refusal case now uses a required `darwin` package, because host-applicable `os` metadata is supported.

## Open decisions

- **`libc`:** the captured lock has no `libc` data, so the planner includes musl variants such as `@img/sharp-linuxmusl-x64` for linux/x64. Their published archives are expected to declare `libc`, which the archive check refuses. Whether Bun 1.3.14 installs those entries determines the choice: plan them and accept a bounded `libc` field, or exclude them. This needs Bun fixture evidence and may need an owner decision.
- **Unmet peers:** rule 2 accepts a legitimate lock state that Bun tolerates, and it records each instance. Requiring every peer to satisfy its range would refuse the captured lock.
- **Captured-lock regression:** the 258 KB captured lock is not committed as a test fixture. Committed tests use authored equivalent shapes.

## Integration needs (parent)

- No new runtime module. All grammar lives in `src/dependencies-lock.mjs`, which the admission profile already hashes.
- `dependencies-registry.mjs`, `dependencies-process.mjs`, and `dependencies-worker.mjs` are unchanged. They are not in the admission profile today.
- The policy rename and the new `acquisition` fields (`host`, `excluded`, `unmetPeers`) change the intent identity and the admission profile digest for registry runs.
