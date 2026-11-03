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
import { setTimeout as delay } from 'node:timers/promises';
import { dependencyMount } from './dependencies.mjs';

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
let fenced = false; // Failed cleanup must also fence newly created execution handles.
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
    if (fenced || process.platform !== 'linux' || process.arch !== 'x64' || process.versions.node !== '24.21.0') throw new Error();
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
async function identity(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid, parentPid: Number(fields[1]), startTime: fields[19], state: fields[0] };
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return; throw error; }
}
async function sandboxIdentity(pid, parentPid, envelope) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Missing sandbox PID.');
  const observed = await identity(pid);
  const cgroup = (await readFile(`/proc/${pid}/cgroup`, 'utf8')).trim();
  const status = await readFile(`/proc/${pid}/status`, 'utf8');
  if (observed?.parentPid !== parentPid || cgroup !== `0::${envelope.cgroup}` || !/^NSpid:\s+\d+\s+1$/m.test(status)) {
    throw new Error('Unverified sandbox PID 1.');
  }
  return observed;
}
async function killSandbox(sandbox, envelope) {
  const current = await identity(sandbox.pid);
  if (!current || current.startTime !== sandbox.startTime || ['Z', 'X'].includes(current.state)) return;
  // An exact PID/start-time and scope check, never a process-group or name-based kill.
  try {
    if ((await readFile(`/proc/${sandbox.pid}/cgroup`, 'utf8')).trim() !== `0::${envelope.cgroup}`) throw new Error('Sandbox moved.');
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return; throw error; }
  try { process.kill(sandbox.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  for (let attempt = 0; attempt < 200; attempt++) {
    const now = await identity(sandbox.pid);
    if (!now || now.startTime !== sandbox.startTime || ['Z', 'X'].includes(now.state)) return;
    await delay(5);
  }
  throw new Error('Sandbox did not drain.');
}
async function fenceScope(envelope) {
  // Uncertain startup/cleanup cannot grant further execution. Kill only this
  // verified foreground scope (including this backend), retaining start receipts.
  fenced = true;
  await exec('/usr/bin/systemctl', ['--user', 'kill', '--kill-whom=all', '--signal=KILL', envelope.unit], { env: managerEnv(), timeout: 5000 });
  fail('CONTAINMENT_REQUIRED', 'Sandbox cleanup was not confirmed; execution is fenced.');
}
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

async function createExecution({ worktree, receiptDirectory, signal, protectedPaths = [], dependencyBundle }, fixture) {
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
    if (!['boundary', ...(dependencyBundle ? ['vitest', 'lint'] : []), ...(fixture ? ['pass', 'fail', 'signal', 'output', 'hang', 'descendants', 'startup-stop', ...(envelope.diagnostic ? ['pids', 'scratch', 'memory'] : [])] : [])].includes(name)) {
      if (name === 'vitest' || name === 'lint') fail('DEPENDENCIES_NOT_PREPARED', 'Prepare and verify the private read-only dependency/toolchain bundle before repository checks.');
      fail('CHECK_NOT_ALLOWED', 'Choose a factory-defined check; arbitrary commands and arguments are not accepted.');
    }
    busy = true; activeCheck = true;
    const operation = (async () => {
      await unchangedRoots();
      let probes; let filter; let log; let child; let terminal; let timer; let reason; let sandbox; let stopping;
      const abortSignal = combined(checkSignal);
      // Do not kill the outer bwrap during its startup handoff. Its namespace child
      // can otherwise adopt a new parent before --die-with-parent is armed.
      const drain = () => stopping ??= (async () => {
        try {
          if (sandbox) await killSandbox(sandbox, envelope);
          else if (child?.pid) throw new Error('Namespace identity was not verified.');
          if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        } catch { closed = true; await fenceScope(envelope); }
      })();
      const stop = (why) => { reason ??= why; if (sandbox) drain().catch(() => {}); };
      const abort = () => stop('aborted');
      try {
        const id = `check-${randomUUID()}`;
        const directory = `${retainedPath}/${id}`;
        await mkdir(directory, { mode: 0o700 });
        const observedEnvelope = await verifyEnvelope();
        const bundle = dependencyBundle ? await dependencyMount(dependencyBundle, worktree) : undefined;
        const sourceDigest = await snapshot(root, `${directory}/source`, protectedPaths);
        if (bundle) await mkdir(`${directory}/source/node_modules`, { mode: 0o700 });
        await durableFile(`${directory}/filter.bpf`, containmentFilter());
        const mountDirectory = await realpath(directory);
        probes = name === 'boundary' ? await hostProbes(`/proc/${process.pid}/fd/${retained.fd}/${id}`) : undefined;
        await durableFile(`${directory}/input.json`, JSON.stringify({ ...probes?.input, scratchBytes: limits.scratchBytes, dependencyBundle: Boolean(bundle) }));
        const started = { id, kind: ['vitest', 'lint'].includes(name) ? 'repository' : 'diagnostic', name, backendPid: process.pid, sourceDigest,
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
        if (envelope.diagnostic) args.push('--ro-bind', '/usr/bin/sleep', '/runtime/sleep');
        for (const library of libraries) args.push('--ro-bind', await realpath(`/usr/lib/${library}`), `/usr/lib/${library}`);
        args.push('--symlink', 'usr/lib', '/lib64', '--symlink', 'usr/lib', '/lib',
          '--ro-bind', `${mountDirectory}/source`, '/work', ...(bundle ? ['--ro-bind', bundle.path, '/work/node_modules'] : []), '--ro-bind', helperPath, '/probe.mjs',
          '--ro-bind', `${mountDirectory}/input.json`, '/input.json', '--proc', '/proc', '--remount-ro', '/proc',
          '--dev', '/dev', '--remount-ro', '/dev', '--size', String(limits.scratchBytes), '--tmpfs', '/tmp',
          '--remount-ro', '/', '--chdir', '/work', '--seccomp', '3', '--block-fd', '4', '--info-fd', '5', '--', '/runtime/node',
          ...(name === 'vitest' ? ['/work/node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=2', '--minWorkers=1']
            : name === 'lint' ? ['/work/node_modules/eslint/bin/eslint.js', '.', '--no-cache'] : ['/probe.mjs', name]));
        const eventsBefore = await resourceEvents(envelope);
        let launch; let length = 0; const output = [];
        child = spawn('/usr/bin/bwrap', args, { env: {}, stdio: ['ignore', 'pipe', 'pipe', filter.fd, 'pipe', 'pipe'] });
        let startupTimer;
        const information = new Promise((resolve, reject) => {
          startupTimer = setTimeout(() => reject(new Error('Sandbox startup did not finish.')), Math.min(5000, limits.checkMs));
          let text = '';
          child.stdio[5].on('data', (data) => { text += data; if (text.length > 8192) reject(new Error('Invalid sandbox information.')); });
          child.stdio[5].on('error', reject);
          child.stdio[5].on('end', () => {
            try { resolve(JSON.parse(text)); } catch (error) { reject(error); }
          });
        }).finally(() => clearTimeout(startupTimer));
        // Attach immediately: startup can fail before the launch receipt is saved.
        information.catch(() => {});
        terminal = new Promise((resolve) => {
          child.on('error', () => { reason ??= 'launcher-error'; });
          child.on('close', (exitCode, exitSignal) => resolve({ exitCode, exitSignal }));
        });
        const collect = (data) => {
          const keep = Math.min(data.length, limits.outputBytes - length);
          if (keep > 0) {
            const retained = data.subarray(0, keep);
            output.push(retained); length += keep;
            try {
              for (let written = 0; written < keep;) written += writeSync(log.fd, retained, written, keep - written);
            } catch { stop('receipt-write'); }
          }
          if (keep < data.length) stop('output-limit');
        };
        child.stdout.on('data', collect); child.stderr.on('data', collect);
        child.stdio[4].on('error', () => stop('launcher-error'));
        timer = setTimeout(() => stop('timeout'), limits.checkMs);
        abortSignal.addEventListener('abort', abort, { once: true });
        if (abortSignal.aborted) abort();
        try {
          const stat = await readFile(`/proc/${child.pid}/stat`, 'utf8');
          const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
          const cgroup = (await readFile(`/proc/${child.pid}/cgroup`, 'utf8')).trim().slice(3);
          if (Number(fields[1]) !== process.pid || cgroup !== envelope.cgroup) throw new Error();
          sandbox = await sandboxIdentity((await information)['child-pid'], child.pid, envelope);
          launch = { pid: child.pid, parentPid: Number(fields[1]), startTime: fields[19], cgroup, sandbox };
          // Close is a pipe-drain event, not proof of namespace death. Even on normal
          // exit, join cleanup of PID 1 before waiting for inherited output pipes.
          child.once('exit', () => { drain().catch(() => {}); });
          await durableFile(`${directory}/launch.json`, JSON.stringify(launch));
          if (fixture && name === 'startup-stop') {
            // Fixed diagnostic fault: freeze this namespace before its parent-death
            // setup can finish. The external test kills the backend or launcher.
            process.kill(sandbox.pid, 'SIGSTOP');
            process.stdout.write(`${JSON.stringify({ envelope, backendIdentity: await identity(process.pid), observed: [await identity(child.pid), sandbox] })}\n`);
          }
          if (reason) await drain();
          else child.stdio[4].end(); // Release only after BOTH launcher and PID 1 are verified.
        } catch { stop('launcher-verification'); await drain(); }
        const { exitCode, exitSignal } = await terminal;
        await stopping;
        const eventsAfter = await resourceEvents(envelope);
        const events = Object.fromEntries(Object.keys(eventsBefore).map((key) => [key, eventsAfter[key] - eventsBefore[key]]));
        if (events.pidsMax > 0) reason ??= 'task-limit';
        if (events.oomKill > 0 || events.memoryMax > 0) reason ??= 'memory-limit';
        if (fixture && name === 'scratch' && exitCode === 73) reason ??= 'scratch-limit';
        const bytes = Buffer.concat(output);
        await log.sync();
        const result = { ...started, finishedAt: new Date().toISOString(), launch, exitCode, exitSignal,
          passed: !reason && exitCode === 0 && exitSignal === null,
          reason: reason ?? (exitSignal ? 'signal' : exitCode === 0 ? 'passed' : 'exit'),
          outputBytes: length, resourceEvents: events, hostConnections: probes?.connections(), receipt: join(receiptDirectory, id, 'result.json'), reviewReady: false };
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
        if (child) await drain();
        await terminal;
        await log?.close(); await filter?.close(); await probes?.close();
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
      return fileOperation(() => withFile(root, path, protectedPaths, true, async (file) => {
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
        try { await current; } finally { await root.close(); await retained.close(); }
      })();
    },
  };
  try {
    const verification = await run('boundary');
    if (!verification.passed) fail('CONTAINMENT_REQUIRED', 'The actual launcher failed its boundary verification. Retain the private receipt.');
    return Object.freeze({ ...api, verification });
  } catch (error) { await api.close(); throw error; }
}
