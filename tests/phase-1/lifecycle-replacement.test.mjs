import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, chmod, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { openFactory, inspectHistory } from '../../src/factory.mjs';
import { serveFactory } from '../../src/control-server.mjs';
import { createQualifiedRepositoryExecution } from '../../src/qualified-execution.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { ownedProcesses, stopOwnedScope } from '../fixtures/containment-harness.mjs';
import { processIdentity } from '../../src/containment-namespace.mjs';
import { git } from './workspace-fixture.mjs';
import { until } from '../phase-0/helpers.mjs';

const exec = promisify(execFile);
const workspace = { admit: admitWorkspace, prepare: prepareWorkspace };
const entry = fileURLToPath(new URL('../../bin/factory.mjs', import.meta.url));

test('CLI linked replacement requires whole original scope extinction and quarantines the crashed composed draft', { timeout: 90_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'factory-dependencies-'));
  // Keep the canonical Unix-socket path below its public CLI length bound.
  // Large toolchain/fixture assets follow TMPDIR; this state root holds only small records/checks.
  const stateRoot = await mkdtemp('/tmp/factory-lifecycle-');
  const stateDirectory = join(stateRoot, 'state');
  const unit = `factory-contained-${randomUUID()}.scope`;
  if (process.env.FACTORY_LIFECYCLE_EVIDENCE) await writeFile(join(process.env.FACTORY_LIFECYCLE_EVIDENCE, 'registered.json'),
    JSON.stringify({ root, stateRoot, unit, hostTmpdir: tmpdir(), environmentTmpdir: process.env.TMPDIR ?? null }), { mode: 0o600 });
  let drained = false; let server; let stderr = '';
  const child = spawn('/usr/bin/systemd-run', ['--user', '--scope', '--quiet', '--collect', `--unit=${unit}`,
    '--property=MemoryMax=4294967296', '--property=MemorySwapMax=0', '--property=TasksMax=256', '--property=OOMPolicy=kill',
    '--', process.execPath, fileURLToPath(new URL('./qualified-execution-worker.mjs', import.meta.url)), root, 'replacement-crash', stateDirectory], {
    env: { PATH: '/usr/bin', XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus`, TMPDIR: tmpdir() }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', data => { stderr += data; });
  const finished = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  finished.catch(() => {});
  t.after(async () => {
    try { await server?.close(); }
    finally {
      child.kill('SIGKILL');
      await stopOwnedScope(unit); drained = true;
      await finished;
      if (process.env.FACTORY_LIFECYCLE_EVIDENCE) await writeFile(join(process.env.FACTORY_LIFECYCLE_EVIDENCE, 'owned-root.json'),
        JSON.stringify({ root, stateRoot, unit, drained, stderr }), { mode: 0o600 });
    }
    if (!process.env.FACTORY_LIFECYCLE_EVIDENCE) {
      async function writable(path) {
        await chmod(path, 0o700);
        for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await writable(join(path, entry.name));
      }
      for (const path of [root, stateRoot]) { await writable(path); await rm(path, { recursive: true, force: true }); }
    }
  });
  await until(async () => {
    const checkpoint = await readFile(join(root, 'survivor.json'), 'utf8').catch(() => undefined);
    if (!checkpoint && (child.exitCode !== null || child.signalCode !== null)) throw new Error(`Fixture exited before its crash checkpoint: ${stderr}`);
    return checkpoint;
  }, Boolean, 70_000)
    .catch(error => { error.message += `\n${stderr}`; throw error; });
  const input = JSON.parse(await readFile(join(root, 'application-input.json'), 'utf8'));
  const survivor = JSON.parse(await readFile(join(root, 'survivor.json'), 'utf8'));
  const before = await until(() => inspectHistory({ stateDir: input.stateDir, runId: input.runId }).catch(() => undefined),
    run => run?.status === 'interrupted');
  assert.ok(await processIdentity(survivor.pid), 'The original scope still has a live descendant.');
  assert.ok((await ownedProcesses(unit)).some(process => process.pid === survivor.pid));
  let initialized = 0;
  const execution = createQualifiedRepositoryExecution({ fixture: true,
    createRuntime() { initialized++; assert.fail('Recovery or blocked replacement must not initialize a model.'); },
    fetch() { assert.fail('No recovery request'); } });
  const factory = await openFactory({ stateDir: input.stateDir, project: input.project, workspace, execution });
  server = await serveFactory({ factory, mode: execution.mode, fixture: true });
  const cli = async (...args) => JSON.parse((await exec(process.execPath, [entry, ...args, '--state-dir', input.stateDir], {
    env: { PATH: '/usr/bin', HOME: root, TMPDIR: tmpdir() }, timeout: 15000, maxBuffer: 8 * 1024 * 1024,
  })).stdout);
  const replace = () => cli('replace', input.runId, '--request-id', 'explicit-linked-replacement', '--review', 'Retain the quarantined partial draft; start from the admitted base.');
  const refused = code => error => JSON.parse(error.stderr).error.code === code;
  assert.deepEqual(await cli('inspect', input.runId), before, 'Inspection never starts recovery.');
  await assert.rejects(cli('resume', input.runId, '--review', 'Review cannot authorize replay.'), refused('UNSAFE_RESUME'));
  await assert.rejects(replace(), refused('RECOVERY_REQUIRED'));
  assert.equal((await cli('list')).length, 2, 'Only the preparation and original run exist.');
  await stopOwnedScope(unit); drained = true;
  assert.deepEqual(await ownedProcesses(unit), []);
  await finished;
  const dependencyRun = await factory.inspectRun(input.dependencyRunId);
  for (const corrupt of [
    run => { delete run.executor.recoveryOwner; },
    run => { run.executor.recoveryOwner.runId = input.dependencyRunId; },
    run => { run.executor.recoveryOwner.topology.bootId = randomUUID(); },
    run => { run.executor.recoveryOwner.scope.invocationId = '0'.repeat(32); },
    run => { run.executor.recoveryOwner.topology.manager.startTime = '0'; },
  ]) {
    const altered = structuredClone(before);
    // Legacy pre-fix execution has no binding; the positive CLI assertion below
    // remains the causal red, while the corrected implementation tests corruption.
    if (altered.executor.recoveryOwner) {
      corrupt(altered);
      if (altered.executor.recoveryOwner) {
        const { id, ...binding } = altered.executor.recoveryOwner;
        altered.executor.recoveryOwner.id = createHash('sha256').update(JSON.stringify(binding)).digest('hex');
      }
    }
    assert.equal((await execution.assessRecovery({ run: altered, directory: join(input.stateDir, 'runs', input.runId), dependencyRun })).quiescent, false);
  }
  const oldDraft = await readFile(join(before.workspace.intent.worktree, 'convex/syncHelpers.ts'), 'utf8');
  assert.ok(before.reservations.some(reservation => reservation.state === 'uncertain'));
  // An independently advanced disposable owner main must not change the replacement's base.
  await writeFile(join(input.project.repositoryPath, 'later-main.txt'), 'later independent source\n');
  git(input.project.repositoryPath, 'add', 'later-main.txt');
  git(input.project.repositoryPath, 'commit', '-m', 'later fixture main');
  assert.notEqual(git(input.project.repositoryPath, 'rev-parse', 'main').trim(), before.workspace.intent.baseCommit);
  const replacement = await replace();
  assert.equal(replacement.replacesRunId, input.runId);
  assert.notEqual(replacement.id, input.runId);
  const blocked = await until(() => cli('inspect', replacement.id), run => run.status === 'blocked');
  assert.equal(blocked.outcome.reason, 'CONTAINMENT_REQUIRED', 'New work refuses this uncontained test backend.');
  assert.equal(blocked.workspace.intent.baseCommit, before.workspace.intent.baseCommit);
  assert.equal(blocked.workspace.intent.sourceManifest.id, before.workspace.intent.sourceManifest.id);
  assert.notEqual(blocked.workspace.intent.worktree, before.workspace.intent.worktree);
  assert.equal(blocked.counters.modelAttempts, 0);
  assert.equal(initialized, 0);
  assert.equal(await readFile(join(before.workspace.intent.worktree, 'convex/syncHelpers.ts'), 'utf8'), oldDraft);
  const retired = await cli('inspect', input.runId);
  assert.equal(retired.status, 'replaced');
  assert.equal(retired.replacedByRunId, replacement.id);
  assert.deepEqual(retired.counters, before.counters);
  assert.deepEqual(retired.reservations, before.reservations);
  assert.equal(retired.deadlineAt, before.deadlineAt);
  assert.equal((await replace()).id, blocked.id, 'The explicit replacement request is idempotent.');
  assert.equal(blocked.replacementReview.safety.proof.ownerExtinct, true);
  assert.equal(blocked.replacementReview.safety.proof.descendantsEmpty, true);
  assert.equal(blocked.replacementReview.safety.resumable, false);
  if (process.env.FACTORY_LIFECYCLE_EVIDENCE) await writeFile(join(process.env.FACTORY_LIFECYCLE_EVIDENCE, 'replacement.json'),
    JSON.stringify({ root, stateRoot, unit, drained, before, replacement: blocked, retired }), { mode: 0o600 });
});
