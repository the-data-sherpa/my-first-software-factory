# Ticket #4: exact-source workspace admission

## Status

This slice implements `src/workspace.mjs` and its disposable-repository verification.
It starts from baseline `9ed9439`.
The initial module checkout left application and CLI integration to the parent implementation.
The parent integration described below adds those acceptance cases.

No production-model request, Vanguard read, package download, publication, or draft commit occurred.
The initial module checkout left the application, execution, storage, CLI, package files, and Phase 0 probes unchanged.

## Public contract

Import these functions from `src/workspace.mjs`:

```js
const intent = await admitWorkspace({
  stateDir,                         // Existing private factory state root, outside Git repositories.
  project: { id, repositoryPath },  // Trusted application configuration, never model input.
  runId,                           // Stable application run identity.
  signal,                          // Optional trusted AbortSignal.
});

// Persist intent unchanged in the factory run record BEFORE this call.
const receipt = await prepareWorkspace(intent, { signal });

// Passive lookup: no Git process, worktree creation, source admission, or execution scheduling.
const workspace = await inspectWorkspace(intent);

// Store/display this value instead of raw exceptions, stderr, paths from errors, or stacks.
const failure = serializeWorkspaceError(error);
```

The module exports `WorkspaceError`, which extends the existing `FactoryError`.
Errors contain fixed codes and messages.
`JSON.stringify(error)` and `serializeWorkspaceError(error)` produce `{ code, message }` for module errors.
Unknown errors become `WORKSPACE_FAILED` without their original messages.

Project and run IDs accept 1–128 ASCII letters, digits, underscores, and hyphens.
The first character must be a letter or digit.
The application still owns Phase 1's single-project restriction and single-owner lock.
Do not invoke preparation concurrently or allow tools during preparation.

### Admission intent

`admitWorkspace` resolves the exact local `refs/heads/main` object without consulting remote refs.
It reads committed objects, not checkout files or the index.
It returns JSON with these fields:

- `version`, `id`: format version and SHA-256 identity of the returned intent body.
- `projectId`, `runId`, `repositoryPath`, `stateDir`: ownership and canonical paths.
- `baseRef`, `baseCommit`: the selected local ref and exact SHA-1 commit.
- `branch`, `worktree`, `gitCommonDirectory`: predetermined private destinations.
- `sourceManifest`: the committed-source receipt described below.

Admission creates no retained run workspace, branch, or source artifact.
Its temporary Git reader contains only adapter metadata and has no checkout.
The adapter removes that temporary directory after ordinary completion or failure.
A process kill can leave this owner-only temporary directory behind.

Persist the returned JSON without changing its fields or property ordering.
JSON serialization and parsing preserve the contract.
A stable request retry must reuse this saved intent, not call admission again.
A later `main` commit does not change the saved base.

### Source manifest

The manifest contains `version`, `objectFormat`, `materialization`, `baseCommit`, `tree`, `entries`, and `id`.
`objectFormat` is `sha1` and `materialization` is `raw-blobs`.
Its `id` hashes the manifest body with SHA-256.

Each file entry records:

- `path`: a validated UTF-8 repository-relative path.
- `mode`: Git's `100644` or `100755`, including executable identity.
- `objectId`: the committed blob object ID.
- `bytes`: the blob length.
- `sha256`: the digest of its exact committed bytes.

The reader checks Git object hashes against the returned bytes.
Preparation reads the saved commit again and checks the manifest identity before importing objects.
Dirty checkout files, dirty lockfiles, untracked files, replace refs, and checkout filters cannot change this receipt.
Both tracked lockfiles retain their committed bytes in the worktree and their existing bytes in the owner checkout.

### Prepared receipt and passive inspection

`prepareWorkspace` returns a stable JSON receipt with `status: 'prepared'`.
It records the intent, project, run, base, branch, worktree, manifest identity, and private Git metadata paths.
It also returns:

```js
{
  toolAccess: {
    sourceRoot: receipt.worktree,
    excludedPaths: ['.git'],
    requiresVerifiedContainment: true,
  },
}
```

This descriptor is a containment requirement, not permission to enable tools.
A successful repeat returns the same receipt without rereading the owner repository or resetting draft files.
The receipt proves initial preparation, not the content or verification status of a later draft.

`inspectWorkspace` returns one of:

- `{ status: 'not-prepared', intentId }`: no owned workspace artifact exists.
- `{ status: 'preparing', intentId, retained: true }`: owned preparation artifacts exist without a completed receipt.
- The prepared receipt.

Inspection throws a sanitized error for conflicting ownership, redirects, or invalid retained metadata.
It does not repair artifacts or create a receipt.
The application must combine this artifact state with its recorded failed, stopped, or interrupted outcome.

## Persistence and application integration

Hold the application's lifetime owner lock throughout admission and preparation.
Keep repository tools disabled until all later gates pass.

1. Save the run identity, immutable brief, original deadline, counters, and active-run reservation.
2. Call `admitWorkspace` with the configured project and saved run ID.
3. Save the entire intent in the factory record before calling `prepareWorkspace`.
4. Call `prepareWorkspace` with the run's trusted cancellation signal.
5. Save its receipt before starting execution, dependency preparation, or contained tools.
6. If either call fails, save the sanitized error and the appropriate terminal outcome.
7. On inspection or backend reopen, use passive inspection only.
8. On explicit retry, reuse the saved intent and original limits under the owner lock.

An application crash between steps 4 and 5 can leave a complete receipt without the factory-record update.
Passive inspection can discover it without repeating preparation.
If no intent survived admission, do not invent the previous source identity or claim preparation completed.

Forward shutdown, stop, and original-deadline cancellation to the module.
Await preparation settlement before releasing application ownership.
Cancellation kills and drains the active trusted Git child and stops further preparation steps.
It does not remove retained workspace artifacts.

The parent integration below covers saved source identity, source failures, interrupted preparation, stable admission retries, and passive reopen.
Legacy controlled-execution fixtures must not implicitly select the real Vanguard checkout.
Use explicitly configured disposable repositories for these integration cases.

## Private layout and containment handoff

```text
<state>/runs/<run>/
  <existing execution-store files>
  .workspace-write-*                 # Possible interrupted intent-write evidence.
  workspace/
    intent.json                     # Immutable ownership, outside source.
    control/
      repository.git/               # Independent private shallow Git object/ref store.
        worktrees/source/           # Native linked-worktree administration and index.
      *-request.json                # Recorded trusted Git transaction intents.
      prepared.json                 # Completed preparation receipt.
      retained/                     # Archived interrupted native metadata/lock evidence.
      .workspace-write-*            # Possible interrupted source-write evidence.
    source/
      .git                          # Native pointer: MUST be inaccessible to tools.
      <exact committed files>
```

The private repository holds the exact base commit, its trees, and its blobs.
Its shallow boundary excludes parent history.
`git update-ref` creates the private branch.
`git worktree add --no-checkout --lock` creates a real linked worktree.
The owner repository gains no branch, worktree registration, alternate, or hardlink.
No `clone`, `fetch`, `pull`, `dev` branch, Worktrunk, commit creation, or publication occurs.

The backend owns all metadata and ownership records.
Ticket #3 must expose only `source` and must hide its `.git` pointer from every file tool and check process.
It must also deny metadata-shaped paths created after preparation, symlink escapes, parent traversal, and access to sibling control paths.
Never mount the run directory or private Git store into a check sandbox.
Filesystem permissions alone do not protect metadata from same-UID agent code.
The containment integration must verify these exclusions before granting tool authority.

The `source` and `control` directories are siblings deliberately.
Do not weaken `privateDirectory` or call it on the Git worktree itself.
The existing run/execution storage stays outside any ancestor containing `.git`.

## Git safety and supported source features

Preparation never points Git at the owner's Git directory or reads the owner's config.
A temporary trusted Git directory reads only the validated owner object database.
The reader handles loose and packed refs/objects and disables replace refs.
It rejects object alternates, promisor markers, redirected metadata, and special filesystem nodes.

Git runs through direct argv using `/usr/bin/git` and a fixed environment.
The environment excludes inherited Git options, credentials, user config, and system config.
Hooks, fsmonitor, lazy fetch, protocols, automatic maintenance, and automatic garbage collection are disabled.
No Git checkout or filter command materializes files.
The backend writes verified raw blobs atomically and uses `read-tree` only to construct the index.
Attributes remain source bytes but do not invoke filters, EOL conversion, encodings, or LFS during preparation.

This slice supports primary, non-bare SHA-1 repositories with ordinary committed files and executable files.
It blocks these unsupported features rather than attempting automatic preparation:

