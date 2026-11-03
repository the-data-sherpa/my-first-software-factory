// Shared internal bwrap lifetime. A launcher exit is not namespace death or pipe
// closure. Keep the startup gate shut until BOTH process identities are verified.
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
const exec = promisify(execFile);
let fenced = false;
export const namespaceFenced = () => fenced;
export async function processIdentity(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid, parentPid: Number(fields[1]), startTime: fields[19], state: fields[0] };
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return; throw error; }
}
async function sandboxIdentity(pid, parentPid, envelope) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Missing sandbox PID.');
  const observed = await processIdentity(pid);
  const cgroup = (await readFile(`/proc/${pid}/cgroup`, 'utf8')).trim();
  const status = await readFile(`/proc/${pid}/status`, 'utf8');
  if (observed?.parentPid !== parentPid || cgroup !== `0::${envelope.cgroup}` || !/^NSpid:\s+\d+\s+1$/m.test(status)) throw new Error('Unverified sandbox PID 1.');
  return observed;
}
async function killSandbox(sandbox, envelope) {
  const current = await processIdentity(sandbox.pid);
  if (!current || current.startTime !== sandbox.startTime || ['Z', 'X'].includes(current.state)) return;
  try {
    if ((await readFile(`/proc/${sandbox.pid}/cgroup`, 'utf8')).trim() !== `0::${envelope.cgroup}`) throw new Error('Sandbox moved.');
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return; throw error; }
  try { process.kill(sandbox.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  for (let attempt = 0; attempt < 200; attempt++) {
    const now = await processIdentity(sandbox.pid);
    if (!now || now.startTime !== sandbox.startTime || ['Z', 'X'].includes(now.state)) return;
    await delay(5);
  }
  throw new Error('Sandbox did not drain.');
}
async function fenceScope(envelope) {
  fenced = true; // Also fences new check AND preparation handles if the manager fails.
  try {
    await exec('/usr/bin/systemctl', ['--user', 'kill', '--kill-whom=all', '--signal=KILL', envelope.unit], {
      env: { PATH: '/usr/bin', XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus` },
      timeout: 5000, maxBuffer: 8192,
    });
  } catch { /* Still a drainage failure, not an ordinary terminal failure. */ }
  throw Object.assign(new Error('Sandbox cleanup was not confirmed; ownership remains fenced.'), { code: 'DRAIN_FAILED' });
}
async function bounded(operation, ms) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Sandbox lifetime did not settle.')), ms); })]);
  } finally { clearTimeout(timer); }
}
export function namespaceLifetime(child, envelope, infoFd, startupMs = 5000) {
  const terminal = new Promise((resolve) => child.once('close', (exitCode, exitSignal) => resolve({ exitCode, exitSignal })));
  const information = bounded(new Promise((resolve, reject) => {
    let text = '';
    child.stdio[infoFd].on('data', (data) => {
      if (text.length + data.length > 8192) { reject(new Error('Invalid sandbox information.')); return; }
      text += data;
    });
    child.stdio[infoFd].on('error', reject);
    child.stdio[infoFd].on('end', () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
    child.once('error', reject);
  }), Math.min(5000, startupMs));
  information.catch(() => {});
  const verified = (async () => {
    const outer = await processIdentity(child.pid);
    const cgroup = (await readFile(`/proc/${child.pid}/cgroup`, 'utf8')).trim();
    if (outer?.parentPid !== process.pid || cgroup !== `0::${envelope.cgroup}`) throw new Error('Unverified launcher.');
    const sandbox = await sandboxIdentity((await information)['child-pid'], child.pid, envelope);
    return { pid: outer.pid, parentPid: outer.parentPid, startTime: outer.startTime, cgroup: envelope.cgroup, sandbox };
  })();
  verified.catch(() => {});
  const failed = Promise.withResolvers(); failed.promise.catch(() => {});
  let stopping;
  const drain = () => stopping ??= (async () => {
    try {
      if (child.pid) await killSandbox((await verified).sandbox, envelope);
      child.stdio[4].destroy(); // Cancellation may precede gate release; close our pipe too.
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      // Join output/export closure as well as PID 1. A leaked pipe cannot keep
      // ownership pending forever or be mistaken for a terminal receipt.
      await bounded(terminal, 1000);
    } catch {
      await fenceScope(envelope);
    }
  })().catch((error) => { failed.reject(error); throw error; });
  child.once('exit', () => { drain().catch(() => {}); });
  return {
    verified,
    stop() { drain().catch(() => {}); },
    drain,
    async finished() {
      const exit = await Promise.race([terminal, failed.promise]);
      await drain();
      return exit;
    },
  };
}
