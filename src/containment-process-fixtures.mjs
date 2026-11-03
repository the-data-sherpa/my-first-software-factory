// Observations are limited to processes in the exact disposable scope, never a host-wide scan.
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

export async function processIdentity(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid, state: fields[0], parentPid: Number(fields[1]), session: Number(fields[3]), startTime: fields[19] };
  } catch (error) { if (error.code === 'ENOENT') return; throw error; }
}
export async function scopeProcesses(envelope) {
  const pids = (await readFile(`/sys/fs/cgroup${envelope.cgroup}/cgroup.procs`, 'utf8')).trim().split('\n').filter(Boolean).map(Number);
  return (await Promise.all(pids.filter((pid) => pid !== process.pid).map(processIdentity))).filter(Boolean);
}
export async function observeDescendants(envelope) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const processes = await scopeProcesses(envelope);
    if (processes.length >= 5) return processes;
    await delay(10);
  }
  throw new Error('Controlled descendants were not observed.');
}
export async function livingProcesses(observed) {
  return (await Promise.all(observed.map(async (identity) => {
    const current = await processIdentity(identity.pid);
    return current && current.startTime === identity.startTime && !['Z', 'X'].includes(current.state) ? current : undefined;
  }))).filter(Boolean);
}
export async function waitForCleanup(observed) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const survivors = await livingProcesses(observed);
    if (!survivors.length) return survivors;
    await delay(10);
  }
  return livingProcesses(observed);
}
