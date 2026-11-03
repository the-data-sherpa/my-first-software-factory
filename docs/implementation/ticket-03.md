# Ticket 03: contained file tools and checks

## Status

The containment layer is implemented from baseline `9ed9439`.
The tests use disposable fixtures, the actual foreground launcher, bubblewrap, and kernel resource controls.
They do not use a substitute sandbox or skip unsupported enforcement.

Production repository checks remain blocked pending ticket #6's private dependency bundle and toolchain verification.
No Vanguard file, host model credential, or host model configuration was read.
No Vanguard check, production model request, package download, publication, or installed service was used.

The shared execution, factory, storage, workspace, CLI, package, and design files are unchanged.
The parent must connect this module to the execution interface after integration with #2 and #4.

## Public interface

`src/containment.mjs` exports:

- `CONTAINMENT_LIMITS`: the accepted numerical profile, frozen at module load.
- `ContainmentError`: an error with a stable `code` and a message.
- `verifyContainmentEnvelope()`: inspect the current kernel cgroup and transient user scope. Caller arguments cannot grant permission.
- `createContainedExecution({ worktree, receiptDirectory, signal, protectedPaths })`: create a verified, production-mode execution interface.
- `inspectContainedChecks(receiptDirectory)`: inspect private receipts without launching processes, checking resources, writing files, or replaying work.
- `createContainmentFixture(options)`: run fixed diagnostics against a disposable `/tmp/factory-containment-*/work` directory. Do not expose this export to the agent.

`worktree` and `receiptDirectory` must be absolute, canonical, existing, owned directories without symlink ancestors.
The receipt directory must have owner-only permissions and must be separate from the worktree.
The trusted application supplies these paths. The agent never selects them.

The returned execution interface has these methods:

```js
const tools = await createContainedExecution({
  worktree: admittedWorktreePath,
  receiptDirectory: privateRunCheckDirectory,
  signal: runAbortController.signal,
  protectedPaths: ['relative-ownership-record'],
});

await tools.read('src/example.ts', { offset: 0, length: 16384 });
await tools.write('src/example.ts', replacementText);
await tools.check('vitest', { signal: checkAbortController.signal });
await tools.close();
```

`read` uses byte offsets and returns `{ path, text, bytes, offset, nextOffset }`.
Use the returned `nextOffset` for pagination. `null` means EOF.
Page sizes range from 4 to 16,384 bytes. Reads reject invalid UTF-8 and avoid splitting a character between pages.

`write` replaces or creates one regular file in an existing directory.
It accepts at most 65,536 UTF-8 bytes and returns `{ path, bytesWritten }`.
It does not create parent directories, follow links, or change ownership metadata.
A crash can leave a partial draft write. Recovery must review that effect, not repeat the write automatically.

`check` accepts a fixed name and an optional cancellation signal. It rejects command strings, argv, environment overrides, and other options.
Production recognizes `boundary`, `vitest`, and `lint`.
`boundary` runs the factory-owned diagnostic, not repository code.
`vitest` and `lint` return `DEPENDENCIES_NOT_PREPARED` until the private bundle integration exists.
An alleged preparation or verification receipt does not remove that block.

Every current check receipt has `kind: diagnostic` and `reviewReady: false`.
A successful boundary diagnostic is not a passing maintenance check or a ready work item.

## Integration with #2 and #4

1. Re-export the production API from the factory-owned execution module.
2. Hold #2's factory lifetime ownership lock before creating an execution interface.
3. Admit exactly one run and one execution interface for its worktree.
4. Get the worktree path from #4's verified ownership record, not from a model argument or source file.
5. Keep #4's ownership records outside the mounted source tree where possible.
6. Supply all remaining relative ownership paths through `protectedPaths`.
7. Create an owner-only receipt directory inside the run's private retained state, outside its worktree.
8. Pass the run cancellation signal to the constructor.
9. Charge cumulative tool budgets before dispatching the bounded methods.
10. On stop or shutdown, cancel the model request and abort the run signal.
11. Await `tools.close()` before releasing run or backend ownership.
12. During crash inspection, call only `inspectContainedChecks()` after fencing the closed backend.

Repeated `close()` calls share the same draining promise.
The method waits for the child to exit and for receipt handling before closing directory handles.
The module rejects overlapping checks within one backend. The factory ownership lock must exclude another backend process.

