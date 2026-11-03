# Dependency preparation namespace cleanup

Baseline: `9c10f9d`. This correction follows the integrated containment correction `9459af9` and preserves the scoped registry identity correction `bb2e839`.
Verification used Node 24.21.0, Bun 1.3.14, bubblewrap 0.13.1, and systemd 262.
Only existing installed tools and dependencies were used.

## Causal reproduction

The preparation path still killed only its outer bwrap process and waited for `close`.
Its script-suppression sandbox and target-install sandbox both used that path.

The new regression calls `prepareOwnerDependencies` with a disposable, admitted workspace.
It runs through the actual `factory-contained.mjs dependencies-diagnose` foreground route.
The fixture holds the startup gate and sends `SIGSTOP` to the namespace child reported by installed bwrap.
The baseline needed an observation-only `--info-fd 6` pipe. Bundle export remained on fd 5.
The fixture did not replace bwrap, Bun, the mounts, the preparation interface, or the baseline kill rules.

Before the correction, both cases failed at the unchanged three-second cleanup watchdog:

| Preparation stage | Outer bwrap | Namespace PID 1 | Observation after abort |
| --- | --- | --- | --- |
| Script proof | 3708481 | 3708482 | Outer `exit`, no `close`. Namespace remained stopped, reparented to PID 1097. |
| Target install | 3708780 | 3708781 | Outer `exit`, no `close`. Namespace remained stopped, reparented to PID 1097. |

The owned scopes were:

- `factory-contained-92a74c75-08a4-4c5f-a3a1-ddb2e3301fc7.scope`
- `factory-contained-279d46e1-f1d3-4193-9ad9-2fd49fe8f648.scope`

The harness drained both exact scopes and checked captured PID/start-time identities after the failures.
No host-wide process scan or name-pattern kill was used.
The red log is `/tmp/dependency-cleanup-red.log`.

This is an **injected startup fault**, not an observed natural preparation failure.
It reproduces the outer-exit/namespace-survival/pipe-retention mechanism through the preparation interface.
It does not establish the exact interleaving in the historical containment timeout.
Existing late-Bun cancellation passes were not used as startup-safety evidence.

## Correction

`src/containment-namespace.mjs` now owns the shared lifetime rules for checks and preparation:

1. Read the bounded bwrap information pipe while the startup gate remains closed.
2. Verify the outer process parent, start time, and exact cgroup.
3. Verify namespace PID 1, its parent, start time, cgroup, and `NSpid`.
4. On cancellation, wait for that verification before terminating the namespace.
5. Kill namespace PID 1 and join its death before terminating the outer process.
6. Close the parent's startup-gate pipe and join all child pipe closure.
7. On outer `exit`, start namespace drainage without waiting for `close`.

The launch receipt retains both identities.
Preparation uses fd 6 for bwrap information. The worker's bounded bundle export still uses fd 5.
Both script proof and target installation use the shared helper.
The public execution and preparation interfaces are unchanged.

The startup information bound remains five seconds, or the shorter existing diagnostic deadline.
Namespace death retains the existing 200 observations at five-millisecond intervals.
A separate one-second pipe-closure watchdog now fences a failed drain instead of waiting indefinitely.
The 120-second check/preparation deadline, 100-second Bun deadline, output cap, scratch size, and accepted scope limits are unchanged.
No caller can choose production commands or limits.

An intermediate implementation joined namespace death but left the parent's unreleased gate pipe open.
The stopped-startup fixture caught that omission through the pipe-closure watchdog.
Closing the gate during drainage corrected it without increasing a timeout.

## Failed drainage and ownership

If startup verification or drainage is uncertain, the shared helper fences further execution and requests `SIGKILL` for its verified exact scope.
If the backend survives that request, the helper throws `DRAIN_FAILED`, including when the manager request fails.
It does not return an ordinary failed preparation receipt.

`src/dependencies.mjs` preserves that code through sanitization and its safety wrapper.
A failure-record write error cannot replace the drainage error.
Final descriptor closure also preserves a preceding drainage failure.
The existing application fence recognizes `DRAIN_FAILED` without changes to `factory.mjs` or `dependency-run.mjs`.

