# Ticket 10 toolchain preflight: Vanguard Bun/npm and check configuration

Stream B research note, written on 2026-11-06. It compares captured Vanguard dependency and check inputs against the factory at `60cc8a4ed47439443a9bad479c480aacdf8f7002`.
This note is source and data inspection only. It does not accept #10, establish owner readiness, approve toolchain use, or authorize any operation.

## Evidence base

- Capture: private manifest `capture-manifest.json` (SHA-256 `9fe4b095…5d76`), `capturedAtUTC` `2026-11-06T16:27:13Z`. It records working-tree bytes and Git-index membership. It is not a committed local-main manifest.
- Independent recheck: all 21 captured files matched the manifest's SHA-256, byte length, and Git blob ID. The candidate `lib/__tests__/normalize-address.test.ts` is absent.
- Method: Python `-I` parsing of JSON and Bun-lock data, data-only traversal, and text search. No factory, Vanguard, Bun, Vitest, ESLint, or package-manager code ran. Factory predicates were compared by reading their source. Python mirrors of those predicates were not the planner.
- Retained receipts: private directory `t10-streamB-receipts-S3MEiP` under `/tmp` contains `01-hash-verify.json`, `02-lock-analysis.json`, `03-reach-analysis.json`, `04-test-pattern-scan.txt`, `05-skip-only-scan.txt`, `06-duplicate-keys.json`, and the two analysis scripts.

## Captured dependency facts

- `package.json:25-82` lists 40 dependencies and 14 devDependencies. Of these 54 specs, 51 are caret ranges and 3 are exact versions. None uses `file:vendor/*.tgz`. The manifest has no `trustedDependencies`, workspaces, overrides, peer, optional, or platform fields.
- `bun.lock:2-3` has `lockfileVersion` 1 and `configVersion` 0. It has 945 package tuples, each with four elements and an empty second element. Every integrity value is SHA-512. Root workspace dependencies equal the manifest exactly.
- Every direct dependency resolves in `bun.lock`. Examples: `vitest@4.0.17` (line 1708), `next@16.1.2` (line 1380), `jsdom@29.0.0`, `eslint@9.39.2`, `typescript@5.9.3`, `convex-test@0.0.40`, `vitest-axe@0.1.0`.
- `package-lock.json` has `lockfileVersion` 3 and 956 packages. Its root dependency lists match the manifest. Both lockfiles contain the same set of package names.
- The two lockfiles resolve five direct dependencies to different versions (npm lock vs Bun lock): `next` 16.2.1 vs 16.1.2 (`package-lock.json:11254-11255`), `@sentry/nextjs` 10.45.0 vs 10.42.0, `resend` 6.10.0 vs 6.12.3, `svix` 1.88.0 vs 1.84.1, and `jsdom` 29.0.1 vs 29.0.0.
- Tuple metadata key counts: `dependencies` 467, `peerDependencies` 183, `cpu` 158, `os` 157, `bin` 41, `optionalPeers` 41, `optionalDependencies` 21. Example: `bun.lock:180` (`@esbuild/linux-x64`) carries `os` and `cpu` metadata.
- `package-lock.json` marks 7 packages with `hasInstallScript`: `@clerk/shared`, `@sentry/cli`, two `esbuild` placements, `fsevents`, `sharp`, and `unrs-resolver`.
- No duplicate JSON object keys appear in any of the three files.

## Confirmed static blockers (source-established, not observed refusals)

No route was executed. Each item below names a refusal predicate that the captured data fails, according to static reading.

