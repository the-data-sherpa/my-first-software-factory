import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, git } from './workspace-fixture.mjs';

const exec = promisify(execFile);
const worker = fileURLToPath(new URL('./run-tools-worker.mjs', import.meta.url));
async function runScoped(f, scenario) {
  const unit = `factory-contained-${randomUUID()}.scope`;
  try {
   const { stdout } = await exec('/usr/bin/systemd-run', ['--user', '--scope', '--quiet', '--collect', `--unit=${unit}`,
    '--property=MemoryMax=4294967296', '--property=MemorySwapMax=0', '--property=TasksMax=256', '--property=OOMPolicy=kill',
    '--', process.execPath, worker, f.stateDir, f.repositoryPath, scenario], {
    timeout: 20_000, maxBuffer: 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', HOME: f.root, XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus` },
  });
   return JSON.parse(stdout);
  } finally {
    await exec('/usr/bin/systemctl', ['--user', 'stop', unit]).catch(() => {});
    await exec('/usr/bin/systemctl', ['--user', 'reset-failed', unit]).catch(() => {});
  }
}

test('admitted exact-source worktrees feed verified bounded tools with original run budgets and hidden Git metadata', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const before = git(f.repositoryPath, 'status', '--porcelain=v1');
  const { run, checks, verification } = await runScoped(f, 'complete');
  assert.equal(run.workspace.receipt.baseCommit, f.base);
  assert.equal(run.counters.toolRounds, 8);
  assert.equal(run.counters.modelAttempts, 1);
  assert.equal(run.reservations.filter((item) => item.kind === 'tool-round' && item.state === 'settled').length, 8);
  assert.equal(run.outcome.reviewReady, false);
  assert.equal(verification.probe.hidden, true);
  assert.equal(verification.envelope.memoryBytes, 4294967296);
  assert.equal(checks.length, 2);
  assert.ok(checks.every((check) => check.status === 'settled' && check.passed));
  assert.notEqual(checks[0].sourceDigest, checks[1].sourceDigest);
  assert.equal(await readFile(join(run.workspace.receipt.worktree, 'draft.txt'), 'utf8'), 'controlled draft\n');
  assert.equal((await readdir(run.workspace.receipt.worktree)).includes('late.txt'), false);
  assert.equal(git(f.repositoryPath, 'status', '--porcelain=v1'), before);
});

test('application stop joins its real contained tools before releasing active admission', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const { run, checks } = await runScoped(f, 'stop');
  assert.equal(run.status, 'stopped');
  assert.equal(run.stopRequested, true);
  assert.equal(run.counters.toolRounds, 2);
  assert.equal(run.counters.modelAttempts, 0);
  assert.ok(checks.every((check) => check.status === 'settled'));
  assert.equal((await readdir(run.workspace.receipt.worktree)).includes('late.txt'), false);
});
