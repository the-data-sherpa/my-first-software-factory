// Trusted host observations for explicit retirement only. Never launches, kills,
// resumes, or reconciles a remote request. Repository tools cannot write this record.
import { execFile } from 'node:child_process';
import { readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { verifyContainmentEnvelope } from './containment.mjs';
import { processIdentity } from './containment-namespace.mjs';
import { FactoryError } from './storage.mjs';

const exec = promisify(execFile);
const uid = () => process.getuid();
const fail = () => { throw new FactoryError('RECOVERY_REQUIRED', 'Original execution identity or whole-scope extinction is unconfirmed. Retain the quarantined draft and reservations.'); };
const hex = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const live = identity => identity && !['Z', 'X'].includes(identity.state);
const identity = value => {
  if (!Number.isSafeInteger(value?.pid) || value.pid <= 1 || !/^[0-9]+$/.test(value.startTime ?? '')) fail();
  return { pid: value.pid, startTime: value.startTime };
};
async function properties(user, unit, names) {
  const { stdout } = await exec('/usr/bin/systemctl', [...(user ? ['--user'] : []), 'show', ...(unit ? [unit] : []), `--property=${names}`], {
    env: { PATH: '/usr/bin', XDG_RUNTIME_DIR: `/run/user/${uid()}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid()}/bus` },
    timeout: 5000, maxBuffer: 8192,
  });
  return Object.fromEntries(stdout.trim().split('\n').map(line => line.split('=')));
}
async function host() {
  const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  if (!/^[a-f0-9-]{36}$/.test(bootId)) fail();
  const namespaces = {};
  for (const name of ['pid', 'mnt', 'cgroup', 'user']) namespaces[name] = await readlink(`/proc/self/ns/${name}`);
  const service = await properties(false, `user@${uid()}.service`, 'ActiveState,SubState,MainPID,InvocationID');
  if (service.ActiveState !== 'active' || service.SubState !== 'running' || !hex(service.InvocationID)) fail();
  const manager = await processIdentity(Number(service.MainPID));
  if (!live(manager) || !['running', 'degraded'].includes((await properties(true, undefined, 'SystemState')).SystemState)) fail();
  return { bootId, uid: uid(), namespaces, manager: { ...identity(manager), invocationId: service.InvocationID } };
}
const scopeProperties = unit => properties(true, unit, 'Id,LoadState,ActiveState,Transient,InvocationID,ControlGroup');
function bound(run, directory) {
  const intent = run.workspace?.intent;
  if (!run.qualification || !intent || intent.runId !== run.id || intent.projectId !== run.project.id
    || directory !== join(intent.stateDir, 'runs', run.id)) fail();
  return { runId: run.id, requestId: run.execution.requestId, workspaceIntentId: intent.id,
    sourceManifestId: intent.sourceManifest.id, baseCommit: intent.baseCommit };
}

/** Persist the returned detached binding synchronously before the first model/tool window. */
export async function captureRecoveryOwner({ run, directory }) {
  let envelope;
  try { envelope = await verifyContainmentEnvelope(); }
  catch { throw new FactoryError('CONTAINMENT_REQUIRED', 'Composed execution requires its verified foreground scope before recording recovery ownership.'); }
  const topology = await host();
  const unit = await scopeProperties(envelope.unit);
  if (unit.Id !== envelope.unit || unit.LoadState !== 'loaded' || unit.ActiveState !== 'active'
    || unit.Transient !== 'yes' || unit.ControlGroup !== envelope.cgroup || !hex(unit.InvocationID)) fail();
  const owner = identity(await processIdentity(process.pid));
  if (JSON.stringify(await host()) !== JSON.stringify(topology)) fail();
  const binding = { version: 1, ...bound(run, directory), topology, owner,
    scope: { unit: envelope.unit, cgroup: envelope.cgroup, invocationId: unit.InvocationID } };
  return { ...binding, id: digest(binding) };
}

/** Read only; missing legacy bindings and unsupported host/manager topologies refuse. */
export async function verifyRecoveryOwner({ run, directory }) {
  const saved = run.executor?.recoveryOwner;
  const { id, ...binding } = saved ?? {};
  if (saved?.version !== 1 || id !== digest(binding) || Object.entries(bound(run, directory)).some(([key, value]) => saved[key] !== value)
    || JSON.stringify(await host()) !== JSON.stringify(saved.topology)) fail();
  const owner = identity(saved.owner);
  const current = await processIdentity(owner.pid);
  if (live(current) && current.startTime === owner.startTime) fail();
  const scope = saved.scope;
  if (!/^factory-contained-[a-f0-9-]{36}\.scope$/.test(scope?.unit ?? '') || !hex(scope.invocationId)
    || typeof scope.cgroup !== 'string' || scope.cgroup.includes('..')
    || !scope.cgroup.startsWith(`/user.slice/user-${uid()}.slice/user@${uid()}.service/`)
    || !scope.cgroup.endsWith(`/${scope.unit}`)) fail();
  const unit = await scopeProperties(scope.unit);
  if (unit.Id !== scope.unit || !['inactive', 'failed'].includes(unit.ActiveState)) fail();
  if (unit.LoadState === 'not-found') {
    if (unit.InvocationID || unit.ControlGroup) fail();
  } else if (unit.LoadState !== 'loaded' || unit.Transient !== 'yes' || unit.InvocationID !== scope.invocationId
    || (unit.ControlGroup && unit.ControlGroup !== scope.cgroup)) fail();
  let cgroup = 'empty';
  try {
    const events = await readFile(`/sys/fs/cgroup${scope.cgroup}/cgroup.events`, 'utf8');
    // The kernel's populated counter includes every descendant cgroup.
    if (!/^populated 0$/m.test(events) || (await readFile(`/sys/fs/cgroup${scope.cgroup}/cgroup.procs`, 'utf8')).trim()) fail();
  } catch (error) { if (error.code !== 'ENOENT') throw error; cgroup = 'absent'; }
  // Reobserve the manager and unit after all kernel/process observations.
  if (JSON.stringify(await host()) !== JSON.stringify(saved.topology)
    || JSON.stringify(await scopeProperties(scope.unit)) !== JSON.stringify(unit)) fail();
  return { version: 1, binding: saved, observedAt: Date.now(), ownerExtinct: true,
    unitState: unit.ActiveState, cgroup, descendantsEmpty: true };
}
