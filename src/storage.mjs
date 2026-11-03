import { DatabaseSync } from 'node:sqlite';
import { lstat, mkdir, open, realpath, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';

export const STORAGE_VERSIONS = Object.freeze({ factory: 1, execution: 1, durableSqlite: 2, piDurable: '1.5.0' });
export const ACTIVE_STATUSES = ['admitted', 'running', 'interrupted'];

export class FactoryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export async function privateDirectory(path, { create = true, newOnly = false, notWithin = [], mustBeWithin } = {}) {
  // Resolve existing ancestors before creating anything, including paths through symlinks.
  let ancestor = resolve(path);
  const suffix = [];
  while (true) {
    try { ancestor = await realpath(ancestor); break; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      suffix.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
  const canonical = join(ancestor, ...suffix);
  if (mustBeWithin && !within(mustBeWithin, canonical)) throw new FactoryError('PRIVATE_STORAGE_REQUIRED', 'Run storage cannot leave the configured private state root.');
  if (notWithin.some((root) => within(root, canonical))) throw new FactoryError('INVALID_DESTINATION', 'The destination must be outside the source directory.');
  for (let parent = canonical; ; parent = dirname(parent)) {
    const git = await lstat(join(parent, '.git')).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (git) throw new FactoryError('PRIVATE_STORAGE_REQUIRED', 'Factory state and backups must be outside Git repositories.');
    if (dirname(parent) === parent) break;
  }
  if (newOnly) {
    await mkdir(dirname(canonical), { recursive: true, mode: 0o700 });
    try { await mkdir(canonical, { mode: 0o700 }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new FactoryError('DESTINATION_EXISTS', 'Choose a new destination. Existing state is never overwritten.');
      throw error;
    }
  } else if (create) await mkdir(canonical, { recursive: true, mode: 0o700 });
  const info = await lstat(canonical);
  if (!info.isDirectory() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) {
    throw new FactoryError('PRIVATE_STORAGE_REQUIRED', 'Use an owner-only directory (mode 0700).');
  }
  return canonical;
}

export async function privateFile(path) {
  let file;
  try { file = await open(path, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (error.code === 'ELOOP') throw new FactoryError('PRIVATE_STORAGE_REQUIRED', 'Factory files cannot be symbolic links.');
    throw error;
  }
  await file.close();
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) {
    throw new FactoryError('PRIVATE_STORAGE_REQUIRED', 'Factory files must be owner-only regular files (mode 0600).');
  }
}

export async function acquireOwner(stateDir) {
  const path = join(stateDir, 'owner.sqlite');
  await privateFile(path);
  const database = new DatabaseSync(path);
  try { database.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE'); }
  catch {
    database.close();
    throw new FactoryError('BACKEND_OWNED', 'Another backend owns this factory. Inspect it through the CLI.');
  }
  return () => database.close(); // The OS releases this lock even after SIGKILL; no stale PID-file takeover.
}

export async function openRecords(stateDir, { readOnly = false } = {}) {
  const path = join(stateDir, 'factory.sqlite');
  if (!readOnly) await privateFile(path);
  const database = new DatabaseSync(path, { readOnly });
  try {
    const version = database.prepare('PRAGMA user_version').get().user_version;
    if (version === 0 && !readOnly) {
      database.exec(`BEGIN;
        CREATE TABLE runs (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, record TEXT NOT NULL);
        CREATE UNIQUE INDEX one_active_run ON runs ((1)) WHERE status IN ('admitted', 'running', 'interrupted');
        PRAGMA user_version=1;
        COMMIT;`);
    } else if (version !== STORAGE_VERSIONS.factory) {
      throw new FactoryError('STORAGE_VERSION', 'This factory storage version is not supported. Keep a closed-store backup before migration.');
    }
    const decode = (row) => row ? JSON.parse(row.record) : undefined;
    const save = (record) => database.prepare(`INSERT INTO runs VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, record=excluded.record`).run(
      record.id, record.requestId, record.status, JSON.stringify(record));
    return {
      get: (id) => decode(database.prepare('SELECT record FROM runs WHERE id=?').get(id)),
      byRequest: (id) => decode(database.prepare('SELECT record FROM runs WHERE request_id=?').get(id)),
      active: () => decode(database.prepare("SELECT record FROM runs WHERE status IN ('admitted', 'running', 'interrupted')").get()),
      list: () => database.prepare('SELECT record FROM runs ORDER BY rowid').all().map(decode),
      save,
      saveTogether: (...runs) => {
        database.exec('BEGIN IMMEDIATE');
        try { for (const run of runs) save(run); database.exec('COMMIT'); }
        catch (error) { database.exec('ROLLBACK'); throw error; }
      },
      close: () => database.close(),
    };
  } catch (error) { database.close(); throw error; }
}

function within(root, path) {
  const local = relative(root, path);
  return local === '' || (local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local));
}

async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function filesBelow(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (directory === root && (entry.name.startsWith('owner.sqlite') || entry.name === 'backend.sock')) continue;
    const path = join(directory, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) || (info.mode & 0o077)
      || (process.getuid && info.uid !== process.getuid())) {
      throw new FactoryError('PRIVATE_STORAGE_REQUIRED', 'Backups require owner-only regular files and directories, without symbolic links.');
    }
    if (entry.name.endsWith('.sqlite-shm') && info.isFile()) continue; // Validate, but do not archive rebuildable WAL indexes.
    if (info.isDirectory()) files.push(...await filesBelow(root, path));
    else files.push(relative(root, path));
  }
  return files.sort();
}

export async function backupFactory({ stateDir, destination }, validateExecutions) {
  if (!stateDir || !destination) throw new FactoryError('INVALID_ARGUMENTS', 'Supply a state directory and backup destination.');
  stateDir = await privateDirectory(stateDir, { create: false });
  const release = await acquireOwner(stateDir);
  try {
    const records = await openRecords(stateDir, { readOnly: true });
    let runs;
    try { runs = records.list(); } finally { records.close(); }
    await validateExecutions(stateDir, runs);
    const files = await filesBelow(stateDir);
    destination = await privateDirectory(destination, { newOnly: true, notWithin: [stateDir] });
    const manifest = { formatVersion: 1, storageVersions: { ...STORAGE_VERSIONS },
      ...(runs.some((run) => run.workspace?.intent) ? { workspaceRelocationRequired: true } : {}), files: [] };
    for (const path of files) {
      const target = join(destination, path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(join(stateDir, path), target, constants.COPYFILE_EXCL);
      manifest.files.push({ path, sha256: await digest(target) });
    }
    await writeFile(join(destination, 'backup-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return { destination, storageVersions: manifest.storageVersions, files: manifest.files.length };
  } finally { release(); }
}

export async function restoreFactory({ stateDir, backupDir }, validateExecutions) {
  if (!stateDir || !backupDir) throw new FactoryError('INVALID_ARGUMENTS', 'Supply a new state directory and backup source.');
  backupDir = await privateDirectory(backupDir, { create: false });
  const release = await acquireOwner(backupDir);
  try { return await restoreClosed({ stateDir, backupDir }, validateExecutions); }
  finally { release(); }
}

async function restoreClosed({ stateDir, backupDir }, validateExecutions) {
  const actualFiles = await filesBelow(backupDir);
  let manifest;
  try { manifest = JSON.parse(await readFile(join(backupDir, 'backup-manifest.json'), 'utf8')); }
  catch { throw new FactoryError('INVALID_BACKUP', 'The backup manifest is missing or unreadable.'); }
  const versions = manifest.storageVersions;
  if (manifest.formatVersion !== 1 || !versions || Object.keys(STORAGE_VERSIONS).some((key) => versions[key] !== STORAGE_VERSIONS[key])) {
    throw new FactoryError('STORAGE_VERSION', 'The backup storage versions are not supported.');
  }
  if (!Array.isArray(manifest.files) || !manifest.files.some((file) => file.path === 'factory.sqlite')) {
    throw new FactoryError('INVALID_BACKUP', 'The backup has no factory record store.');
  }
  const expected = new Set(['backup-manifest.json']);
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || !file.path || isAbsolute(file.path)
      || !within(backupDir, resolve(backupDir, file.path)) || expected.has(file.path)
      || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new FactoryError('INVALID_BACKUP', 'The backup file inventory is invalid.');
    }
    expected.add(file.path);
  }
  if (actualFiles.length !== expected.size || actualFiles.some((path) => !expected.has(path))) {
    throw new FactoryError('INVALID_BACKUP', 'The backup file inventory does not match its manifest.');
  }
  for (const file of manifest.files) {
    if (await digest(join(backupDir, file.path)) !== file.sha256) throw new FactoryError('INVALID_BACKUP', 'A backup file does not match its recorded digest.');
  }
  const sourceRecords = await openRecords(backupDir, { readOnly: true });
  let runs;
  try { runs = sourceRecords.list(); } finally { sourceRecords.close(); }
  if (runs.some((run) => run.workspace?.intent)) {
    throw new FactoryError('WORKSPACE_RELOCATION_REQUIRED', 'The archive contains workspace identities and Git pointers tied to their original private paths. Restore requires relocation support, which is not enabled. No destination was created.');
  }
  await validateExecutions(backupDir, runs);
  stateDir = await privateDirectory(stateDir, { newOnly: true, notWithin: [backupDir] });
  for (const file of manifest.files) {
    const target = join(stateDir, file.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(join(backupDir, file.path), target, constants.COPYFILE_EXCL);
    if (await digest(target) !== file.sha256) throw new FactoryError('INVALID_BACKUP', 'The copied backup failed digest verification. Retain it for inspection.');
  }
  const records = await openRecords(stateDir, { readOnly: true });
  records.close();
  return { stateDir, storageVersions: { ...STORAGE_VERSIONS } };
}
