# Bun 1.3.14 registry cache naming

Research checkpoint, 2026-11-06. Source inspection only; no implementation or compatibility verdict. Only this note was written. No subagents, tests, Bun, downloaded-code execution, package acquisition/installation, target access, credentials, host caches, Git mutation, or PR operations were used. The parent retains the sole contained-fixture slot.

## Fixed source and local evidence

The official [`bun-v1.3.14` tag reference](https://api.github.com/repos/oven-sh/bun/git/ref/tags/bun-v1.3.14), read on this date without authentication, reports a direct commit object: **[`0d9b296af33f2b851fcbf4df3e9ec89751734ba4`](https://github.com/oven-sh/bun/commit/0d9b296af33f2b851fcbf4df3e9ec89751734ba4)**. All source links below pin that commit. The pinned [official cache documentation, lines 6–32][docs], describes name/version directories and hashed prerelease/build suffixes; it does not specify the hash implementation. The current [official documentation](https://bun.sh/docs/pm/global-cache) was also read, but does not determine historical 1.3.14 behavior.

Local inspection found `${name}@${version}@@@1` at `/home/cowen/.t3/worktrees/tiny-software-factory/t3-b353e788/src/dependencies-lock.mjs:179`, matching the parent's candidate description (`48640c8` plus parent edits; this research did not independently establish its Git revision). The inspected parser admits prereleases but rejects build metadata (`:11–26`). Registry extraction consumes `entry.cachePath` in `src/dependencies-registry.mjs:107`.

The parent's retained [handoff](/home/cowen/.local/state/tiny-software-factory/development-evidence/prerelease-diagnosis-mH6n9P/handoff.json) and [public red log](/home/cowen/.local/state/tiny-software-factory/development-evidence/prerelease-diagnosis-mH6n9P/public-red.log) were read, not rerun. They report an authored `gensync@1.0.0-beta.2` preparation failure (`DEPENDENCIES_INSTALL_FAILED`, one planned request, unchanged lock) and a successful local-tarball diagnostic producing `@T@96786473bd91c7aa@@@1` and `@T@c3c4997f73e0774b@@@1`. The handoff identifies its earlier base as `981560c`; it does not verify the current candidate. These are controlled fixtures, not acquired real packages. The reported installed Bun version is 1.3.14; this research did not invoke or identify the binary by hash.

## Verified formatter

Let `N` be the package name, `M.m.p` the parsed numeric triple, `P`/`B` the actual parsed prerelease/build byte slices, `h` the hash below, and `L`/`U` its 16-digit lowercase/uppercase hexadecimal encoding. The unpatched default-registry paths are:

| Parsed version | Cache-relative path | Pinned source |
| --- | --- | --- |
| Stable | `N@M.m.p@@@1` | [Directories 342–349][stable], [727–737][cache-version] |
| Prerelease | `N@M.m.p-L(h(P))@@@1` | [Directories 313–325][pre] |
| Build | `N@M.m.p+U(h(B))@@@1` | [Directories 327–340][build] |
| Both | `N@M.m.p-L(h(P))+U(h(B))@@@1` | [Directories 296–311][both] |

Names are copied with `{s}`; numeric components use decimal `{d}`. There is no formatter truncation or case conversion of names. A scoped name keeps its slash: `@scope/pkg@…`, beneath an `@scope` directory. Extraction explicitly creates the parent for namespace packages ([extraction 341–362][extract], [447–457][extract-posix]). This is a registry cache path, distinct from an isolated install store name.

The simple path applies when the selected registry scope has an empty name and the default registry was not overridden ([Directories 235–245][registry-format]). Package scoping alone does not force a registry suffix: scope lookup falls back to the default registry ([Resolution 36–42][scope-lookup]). With a configured scope or overridden default, Bun omits `@@@1` while formatting the basename, then appends:

- Normally: `@@{scope.url.hostname}@@@1`.
- If hostname length exceeds 32 bytes **or** remaining output buffer is below 64 bytes: `@@{first up to 12 hostname bytes}__{L(h(scope.url.href))}@@@1`.

These branches, including the exact URL field hashed, are [Directories 244–268][registry-format]. This URL hash uses [`String.Builder.stringHash`, lines 494–496][string-hash]. Default override detection compares URL hashes ([Options 243–246][override]); the default URL and trailing-slash treatment for that comparison are [npm 196–198][default-registry] and [365–370][scope-url]. Do not substitute the comparison hash's trailing-slash removal for the formatter's `scope.url.href` input. A non-null patch hash adds `_patch_hash={x}` after the cache version ([740–747][patch]); patch support is outside the proposed correction.

Local and remote tarball resolutions instead use `@T@{L(h(url))}@@@1` ([Directories 352–361][tarball]). The npm/tarball dispatch is explicit in both [cache lookup 481–517][dispatch] and [extraction 341–345][extract]. Thus the local-tarball diagnostic cannot establish a registry basename.

## Verified hash, bytes, and encoding

The text-lock reader passes its resolution string to `Resolution.fromTextLockfile` ([bun.lock 1690–1704][lock-read]); the npm branch calls `Semver.Version.parse` ([resolution 60–82][version-read]). Its tag parser creates the suffix slices, and [`SlicedString.external`, lines 15–20][external], hashes them with **`bun.Wyhash11.hash(0, slice)`**. This is Bun's bundled implementation, explicitly imported at [bun.zig 1952][hash-import], not an unspecified current Wyhash implementation.

- **Input:** the parsed suffix bytes alone, excluding the introducing `-` or `+`, excluding the version triple, package name, and NUL. Dots, suffix hyphens, and ASCII letter case are significant where retained by the parser. For `1.0.0-beta.2`, `P` is exactly ASCII/UTF-8 `beta.2` (six bytes: `62 65 74 61 2e 32`). The parser's delimiter/slice operations are [Version 611–619][tag-delimiters] and [645–651][tag-end]; its byte-slice implementation is [SlicedString 31–46][slice]. No lowercase transform or length-based suffix truncation occurs in this path.
- **Hash:** deterministic unsigned 64-bit, seed **0**. The bundled file identifies its origin as Zig `v0.11.0-dev.2609+5e19250a1`; its five constants are `a0761d6478bd642f`, `e7037ed1a0b428db`, `8ebc6af09c88c6e3`, `589965cc75374cc3`, `1d8e4e27c47d124f` ([Wyhash 1–34][hash-core]). Reads are explicitly little-endian. `mum(a,b)` XORs the high and low halves of the unsigned 128-bit product; `mix0`/`mix1` XOR their inputs with seed and their respective constants before `mum` (same source).
- **Full algorithm:** consume 32-byte rounds with `seed = mix0(LE64(block[0:8]), LE64(block[8:16]), seed) XOR mix1(LE64(block[16:24]), LE64(block[24:32]), seed)` ([51–75][hash-round]). Apply the exact remainder-length table for 0–31 bytes, then return `mum(seed XOR totalByteLength, constant[4])` ([77–130][hash-tail]). In particular its eight-byte tail reader combines two little-endian 32-bit reads as `(first << 32) | second` ([19–20][hash-core]); replacing that with a plain LE64 changes results. `Wyhash11.hash` delegates to this stateless function ([174–176][hash-entry]).
- **Encoding:** the hash field is `u64` ([ExternalString 1–3][hash-type]); the formatter emits all 16 nibbles, most significant first, including leading zeroes. Prerelease uses lowercase, build uppercase. This is integer hex, not native-memory-byte hex ([fmt 1484–1556][hex]). There is no 32-bit truncation or shortened hash in this formatter.

Parser qualification matters: those formulas use **parsed tags**, not an assertion that Bun accepts or preserves every SemVer spelling. For example, `-` encountered while in build state changes to prerelease state and resets the slice start ([Version 611–615][tag-delimiters]); invalid tag characters terminate parsing ([617–637][tag-stop]). A simple `split('+')` cannot be claimed equivalent for every build string. The current factory rejects build metadata; retain that boundary for this prerelease correction.

## Host properties and limits of the finding

**Source inference:** the same parsed bytes produce the same suffix hash and hex on different hosts: reads specify little-endian, arithmetic widths are explicit, and hex uses shifts rather than native byte order ([hash core][hash-core], [hex][hex]). No CPU, libc, locale, random seed, or absolute cache-root input participates in that hash chain. The basename routine itself has no platform branch ([296–349][basename]). This does not establish identical filesystem behavior across platforms.

The configured-registry low-space branch can depend on supplied buffer size; the normal manager buffer is `bun.PathBuffer` ([PackageManager 429–431][buffer]), whose size depends on `std.fs.max_path_bytes` except Wasm ([paths 13–20][path-size]). Cache-root selection depends on configuration/environment ([Directories 152–179][cache-root]), and Windows extraction converts the path to normalized wide characters ([355–362][extract]). None requires changing the factory's pinned Linux profile.

**Adjacent semantics only:** text-lock peer lookup walks package-path ancestors without a range comparison inside that lookup ([bun.lock 1077–1135][peer-lookup]); this is not proof that all Bun stages ignore peer ranges or permission to tolerate unsatisfied peers. Text-lock `libc` reading/writing remains commented TODO code ([1841–1851][libc-read], [780–787][libc-write]), while registry-manifest parsing does read `libc` ([npm 2089–2091][libc-registry]). Cache naming settles neither peer validation nor a safe libc policy. Existing refusals remain.

## Smallest correction proposal and required evidence

**Proposal, not implemented:** replace only the prerelease cache-path derivation behind `registryPlan` with the pinned default-registry rule. Preserve the admitted `name`, complete `version`, archive request path, integrity and archive metadata checks. A small factory-owned `Wyhash11` helper using Node's existing `BigInt`/byte operations can avoid a dependency, global/transitive import, or extra Bun process. Port the pinned algorithm exactly; do not select a library merely named Wyhash or use floating-point multiplication. Keep stable paths unchanged, scoped slashes intact, the 64-byte version limit, and build/custom-registry/patch exclusions. If added as a module, include its bytes in every affected preparation/execution fingerprint and evidence binding; the parent owns those changes. This is an implementation recommendation, not verified code.

**Inference:** the hardcoded literal prerelease suffix conflicts with the source-established npm cache lookup. It is a strong explanation for the retained red, but source reading alone does not establish that it is the only cause or that the proposed correction succeeds.

The parent must retain and rerun the public application/CLI regression using the authored locked `gensync@1.0.0-beta.2` fixture and real contained pinned Bun: red on the original runtime, green after the correction. Verify the exact planned request, successful prepared/passively verified bundle, original locked identities/archives and unchanged lock bytes, suppressed lifecycle sentinels, denied tool network, original limits, and exact process-scope drainage. No real package is needed. Exercise scoped and dotted stable/prerelease names, case-distinct suffixes, a leading-zero hash encoding case, and suffix lengths crossing 8/16/32-byte tail/round boundaries through that behavior where the existing limits permit. A mirrored hash unit test alone is not compatibility evidence. Build/custom-registry behavior remains outside this correction and unverified.

**Coverage:** examined official pinned source/docs, local candidate naming/consumers, and the two retained parent artifacts. Tests were reported by the parent, not executed here. Numeric `beta.2` hash output, installed-binary/source correspondence, actual registry cache lookup success, corrected preparation, real distributions, target baseline and owner readiness remain unverified. No policy change, implementation, or acceptance follows from this note.

[docs]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/docs/pm/global-cache.mdx#L6-L32
[stable]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/PackageManager/PackageManagerDirectories.zig#L342-L349
[cache-version]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/PackageManager/PackageManagerDirectories.zig#L727-L737
[pre]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/PackageManager/PackageManagerDirectories.zig#L313-L325
[build]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/PackageManager/PackageManagerDirectories.zig#L327-L340
[both]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/PackageManager/PackageManagerDirectories.zig#L296-L311
[basename]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/PackageManager/PackageManagerDirectories.zig#L296-L349
[extract]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/extract_tarball.zig#L341-L362
[extract-posix]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/extract_tarball.zig#L447-L457
[registry-format]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/PackageManager/PackageManagerDirectories.zig#L235-L268
[scope-lookup]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/PackageManager/PackageManagerResolution.zig#L36-L42
[string-hash]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install_types/SemverString.zig#L494-L496
[override]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/PackageManager/PackageManagerOptions.zig#L243-L246
[default-registry]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/npm.zig#L196-L198
[scope-url]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/npm.zig#L365-L370
[patch]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/PackageManager/PackageManagerDirectories.zig#L740-L747
[tarball]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/PackageManager/PackageManagerDirectories.zig#L352-L361
[dispatch]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/PackageManager/PackageManagerDirectories.zig#L481-L517
[lock-read]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/lockfile/bun.lock.zig#L1690-L1704
[version-read]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/resolution.zig#L60-L82
[external]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install_types/SlicedString.zig#L15-L20
[hash-import]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/bun.zig#L1952
[tag-delimiters]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/semver/Version.zig#L611-L619
[tag-end]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/semver/Version.zig#L645-L651
[tag-stop]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/semver/Version.zig#L617-L637
[slice]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install_types/SlicedString.zig#L31-L46
[hash-core]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/wyhash/wyhash.zig#L1-L34
[hash-round]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/wyhash/wyhash.zig#L51-L75
[hash-tail]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/wyhash/wyhash.zig#L77-L130
[hash-entry]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/wyhash/wyhash.zig#L174-L176
[hash-type]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install_types/ExternalString.zig#L1-L3
[hex]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/bun_core/fmt.zig#L1484-L1556
[buffer]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/PackageManager.zig#L429-L431
[path-size]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/paths/paths.zig#L13-L20
[cache-root]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/PackageManager/PackageManagerDirectories.zig#L152-L179
[peer-lookup]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/lockfile/bun.lock.zig#L1077-L1135
[libc-read]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/lockfile/bun.lock.zig#L1841-L1851
[libc-write]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/lockfile/bun.lock.zig#L780-L787
[libc-registry]: https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/install/npm.zig#L2089-L2091
