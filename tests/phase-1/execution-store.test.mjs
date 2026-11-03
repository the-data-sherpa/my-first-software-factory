import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, readFile, writeFile, symlink, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { applySqliteMigrations, SQLITE_MIGRATIONS } from '@earendil-works/pi-durable/storage/sqlite';
import { openNodeSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/node';
import { openFactory, backupFactory, restoreFactory } from '../../src/factory.mjs';
import { createFixtureExecution, inspectExecution } from '../../src/execution.mjs';
import { until } from '../phase-0/helpers.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function closedFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'factory-storage-'));
  let factory;
  t.after(async () => {
    try { await factory?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  const stateDir = join(directory, 'state');
  factory = await openFactory({ stateDir, execution: createFixtureExecution() });
  const admitted = await factory.startRun({ requestId: 'storage-fixture', brief: 'Goal: Verify storage.\nAcceptance criteria: Retain evidence.\nEvidence: A controlled fixture.' });
  await until(() => factory.inspectRun(admitted.id), (run) => run.status === 'completed');
  await factory.close();
  const backupDir = join(directory, 'backup');
  await backupFactory({ stateDir, destination: backupDir });
  const manifestPath = join(backupDir, 'backup-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const executionFile = manifest.files.find((file) => file.path.endsWith('/execution.sqlite')).path;
  return { directory, stateDir, backupDir, manifestPath, manifest, executionFile };
}

async function futureSchema(path) {
  // Arrange an unsupported external SDK schema through its public migration interface.
  const database = await openNodeSqliteDatabase(path);
  try {
    await applySqliteMigrations(database, [...SQLITE_MIGRATIONS, { version: SQLITE_MIGRATIONS.length + 1, statements: [] }]);
  } finally { await database.close(); }
}

test('passive execution inspection neither changes journal mode nor rewrites the database', async (t) => {
  const fixture = await closedFixture(t);
  const path = join(fixture.stateDir, fixture.executionFile);
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode=DELETE'); // OS fixture, not an assertion on SDK internals.
  database.close();
  const before = hash(await readFile(path));
  assert.equal((await inspectExecution(dirname(path))).status, 'done');
  assert.equal(hash(await readFile(path)), before);
});

test('passive inspection leaves an execution file cut off before initialization untouched', async (t) => {
  const fixture = await closedFixture(t);
  const path = join(fixture.stateDir, fixture.executionFile);
  await writeFile(path, '');
  assert.deepEqual(await inspectExecution(dirname(path)), { status: 'missing' });
  assert.equal((await readFile(path)).length, 0);
});

test('passive inspection refuses linked SQLite sidecars without touching their targets', async (t) => {
  const fixture = await closedFixture(t);
  const path = join(fixture.stateDir, fixture.executionFile);
  const target = join(fixture.directory, 'outside-sentinel');
  await writeFile(target, 'Do not change this sentinel.', { mode: 0o600 });
  const before = await readFile(target, 'utf8');
  await symlink(target, `${path}-shm`);
  await assert.rejects(inspectExecution(dirname(path)), { code: 'PRIVATE_STORAGE_REQUIRED' });
  assert.equal(await readFile(target, 'utf8'), before);
});

test('passive inspection fences redirected run directories within the supplied state root', async (t) => {
  const fixture = await closedFixture(t);
  const directory = dirname(join(fixture.stateDir, fixture.executionFile));
  const outside = join(fixture.directory, 'moved-execution');
  await rename(directory, outside);
  await symlink(outside, directory);
  await assert.rejects(inspectExecution(directory, { stateRoot: fixture.stateDir }), { code: 'PRIVATE_STORAGE_REQUIRED' });
});

test('backup refuses to advertise compatibility with an unsupported execution schema', async (t) => {
  const fixture = await closedFixture(t);
  await futureSchema(join(fixture.stateDir, fixture.executionFile));
  await assert.rejects(backupFactory({ stateDir: fixture.stateDir, destination: join(fixture.directory, 'unsupported-backup') }), { code: 'STORAGE_VERSION' });
});

test('restore validates execution compatibility even when digests and declared versions match', async (t) => {
  const fixture = await closedFixture(t);
  const path = join(fixture.backupDir, fixture.executionFile);
  await futureSchema(path);
  fixture.manifest.files.find((file) => file.path === fixture.executionFile).sha256 = hash(await readFile(path));
  await writeFile(fixture.manifestPath, JSON.stringify(fixture.manifest));
  await assert.rejects(restoreFactory({ stateDir: join(fixture.directory, 'unsupported-restore'), backupDir: fixture.backupDir }), { code: 'STORAGE_VERSION' });
});
