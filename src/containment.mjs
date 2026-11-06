import { readFile, open, mkdir, realpath, lstat, readdir, rename } from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { privateRoot, withFile, snapshot } from './containment-files.mjs';
import { containmentFilter } from './containment-filter.mjs';
import { hostProbes } from './containment-host-probes.mjs';
import { DIAGNOSTIC_LIMITS } from './containment-test-profile.mjs';
import { promisify } from 'node:util';
import { dependencyMount } from './dependencies.mjs';
import { namespaceLifetime, namespaceFenced, processIdentity as identity } from './containment-namespace.mjs';
import { snapshotQualificationSource } from './qualification-source.mjs';
import { selectedTest } from './qualification-selection.mjs';
import { reportOperations, reportFiles, filesDigest } from './qualification-reporting.mjs';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
export const CONTAINMENT_LIMITS = Object.freeze({
  memoryBytes: 4 * 1024 ** 3, swapBytes: 0, tasks: 256,
  checkMs: 120_000, scratchBytes: 256 * 1024 ** 2,
  outputBytes: 1024 ** 2, writeBytes: 64 * 1024, readBytes: 16 * 1024,
});
export class ContainmentError extends Error {
  constructor(code, message) { super(message); this.name = 'ContainmentError'; this.code = code; }
}
const fail = (code, message) => { throw new ContainmentError(code, message); };
let activeCheck = false; // One backend owns execution; the factory lifetime lock fences other processes.
const managerEnv = () => ({ PATH: '/usr/bin', XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`,
  DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus` });

/** Kernel/manager observations, never a caller-supplied permission or persisted attestation. */
export async function verifyContainmentEnvelope() {
  return inspectEnvelope(CONTAINMENT_LIMITS, false);
}
async function fixtureEnvelope() {
  const testScope = (await readFile('/proc/self/cgroup', 'utf8')).includes('/factory-contained-test-');
  return inspectEnvelope(testScope ? DIAGNOSTIC_LIMITS : CONTAINMENT_LIMITS, testScope);
}
async function inspectEnvelope(limits, diagnostic) {
  try {
    if (namespaceFenced() || process.platform !== 'linux' || process.arch !== 'x64' || process.versions.node !== '24.21.0') throw new Error();
    const path = (await readFile('/proc/self/cgroup', 'utf8')).trim().match(/^0::(\/[^\n]+)$/)?.[1];
    const unit = path && basename(path);
    if (!(diagnostic ? /^factory-contained-test-[a-f0-9-]+\.scope$/ : /^factory-contained-[a-f0-9-]+\.scope$/).test(unit ?? '')) throw new Error();
    const { stdout } = await exec('/usr/bin/systemctl', ['--user', 'show', unit,
      '--property=Transient,ControlGroup,MemoryMax,MemorySwapMax,TasksMax,OOMPolicy'], { env: managerEnv(), timeout: 5000, maxBuffer: 8192 });
    const properties = Object.fromEntries(stdout.trim().split('\n').map((line) => line.split('=')));
    if (properties.Transient !== 'yes' || properties.ControlGroup !== path || properties.OOMPolicy !== 'kill') throw new Error();
    const directory = join('/sys/fs/cgroup', path);
    for (const [file, value, property] of [
      ['memory.max', limits.memoryBytes, 'MemoryMax'],
      ['memory.swap.max', 0, 'MemorySwapMax'], ['pids.max', limits.tasks, 'TasksMax'],
    ]) {
      if ((await readFile(join(directory, file), 'utf8')).trim() !== String(value) || properties[property] !== String(value)) throw new Error();
    }
    if ((await readFile(join(directory, 'memory.oom.group'), 'utf8')).trim() !== '1') throw new Error();
    return Object.freeze({ unit, cgroup: path, memoryBytes: limits.memoryBytes, swapBytes: 0, tasks: limits.tasks, diagnostic });
  } catch {
    fail('CONTAINMENT_REQUIRED', 'Repository tools require the verified foreground factory scope; no fallback is available.');
  }
}

