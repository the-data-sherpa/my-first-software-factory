import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, lstat, readdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openFactory, inspectHistory, backupFactory, restoreFactory } from '../../src/factory.mjs';
import { createFixtureExecution } from '../../src/execution.mjs';
import { until } from '../phase-0/helpers.mjs';

const brief = 'Goal: Exercise a controlled run.\nAcceptance criteria:\n- Retain the result after reconnecting.\nEvidence:\n- Fixture context; https://example.invalid is a citation only.\n';

async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'factory-phase1-'));
  const factories = [];
  const releases = [];
  t.after(async () => {
    try { for (const release of releases) release(); for (const factory of factories.reverse()) await factory.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  const stateDir = join(directory, 'state');
  const project = { id: 'vanguard', repositoryPath: join(directory, 'repository') };
  await mkdir(project.repositoryPath);
  const factory = await openFactory({ stateDir, project, execution: createFixtureExecution(options) });
  factories.push(factory);
  return { directory, stateDir, project, factory, closeLater: (other) => factories.push(other), beforeClose: (release) => releases.push(release) };
}

test('an admitted fixture run retains its brief, limits, receipt, and honest outcome after reopening', async (t) => {
  const { factory, stateDir, project, closeLater } = await setup(t);
  const admitted = await factory.startRun({ requestId: 'owner-request-1', brief });
  const done = await until(() => factory.inspectRun(admitted.id), (run) => run.status === 'completed');
  assert.equal(done.brief.text, brief);
  assert.deepEqual(done.project, project);
  assert.equal(done.requestId, 'owner-request-1');
  assert.equal(done.limits.runDeadlineMs, 1_200_000);
  assert.equal(done.limits.toolRounds, 30);
  assert.equal(done.limits.modelAttempts, 40);
  assert.equal(done.deadlineAt - done.admittedAt, 1_200_000);
  assert.notEqual(done.id, done.execution.submissionId);
  assert.equal(done.execution.mode, 'fixture');
  assert.equal(done.outcome.kind, 'fixture-completed');
  assert.equal(done.outcome.reviewReady, false);
  assert.equal(done.outcome.answer, 'Controlled fixture complete. No repository work was performed.');
  await factory.close();
  assert.deepEqual(await inspectHistory({ stateDir, runId: done.id }), done);
  const reopened = await openFactory({ stateDir, project, execution: createFixtureExecution() });
  closeLater(reopened);
  assert.deepEqual(await reopened.inspectRun(done.id), done);
});

test('stable admission IDs preserve one immutable snapshot and reject changed input', async (t) => {
  const { factory } = await setup(t, { delayMs: 100 });
  const first = await factory.startRun({ requestId: 'stable', brief });
  first.brief.text = 'a caller cannot mutate admission';
  const duplicate = await factory.startRun({ requestId: 'stable', brief });
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.brief.text, brief);
  await assert.rejects(factory.startRun({ requestId: 'stable', brief: `${brief}Changed evidence.` }), { code: 'REQUEST_CONFLICT' });
  const done = await until(() => factory.inspectRun(first.id), (run) => run.status === 'completed');
  assert.equal(done.counters.modelAttempts, 1);
  assert.equal((await factory.listRuns()).length, 1);
});

test('concurrent admission rejects another run with the active identity and inspection instructions', async (t) => {
  const { factory } = await setup(t, { delayMs: 100 });
  const starts = await Promise.allSettled([
    factory.startRun({ requestId: 'first', brief }), factory.startRun({ requestId: 'second', brief }),
  ]);
  assert.equal(starts[0].status, 'fulfilled');
  assert.equal(starts[1].status, 'rejected');
  assert.equal(starts[1].reason.code, 'RUN_ACTIVE');
  assert.equal(starts[1].reason.details.activeRunId, starts[0].value.id);
  assert.match(starts[1].reason.message, new RegExp(`inspect ${starts[0].value.id}`));
  assert.equal((await factory.listRuns()).length, 1);
});

test('a lifetime owner lock excludes a second backend and releases on close', async (t) => {
  const { factory, stateDir, project } = await setup(t);
  await assert.rejects(openFactory({ stateDir, project }), { code: 'BACKEND_OWNED' });
  await assert.rejects(inspectHistory({ stateDir }), { code: 'BACKEND_OWNED' });
  await assert.rejects(backupFactory({ stateDir, destination: `${stateDir}-backup` }), { code: 'BACKEND_OWNED' });
  await factory.close();
  const next = await openFactory({ stateDir, project });
  await next.close();
});

test('shutdown retains ownership until finalization drains even if cancellation races with SDK close', { timeout: 10_000 }, async (t) => {
  const { factory, stateDir, project, closeLater, beforeClose } = await setup(t);
  await factory.close();
  const entered = Promise.withResolvers();
  const gate = Promise.withResolvers();
  const fixture = createFixtureExecution();
  const controlled = await openFactory({ stateDir, project, execution: {
    ...fixture,
    async start(input) {
      const handle = await fixture.start(input);
      return { ...handle, close: async () => {
        await handle.close();
        entered.resolve();
        await gate.promise;
      } };
    },
  } });
  closeLater(controlled);
  beforeClose(() => gate.resolve());
  const admitted = await controlled.startRun({ requestId: 'closing-race', brief });
  await entered.promise;
  const closing = controlled.close();
  closing.catch(() => {});
  try {
    let unexpected;
    try { unexpected = await openFactory({ stateDir, project }); }
    catch (error) { assert.equal(error.code, 'BACKEND_OWNED'); }
    if (unexpected) { await unexpected.close(); assert.fail('Ownership was released before finalization drained'); }
  } finally { gate.resolve(); }
  await closing;
  assert.equal((await inspectHistory({ stateDir, runId: admitted.id })).status, 'stopped');
});

test('brief validation is byte-bounded, requires all sections, and leaves no rejected admission', async (t) => {
  const { factory } = await setup(t);
  for (const invalid of ['Goal: Missing the other sections.', `${brief}${'é'.repeat(32_768)}`, 42]) {
    await assert.rejects(factory.startRun({ requestId: 'invalid', brief: invalid }), { code: 'INVALID_BRIEF' });
  }
  assert.deepEqual(await factory.listRuns(), []);
  const boundary = brief + 'x'.repeat(65_536 - Buffer.byteLength(brief));
  const run = await factory.startRun({ requestId: 'boundary', brief: boundary });
  assert.equal(Buffer.byteLength((await factory.inspectRun(run.id)).brief.text), 65_536);
});

test('plain brief fields allow text immediately after their colon', async (t) => {
  const { factory } = await setup(t);
  const text = 'Goal:Normalize whitespace\nAcceptance criteria:Preserve units\nEvidence:Fixture context';
  const admitted = await factory.startRun({ requestId: 'compact-fields', brief: text });
  assert.equal(admitted.brief.goal, 'Normalize whitespace');
  assert.equal(admitted.brief.acceptanceCriteria, 'Preserve units');
  assert.equal(admitted.brief.evidence, 'Fixture context');
});

test('production mode never silently substitutes a fixture', async (t) => {
  const { factory, stateDir, project, closeLater } = await setup(t);
  await factory.close();
  const production = await openFactory({ stateDir, project });
  closeLater(production);
  await assert.rejects(production.startRun({ requestId: 'production', brief }), { code: 'MODEL_NOT_READY' });
  assert.deepEqual(await production.listRuns(), []);
});

test('successive completed runs retain distinct receipts without overlapping ownership', async (t) => {
  const { factory } = await setup(t);
  const receipts = new Set();
  for (let index = 0; index < 5; index++) {
    const admitted = await factory.startRun({ requestId: `sequence-${index}`, brief });
    const done = await until(() => factory.inspectRun(admitted.id), (run) => run.status === 'completed');
    assert.equal(done.outcome.kind, 'fixture-completed');
    receipts.add(`${done.id}/${done.execution.submissionId}`);
  }
  assert.equal(receipts.size, 5);
  assert.equal((await factory.listRuns()).length, 5);
});

test('state, receipts, and backups stay in owner-only files outside repositories', async (t) => {
  const { factory, stateDir, directory } = await setup(t);
  const run = await factory.startRun({ requestId: 'private', brief });
  await until(() => factory.inspectRun(run.id), (item) => item.status === 'completed');
  await factory.close();
  const backupDir = join(directory, 'backup');
  await backupFactory({ stateDir, destination: backupDir });
  async function check(path) {
    const info = await lstat(path);
    assert.equal(info.mode & 0o077, 0);
    if (info.isDirectory()) for (const child of await readdir(path)) await check(join(path, child));
  }
  await check(stateDir);
  await check(backupDir);
  const repository = join(directory, 'public-repository');
  await mkdir(join(repository, '.git'), { recursive: true });
  await assert.rejects(openFactory({ stateDir: join(repository, 'state') }), { code: 'PRIVATE_STORAGE_REQUIRED' });
  await assert.rejects(backupFactory({ stateDir, destination: join(repository, 'backup') }), { code: 'PRIVATE_STORAGE_REQUIRED' });
});

test('restore rejects unsupported versions, damaged contents, and overwriting existing state', async (t) => {
  const { factory, stateDir, directory } = await setup(t);
  const run = await factory.startRun({ requestId: 'restore-integrity', brief });
  await until(() => factory.inspectRun(run.id), (item) => item.status === 'completed');
  await factory.close();
  const backupDir = join(directory, 'backup');
  await backupFactory({ stateDir, destination: backupDir });
  await assert.rejects(restoreFactory({ stateDir, backupDir }), { code: 'DESTINATION_EXISTS' });
  const path = join(backupDir, 'backup-manifest.json');
  const original = await readFile(path, 'utf8');
  const manifest = JSON.parse(original);
  manifest.storageVersions.factory = 999;
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(restoreFactory({ stateDir: join(directory, 'unsupported'), backupDir }), { code: 'STORAGE_VERSION' });
  await writeFile(path, original);
  const artifact = JSON.parse(original).files[0].path;
  await writeFile(join(backupDir, artifact), 'damaged backup');
  await assert.rejects(restoreFactory({ stateDir: join(directory, 'damaged'), backupDir }), { code: 'INVALID_BACKUP' });
});

test('a redirected run directory blocks execution without writing outside the state root', async (t) => {
  const { factory, stateDir, directory } = await setup(t);
  const outside = join(directory, 'outside');
  await mkdir(outside, { mode: 0o700 });
  await symlink(outside, join(stateDir, 'runs'));
  const admitted = await factory.startRun({ requestId: 'redirected-state', brief });
  const terminal = await until(() => factory.inspectRun(admitted.id), (run) => ['completed', 'failed'].includes(run.status));
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.counters.modelAttempts, 0);
  assert.deepEqual(await readdir(outside), []);
});

test('backup rejects symlinks rather than copying host-private paths', async (t) => {
  const { factory, stateDir, directory } = await setup(t);
  await factory.close();
  const outside = join(directory, 'outside.txt');
  await writeFile(outside, 'outside sentinel');
  await symlink(outside, join(stateDir, 'unexpected-link'));
  await assert.rejects(backupFactory({ stateDir, destination: join(directory, 'backup') }), { code: 'PRIVATE_STORAGE_REQUIRED' });
  assert.equal(await readFile(outside, 'utf8'), 'outside sentinel');
});
