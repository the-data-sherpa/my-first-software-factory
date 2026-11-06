# Dependency admission adversarial regressions

## Scope

`tests/phase-1/dependencies-compatibility-adversarial.test.mjs` adds 11 admission-only Node tests from the independent adversarial probe.
They use the public registry admission seam over disposable committed repositories, with configuration version 1.
They do not run Bun, acquisition, a server, or contained processes, and they do not prove installation, real archives, or #10 readiness.

The file depends on the dependency-compatibility implementation at `12806d9`, which this branch does not yet contain.
It imports that implementation's `lockFixture` and `admit` helpers from `dependencies-compatibility-fixture.mjs`.
Before that implementation is integrated, the file cannot load on this branch.

## Covered behavior

| Probe | Test behavior | Same-shape control |
|---|---|---|
| C01 | Root and nested optional platform versions through an intermediate hoisted placement, with dotted scoped names | — |
| C02 | Removing the hoisted nested copy is refused; the root copy does not satisfy the nested exact version | C01 |
| C03 | A host child shared with non-host optional closures is planned once; the closures stay excluded | — |
| C04 | A package reachable only through a required peer is planned with its children and peer | — |
| C07 | One identity at two planned placements and one excluded placement is acquired once | — |
| C08 | Conflicting lock metadata on copies with one shared integrity is refused | The same post-generation metadata on every copy is admitted |
| C09 | An escaped duplicate metadata key is refused as unsafe | The last-wins value written once is admitted |
| C10 | A duplicate `packages` key is refused as unsafe; parsing yields the admitted C03 lock | C03 |
| C11–C13 | Numeric prerelease identifiers order numerically and below alphanumeric identifiers | Two admitted edges in the same test |

The probe's C08 changed metadata before archive generation, so metadata and integrity both differed.
These tests change only the lock tuple after `lockFixture` has computed integrities, and they assert that the copies share one integrity.

The unapproved out-of-range peer observation (C16) is excluded.
These tests do not change the package-name rules.

## Fixture retention

The shared fixture removes a repository in an unconditional `t.after` hook.
These tests collect that removal and run it only after the checks pass.
A failing check keeps its fixture root and reports it with `t.diagnostic`.
Each fixture is created, checked, and removed or retained before the next one starts.
