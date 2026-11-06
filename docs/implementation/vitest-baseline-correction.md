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
`--no-file-parallelism` runs test files serially; the retained `config.ts` states that this overrides `maxWorkers` to 1.
`--maxWorkers=2` keeps the original ceiling of two workers.
This matches the runtime the qualifier already requires: `maxWorkers: 1`, `fileParallelism: false`.
Resource limits, timeouts and the lint check are unchanged. The qualifier's reporter command changes only as described below.

## Qualification pool pin

Adversarial review (stream E, F4) observed that the qualifier's report descriptor (fd 6) cannot be written from forked children but can be written from worker threads.
The final qualification suite keeps the repository configuration, which may select `pool: 'threads'`.
As a precaution, every qualification command now passes `--pool=forks`; the retained `cli-config.ts` documents `--pool <pool>` (default `forks`), and CLI options override the configuration file.
The baseline `vitest` check does not use the report descriptor and keeps its argv.
This is not an end-to-end proof that forged frames are rejected; reporter validation of the resolved pool belongs to the qualifier.

## Profile changes

The descriptor change alters every admission profile digest.
An admission verified under the old descriptor no longer matches on passive inspection and shows `ADMISSION_INVALIDATED`.
This is intended: its baseline ran a command that the current factory no longer executes.

A composed run is identified by `run.qualification`.
For those runs only, the profile also hashes `qualified-execution.mjs` and the qualifier modules (`qualification.mjs`, `qualification-artifacts.mjs`, `qualification-source.mjs`, `qualification-selection.mjs`, `qualification-scope.mjs`, `qualification-reporting.mjs`, `qualification-reporter.mjs`).
Legacy admission-only and executor profiles do not include these names.
If a composed module is missing, the profile cannot be computed and admission blocks before any gate effect.

## Evidence

The controlled consumer `tests/fixtures/vitest-baseline-cli.mjs` is inlined into the disposable vitest package.
It parses argv like the retained CLI contract: it rejects options outside its table and resolves serial files to one worker.
It is a controlled model of the retained sources, not the Vitest distribution.

- Red: with the old argv, the executed consumer reported ``CACError: Unknown option `--minWorkers` `` and admission blocked with `BASELINE_VITEST_FAILED`.
- Green: admission succeeds and the consumer reports `{ watch: false, fileParallelism: false, maxWorkers: 1 }`.
- `tests/phase-1/admission-profile.test.mjs` covers the composed profile. At this base `qualified-execution.mjs` is absent, so it checks the fail-closed branch. A temporary placeholder probe exercised the present branch; it was removed and not committed.

## Limits

Admission still judges the baseline by exit status. It does not read a structured report of the resolved configuration.
No real Vitest package was downloaded or executed.
Live distribution compatibility remains a separate acceptance gate.