- Linked owner worktrees or a redirected `.git` file/directory.
- SHA-256 refs, symbolic `main` refs, missing objects, alternates, and partial-clone promisor markers.
- Symlinks, gitlinks, `.gitmodules`, and LFS pointer content.
- Metadata-shaped, escaping, control-character, bidirectional-control, non-UTF-8, or case-colliding paths.

Limits are 20,000 tree entries, 16 MiB per object, and 128 MiB of materialized file content.
The size limit counts duplicate blobs at every destination path.
Git output also has a 128 MiB limit and each Git command has a 30-second deadline.
The application still owns the original total run deadline and OS resource envelope.
These limits are not a sandbox or a guarantee against Git parser vulnerabilities.

## Retry and retention behavior

The module writes ownership before any retained Git or source effect.
It installs its own complete files atomically, with unfinished write evidence outside the source directory.
Preparation completes missing native registration files only for the recorded creation request.
It archives truncated expected native metadata before completing it.
It archives stale locks only for a recorded transaction.
It never adopts conflicting complete metadata, foreign ownership, redirected paths, or conflicting source bytes.

A prepared receipt ends source reconciliation.
Later retries never reset, overwrite, delete, or rehash a draft as though it were the original source.
No cleanup API exists in this slice.
Explicit operator cleanup must own the run and remove only that run's retained resources.

## Verification and remaining gaps

The workspace suite covers 28 cases through the assigned workspace-admission interface and disposable Git repositories.
Coverage includes exact bases, dirty lockfiles, advancing `main`, packed objects, binary receipts, executable modes, and owner replacement refs.
It also covers stable receipts, cancellation, missing/truncated registration, conflicting ownership, malicious Git settings, unsafe paths, and retained failures.
A separate process receives SIGKILL during blob materialization, then explicit preparation resumes from the saved intent.
The index-cancellation and process-death cases also passed ten repeated runs.
These are process-crash checks, not host/power-failure guarantees.

The full suite passed **65/65** under Node 24.21.0: 11 Phase 0 and 54 Phase 1 tests.
JavaScript syntax checks and `git diff --check` also passed.
Dependencies and package files remain unchanged.

The final verification command is:

```sh
PATH=/home/cowen/.local/share/mise/installs/node/24.21.0/bin:$PATH npm test
```

The original isolated checkout did not verify application/CLI source visibility or containment integration.
The parent integration below supplies those checks.
No real Vanguard compatibility or toolchain check has run.
The conservative unsupported-feature checks may block an actual repository until the operator addresses the reported preparation failure.

Workspace identities and native Git pointers contain absolute private paths.
The existing factory backup/restore path has no workspace relocation support in this slice.
Do not advertise a copied backup as a resumable workspace without explicit relocation validation and application tests.
The module assumes trusted private-state ownership, a local filesystem, and the application's single-writer lock.
It does not defend against a separate host process with the same UID racing private metadata writes.

## Parent integration

`serve --prepare-workspace` installs the trusted workspace adapter. Without this option, legacy fixture runs do not access a repository.
The factory saves the run before admission, the immutable intent before preparation, and the prepared receipt before executor dispatch.
Without an executor, it retains the prepared workspace and reports `blocked / MODEL_NOT_READY` with zero model attempts.
Inspection shows source identity and sanitized preparation failures through the application and CLI.

Stop, shutdown, and deadline signals reach preparation. The factory retains ownership until preparation drains.
After process death, inspection discovers completed workspace receipts without repairing artifacts or creating an execution input.
Completed workspace-only preparation can be stopped or explicitly replaced using its verified quiescence and no-execution admission.
Incomplete crashed preparation remains fenced until trusted reconciliation establishes quiescence.
No operator flag overrides that block.

The application tests exercise intent/receipt persistence ordering, dirty-checkout preservation, duplicate admission, source failures, cancellation, and both preparation crash windows.
CLI tests exercise exact-source visibility, production blocking, idempotency, missing-source failures, and offline inspection.
The contained integration exercises a native workspace with hidden `.git` and sibling control metadata, budgeted reads/writes/checks, and draining stop.

Archive manifests identify workspaces that require relocation. Restore checks the actual records and rejects those archives before creating a destination.
The original private workspace remains usable. Fixture-only backup/restore remains supported.
This explicit refusal prevents a copied archive from silently referring back to the original workspace.