A missing terminal receipt means interruption, not success and not permission to retry.
Explicit resume must create a new execution interface and repeat its live verification.
This module does not replenish run budgets, enable a scheduler, or replay a file write or check.

Ticket #6 must add only fixed Vitest/lint argv and verified read-only bundle mounts.
It must preserve two-worker Vitest limits and prove the real toolchain works in this boundary.
It must not add caller-selected executables, arbitrary mounts, shell execution, installs, or trusted preparation flags supplied by the agent.

Ticket #9 must bind a run's private receipts to the tested snapshot digest and the final draft.
Do not qualify a work item from a model-supplied receipt object or from a diagnostic result.

## Foreground resource envelope

Start the backend explicitly with the selected runtime:

```sh
/home/cowen/.local/share/mise/installs/node/24.21.0/bin/node \
  bin/factory-contained.mjs serve [factory options]
```

The launcher creates a uniquely named foreground transient user-systemd scope.
It sets 4 GiB memory, zero swap, 256 tasks, and `OOMPolicy=kill`.
It installs no service or startup configuration.
The existing backend CLI still validates its own arguments.

Before file operations and each check, the module verifies the live scope and kernel values.
It requires a transient scope with matching `ControlGroup`, `MemoryMax`, `MemorySwapMax`, `TasksMax`, and `OOMPolicy` properties.
It also checks `memory.max`, `memory.swap.max`, `pids.max`, and `memory.oom.group`.
A renamed scope, unsupported control, wrong value, or unavailable user manager blocks execution.
A caller-provided verification object cannot substitute for these observations.

The backend spawns `/usr/bin/bwrap` directly with argv and an empty environment.
No shell, SDK shell adapter, or systemd wrapper sits between Node and bubblewrap.
The runner observes the actual child's parent PID, start time, and cgroup before releasing its startup pipe.
Bubblewrap uses parent-death termination, a PID namespace, and a new session.

An OOM can kill the entire backend scope.
The implementation does not promise a graceful stopped result after OOM.
It retains start receipts and source snapshots for passive interrupted recovery.

## Filesystem and network boundary

Checks receive a read-only source snapshot, not a writable host worktree mount.
Bounded file tools provide draft writes separately through pinned directory descriptors.
This avoids an unbounded host-disk write surface in repository checks.

The snapshot excludes `.git`, `node_modules`, `.factory*`, `.ownership*`, `ownership.json`, `.env` files, and caller-protected ownership paths.
The same paths are unavailable to file tools.
All path components reject traversal and symlinks.
Files must be regular, owned, singly linked, and not group- or world-writable.
Directories must be owned and not group- or world-writable.
Root replacement also blocks subsequent operations.

Snapshots have conservative admission bounds: 20,000 entries, 8 MiB per file, and 128 MiB total source bytes.
Repositories outside those bounds block. These bounds are not claims about Vanguard compatibility.

Only the selected Node executable, required dynamic libraries, and the factory-owned diagnostic are mounted read-only.
There is no host home, credential directory, backend socket directory, other project, other run, or host cgroup mount.
The root, source, runtime, libraries, `/proc`, and `/dev` are read-only.
This includes `/dev/shm`.
The only regular writable check filesystem is the 256 MiB scratch tmpfs at `/tmp`.

The child environment contains only `HOME`, `LANG`, `NODE_ENV`, `PATH`, `PWD`, `TMPDIR`, and `UV_THREADPOOL_SIZE`.
No model credential, proxy, SSH socket, loader option, or host home environment is inherited.

Separate network and PID namespaces hide host endpoints and processes.
A Linux x86-64 seccomp filter denies socket creation, connection, listening, and related network operations.
It also denies io_uring, host process inspection syscalls, keyring access, and selected namespace/mount operations.
Private IPC socketpairs remain possible. They do not expose host sockets.
Other syscall ABIs fail closed.

Runtime verification creates its own host-loopback TCP/UDP and Unix socket controls.
The trusted, read-only diagnostic attempts those endpoints inside the actual sandbox.
It also verifies private-path absence, environment keys, read-only mounts, scratch size, seccomp, and no-new-privileges.
These results come from factory code outside the editable source snapshot.
The runner retains them in the private receipt directory.

## Results and retention

