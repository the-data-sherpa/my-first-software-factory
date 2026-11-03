# Containment descendant-cleanup correction

Baseline: `cc515bb`. Runtime: Node 24.21.0. Installed bubblewrap: 0.13.1.
This correction changes only containment code, its launcher, and containment fixtures/tests.
It does not include the parent's separate model integration or dependency extensions.

## Failure and causal evidence

The supplied evidence recorded a 30-second timeout in the normal/abort/close cleanup diagnostic:

- `/tmp/factory-dependency-evidence-oQ8n17/suite-with-cleanup-timeout.log`
- `/tmp/factory-dependency-evidence-oQ8n17/cleanup-observation.json`

The surviving bwrap and detached descendants belonged to `factory-contained-67d4b482-1fa2-4251-959f-b5c79b25a1bf.scope`.
That scope had already been stopped. Later passing reruns did not explain the failure.

The first reproduction loop used the actual execution interface in an exact-owned transient scope.
It applied the accepted resource limits and the installed bwrap binary.
Its three-second watchdog killed only that scope and checked captured PID/start-time identities.
The original cleanup diagnostic passed 100 consecutive repetitions.

A fixed cancellation sweep then reproduced the orphan topology on its first run.
Cancellation offsets covered 0–39 milliseconds after `execution.check('hang')`.
The sweep did not wait for the descendant-observation fixture.
Ten subsequent sweeps all failed within three seconds on the unchanged runner.

One instrumented failure supplied this sequence:

1. The runner launched direct bwrap PID `3363462`.
2. bwrap reported namespace child PID `3363463` through `--info-fd`.
3. Cancellation killed PID `3363462` with `SIGKILL`.
4. PID `3363463` survived, reparented to PID `1097`, with the fixture and detached descendants.
5. The runner received the direct child's `exit`, but never received `close` while those descendants retained output pipes.

The original runner killed only the direct bwrap process.
Its startup gate verified that process's parent and cgroup, not the namespace child.
`--die-with-parent` did not cover the observed startup handoff.
The later timeout tried to kill the same dead direct child and could not finish drainage.
The original harness also killed only the launcher on timeout, without stopping its scope.

Three hypotheses guided the probes: an early bwrap termination race, inherited output pipes, and a diagnostic observation race.
The timing sweep supported the first two and excluded the observation wait as a necessary trigger.
Removing bwrap's reaper with `--as-pid-1` still reproduced orphaning, so that experiment was discarded.

A deterministic fault now stops namespace PID 1 while the command remains behind the startup gate.
Restoring outer-only termination makes the abort regression time out at three seconds.
Disabling the launcher's scope drain makes backend SIGKILL leave that stopped namespace orphaned.
These probes establish the startup-lifetime failure without depending on a rare scheduling interleaving.
They do not identify a particular instruction inside bwrap or prove which mode failed in the historical 30-second run.

## Correction

### Check lifetime

The runner reads bwrap's bounded `--info-fd` response while the startup gate remains closed.
It verifies namespace PID 1's parent, start time, cgroup, and `NSpid` before releasing the gate.
The launch receipt retains both process identities.

Cancellation records its reason immediately but does not kill the outer bwrap during the handoff.
After verification, the runner kills namespace PID 1 and joins its death before killing the outer bwrap.
Linux PID-namespace teardown removes the detached sessions and grandchildren.
The runner also starts namespace drainage on direct-child `exit`, independently of inherited pipe closure.
It joins drainage before recording a settled result or releasing execution ownership.

An uncertain startup or failed drain fences all execution handles in the backend and requests SIGKILL for its verified scope.
The startup information wait is bounded by five seconds, or the shorter diagnostic check deadline.
The normal 120-second check deadline and the original 30-second containment-test timeout are unchanged.
No timeout increase substitutes for process cleanup.

### Foreground lifetime

The launcher retains its exact generated scope name and drains that scope when the backend exits.
This also covers backend death before the namespace child finishes startup.
The backend checks its foreground launcher's parent relationship every 50 milliseconds.
Launcher loss kills the backend's own scope, including any startup or detached descendants.
The entry point checks for early launcher loss before dispatching work.

The launcher can announce its scope over an inherited Node IPC channel before spawning the backend.
The containment harness uses this ownership announcement, rather than waiting for a successful diagnostic receipt.
Its failure and timeout paths kill, stop, and reset only that announced scope.
They verify captured process identities and an empty exact scope before removing fixture files.

### Unchanged controls

The accepted envelope remains 4 GiB memory, zero swap, and 256 tasks.
The smaller destructive diagnostic profile remains separate.
Production execution still rejects diagnostic checks, arbitrary argv, and caller-selected limits.
Read-only snapshots, scrubbed tool environments, denied networking, live envelope verification, and startup fencing remain enabled.
No service or global configuration was installed or changed.

## Reproduction and regression commands

Use the installed runtime. These commands require the existing user manager, bwrap, and repository dependencies.
They use disposable fixtures and controlled local networking, not Vanguard or production providers.

