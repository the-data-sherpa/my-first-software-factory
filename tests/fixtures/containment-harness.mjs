import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { processIdentity, waitForCleanup } from '../../src/containment-process-fixtures.mjs';
const exec = promisify(execFile);
const launcher = fileURLToPath(new URL('../../bin/factory-contained.mjs', import.meta.url));
const env = { PATH: '/usr/bin', XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus` };
export async function ownedProcesses(unit) {
  assert.match(unit, /^factory-contained-(test-)?[a-f0-9-]{36}\.scope$/);
  const { stdout } = await exec('/usr/bin/systemctl', ['--user', 'show', unit, '--property=ControlGroup', '--value'], { env, timeout: 2000 });
  const cgroup = stdout.trim();
  // Collected units have an empty ControlGroup; never read the root cgroup.
  if (!cgroup.endsWith(`/${unit}`)) return [];
  const pids = await readFile(`/sys/fs/cgroup${cgroup}/cgroup.procs`, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''; throw error;
  });
  return (await Promise.all(pids.trim().split('\n').filter(Boolean).map((pid) => processIdentity(Number(pid))))).filter(Boolean);
}
export async function stopOwnedScope(unit) {
  const observed = await ownedProcesses(unit);
  await exec('/usr/bin/systemctl', ['--user', 'kill', '--kill-whom=all', '--signal=KILL', unit], { env, timeout: 2000 }).catch(() => {});
  await exec('/usr/bin/systemctl', ['--user', 'stop', unit], { env, timeout: 2000 }).catch(() => {});
  await exec('/usr/bin/systemctl', ['--user', 'reset-failed', unit], { env, timeout: 2000 }).catch(() => {});
  assert.deepEqual(await waitForCleanup(observed), []);
  assert.deepEqual(await ownedProcesses(unit), []);
}
export async function startDiagnostic(t, scenario) {
  const directory = await mkdtemp('/tmp/factory-containment-');
  const child = spawn(process.execPath, [launcher, 'diagnose', scenario, directory], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stdout = ''; let stderr = ''; let unit; let disposed;
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const finished = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr })));
  const owned = new Promise((resolve, reject) => {
    child.on('message', (message) => {
      if (message.type === 'containment-scope') { unit = message.unit; resolve(unit); }
    });
    child.on('error', reject);
    child.on('exit', () => { if (!unit) reject(new Error(`Launcher exited before ownership: ${stderr}`)); });
  });
  owned.catch(() => {});
  const dispose = () => disposed ??= (async () => {
    child.kill('SIGKILL');
    await exited;
    // Ownership precedes spawn. If termination races scope registration, allow
    // the exact pending scope to appear before declaring this fixture drained.
    if (unit) { await delay(100); await stopOwnedScope(unit); }
    await finished;
    await rm(directory, { recursive: true, force: true });
  })();
  t.after(dispose);
  async function bounded(promise, ms) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Contained diagnostic exceeded ${ms}ms: ${stderr}`)), ms);
      })]);
    } catch (error) { await dispose(); throw error; }
    finally { clearTimeout(timer); }
  }
  await bounded(owned, 2000);
  async function ready() {
    return bounded((async () => {
      while (!stdout.includes('\n')) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Diagnostic exited before ready: ${stderr}`);
        await delay(5);
      }
      return JSON.parse(stdout.slice(0, stdout.indexOf('\n')));
    })(), 8000);
  }
  return { directory, child, unit, ready, finished, exited, bounded, dispose };
}
export async function diagnose(t, scenario, timeout = 30000) {
  const harness = await startDiagnostic(t, scenario);
  const terminal = await harness.bounded(harness.finished, timeout);
  assert.equal(terminal.code, 0, terminal.stderr);
  return JSON.parse(terminal.stdout);
}