1. **Registry route, configVersion.** `src/dependencies-lock.mjs:38` requires `configVersion === 1`, but the lock has 0. Admission reaches `registryPlan` from `src/dependencies.mjs:85`, before toolchain hashing, intent saving, or any fetch. This would be the first refusal: `DEPENDENCIES_UNSUPPORTED`.
2. **Registry route, metadata grammar.** `src/dependencies-lock.mjs:60` allows only `dependencies` and `bin` in tuple metadata. At least 183 tuples carry other keys.
3. **Registry route, name and version grammar.** The name pattern at `dependencies-lock.mjs:6` excludes `.`. This rejects 27 packages, including `@nodelib/fs.scandir` (`bun.lock:322`) and `array.prototype.flat`. `versionRE` at line 9 rejects the prereleases `gensync@1.0.0-beta.2` (`bun.lock:1138`) and `resolve@2.0.0-next.5`.
4. **Registry route, dependency-spec grammar.** `dependencies()` at lines 22-27 accepts only exact, `^`, or `~` triples. There are 38 nested specs outside that grammar, such as `*` (`bun.lock:666`), hyphen ranges, `||` unions, `x` ranges, and prerelease carets.
5. **Registry route, orphan rule.** Line 85 requires every tuple to be reachable through `dependencies` edges. The placement-only traversal mirror reached 723 of 945 tuples, leaving 222 unreached: 160 carry `os`/`cpu` metadata, and 137 are named in reached packages' `optionalDependencies`. This mirror does not validate version ranges or earlier predicates. It is not a runnable admission plan or proof that the legitimate lock graph is corrupt.
6. **Offline route.** `src/dependencies.mjs:94` requires each manifest spec to be `file:vendor/<name>.tgz`. All 54 specs fail, starting with `@clerk/nextjs`. Lines 106 and 112 would also reject `configVersion` 0 and the four-element registry tuples.

Each blocker is independent. Correcting only the first would still leave items 2-5.

## Runtime acceptance gaps (unverified, not observed failures)

- **Archive contents.** `registryArchive` (`dependencies-lock.mjs:96-99`) rejects published manifests that have non-empty `devDependencies`, `peerDependencies`, `optionalDependencies`, `os`, or `cpu`. No archive was read, so the effect is unknown.
- **Sizes and availability.** `FETCH_LIMITS` sets 16 MiB per archive and 64 MiB each for total compressed and expanded bytes, with 20 000 entries (`dependencies-registry.mjs:13-14`). Other limits are the 128 MiB export, 256 MiB scratch space, and a 120 s check (`dependencies-process.mjs:57`, `containment.mjs:20-24`). Lockfile text bytes cannot establish archive or installed sizes. Registry availability was not checked.
- **Native and install-script packages.** Preparation runs `--ignore-scripts` (`dependencies-worker.mjs:54`). It is unknown whether `esbuild`, `sharp`, `unrs-resolver` (used by ESLint resolution), or `@sentry/cli` work without scripts or platform binaries.
- **Bun version.** The factory requires Bun 1.3.14 (`dependencies.mjs:186`). Which Bun wrote `configVersion` 0, and how 1.3.14 would treat it under `--frozen-lockfile`, is not established.
- **Check configuration.** The suite check uses the repository config with forced CLI flags (`containment.mjs:216-218`). The reporter requires Vitest 4.0.17, Node 24.21.0, `maxWorkers` 1, forks, `retry` 0, and both `allowOnly` and `passWithNoTests` false (`qualification-reporter.mjs:16-20`). The Bun lock's `vitest@4.0.17` matches statically. Whether `--configLoader=runner` resolves `__dirname` in `vitest.config.ts:9-11`, and the final resolved configuration, are unverified.
- **Lint.** `eslint.config.mjs` imports `eslint-config-next/core-web-vitals`. Actual ESLint execution and the real baseline result are unverified.
- **Report limits.** Real worker/report-descriptor topology and fit within the 256 KiB report and 1 MiB output limits are unverified.

## Test and setup text findings

- `vitest.config.ts` sets `globals` and the setup file `tests/a11y/setup.ts`, which extends `expect` with `vitest-axe/matchers`. It sets no `environment`, so the default applies. Per-file docblocks select `jsdom` (`pulsepoint-renewal-rendering.test.tsx:1`, both `tests/a11y` tests) or `edge-runtime` (`convex/postAudit.test.ts:2`).
- The search found no `.skip`, `.only`, `.todo`, `.fails`, `.concurrent`, `retry`, `repeats`, or custom-runner text in the 13 indexed tests. Static `it`/`test` call sites total 111. `.each` expands at runtime, so this is not a case count.
- The external-effect concern is limited by text, not proven. Network-facing tests stub `fetch` with `vi.stubGlobal`, and several tests use fake timers.
- Three Convex tests call `import.meta.glob("./**/!(*.test).*s")`, which loads uncaptured modules dynamically. Many tests also import uncaptured source and `convex/_generated`.
- `tests/a11y/a11y-utils.ts:6-8` mentions `bun test`. Only Vitest is the factory check.

