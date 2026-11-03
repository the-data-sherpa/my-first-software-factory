import assert from 'node:assert/strict';
import { spawn, execFile, fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { until } from '../phase-0/helpers.mjs';

const entry = fileURLToPath(new URL('../../bin/factory.mjs', import.meta.url));
const exec = promisify(execFile);
const brief = '# Goal\nExercise a retained fixture run.\n## Acceptance criteria\nThe record survives reconnecting.\n## Evidence\nA disposable fixture.\n';
const shutdowns = new WeakMap();
async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'factory-cli-'));
  const children = new Set();
  shutdowns.set(t, children);
  t.after(async () => {
    try { for (const stop of children) await stop(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  const stateDir = join(directory, 'state');
  const briefPath = join(directory, 'brief.md');
  await writeFile(briefPath, brief);
  return { directory, stateDir, briefPath };
}
const cli = async (stateDir, ...args) => {
  const { stdout } = await exec(process.execPath, [entry, ...args, '--state-dir', stateDir], { timeout: 15_000 });
  return JSON.parse(stdout);
};
async function backend(t, stateDir, args = []) {
  const child = spawn(process.execPath, [entry, 'serve', '--state-dir', stateDir, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: tmpdir() },
  });
  const stop = async (signal = 'SIGTERM') => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill(signal);
    await exited;
  };
  shutdowns.get(t).add(() => stop('SIGKILL'));
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Backend startup timed out: ${output}`)), 10_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output.split('\n')[0])); }
    });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', () => { clearTimeout(timer); reject(new Error(`Backend exited before readiness: ${output}`)); });
  });
  assert.equal((await ready).event, 'backend-ready');
  return { stop };
}

test('a separate CLI disconnects while the fixture backend continues, then history survives a clean reopen', { timeout: 30_000 }, async (t) => {
  const { stateDir, briefPath } = await workspace(t);
  const running = await backend(t, stateDir, ['--fixture', '--fixture-delay-ms', '3000']);
  const admitted = await cli(stateDir, 'start', '--request-id', 'cli-request-1', '--brief', briefPath);
  assert.equal(admitted.execution.mode, 'fixture');
  const attached = await cli(stateDir, 'inspect', admitted.id);
  assert.equal(attached.status, 'running');
  const done = await until(() => cli(stateDir, 'inspect', admitted.id), (run) => run.status === 'completed');
  await running.stop();
  assert.deepEqual(await cli(stateDir, 'inspect', admitted.id), done);
  const reopened = await backend(t, stateDir, ['--fixture']);
  assert.deepEqual(await cli(stateDir, 'inspect', admitted.id), done);
  await reopened.stop();
});

test('a closed-store backup restores the same run through public CLI inspection', { timeout: 30_000 }, async (t) => {
  const { directory, stateDir, briefPath } = await workspace(t);
  const running = await backend(t, stateDir, ['--fixture']);
  const admitted = await cli(stateDir, 'start', '--request-id', 'backup-request', '--brief', briefPath);
  const done = await until(() => cli(stateDir, 'inspect', admitted.id), (run) => run.status === 'completed');
  await running.stop();
  const backupDir = join(directory, 'backup');
  const backup = await cli(stateDir, 'backup', '--to', backupDir);
  assert.deepEqual(backup.storageVersions, { factory: 1, execution: 1, durableSqlite: 2, piDurable: '1.5.0' });
  const restoredDir = join(directory, 'restored');
  await cli(restoredDir, 'restore', '--from', backupDir);
  assert.deepEqual(await cli(restoredDir, 'inspect', done.id), done);
  const restored = await backend(t, restoredDir, ['--fixture']);
  assert.deepEqual(await cli(restoredDir, 'start', '--request-id', 'backup-request', '--brief', briefPath), done);
  assert.equal((await cli(restoredDir, 'list')).length, 1);
  await restored.stop();
});

async function cliError(stateDir, code, ...args) {
  await assert.rejects(cli(stateDir, ...args), (error) => JSON.parse(error.stderr).error.code === code);
}

test('competing CLI backends are fenced and production never substitutes a fixture', { timeout: 30_000 }, async (t) => {
  const { stateDir, briefPath } = await workspace(t);
  const running = await backend(t, stateDir);
  await cliError(stateDir, 'BACKEND_OWNED', 'serve', '--fixture');
  await cliError(stateDir, 'MODEL_NOT_READY', 'start', '--request-id', 'no-fallback', '--brief', briefPath);
  assert.deepEqual(await cli(stateDir, 'list'), []);
  assert.equal((await cli(stateDir, 'info')).fixture, false);
  await running.stop();
});

test('CLI file and inline briefs preserve snapshots and reject oversized files', { timeout: 30_000 }, async (t) => {
  const { stateDir, briefPath } = await workspace(t);
  const running = await backend(t, stateDir, ['--fixture']);
  await writeFile(briefPath, `${brief}${'x'.repeat(65_536)}`);
  await cliError(stateDir, 'INVALID_BRIEF', 'start', '--request-id', 'oversized', '--brief', briefPath);
  assert.deepEqual(await cli(stateDir, 'list'), []);
  await writeFile(briefPath, brief);
  const admitted = await cli(stateDir, 'start', '--request-id', 'snapshot', '--brief', briefPath);
  await writeFile(briefPath, `${brief}Changed evidence.`);
  await cliError(stateDir, 'REQUEST_CONFLICT', 'start', '--request-id', 'snapshot', '--brief', briefPath);
  const same = await cli(stateDir, 'start', '--request-id', 'snapshot', '--brief-text', brief);
  assert.equal(same.id, admitted.id);
  assert.equal(same.brief.text, brief);
  assert.equal((await cli(stateDir, 'list')).length, 1);
  await running.stop();
});

test('graceful backend shutdown retains a stopped fixture instead of pending replay', { timeout: 30_000 }, async (t) => {
  const { stateDir, briefPath } = await workspace(t);
  const running = await backend(t, stateDir, ['--fixture', '--fixture-delay-ms', '60000']);
  const admitted = await cli(stateDir, 'start', '--request-id', 'shutdown', '--brief', briefPath);
  await until(() => cli(stateDir, 'inspect', admitted.id), (run) => Boolean(run.execution.submissionId));
  await running.stop();
  const stopped = await cli(stateDir, 'inspect', admitted.id);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.outcome.reviewReady, false);
  assert.equal(stopped.counters.modelAttempts, 1);
  const reopened = await backend(t, stateDir, ['--fixture']);
  assert.deepEqual(await cli(stateDir, 'inspect', admitted.id), stopped);
  await reopened.stop();
});

test('a crashed backend reopens passively and fences the interrupted run', { timeout: 30_000 }, async (t) => {
  const { stateDir, briefPath } = await workspace(t);
  const running = await backend(t, stateDir, ['--fixture', '--fixture-delay-ms', '60000']);
  const admitted = await cli(stateDir, 'start', '--request-id', 'crashed', '--brief', briefPath);
  const before = await until(() => cli(stateDir, 'inspect', admitted.id), (run) => Boolean(run.execution.submissionId));
  await running.stop('SIGKILL');
  const interrupted = await cli(stateDir, 'inspect', admitted.id);
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.deadlineAt, before.deadlineAt);
  assert.deepEqual(interrupted.counters, before.counters);
  const reopened = await backend(t, stateDir, ['--fixture']);
  assert.deepEqual(await cli(stateDir, 'inspect', admitted.id), interrupted);
  await cliError(stateDir, 'RUN_ACTIVE', 'start', '--request-id', 'must-not-wake-old', '--brief', briefPath);
  assert.deepEqual(await cli(stateDir, 'start', '--request-id', 'crashed', '--brief', briefPath), interrupted);
  assert.equal((await cli(stateDir, 'list')).length, 1);
  await cliError(stateDir, 'REVIEW_REQUIRED', 'replace', admitted.id, '--request-id', 'replacement');
  const replacement = await cli(stateDir, 'replace', admitted.id, '--request-id', 'replacement', '--review', 'Explicit replacement, not a resume.');
  assert.notEqual(replacement.id, admitted.id);
  assert.equal(replacement.replacesRunId, admitted.id);
  await until(() => cli(stateDir, 'inspect', replacement.id), (run) => run.status === 'completed');
  const retired = await cli(stateDir, 'inspect', admitted.id);
  assert.equal(retired.status, 'replaced');
  assert.equal(retired.replacedByRunId, replacement.id);
  assert.deepEqual(retired.counters, interrupted.counters);
  assert.equal(retired.execution.submissionId, interrupted.execution.submissionId);
  await reopened.stop();
});

test('CLI stop is terminal and an explicitly reviewed resume keeps the same submission and original budget', { timeout: 30_000 }, async (t) => {
  const { stateDir, briefPath } = await workspace(t);
  const running = await backend(t, stateDir, ['--fixture', '--fixture-delay-ms', '60000']);
  const run = await cli(stateDir, 'start', '--request-id', 'resume-original', '--brief', briefPath);
  const before = await until(() => cli(stateDir, 'inspect', run.id), (item) => Boolean(item.execution.submissionId));
  await running.stop('SIGKILL');
  const reopened = await backend(t, stateDir, ['--fixture']);
  await cliError(stateDir, 'REVIEW_REQUIRED', 'resume', run.id);
  await cli(stateDir, 'resume', run.id, '--review', 'Reviewed retained partial output. No tools were installed.');
  const done = await until(() => cli(stateDir, 'inspect', run.id), (item) => item.status === 'completed');
  assert.equal(done.execution.submissionId, before.execution.submissionId);
  assert.equal(done.execution.requestId, before.execution.requestId);
  assert.equal(done.requestId, 'resume-original');
  assert.equal(done.deadlineAt, before.deadlineAt);
  assert.equal(done.counters.modelAttempts, 2);
  assert.equal(done.counters.reservedOutputTokens, 16384);
  assert.equal(done.capabilities.resourceContainmentVerified, false);
  assert.equal(done.recovery.safety.kind, 'tool-free-fixture');
  await reopened.stop();
  const delayed = await backend(t, stateDir, ['--fixture', '--fixture-delay-ms', '60000']);
  const next = await cli(stateDir, 'start', '--request-id', 'stop-command', '--brief', briefPath);
  assert.equal((await cli(stateDir, 'stop', next.id)).status, 'stopped');
  await cliError(stateDir, 'RUN_NOT_INTERRUPTED', 'resume', next.id, '--review', 'Cannot revive a stopped run.');
  await delayed.stop();
});

test('crash reconciliation finds a committed execution receipt without resubmitting admission', { timeout: 30_000 }, async (t) => {
  const { stateDir, directory } = await workspace(t);
  const worker = fork(new URL('./crash-worker.mjs', import.meta.url), [stateDir], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: process.env.PATH, HOME: tmpdir() },
  });
  const kill = async () => {
    if (worker.exitCode !== null || worker.signalCode !== null) return;
    const exited = once(worker, 'exit');
    worker.kill('SIGKILL');
    await exited;
  };
  shutdowns.get(t).add(kill);
  let admitted;
  let output = '';
  worker.stderr.on('data', (data) => { output += data; });
  const committed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Crash checkpoint timed out: ${output}`)), 10_000);
    worker.on('message', (message) => {
      if (message.event === 'admitted') admitted = message.run;
      if (message.event === 'receipt-committed') { clearTimeout(timer); resolve(message); }
    });
    worker.on('exit', () => { clearTimeout(timer); reject(new Error(`Crash fixture exited: ${output}`)); });
    worker.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
  const checkpoint = await committed;
  assert.equal(checkpoint.runId, admitted.id);
  assert.equal(admitted.execution.submissionId, undefined);
  await kill();
  const reconciled = await cli(stateDir, 'inspect', admitted.id);
  assert.equal(reconciled.status, 'interrupted');
  assert.ok(reconciled.execution.submissionId);
  assert.equal(reconciled.deadlineAt, admitted.deadlineAt);
  assert.equal(reconciled.counters.modelAttempts, 1);
  const backupDir = join(directory, 'interrupted-backup');
  await cli(stateDir, 'backup', '--to', backupDir);
  for (const name of ['restored-one', 'restored-two']) {
    const target = join(directory, name);
    await cli(target, 'restore', '--from', backupDir);
    assert.deepEqual(await cli(target, 'inspect', admitted.id), reconciled);
  }
  const reopened = await backend(t, stateDir, ['--fixture']);
  assert.deepEqual(await cli(stateDir, 'inspect', admitted.id), reconciled);
  assert.deepEqual(await cli(stateDir, 'start', '--request-id', 'crash-window-request', '--brief-text', brief), reconciled);
  assert.equal((await cli(stateDir, 'list')).length, 1);
  await reopened.stop();
});
