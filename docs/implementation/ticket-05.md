# Ticket #5 implementation record

This slice adds bounded model requests from baseline `49a57c9`.
It uses the installed, pinned Pi 1.5.0 packages and Node 24.21.0.
Controlled transports provide the evidence. No live model acceptance or Vanguard execution occurred.

## Factory-owned interfaces

Import these functions from `src/execution.mjs`:

```js
createModelExecution({ modelRuntime, purpose, fetch, clock })
createModelRequests({ modelRuntime, budget, signal, fetch, clock })
```

The caller supplies Pi's `ModelRuntime`. These constructors do not create a runtime, discover credentials, or load host configuration.
`ModelRuntime` owns credential resolution and the actual Responses adapter. There is no separate credential loader or fallback route.
`fetch` and `clock` are controlled transport/time boundaries for tests. Production uses the default fetch and system clock.
The request clock must use the same time base as the factory budget.

### Execution adapter

`purpose` defaults to `preflight`. This operation submits one fixed, no-tool smoke prompt.
`bounded-no-tools` submits the admitted brief, after a successful smoke in the same run.
It exists to exercise normal requests and durable retries. It does not enable the repository executor.

The adapter supplies `mode`, `model`, `start`, `resume`, and `assessRecovery`.
Modes are `model-preflight` and `model-bounded-no-tools`. The model is always `openai/gpt-6.1-sol`.

```js
const handle = await execution.start({
  directory, runId, requestId, brief, run, budget, signal,
});
// handle: { submissionId, finished, cancel, close }
```

The adapter commits the original input and receipt identity in the run's execution store before scheduling.
It rejects a second `start` against an existing receipt. It never uses resubmission for lookup or recovery.
`finished` returns the existing factory receipt format. The application must still call `close` before releasing admission.
`cancel` aborts the model and joins cancellation. `close` also aborts and drains, independently of closing SQLite.
A startup rejection drains anything it started. A drain failure rejects closure and keeps factory admission fenced.

Inspection retains the native read-only implementation, schema validation, WAL handling, and original submission identity from tickets #1/#2.
No model request starts during inspection or backend reopen.

`resume` always rejects with `UNSAFE_RESUME`.
Recovery assessment reports neither quiescence nor resumability. This slice cannot reconcile production effects after a crash.
The factory must not replace that assessment with an operator boolean or resubmit the original input.
A crashed model run therefore remains fenced until a later trusted recovery implementation establishes quiescence.

### Request controller

The request controller supports these methods:

```js
await requests.preflight();
await requests.request({ generationId, retry, messages, sessionId });
await requests.cancel();
await requests.close();
```

Each response includes `ok`, `message`, `accounting`, `reservationId`, and `reviewReady: false`.
Failures include a fixed `reason` code. Budget violations reject with a `FactoryError`.
A repeated successful `preflight()` returns the retained reservation identity without another request or message.
A failed or interrupted smoke cannot retry. Normal requests require a successful smoke from this run's persisted budget.

Each `request` makes one attempt. It performs no local retry.
The execution adapter lets pi-durable schedule at most one transient retry for its normal generation.
Every retry needs a new reservation under the same `generationId` with `retry: true`.
A future reconciled resume must use the same rule. Reconstructing a controller never resets counters or the original deadline.
Controller reconstruction is not permission to resume production execution.

Both operations reject tool-bearing payloads in this slice.
Ticket #8 must connect approved tool declarations and execution through verified containment before changing that restriction.
No automatic compaction, continuation hooks, follow-up inputs, deferred responses, or background work are installed.

## Request enforcement

- The exact physical model must use `openai-responses` at the official OpenAI v1 endpoint.
- Auth checks must report `api_key`. OAuth fails before token refresh or model dispatch.
- The final authorization header must contain an API key beginning with `sk-`.
- A missing, invalid, or excessive `max_output_tokens` blocks dispatch. Server rejection of the cap also fails preflight.
- The smoke requests at most 1,024 output tokens and has a 60-second full-stream deadline.
- Normal requests request at most 8,192 output tokens and have a 180-second full-stream deadline.
- Both deadlines end no later than the original run deadline.
- The payload must use explicit `low` reasoning, streaming, and `store: false`.
- Provider retries are zero. A second transport dispatch under one reservation is also refused.
- Redirects are disabled. The final URL and serialized payload receive another check before transport I/O.

