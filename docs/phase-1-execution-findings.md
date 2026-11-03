# Phase 1 execution-boundary findings

Collected on 2026-11-02 for the [design interview](phase-1-plan.md).
These are research findings, not an approved execution design or implemented factory.
The probes used disposable scratch files and processes. No Vanguard code ran, no credential configuration was read, and no live inference occurred.
The scratch scripts are not version-controlled regression tests. The researcher reported removing the scratch directory and terminating its probe processes after identity checks.

## Scope deviation

One unisolated network-control test attempted a TCP connection to `1.1.1.1:9` with a 1 ms timeout and no application payload.
This breached the delegated task's loopback-only restriction. The researcher disclosed it and did not repeat the control.
An isolated attempt returned `ENETUNREACH`; that does not excuse the out-of-scope control.
Do not describe the research as wholly loopback-only or as involving no external connection attempt.
Further network tests must use only explicitly authorized destinations.

## Observed scratch-probe behavior

- A plain `NodeExecutionEnv` command running the researcher's own `sleep` survived SIGKILL of its Node parent. An interrupted durable tool record does not prove its process has stopped.
- Abort and timeout killed the tested child. Calling `cleanup()` also killed it, but execution returned `ok: true` with exit code 137. An execution result's `ok` flag is not proof of a passing check; inspect its exit code and termination reason.
- Installed bubblewrap 0.13.1 successfully ran an unprivileged scratch command with explicit namespace and mount flags. An outside-scratch sentinel was inaccessible, a dummy parent environment variable was absent, and network isolation blocked access to the researcher's host-loopback listener.
- Direct argv invocation of bubblewrap with `--die-with-parent` and a PID namespace left no tested child running after parent SIGKILL. This does not establish the same property through the built-in bash tool's shell-string path.
- The minimal sandbox had no seccomp filter. CPU, memory, and PID limits were not tested. A size-limited tmpfs constrained scratch storage, not a host-bound repository's disk use.

Vanguard, its dependencies, and the selected Node 24 toolchain were not mounted into this sandbox.
Their operation inside a final execution boundary remains unverified. No production sandbox profile follows from these probes.

## Public-source findings for the pinned libraries

Paths are relative to this repository's installed dependencies.

- `pi-durable` spawns detached process groups and kills the group on abort, timeout, or cleanup. Active process IDs exist only in memory. See `node_modules/@earendil-works/pi-durable/dist/env/node.js:214–240,742–773,1168–1172`.
- An interrupted unsafe tool settles without automatic replay, but the harness has no durable process receipt that could locate an orphan. See `node_modules/@earendil-works/pi-durable/dist/harness/tool.js:113–160`.
- In the inspected OpenAI and Anthropic SDK paths, the configured request timeout clears after fetch receives response headers. It is not a full-stream deadline. See `node_modules/openai/client.js:991–1023` and `node_modules/@anthropic-ai/sdk/client.js:663–673`. The actual gateway's behavior remains untested.
- The factory needs an independent full-operation deadline and abort path to meet the accepted duration-limit requirement. Aborting locally is not proof that a provider has stopped billing.
- `ConversationStreamOptions` has no typed output-token cap. Public alternatives include the model definition's `maxTokens` or a provider-payload hook. An untyped stream-option pass-through exists in source but was not exercised and is not a stable typed contract. See `node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts:481–493,902–907` and `node_modules/@earendil-works/pi-ai/dist/api/simple-options.js:3–23`.
- Durable model retries start afresh for each tool round. Provider retries are a separate layer. Set both policies explicitly; do not infer a cumulative request budget from either default. See `node_modules/@earendil-works/pi-durable/dist/harness/agent.js:4–9` and `node_modules/@earendil-works/pi-ai/dist/utils/provider-retry.js:76–96`.
- The SDK tool-round counter survives a crash but resets for a new SDK run, including a `continue` submission. Continuation hooks can also reset it. A factory run's cumulative limits therefore require application-owned accounting. See `node_modules/@earendil-works/pi-durable/dist/harness/generation.js:685–687,832–837,895–905,939–945`.

## Restart inspection and scheduling controls

A follow-up source inspection found a passive restart path; no runtime probe has verified application fencing.