## Preserve

Q18 already selects Bun and `bun.lock` for Vanguard while preserving both lockfiles (`docs/phase-1-plan.md:64`). Their version disagreement does not reopen that choice or authorize npm. No lockfile changed during this preflight.
A future approved profile may support specific legitimate forms rejected today. It must retain fail-closed handling of unknown or ambiguous forms and security checks, not blindly retain each accidental incompatibility. Preserve these guarantees:

- script suppression and its proof;
- kernel-denied preparation;
- explicit fetch authorization;
- integrity checks;
- all fetch and containment limits;
- the fixed check argv;
- the reporter pins;
- the reuse fingerprints.

npm is not an authorized workaround. Changing `configVersion`, ignoring metadata, using owner `node_modules`, bypassing bundle validation, or substituting a skinny fixture would not be compatibility.

## Smallest future scope (not implemented)

A separately authorized factory change must establish compatibility with the captured lock under pinned Bun 1.3.14, without assuming which Bun version wrote it:

- an explicit decision on `configVersion` 0, based on documented Bun semantics;
- npm name and semver grammar, including `.` and prereleases;
- range evaluation for the observed spec forms;
- locked optional/peer-edge semantics, including optional peers and host applicability, without unplanned resolution or downloads;
- a platform selection rule for `os`/`cpu`, so that only host-applicable optional archives are planned while the plan stays finite and fully reached;
- archive-manifest checks consistent with that metadata.

The change needs controlled-loopback and captured-shape regression fixtures plus independent review. Bun's authority is already settled. A compatible planner alone would not prove archive, size, native-package, baseline, or owner readiness. Unsupported formats or exceeded limits must still block rather than trigger a silent fallback.

## Next permission gates

1. Owner authorization for bounded factory compatibility work, controlled tests, and review. No such implementation is authorized by this inspection.
2. Separately authorize exact local-main source and no-fetch dependency admission. This would be the first actual admission, not a rerun of this data inspection. `admitDependencies` is module-only; the CLI preparation operation also prepares the bundle.
3. Separately authorize real locked acquisition, bounded sizing, and preparation, if the no-fetch plan is eligible.
4. Separately authorize actual contained toolchain/baseline and production-model acceptance operations. No baseline-only CLI route was established here.

The current owner admission runs a bounded no-tool model smoke **before** baseline Vitest/lint (`src/admission.mjs:176–194`). Only healthy baseline evidence permits tool-enabled executor work. Baseline validation before *any* production-model request would require a separately scoped model-free check, not an assumed reordering of the current CLI. The helper-grammar gate should precede even the smoke. This note changes none of those gates.

## Coverage

- **Examined:** the 21 captured files, hash-verified; the factory sources `dependencies-lock.mjs`, `dependencies.mjs`, `dependencies-files.mjs` (lines 1-80), `dependencies-process.mjs`, `dependencies-worker.mjs`, `dependencies-self-test.mjs`, `dependencies-registry.mjs`, `qualification-reporter.mjs`, `qualification-reporting.mjs`, `containment.mjs:150-260`, and `qualification.mjs:76-120`.
- **Unexamined:**
  - live Vanguard and local-main/HEAD identity;
  - untracked or dynamically registered tests;
  - imported source outside the capture, including `convex/_generated`;
  - registry archives and their sizes;
  - real Bun, Vitest, and ESLint behavior;
  - the baseline result;
  - credentials and providers.
- **Inapplicable:** automated runtime tests. Execution was not authorized, and no factory source changed.

Parent integration clarified the settled Bun choice, the placement-only mirror, and the actual admission ordering. The child's original receipts remain retained. Its receipt files used 0644 and the inner scripts directory 0755 inside the private 0700 root; the parent hardened them to 0600/0700 without changing data. Parent Markdown/link/prose checks used already installed tools, not an installation.