The installed SDK's optional mid-conversation effort mode otherwise sends `medium` in the top-level request.
The bounded model copy disables that mode. Controlled payload checks confirm top-level `reasoning.effort: low`.
The adapter does not depend on the SDK's response-header timeout for its deadline.
Its own abort timer covers auth preparation, headers, and the complete response body.
Body cancellation joins the underlying reader's cleanup before returning. Unconfirmed cleanup does not become a terminal success.

## Persistent accounting

The existing `executionBudget` interface adds these compatible operations:

```js
budget.modelAttempts(); // detached snapshots of retained model reservations
budget.reserveModelAttempt({
  generationId, retry, smoke, requestedOutputTokens, requestDeadlineAt,
});
budget.observeModelUsage(reservationId, accounting);
budget.settle(reservationId, evidence, accounting); // third argument remains optional
```

Reservations commit before auth/request dispatch and consume the original attempt allowance.
They persist the full-stream request deadline without changing the run deadline.
The smoke identity cannot become a normal retry to bypass its single-attempt limit.

A reservation's `accounting` contains:

- `outcome` and an optional fixed `reason` code.
- Optional terminal `usage`: input, output, cache read/write, reasoning, and total tokens.
- `cost`, labeled `estimated` with a USD estimate, or `unknown` without an amount.
- `unmeasuredOutputTokens`, retaining the full requested allowance when terminal usage is absent or invalid.
- `preflight`, true only after a successful smoke completes and drains.

Terminal provider usage commits immediately, before stream drainage.
An interrupted or failed drain can therefore retain measured usage while its reservation stays `uncertain`.
Final settlement records bounded evidence. It never refunds attempts or `counters.reservedOutputTokens`.
Older reservations without accounting remain conservative full reservations, not measured consumption.

Reasoning tokens are a subset of output tokens. Neither totals nor estimated cost add reasoning a second time.
Failed Responses events retain their usage even when Pi's normalized error message omits it.
Catalog pricing supplies estimates, not provider-reported invoices. Service-tier adjustments and actual billing remain unverified.
There is no hard monetary ceiling. Local abort does not prove that provider billing stopped.

Error bodies, auth diagnostics, and failed-response partial content do not enter returned errors or retained evidence.
A length stop, provider error, reported cap violation, or failed smoke cannot pass preflight or establish review readiness.

## Parent integration gates

This branch does not change normal `serve`, the CLI, application outcomes, or application capability flags.
The parent must preserve explicit owner authorization for any production-model operation.
Do not create a credential-discovering runtime on ordinary startup, inspection, or recovery.
Do not describe the current application's `fixture-completed` outcome as production acceptance.
Use the retained preflight result and accounting when adding model-specific outcome rendering.

Ticket #7 should run the request controller's smoke inside the maintenance run's existing budget before executor dispatch.
Do not copy smoke evidence from a different diagnostic run or replenish the budget between preflight and agent work.
The standalone preflight adapter already owns a durable submission. It is not a reusable placeholder for another executor's `start`.
Ticket #8 must retain the same request gates when adding contained tools and multiple generations.
Every future generation needs a stable identity, and every tool round must use the existing tool budget.

Live API-key availability, provider cap enforcement, actual billing, and the Vanguard maintenance demonstration remain owner-invoked acceptance gates.
Repository tools, dependency preparation, baseline qualification, readiness qualification, and production effect reconciliation remain separate slices.

## Verification

Tests use the accepted execution/application seams, actual ModelRuntime and pi-durable, dummy in-memory credentials, and controlled transports.
No private SDK methods, SQL queries, or source-string assertions form the model acceptance tests.
Missing-credential checks run with a private empty home and scrubbed environment.
OAuth fixtures prohibit credential refresh. The process-crash worker also rejects uncontrolled network access.

The focused suite covers outgoing payloads, auth/cap incompatibility, stalls, cancellation drainage, failed usage, conservative reservations, and sanitized errors.
It also covers durable retry limits, reconstructed budgets, real process death, passive inspection, and fail-closed production resume.
Existing recovery, containment, workspace, and execution-store regressions remain in the full suite.

Final verification under Node 24.21.0:

- Focused model suite: **18/18 passed**.
- `npm test`: **122/122 passed**, with no skips.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:ui`: **1/1 passed**.
- JavaScript syntax checks and `git diff --check` passed.

Package files and the dependency graph are unchanged. The checkout uses the permitted untracked local `node_modules` symlink.
No package fetch, production-model request, host credential-file read, Vanguard access, GitHub write, push, or merge occurred.