A check has a 120-second command deadline.
Combined stdout and stderr have one 1,048,576-byte retained limit.
Overflow kills the check and records `output-limit`, even if the process otherwise exits successfully.
There is no silent truncation followed by a passing result.

Nonzero exits, signals, aborts, timeouts, resource events, and launcher failures never pass.
A signal inside bubblewrap can appear as a nonzero encoded exit status rather than a host `exitSignal`.
Both forms fail.

Each check retains a private directory containing:

- `source/`: the exact read-only source snapshot used by the check.
- `started.json`: the source digest, profile, backend identity, and start time.
- `launch.json`: the observed direct child identity and cgroup.
- `output.log`: bounded combined output, written as it arrives.
- `result.json`: the terminal result, if the backend survived to record one.
- The fixed filter, diagnostic input, and private sentinel used for verification.

Receipt writes use a synchronized pending file and an atomic rename.
A crash before the rename leaves no complete terminal receipt.
Logs can retain partial output after process death.
These are process-crash guarantees, not host power-loss guarantees.

Normal completion, abort, timeout, or parent death releases the sandbox processes and tmpfs mounts.
Private source snapshots, drafts, receipts, and logs remain until explicit owner cleanup.
The test suite removes only its own disposable fixtures and transient scopes.

## Verification record

Under installed Node 24.21.0:

```sh
PATH=/home/cowen/.local/share/mise/installs/node/24.21.0/bin:$PATH npm test
```

The suite passed **47/47**, including all **11 Phase 0 tests** and **10 containment tests**.
No containment test was skipped.
Dependencies came from the permitted untracked `node_modules` symlink. No package graph changed.

Verified through the execution interface and actual launcher:

- Exact accepted memory, swap, task, scratch, output, read/write, and deadline configuration.
- Live rejection after changing the disposable scope's task limit.
- Private-path, Git/ownership metadata, environment, read-only filesystem, and controlled network boundaries.
- Traversal, directory symlink, file symlink, hardlink, root-redirection, and unsafe-snapshot rejection.
- Fixed check selection and refusal of arbitrary argv or alleged dependency preparation.
- UTF-8 pagination, exact 64 KiB writes, and oversized-write rejection.
- Source digest changes after an untracked draft file appears.
- Nonzero exit, signal, combined output overflow, abort, and close handling.
- One check at a time and rejection after closure.
- Cleanup of detached sessions and grandchildren after normal completion, abort, close, timeout, and backend SIGKILL.
- Passive inspection after SIGKILL and scoped OOM, without a new terminal result or replay.

Destructive checks use a separate **192 MiB, zero-swap, 48-task** transient scope.
Its scratch tmpfs is **1 MiB** and its check deadline is **2 seconds**.
The tests triggered task exhaustion, scratch `ENOSPC`, timeout, and an actual scope OOM.
The user manager reported `Result=oom-kill`, and the backend died.
The tests then removed only that failed transient scope.

The tests do **not** allocate 4 GiB, create 256 tasks, fill the accepted 256 MiB scratch, or wait 120 seconds.
They verify the accepted configuration separately from lower-limit destructive checks through the same enforcement paths.
No host-wide stress or public-IP probe was used.

A separate retained diagnostic run covers all eight scenarios, including SIGKILL and OOM.
Its owner-only manifest is `/tmp/factory-containment-evidence-AdjrCt/manifest.json`.
Each listed directory contains `diagnostic-result.json` and the launcher's private receipts.
All associated processes and transient scopes stopped. The controlled artifacts remain for inspection and explicit cleanup.

JavaScript syntax checks and `git diff --check` passed.

## Host restrictions and remaining gates

This implementation supports Linux x86-64, cgroup v2, a working user-systemd manager, and Node 24.21.0.
It requires bubblewrap's strict namespace, user-namespace-disable, seccomp, startup-pipe, and size-limited tmpfs features.
The verified host has bubblewrap 0.13.1 and systemd 262.
Other platforms and missing controls block rather than weaken enforcement.

This is not a VM boundary or a defense against a compromised kernel or a hostile same-UID host operator.
The factory code, launcher, system toolchain, and ownership records are trusted host inputs.
The agent controls source text, not those inputs or retained receipts.

Real Bun/Vitest/lint compatibility, private dependency preparation, model admission, and Vanguard execution remain unverified and blocked.
Parent integration with #2 and #4 is still required.
The implementation does not claim completion of the real Phase 1 maintenance run.
