import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import test from 'node:test';

test('recovery ownership accepts unrelated failed units while retaining manager and extinction checks', async t => {
  const uid = process.getuid();
  const unit = 'factory-contained-11111111-1111-4111-8111-111111111111.scope';
  const cgroup = `/user.slice/user-${uid}.slice/user@${uid}.service/app.slice/${unit}`;
  const managerPid = 1_000_000_000;
  const bootId = '22222222-2222-4222-8222-222222222222';
  const invocationId = 'a'.repeat(32);
  const scopeInvocationId = 'b'.repeat(32);
  const namespaces = Object.fromEntries(['pid', 'mnt', 'cgroup', 'user'].map(name => [name, `${name}:[1234]`]));
  const run = { id: 'run-original', project: { id: 'fixture' }, qualification: { version: 1 }, execution: { requestId: 'original-request' },
    workspace: { intent: { id: 'workspace-original', runId: 'run-original', projectId: 'fixture', stateDir: '/private-fixture',
      sourceManifest: { id: 'original-source' }, baseCommit: 'c'.repeat(40) } } };
  const directory = join(run.workspace.intent.stateDir, 'runs', run.id);
  const binding = { version: 1, runId: run.id, requestId: run.execution.requestId, workspaceIntentId: 'workspace-original',
    sourceManifestId: 'original-source', baseCommit: 'c'.repeat(40),
    topology: { bootId, uid, namespaces, manager: { pid: managerPid, startTime: '123', invocationId } },
    owner: { pid: process.pid, startTime: '456' }, scope: { unit, cgroup, invocationId: scopeInvocationId } };
  run.executor = { recoveryOwner: { ...binding, id: createHash('sha256').update(JSON.stringify(binding)).digest('hex') } };
  let observation;
  const reset = () => { observation = { systemState: 'degraded', active: 'active', sub: 'running', managerLive: true,
    managerStart: '123', managerInvocation: invocationId, ownerLive: false, scopeState: 'inactive',
    scopeInvocation: scopeInvocationId, populated: 0, members: '', hostReads: 0, bootId, namespaces: { ...namespaces } }; };
  const stat = (pid, start) => `${pid} (fixture) ${['S', '1', ...Array(17).fill('0'), start].join(' ')}`;
  t.mock.method(fs, 'readFile', async path => {
    if (path === '/proc/sys/kernel/random/boot_id') return `${observation.hostReads === 1 && observation.laterBootId ? observation.laterBootId : observation.bootId}\n`;
    if (path === '/proc/self/cgroup') return `0::${cgroup}\n`;
    if (path === `/proc/${managerPid}/stat` && observation.managerLive) return stat(managerPid, observation.managerStart);
    if (path === `/proc/${process.pid}/stat` && observation.ownerLive) return stat(process.pid, '456');
    if (path === `/sys/fs/cgroup${cgroup}/cgroup.events`) return `populated ${observation.populated}\n`;
    if (path === `/sys/fs/cgroup${cgroup}/cgroup.procs`) return observation.members;
    const limits = { 'memory.max': '4294967296', 'memory.swap.max': '0', 'pids.max': '256', 'memory.oom.group': '1' };
    for (const [file, value] of Object.entries(limits)) if (path === `/sys/fs/cgroup${cgroup}/${file}`) return value;
    if (path === `/proc/${managerPid}/stat` || path === `/proc/${process.pid}/stat`) throw Object.assign(new Error('Extinct'), { code: 'ENOENT' });
    assert.fail(`Unexpected host read: ${path}`);
  });
  t.mock.method(fs, 'readlink', async path => {
    const name = path.slice('/proc/self/ns/'.length);
    assert.equal(path, `/proc/self/ns/${name}`);
    assert.ok(namespaces[name]);
    return (observation.hostReads === 1 && observation.laterNamespaces ? observation.laterNamespaces : observation.namespaces)[name];
  });
  const execFile = childProcess.execFile;
  childProcess.execFile = (command, args, options, callback) => {
    assert.equal(command, '/usr/bin/systemctl');
    assert.ok(args.includes('show'));
    const property = args.at(-1);
    let values;
    if (property === '--property=SystemState') {
      observation.hostReads++;
      values = { SystemState: observation.hostReads === 2 && observation.laterState ? observation.laterState : observation.systemState };
    } else if (args.includes(`user@${uid}.service`)) {
      values = { ActiveState: observation.active, SubState: observation.sub, MainPID: managerPid, InvocationID: observation.managerInvocation };
    } else {
      assert.ok(args.includes(unit));
      values = { Id: unit, LoadState: 'loaded', ActiveState: observation.scopeState, Transient: 'yes',
        InvocationID: observation.scopeInvocation, ControlGroup: cgroup,
        MemoryMax: '4294967296', MemorySwapMax: '0', TasksMax: '256', OOMPolicy: 'kill' };
    }
    callback(null, { stdout: Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') });
  };
  syncBuiltinESMExports();
  t.after(() => { childProcess.execFile = execFile; t.mock.restoreAll(); syncBuiltinESMExports(); });
  const { captureRecoveryOwner, verifyRecoveryOwner } = await import('../../src/recovery-owner.mjs');
  for (const state of ['running', 'degraded']) {
    await t.test(`replacement observation accepts ${state}`, async () => {
      reset(); observation.systemState = state;
      const proof = await verifyRecoveryOwner({ run, directory });
      assert.equal(proof.ownerExtinct, true);
      assert.equal(proof.descendantsEmpty, true);
      assert.equal(proof.binding.id, run.executor.recoveryOwner.id);
      assert.equal(observation.hostReads, 2);
    });
    await t.test(`prospective capture accepts ${state}`, { skip: process.versions.node !== '24.21.0' && 'Requires Node 24.21.0 containment runtime' }, async () => {
      reset(); observation.systemState = state; observation.ownerLive = true; observation.scopeState = 'active';
      assert.deepEqual(await captureRecoveryOwner({ run, directory }), run.executor.recoveryOwner);
      assert.equal(observation.hostReads, 2);
    });
  }
  for (const patch of [
    ...['starting', 'stopping', 'maintenance', 'offline', 'unknown', ''].map(systemState => ({ systemState })),
    { active: 'inactive' }, { sub: 'dead' }, { managerLive: false }, { managerStart: '999' }, { managerInvocation: 'd'.repeat(32) },
    { ownerLive: true }, { scopeState: 'active' }, { scopeInvocation: 'e'.repeat(32) }, { populated: 1 }, { members: '999\n' },
    { laterState: 'stopping' },
    { bootId: '33333333-3333-4333-8333-333333333333' }, { laterBootId: '33333333-3333-4333-8333-333333333333' },
    ...Object.keys(namespaces).flatMap(name => [
      { namespaces: { ...namespaces, [name]: `${name}:[5678]` } },
      { laterNamespaces: { ...namespaces, [name]: `${name}:[5678]` } },
    ]),
  ]) {
    await t.test(`replacement observation refuses ${JSON.stringify(patch)}`, async () => {
      reset(); Object.assign(observation, patch);
      await assert.rejects(verifyRecoveryOwner({ run, directory }), { code: 'RECOVERY_REQUIRED' });
    });
    if (patch.laterBootId || patch.laterNamespaces) {
      await t.test(`prospective capture refuses ${JSON.stringify(patch)}`, { skip: process.versions.node !== '24.21.0' && 'Requires Node 24.21.0 containment runtime' }, async () => {
        reset(); Object.assign(observation, patch, { ownerLive: true, scopeState: 'active' });
        await assert.rejects(captureRecoveryOwner({ run, directory }), { code: 'RECOVERY_REQUIRED' });
      });
    }
  }
});