The standalone owner wrapper retains its owner-release closure after `DRAIN_FAILED`.
This keeps the SQLite ownership handle reachable and locked while the process remains alive.
There is no new retry, automatic recovery, or ownership-release operation.

A process-local fault fixture denies namespace `SIGKILL` and the subsequent exact-scope kill request.
It verifies both owner routes with an actual stopped namespace still alive:

- Standalone preparation rejects with sanitized `DRAIN_FAILED` and retains its owner lock.
- Application preparation remains `interrupted / drain_failed`, rejects another start, and rejects closure with `DRAIN_FAILED`.
- Both reject new containment verification and preserve the exact scope-kill target.

Only the test harness restores signals and removes these fixture processes after asserting the fences.
This tests the failure contract. It does not establish cleanup guarantees for a real manager outage.

## Harness and regression coverage

The dependency tests no longer rely on `execFile` timeouts that kill only a launcher.
Direct-scope workers register the exact generated unit before launch.
Foreground tests consume the launcher's ownership announcement before waiting for readiness.
Every watchdog path kills and stops that scope, checks captured identities, and verifies an empty exact cgroup before removing files.
An empty collected `ControlGroup` never causes a root-cgroup read.

The new preparation suite covers:

- Abort at stopped startup in both sandboxes.
- Backend and launcher `SIGKILL` at each startup gate through the actual foreground route.
- Outer-bwrap `SIGKILL`, proving drainage starts before output closure.
- Immediate cancellation before startup information, plus fixed 0, 1, 2, 3, 5, 8, and 13 ms offsets after launch.
- Namespace death and pipe closure before return, retained failure, and owner-lock release.
- Failed-drain sanitization and standalone/application ownership fences.
- Exact teardown on a pre-ready watchdog and with a stopped launcher.
- Injected deadline callbacks and output-count overflow at startup in both sandboxes.

The limit fixtures dispatch the existing 120-second timer callback or inject counted diagnostic bytes.
They test the real stop/reason/drain path, not elapsed-time accuracy or an actual Bun output flood.
They change no production limit.
Existing tests still cover actual Bun-install cancellation, script suppression, normal preparation, registry acquisition, and read-only reuse.
The root and nested scoped-substitution admission regressions still pass.

## Commands and results

Use the installed runtime and existing dependencies. Do not install packages for these commands.
If needed, create a temporary `node_modules` link to `/home/cowen/Projects/tiny-software-factory/node_modules`.

```sh
NODE=/home/cowen/.local/share/mise/installs/node/24.21.0/bin/node

# Original red cases, now green. The initial baseline run contained only these two tests.
"$NODE" --test --test-name-pattern='owner abort at a stopped' \
  tests/phase-1/dependencies-cleanup.test.mjs

# Preparation cleanup regressions, including the fixed 16-case timing sweep.
"$NODE" --test tests/phase-1/dependencies-cleanup.test.mjs

# Independent-scope containment loops, with their original three-second watchdog.
"$NODE" tests/fixtures/containment-cleanup-loop.mjs 100 cleanup-startup
"$NODE" tests/fixtures/containment-cleanup-loop.mjs 100 cleanup

# Complete Phase 0/1 and browser regression.
"$NODE" --test --test-concurrency=1 tests/phase-0/*.test.mjs tests/phase-1/*.test.mjs
CHROMIUM_PATH=/usr/bin/chromium "$NODE" --test tests/ui/phase-0.test.mjs
```

Results at the isolated implementation checkpoint:

- Baseline stopped-startup reproduction: **2/2 failed**, both with outer exit and surviving namespace PID 1.
- Corrected preparation cleanup suite: **17/17 passed**.
- Ten sequential repetitions: **170/170 passed**, including 160 fixed preparation cancellation offsets.
- Existing check startup loop: **100/100 passed**, covering 4,000 cancellation offsets.
- Existing normal/abort/close cleanup loop: **100/100 passed**.
- Final complete Phase 0/1 suite: **182/182 passed**, without skips.
- Browser regression: **1/1 passed**.
- JavaScript syntax and whitespace checks passed. Package files, runtime pins, and the dependency graph are unchanged.

