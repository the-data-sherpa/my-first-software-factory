// The foreground launcher owns one transient scope, not a persistent service.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const managerEnv = () => ({ PATH: '/usr/bin', XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`,
  DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus` });
const validUnit = (unit) => /^factory-contained-(test-)?[a-f0-9-]{36}\.scope$/.test(unit ?? '');
async function manager(args) {
  return exec('/usr/bin/systemctl', ['--user', ...args], { env: managerEnv(), timeout: 5000, maxBuffer: 8192 });
}

export async function drainOwnedScope(unit) {
  if (!validUnit(unit)) throw new Error('Invalid owned scope.');
  const { stdout } = await manager(['show', unit, '--property=ActiveState,ControlGroup']);
  const properties = Object.fromEntries(stdout.trim().split('\n').map((line) => line.split('=')));
  // Preserve failed OOM diagnostics for inspection. Collected scopes have no cgroup.
  if (['inactive', 'failed'].includes(properties.ActiveState) && !properties.ControlGroup) return;
  if (properties.ControlGroup && !properties.ControlGroup.endsWith(`/${unit}`)) throw new Error('Unexpected scope identity.');
  await manager(['kill', '--kill-whom=all', '--signal=KILL', unit]).catch(() => {});
  await manager(['stop', unit]).catch(() => {});
  const terminal = (await manager(['show', unit, '--property=ActiveState', '--value'])).stdout.trim();
  if (!['inactive', 'failed'].includes(terminal)) throw new Error('Owned scope did not stop.');
}

export async function watchForegroundLauncher() {
  const unit = process.env.FACTORY_CONTAINMENT_UNIT;
  const launcherPid = Number(process.env.FACTORY_CONTAINMENT_LAUNCHER_PID);
  // Direct trusted scope fixtures own their lifetime themselves.
  if (unit === undefined && process.env.FACTORY_CONTAINMENT_LAUNCHER_PID === undefined) return;
  if (!validUnit(unit) || !Number.isSafeInteger(launcherPid) || launcherPid <= 1
    || !(await readFile('/proc/self/cgroup', 'utf8')).trim().endsWith(`/${unit}`)) throw new Error('Invalid launcher lifetime.');
  let stopping = false;
  const check = () => {
    // PPID changes on death, including death before this module started. It cannot
    // become a reused launcher PID: the process is reparented to its subreaper.
    if (process.ppid === launcherPid || stopping) return;
    stopping = true;
    manager(['kill', '--kill-whom=all', '--signal=KILL', unit]).finally(() => process.kill(process.pid, 'SIGKILL')).catch(() => {});
  };
  check();
  if (stopping) await new Promise(() => {}); // Never dispatch repository work after owner loss.
  setInterval(check, 50).unref();
}