async function resourceEvents(envelope) {
  const read = async (file) => Object.fromEntries((await readFile(`/sys/fs/cgroup${envelope.cgroup}/${file}`, 'utf8')).trim().split('\n').map((line) => {
    const [key, value] = line.split(' '); return [key, Number(value)];
  }));
  const pids = await read('pids.events'); const memory = await read('memory.events');
  return { pidsMax: pids.max, oomKill: memory.oom_kill, memoryMax: memory.max };
}
const inside = (parent, child) => { const path = relative(parent, child); return !path || (!path.startsWith('../') && path !== '..' && !path.startsWith('/')); };
const helperPath = fileURLToPath(new URL('./containment-probe.mjs', import.meta.url));
const libraries = ['libdl.so.2', 'libstdc++.so.6', 'libm.so.6', 'libgcc_s.so.1', 'libpthread.so.0', 'libc.so.6', 'ld-linux-x86-64.so.2'];
async function durableFile(path, data) {
  const pending = `${path}.pending`;
  const handle = await open(pending, 'wx', 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  await rename(pending, path); // A process crash exposes either a complete receipt or no receipt.
}

/**
 * Trusted host interface, not a model tool schema. No command, argv, env, executable,
 * sandbox flags, receipt, or limits are accepted from a caller. Repository checks
 * require a process-local dependency handle, revalidated before every read-only mount.
 */
export async function createContainedExecution(options) {
  return createExecution(options, false);
}

/** Passive inspection only. The factory must hold ownership or fence a closed backend first. */
export async function inspectContainedChecks(receiptDirectory) {
  const root = await privateRoot(receiptDirectory);
  try {
    if ((await root.stat()).mode & 0o077) fail('PRIVATE_STORAGE_REQUIRED', 'Receipts require an owner-only directory.');
    const results = [];
    const json = async (path) => {
      try {
        return await withFile(root, path, [], false, async (file) => {
          if ((await file.stat()).size > 65536) fail('INVALID_RECEIPT', 'The private receipt is invalid.');
          return JSON.parse(await file.readFile('utf8'));
        });
      } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    };
    for (const id of (await readdir(`/proc/self/fd/${root.fd}`)).sort()) {
      if (!/^check-[a-f0-9-]{36}$/.test(id)) fail('INVALID_RECEIPT', 'Unexpected private receipt entry.');
      const start = await json(`${id}/started.json`);
      const result = await json(`${id}/result.json`);
      if ((start && start.id !== id) || (result && (!start || result.id !== id || result.sourceDigest !== start.sourceDigest))) {
        fail('INVALID_RECEIPT', 'A private receipt identity does not match its start record.');
      }
      results.push(result ? { ...result, status: 'settled' }
        : { ...start, id, status: 'interrupted', passed: false, reviewReady: false });
    }
    return results;
  } finally { await root.close(); }
}

/** Controlled diagnostics only: cannot target a production worktree or accept code/argv. */
export async function createContainmentFixture(options) {
  if (!/^\/tmp\/factory-containment-[A-Za-z0-9]+\/work$/.test(options.worktree)) {
    fail('FIXTURE_ONLY', 'Diagnostics require a disposable factory-containment fixture.');
  }
  return createExecution(options, true);
}

async function createExecution({ worktree, receiptDirectory, signal, protectedPaths = [], dependencyBundle, verificationSource }, fixture) {
  const verifyEnvelope = fixture ? fixtureEnvelope : verifyContainmentEnvelope;
  const envelope = await verifyEnvelope();
  const limits = envelope.diagnostic ? DIAGNOSTIC_LIMITS : CONTAINMENT_LIMITS;
  if (inside(worktree, receiptDirectory) || inside(receiptDirectory, worktree)) fail('UNSAFE_PATH', 'Keep receipts separate from the worktree.');
  if (!Array.isArray(protectedPaths) || protectedPaths.some((path) => typeof path !== 'string' || !path || path.startsWith('/'))) fail('UNSAFE_PATH', 'Invalid protected paths.');
  protectedPaths = [...protectedPaths];
  const root = await privateRoot(worktree);
  let retained;
  try {
    retained = await privateRoot(receiptDirectory);
    if ((await retained.stat()).mode & 0o077) fail('PRIVATE_STORAGE_REQUIRED', 'Receipts require an owner-only directory.');
  } catch (error) { await root.close(); await retained?.close(); throw error; }
  const retainedPath = `/proc/self/fd/${retained.fd}`;
  const rootIdentity = await root.stat();
  const retainedIdentity = await retained.stat();
  let closed = false; let busy = false; let current; let closing;
  async function unchangedRoots() {
    for (const [path, original] of [[worktree, rootIdentity], [receiptDirectory, retainedIdentity]]) {
      const now = await lstat(path);
      if (!now.isDirectory() || now.dev !== original.dev || now.ino !== original.ino) fail('UNSAFE_PATH', 'A retained root was replaced; execution is blocked.');
    }
  }
  const shutdown = new AbortController();
  const combined = (other) => AbortSignal.any([shutdown.signal, signal, other].filter(Boolean));
  function available() {
    if (closed) fail('CONTAINMENT_CLOSED', 'Execution is closed.');
    if (busy) fail('EXECUTION_BUSY', 'Another operation owns this worktree.');
    if (combined().aborted) fail('ABORTED', 'Execution was cancelled.');
  }

  async function run(name, { signal: checkSignal } = {}) {
    available();
    if (combined(checkSignal).aborted) fail('ABORTED', 'The check was cancelled before launch.');
    if (activeCheck) fail('CHECK_BUSY', 'Only one contained check can run at once.');
    if (!['boundary', ...(dependencyBundle ? ['vitest', 'lint', ...(verificationSource ? reportOperations : [])] : []), ...(fixture ? ['pass', 'fail', 'signal', 'output', 'hang', 'descendants', 'startup-stop', ...(envelope.diagnostic ? ['pids', 'scratch', 'memory'] : [])] : [])].includes(name)) {
      if (name === 'vitest' || name === 'lint') fail('DEPENDENCIES_NOT_PREPARED', 'Prepare and verify the private read-only dependency/toolchain bundle before repository checks.');
      fail('CHECK_NOT_ALLOWED', 'Choose a factory-defined check; arbitrary commands and arguments are not accepted.');
    }
    busy = true; activeCheck = true;
    const operation = (async () => {
      await unchangedRoots();
      let probes; let filter; let log; let child; let lifetime; let timer; let reason;
      const abortSignal = combined(checkSignal);
      const stop = (why) => { reason ??= why; lifetime?.stop(); };
      const abort = () => stop('aborted');
      try {
        const id = `check-${randomUUID()}`;
        const directory = `${retainedPath}/${id}`;
        await mkdir(directory, { mode: 0o700 });
        const observedEnvelope = await verifyEnvelope();
        const bundle = dependencyBundle ? await dependencyMount(dependencyBundle, worktree) : undefined;
        const sourceDigest = verificationSource
          ? await snapshotQualificationSource(verificationSource, worktree, `${directory}/source`)
          : await snapshot(root, `${directory}/source`, protectedPaths);
        const adapters = reportFiles(name, selectedTest);
        const selectionDigest = adapters ? filesDigest(adapters) : undefined;
        const reportBinding = adapters ? { id, operation: name, sourceDigest, dependencyIntentId: bundle.intentId, selectionDigest } : undefined;
        if (adapters) {
          for (const [file, content] of Object.entries(adapters)) await durableFile(`${directory}/${file}`, content);
          await durableFile(`${directory}/binding.json`, JSON.stringify(reportBinding));
        }
        if (bundle) await mkdir(`${directory}/source/node_modules`, { mode: 0o700 });
        await durableFile(`${directory}/filter.bpf`, containmentFilter());
        const mountDirectory = await realpath(directory);
        probes = name === 'boundary' ? await hostProbes(`/proc/${process.pid}/fd/${retained.fd}/${id}`) : undefined;
        await durableFile(`${directory}/input.json`, JSON.stringify({ ...probes?.input, scratchBytes: limits.scratchBytes, dependencyBundle: Boolean(bundle) }));
        const started = { id, kind: ['vitest', 'lint', ...reportOperations].includes(name) ? 'repository' : 'diagnostic', name, backendPid: process.pid, sourceDigest, selectionDigest, reportBinding,
          dependencyIntentId: bundle?.intentId,
          startedAt: new Date().toISOString(), envelope: observedEnvelope, limits };
        await durableFile(`${directory}/started.json`, JSON.stringify(started));
        filter = await open(`${directory}/filter.bpf`, 'r');
        log = await open(`${directory}/output.log`, 'wx', 0o600);
        const args = ['--unshare-user', '--unshare-pid', '--unshare-net', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup',
          '--disable-userns', '--assert-userns-disabled', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv',
          '--setenv', 'PATH', '/runtime', '--setenv', 'HOME', '/tmp', '--setenv', 'TMPDIR', '/tmp', '--setenv', 'LANG', 'C.UTF-8',
          '--setenv', 'NODE_ENV', 'test', '--setenv', 'UV_THREADPOOL_SIZE', '2',
          '--ro-bind', await realpath(process.execPath), '/runtime/node'];
        if (adapters) for (const file of [...Object.keys(adapters), 'binding.json']) {
          args.push('--ro-bind', `${mountDirectory}/${file}`, `/verification/${file}`);
        }
        if (envelope.diagnostic) args.push('--ro-bind', '/usr/bin/sleep', '/runtime/sleep');
        for (const library of libraries) args.push('--ro-bind', await realpath(`/usr/lib/${library}`), `/usr/lib/${library}`);
        args.push('--symlink', 'usr/lib', '/lib64', '--symlink', 'usr/lib', '/lib',
          '--ro-bind', `${mountDirectory}/source`, '/work', ...(bundle ? ['--ro-bind', bundle.path, '/work/node_modules'] : []), '--ro-bind', helperPath, '/probe.mjs',
          '--ro-bind', `${mountDirectory}/input.json`, '/input.json', '--proc', '/proc', '--remount-ro', '/proc',
          '--dev', '/dev', '--remount-ro', '/dev', '--size', String(limits.scratchBytes), '--tmpfs', '/tmp',
          '--remount-ro', '/', '--chdir', '/work', '--seccomp', '3', '--block-fd', '4', '--info-fd', '5', '--', '/runtime/node',
          // Qualification pins forks over any repository pool: worker threads would share the report descriptor.
          ...(adapters ? ['/work/node_modules/vitest/vitest.mjs', 'run', '--pool=forks', '--maxWorkers=2', '--no-file-parallelism', '--configLoader=runner', '--no-cache',
            '--no-watch', '--retry=0', '--no-allowOnly', '--no-passWithNoTests',
            ...(adapters['config.mjs'] ? ['--config', '/verification/config.mjs'] : []), '--reporter', '/verification/reporter.mjs']
            : name === 'vitest' ? ['/work/node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=2', '--no-file-parallelism']
            : name === 'lint' ? ['/work/node_modules/eslint/bin/eslint.js', '.', '--no-cache'] : ['/probe.mjs', name]));
        const eventsBefore = await resourceEvents(envelope);
        let launch; let length = 0; let reportLength = 0; const output = []; const reports = [];
        child = spawn('/usr/bin/bwrap', args, { env: {}, stdio: ['ignore', 'pipe', 'pipe', filter.fd, 'pipe', 'pipe', ...(adapters ? ['pipe'] : [])] });
        lifetime = namespaceLifetime(child, envelope, 5, limits.checkMs);
        child.on('error', () => stop('launcher-error'));
        const collect = (data, report = false) => {
          const keep = Math.max(0, Math.min(data.length, limits.outputBytes - length, report ? 256 * 1024 + 8 - reportLength : Infinity));
          if (keep > 0) {
            const retained = data.subarray(0, keep);
            length += keep;
            if (report) { reports.push(retained); reportLength += keep; }
            else {
              output.push(retained);
              try {
                for (let written = 0; written < keep;) written += writeSync(log.fd, retained, written, keep - written);
              } catch { stop('receipt-write'); }
            }
          }
          if (keep < data.length) stop('output-limit');
        };
        child.stdout.on('data', data => collect(data)); child.stderr.on('data', data => collect(data));
        if (adapters) {
          child.stdio[6].on('data', data => collect(data, true));
          child.stdio[6].on('error', () => stop('report-channel'));
        }
        child.stdio[4].on('error', () => stop('launcher-error'));
        timer = setTimeout(() => stop('timeout'), limits.checkMs);
        abortSignal.addEventListener('abort', abort, { once: true });
        if (abortSignal.aborted) abort();
        try {
          launch = await lifetime.verified;
          const { sandbox } = launch;
          await durableFile(`${directory}/launch.json`, JSON.stringify(launch));
          if (fixture && name === 'startup-stop') {
            // Fixed diagnostic fault: freeze this namespace before its parent-death
            // setup can finish. The external test kills the backend or launcher.
            process.kill(sandbox.pid, 'SIGSTOP');
            process.stdout.write(`${JSON.stringify({ envelope, backendIdentity: await identity(process.pid), observed: [await identity(child.pid), sandbox] })}\n`);
          }
          if (reason) await lifetime.drain();
          else child.stdio[4].end(); // Release only after BOTH launcher and PID 1 are verified.
        } catch { stop('launcher-verification'); await lifetime.drain(); }
        const { exitCode, exitSignal } = await lifetime.finished();
        const eventsAfter = await resourceEvents(envelope);
        const events = Object.fromEntries(Object.keys(eventsBefore).map((key) => [key, eventsAfter[key] - eventsBefore[key]]));
        if (events.pidsMax > 0) reason ??= 'task-limit';
        if (events.oomKill > 0 || events.memoryMax > 0) reason ??= 'memory-limit';
        if (fixture && name === 'scratch' && exitCode === 73) reason ??= 'scratch-limit';
        const bytes = Buffer.concat(output);
        const report = adapters ? Buffer.concat(reports).toString('utf8') : undefined;
        if (adapters) await durableFile(`${directory}/report.frame`, report);
        await log.sync();
        const result = { ...started, finishedAt: new Date().toISOString(), launch, exitCode, exitSignal,
          passed: !reason && exitCode === 0 && exitSignal === null,
          reason: reason ?? (exitSignal ? 'signal' : exitCode === 0 ? 'passed' : 'exit'),
          outputBytes: length, ...(adapters ? { report, reportBytes: reportLength,
            reportDigest: createHash('sha256').update(report).digest('hex') } : {}), resourceEvents: events, hostConnections: probes?.connections(), receipt: join(receiptDirectory, id, 'result.json'), reviewReady: false };
        if (name === 'boundary' && result.passed) {
          try {
            result.probe = JSON.parse(bytes.toString('utf8'));
            if (result.probe.hidden !== true || result.probe.environmentScrubbed !== true || result.probe.networkDenied !== true || result.probe.udpDenied !== true
              || result.probe.readOnly !== true || result.probe.noNewPrivileges !== true || result.probe.seccomp !== true
              || result.probe.scratchBytes !== limits.scratchBytes || result.hostConnections !== 0
              || (bundle && result.probe.readOnlyBundle !== true)) throw new Error();
          } catch { result.passed = false; result.reason = 'boundary-verification'; }
        }
        await durableFile(`${directory}/result.json`, JSON.stringify(result));
        return { ...result, output: bytes.toString('utf8') };
      } finally {
        clearTimeout(timer); abortSignal.removeEventListener('abort', abort);
        // Also drain a child if receipt IO or verification throws after spawning it.
        const drainFailure = await lifetime?.drain().catch((error) => error);
        try { await Promise.all([log?.close(), filter?.close(), probes?.close()]); }
        finally { if (drainFailure) throw drainFailure; }
      }
    })();
    current = operation;
    try { return await operation; } finally { busy = false; activeCheck = false; current = undefined; }
  }
  async function fileOperation(operation) {
    available(); busy = true;
    const promise = (async () => {
      await unchangedRoots(); await verifyEnvelope();
      if (combined().aborted) fail('ABORTED', 'The file operation was cancelled.');
      return operation();
    })();
    current = promise;
    try { return await promise; } finally { busy = false; current = undefined; }
  }
  const api = {
    envelope,
    async read(path, { offset = 0, length = CONTAINMENT_LIMITS.readBytes } = {}) {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 4 || length > CONTAINMENT_LIMITS.readBytes) {
        fail('READ_LIMIT', 'Use a nonnegative byte offset and a page size from 4 to 16384 bytes.');
      }
      return fileOperation(() => withFile(root, path, protectedPaths, false, async (file) => {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await file.read(buffer, 0, length, offset);
        const size = (await file.stat()).size;
        let end = bytesRead; let text;
        while (end >= Math.max(0, bytesRead - 3)) {
          try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, end)); break; }
          catch { if (offset + bytesRead >= size) break; end--; }
        }
        if (text === undefined || (bytesRead > 0 && end === 0)) fail('TEXT_REQUIRED', 'Only valid UTF-8 text and returned pagination offsets are accepted.');
        return { path, text, bytes: end, offset, nextOffset: offset + end < size ? offset + end : null };
      }));
    },
    async write(path, text) {
      if (typeof text !== 'string' || Buffer.byteLength(text) > CONTAINMENT_LIMITS.writeBytes) fail('WRITE_LIMIT', 'Text writes are limited to 65536 UTF-8 bytes.');
      return fileOperation(() => withFile(root, path, [...protectedPaths,
        ...(dependencyBundle ? ['package.json', 'bun.lock', 'package-lock.json', 'vendor'] : [])], true, async (file) => {
        await file.truncate(0); await file.writeFile(text); await file.sync();
        return { path, bytesWritten: Buffer.byteLength(text) };
      }));
    },
    async check(name, options = {}) {
      if (Object.keys(options).some((key) => key !== 'signal')) fail('CHECK_NOT_ALLOWED', 'Checks accept cancellation only, not arguments.');
      return run(name, options);
    },
    close() {
      return closing ??= (async () => {
        closed = true; shutdown.abort();
        try { await current; }
        finally {
          try { await root.close(); await retained.close(); }
          finally {
            // An executor may handle a tool error after `current` is cleared.
            // Finalization must still preserve the backend's failed-drain fence.
            if (namespaceFenced()) fail('DRAIN_FAILED', 'Sandbox cleanup remains unconfirmed. Backend ownership must remain fenced.');
          }
        }
      })();
    },
  };
  try {
    const verification = await run('boundary');
    if (!verification.passed) fail('CONTAINMENT_REQUIRED', 'The actual launcher failed its boundary verification. Retain the private receipt.');
    return Object.freeze({ ...api, verification });
  } catch (error) { await api.close(); throw error; }
}
