# Vitest baseline command correction

Base: `62a9720`. Stream A of the ticket #9 integration.
This corrects the shared baseline gap recorded in the [qualification parent review](ticket-09-parent-review.md).
It does not accept ticket #9 or establish real toolchain readiness.

## Defect

The fixed contained `vitest` check ran `vitest run --maxWorkers=2 --minWorkers=1`.
The admission profile recorded the same descriptor.
The retained Vitest 4.0.17 sources register every command without `allowUnknownOptions`, and `--minWorkers` is absent from `cli-config.ts`.
A real 4.0.17 runner would therefore stop at CLI parsing with an unknown-option error, and admission would block every healthy baseline as `BASELINE_VITEST_FAILED`.
Earlier fixtures printed argv without parsing it, so they masked this.

## Correction

The executed argv and the profile descriptor change together:

- Check argv: `run --maxWorkers=2 --no-file-parallelism`.
- Profile `checks[0]`: `vitest run --maxWorkers=2 --no-file-parallelism`.

`run` keeps watch mode disabled.
`--no-file-parallelism` runs test files serially. The retained `config.ts` states that this overrides `maxWorkers` to 1.
`--maxWorkers=2` keeps the original ceiling of two workers.
This matches the runtime the qualifier already requires: `maxWorkers: 1`, `fileParallelism: false`.
Resource limits, timeouts and the lint check are unchanged. The qualifier's reporter command changes only as described below.

## Qualification pool pin

Stream E's controlled Node probe reported `EBADF` for fd 6 in a plain forked child, while a worker thread could write to that descriptor. It did not exercise Vitest's actual worker-spawning configuration.
The final qualification suite keeps the repository configuration, which may select `pool: 'threads'`.
Every qualification command now passes `--pool=forks` as a precaution. The retained `cli-config.ts` documents `--pool <pool>` (default `forks`). CLI options override the configuration file.
The baseline `vitest` check does not use the report descriptor and keeps its argv.
This is not an end-to-end proof that forged frames are rejected. Reporter validation of the resolved pool belongs to the qualifier.

## Profile changes

The descriptor change alters every admission profile digest.
An admission verified under the old descriptor no longer matches on passive inspection and shows `ADMISSION_INVALIDATED`.
This is intended: its baseline ran a command that the current factory no longer executes.

A composed run is identified by `run.qualification`.
For those runs only, the profile also hashes `qualified-execution.mjs` and the qualifier modules (`qualification.mjs`, `qualification-artifacts.mjs`, `qualification-source.mjs`, `qualification-selection.mjs`, `qualification-scope.mjs`, `qualification-reporting.mjs`, `qualification-reporter.mjs`).
Parent integration also binds `work-items.mjs`, `factory.mjs`, `execution.mjs`, `storage.mjs`, workspace/Git, and the containment lifetime/entry/host/test-profile modules for composed runs. This fixed set addresses the known omitted implementation bindings, not every transitive dependency.
Legacy admission-only and executor profiles do not include these conditional additions.
If a composed module is missing, the profile cannot be computed and admission blocks before any gate effect.

## Evidence

The controlled consumer `tests/fixtures/vitest-baseline-cli.mjs` is inlined into the disposable vitest package.
It parses argv like the retained CLI contract: it rejects options outside its table and resolves serial files to one worker.
It is a controlled model of the retained sources, not the Vitest distribution.

- Red: with the old argv, the executed consumer reported ``CACError: Unknown option `--minWorkers` `` and admission blocked with `BASELINE_VITEST_FAILED`.
- Green: admission succeeds and the consumer reports `{ watch: false, fileParallelism: false, maxWorkers: 1 }`.
- `tests/phase-1/admission-profile.test.mjs` covers the composed profile. At the stream's base `qualified-execution.mjs` was absent, so it checked the fail-closed branch. A temporary placeholder probe exercised the present branch; it was removed and not committed. Parent integration runs the actual composed modules and separately removes a required file from a disposable runtime after loading it, proving admission blocks before tools or model requests.

## Limits

Admission still judges the baseline by exit status. It does not read a structured report of the resolved configuration.
No real Vitest package was downloaded or executed.
Live distribution compatibility remains a separate acceptance gate.