Local logs:

- `/tmp/dependency-cleanup-red.log`
- `/tmp/dependency-cleanup-green.log`
- `/tmp/dependency-cleanup-check-startup-100.log`
- `/tmp/dependency-cleanup-check-normal-100.log`
- `/tmp/dependency-cleanup-repeat-1.log` through `/tmp/dependency-cleanup-repeat-10.log`
- `/tmp/dependency-cleanup-full-suite-final.log`
- `/tmp/dependency-cleanup-browser.log`

The optional test-only `FACTORY_TEST_SCOPE_AUDIT` variable records exact-scope teardown observations.
`/tmp/dependency-cleanup-scope-audit.jsonl` contains 500 successful teardown records from the final validation runs.
A later exact-name audit checked those scopes and both red scopes: **502/502 inactive**, with empty cgroups.
It also confirmed that the captured red process identities were no longer alive.
The audit is `/tmp/dependency-cleanup-scope-final-audit.json`.
Earlier exploratory runs also used exact-scope teardown, but preceded that journal.

## Limits and parent follow-up

This correction does not change the foreground launcher or recovery policy.
Cleanup still depends on Linux namespace teardown, an available user manager, and a schedulable backend launcher-loss monitor.
Simultaneous backend/launcher death, manager failure, host loss, and kernel failure remain outside the established cleanup guarantees.

The in-process ownership fence is not durable ownership after that process dies.
A standalone operation also has no new application reconciliation record.
Recovery after manager failure plus owner loss therefore still needs trusted external quiescence review.
Durable reconciliation for that combination would require a separate design and changes outside this slice's ownership.
This correction does not claim to close that larger gap.

## Parent integration corrections and final verification

The parent integrated this correction and independently ran the full suite: **182/182 passed**.
Further review found two failure-propagation defects. Both failed new regressions before correction:

- A handled check failure cleared the current operation. A later `close()` then succeeded despite an unconfirmed namespace drain. Finalization now checks the persistent backend namespace fence and rejects repeated close calls with `DRAIN_FAILED`.
- A transient write failure while recording the application's dependency error replaced `DRAIN_FAILED`. During stop, this allowed a stopped result despite surviving work. `src/dependency-run.mjs` now preserves a drainage failure even when its error report cannot be saved. The outer application retains `interrupted / drain_failed`, rejects another start, and refuses shutdown.

The first regression denies namespace and scope signals in a disposable process, handles the check error, and calls the real contained interface's `close()`.
The second adds one injected SQLite mutation failure after actual preparation reports failed drainage.
Its assertions use the factory's stop, inspect, start, close, and ownership interfaces, not private SQL contents.
The missing dependency failure record remains missing; the application does not fabricate persistence.
These are controlled failure-propagation tests, not claims about a naturally observed manager or disk outage.

Final parent verification under Node 24.21.0:

- Full `npm test`: **184/184 passed**, with no exclusions or skips.
- Browser regression: **1/1 passed**.
- JavaScript syntax, documentation links/anchors, whitespace, and unchanged dependency/runtime checks passed.
- All **67** scopes recorded by the exact-owned cleanup harness during the final suite were inactive with empty cgroups in a separate audit.

Parent evidence: `/tmp/factory-parent-final-suite.log`, `/tmp/factory-parent-final-browser.log`,
`/tmp/factory-parent-final-scopes.jsonl`, and `/tmp/factory-parent-final-scope-audit.json`.
The shared implementation documents now describe this verified checkpoint and the remaining live/toolchain/recovery limits.

No real Vanguard source, credential/configuration file, public endpoint, live model, persistent service, or global setting was accessed or changed.
All repositories, package archives, script sentinels, and registry responses were controlled fixtures.
The temporary dependency symlink was not committed.
These results do not establish real Vanguard/Bun compatibility, live-model acceptance, baseline health, or maintenance readiness.