- `Harness.open({ readOnly: true })` neither recovers nor writes tasks. `inspect()` writes nothing and runs no task code. See `node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts:671–677,834–835`.
- A normal writable open still starts paused, but resets previously running tasks to pending and charges a restart. Reconciliation also writes without running extension code. See `node_modules/@earendil-works/pi-durable/dist/harness/scheduler.js:210–252,826–867`.
- `resume()` enables scheduling session-wide. `submit()` does too, even when re-finding an existing request ID; wait calls and `Conversation.abort()` also enable it. These are not passive inspection APIs. See `node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts:811–818` and `node_modules/@earendil-works/pi-durable/dist/harness/submissions.js:51–53`.
- `abortTask()` can mark a task without enabling scheduling, but its abort handler runs only once scheduling starts. There is no public per-conversation hold. Abort-marking or registry-based fencing strategies remain untested. See `node_modules/@earendil-works/pi-durable/dist/harness/harness.js:211–213` and `node_modules/@earendil-works/pi-durable/dist/harness/scheduler.js:383–417`.

## Selected-model limits (source inspection only)

The selected `openai/gpt-6.1-sol` catalog entry uses OpenAI Responses, with a 272,000-token context and 128,000-token maximum output.
Those are catalog limits, not suitable per-run defaults. No live request verified them.

- The catalog supports explicit `low` reasoning effort, not `off` or `minimal`. Leaving the harness at its default `off` omits a reasoning field for this model, leaving the provider's default effort unknown. See `node_modules/@earendil-works/pi-ai/dist/providers/data/openai.json` and `node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js:280–303`.
- The Responses adapter emits `max_output_tokens` in API-key mode but omits it for its Sign in with ChatGPT path. A profile that requires this field must block unsupported authentication modes instead of dropping the cap. See `node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js:252–269`. No credential was read or validated in this research.
- The vendored OpenAI SDK documents the output cap as including reasoning tokens. Pi's `usage.output` already includes reasoning; adding `usage.reasoning` would double-count. Remote enforcement remains a vendor claim, not a tested billing guarantee.
- A public provider-payload hook can cap normal generations, but it does not cover compaction. Disable automatic compaction or use a typed model cap that also covers that path. Preserve ModelRuntime's credential integration; do not invent another credential loader.
- An output-limit response maps to `stopReason: length`, which the harness treats as a final answer. That alone cannot establish readiness. See `node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js` and the harness generation response classification.
- Explicit controls exist for disabling compaction, provider retries, and durable retries. They do not replace cumulative application accounting. A graceful close alone can leave an in-flight request to resend after reopen. Stop must cancel, not merely close.
- Attempts without terminal usage need conservative budget reservations, separate from measured usage. Never report the reserved output allowance as actual consumption or actual billed spend.

## Resource and dependency-preparation feasibility (not enforcement tests)

Read-only host inspection found cgroup v2 memory and PID controllers available to the user manager.
Bubblewrap itself has no memory or PID-limit controls. Shell process-count limits are per user, not per run.
A manually launched foreground transient systemd scope could cap the backend and its tool descendants together, without installing a unit file.
That topology can preserve the direct Node-to-bubblewrap parent relation, but actual launching, limit triggers, and OOM cleanup remain untested.
A memory envelope also needs an explicit swap limit. Task limits count threads as well as processes.
The scope could kill the backend itself; recovery must tolerate that outcome.
Sources: local `systemd-run --help`, `systemd.scope(5)`, `systemd.resource-control(5)`, cgroup controller metadata, and read-only user-manager properties.
No scope or cgroup was created or changed.

Bun 1.3.14's `install --help` lists `--frozen-lockfile` and `--ignore-scripts`, but no offline flag.
The help output is not proof that lifecycle scripts, including trusted dependency scripts, are suppressed.
Verify that behavior with controlled, network-isolated fixtures in a later approved step before preparing real dependencies.
The agent-run network ban still needs OS enforcement; a package-manager option is not a substitute.

## Unresolved design and verification

The owner selected containment in [ADR 0003](adr/0003-contain-repository-tools-in-phase-1.md), operator-controlled recovery in [ADR 0004](adr/0004-operator-controlled-recovery.md), and per-run execution stores in [ADR 0005](adr/0005-isolate-execution-stores-per-run.md).
The [Phase 1 plan](phase-1-plan.md#accepted-limit-profile) records the accepted numerical limits. Actual enforcement and real toolchain behavior remain unverified.
These findings are not permission to enable tools.
Verify actual launcher topology, permitted repository mounts, environment filtering, network restrictions, full-stream cancellation, process cleanup, and cumulative limits before relying on those properties.
Do not copy a shell-wrapped sandbox command and assume the direct-argv parent-death result still holds.