```sh
NODE=/home/cowen/.local/share/mise/installs/node/24.21.0/bin/node
# This checkout used a temporary link to existing dependencies, with no install.
[ -e node_modules ] || ln -s /home/cowen/Projects/tiny-software-factory/node_modules node_modules

# One actual-OS sweep, normally about 1.2 seconds; three-second watchdog.
"$NODE" tests/fixtures/containment-cleanup-loop.mjs 1 cleanup-startup

# Original normal completion, abort, and close scenario.
"$NODE" tests/fixtures/containment-cleanup-loop.mjs 100 cleanup

# Deterministic startup fault, owner deaths, and harness timeout cleanup.
"$NODE" --test tests/phase-1/containment-cleanup.test.mjs

# All containment tests, including boundary/resource enforcement and crash receipts.
"$NODE" --test --test-concurrency=1 tests/phase-1/containment*.test.mjs

# Complete relevant repository suite, including execution/recovery/dependency integration.
"$NODE" --test --test-concurrency=1 tests/phase-0/*.test.mjs tests/phase-1/*.test.mjs
```

The standalone loop owns a scope directly so it can exercise the runner without relying on the launcher's cleanup correction.
The regression tests separately exercise the actual foreground launcher.
The fixed `startup-stop` diagnostic accepts no executable or arguments.
SIGUSR1 requests abort and SIGUSR2 requests close in that diagnostic only.

## Results

- Baseline ordinary cleanup: 100/100 repetitions passed, confirming that isolated green reruns missed the race.
- Baseline startup sweep: 10/10 bounded repetitions reproduced orphaning.
- Deterministic outer-only abort mutation: failed at three seconds. Restored correction: passed.
- Disabled launcher-drain mutation: backend SIGKILL left stopped PID `3416568` reparented to `1097`. Restored correction: passed.
- Launcher SIGKILL before its lifetime correction: backend and detached descendants survived. Corrected regression: passed.
- Final startup sweep: 100/100 repetitions passed, covering 4,000 cancellation offsets without survivors after individual checks.
- Corrected original cleanup: 100/100 repetitions passed, covering normal completion, abort, and close.
- Final cleanup regression file: 25/25 repetitions passed, eight tests each (200 test executions).
- Complete containment suite: 18/18 passed, including backend SIGKILL, scoped OOM, resource enforcement, boundary verification, and passive receipts.
- Complete repository suite: 139/139 passed, no skips.

Local logs include `/tmp/containment-startup-red-bounded.log`, `/tmp/containment-startup-info.log`,
`/tmp/containment-gate-abort-red.log`, and `/tmp/containment-backend-startup-red.log`.
Final repetition logs use `/tmp/containment-correction-startup-40-final.log`,
`/tmp/containment-correction-normal-100-isolated.log`, and `/tmp/containment-correction-final-regression-*.log`.
The complete suite log is `/tmp/containment-correction-full-suite.log`.
These files are local evidence, not committed runtime artifacts.

An exact-name audit checked 744 scopes from the recorded experiments, including the supplied historical scope.
All 744 were inactive. `/tmp/containment-correction-scope-audit.json` records the audit.
No name-pattern kill or host-wide process kill was used.
Harness-based regressions also verify their own scopes during teardown, including failures before a ready receipt.

## Other observations and limits

Two simultaneous repetition loops hit the strict three-second watchdog during the same time interval.
The startup loop had completed its existing check receipts and had not recorded its next launch.
The other loop had not recorded its first launch.
Each exact scope contained only its backend when observed, not orphan bwrap descendants.
Both scopes were drained. Subsequent sequential 100-run repetitions passed without changing the watchdog.
The cause of that shared delay was not established.

One exploratory 40-offset sweep produced an early exit code 137 before cancellation, with no output or surviving process.
That separate early-exit observation remains unexplained.
Two later 100-sweep runs across all 40 offsets passed, including the final run without debug instrumentation.
The correction addresses namespace leakage, not every possible check failure.

A draft reproduction harness mistakenly read the root cgroup after a collected scope returned an empty `ControlGroup`.
This read exposed process metadata outside the test scope. It did not read credentials or signal those processes.
The retained harness now requires an exact nonempty scope suffix before reading `cgroup.procs`.

Cleanup depends on the installed Linux PID-namespace implementation and the available user manager.
The backend's launcher-loss monitor needs a schedulable event loop.
Simultaneous SIGKILL of both launcher and backend, user-manager failure, host loss, and kernel failure are not established cleanup guarantees.
Uncertain recovery must remain fenced until the operator confirms quiescence.
The change does not authorize passive replay, replenish budgets, or grant maintenance readiness.

No real Vanguard access, credential/configuration reads, public downloads, model requests, tracker writes, or push occurred.
Verification used existing dependencies and disposable local package fixtures.
The parent's application integration was outside this implementation checkout.
After integration, the parent containment, registry, and dependency-application selection passed **38/38**, with no skips.
The later [preparation correction](dependency-cleanup-correction.md) moved these namespace-lifetime rules into a shared helper and applied them to both preparation sandboxes.
Parent review added a handled-check-error regression: mandatory close must still reject an unconfirmed drain after the operation has settled.
Final parent verification passed **184/184**, with no exclusions or skips, and the browser regression passed **1/1**.
The recovery limits above remain unchanged.
