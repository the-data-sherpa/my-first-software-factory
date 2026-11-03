import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { InMemoryCredentialStore, InMemoryModelsStore, createModels } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { Harness, createRegistry, defineDoc } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { SqliteStorage, CURRENT_SQLITE_SCHEMA_VERSION } from '@earendil-works/pi-durable/storage/sqlite';
import { privateFile, privateDirectory, STORAGE_VERSIONS, FactoryError } from './storage.mjs';

const Receipt = defineDoc({
  kind: 'factory.execution', version: 1, scope: 'session',
  initial: () => ({}), checkpointWhen: () => true,
});
const settings = {
  retry: { enabled: false, maxRetries: 0 }, compaction: { enabled: false },
  stream: { maxRetries: 0, timeoutMs: 180_000 }, afterFailedRun: 'withdraw',
};

async function result(harness) {
  const receipt = await harness.snapshot(Receipt, context);
  if (!receipt?.submissionId) return { status: 'missing' };
  const submission = await harness.submission(receipt.submissionId, context);
  if (!submission) return { status: 'missing', submissionId: receipt.submissionId };
  const settled = await submission.status(context); // Lookup only; never wait or resubmit during inspection.
  const identity = { submissionId: receipt.submissionId, runId: receipt.runId, requestId: receipt.requestId };
  if (settled.status !== 'done') return { ...identity, status: settled.status, reason: settled.reason };
  const root = await harness.root(context);
  const answer = await root.commit((tx) => tx.entry(settled.answer), context);
  const message = answer?.model?.[0];
  if (message?.role !== 'assistant' || message.stopReason !== 'stop') {
    return { ...identity, status: 'unanswered', reason: 'incomplete_answer' };
  }
  return { ...identity, status: 'done', answer: message.content.filter((block) => block.type === 'text').map((block) => block.text).join('') };
}

async function passiveFile(path) {
  let info;
  try { info = await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!info.isFile() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) {
    throw new FactoryError('PRIVATE_STORAGE_REQUIRED', 'Execution storage and sidecars must be owner-only regular files.');
  }
  return info;
}

async function passiveStorage(path) {
  const info = await passiveFile(path);
  if (!info || info.size === 0) return; // A crash before initialization is not permission to initialize on inspection.
  let database;
  let closed = false;
  const close = async () => { if (!closed && database) { closed = true; database.close(); } };
  try {
    const wal = await passiveFile(`${path}-wal`);
    await passiveFile(`${path}-shm`);
    const location = pathToFileURL(path);
    location.searchParams.set('mode', 'ro');
    // Callers fence closed stores. Immutable avoids creating WAL sidecars only when no WAL data exists.
    // Never ignore a nonempty WAL: it may contain the crashed run's committed receipts.
    if (!wal?.size) location.searchParams.set('immutable', '1');
    database = new DatabaseSync(location.href, { readOnly: true });
    database.exec('BEGIN'); // Hold one native read snapshot. Never enable WAL or checkpoint on close.
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all();
    if (tables.length === 0) { await close(); return; }
    const schema = database.prepare('SELECT version FROM durable_schema WHERE singleton=1').get();
    if (schema?.version !== CURRENT_SQLITE_SCHEMA_VERSION || schema.version !== STORAGE_VERSIONS.durableSqlite) {
      throw new FactoryError('STORAGE_VERSION', 'The execution storage schema is not supported. Inspection never migrates it.');
    }
    // The pinned SDK always issues these two bootstrap writes, even for a current schema.
    // Validate that schema first, then acknowledge ONLY those exact no-op initializers.
    // Every actual SQLite connection is native read-only; every other write is rejected.
    let initializing = true;
    const deny = () => { throw new FactoryError('READ_ONLY_STORAGE', 'Passive execution storage refuses writes.'); };
    const normalize = (sql) => sql.replace(/\s+/g, ' ').trim();
    const facade = {
      get: async (sql, ...values) => database.prepare(sql).get(...values),
      all: async (sql, ...values) => database.prepare(sql).all(...values),
      exec: async (sql) => {
        if (initializing && normalize(sql) === 'CREATE TABLE IF NOT EXISTS durable_schema ( singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL CHECK (version >= 0) ) STRICT') return;
        deny();
      },
      run: async (sql) => {
        if (initializing && normalize(sql) === 'INSERT OR IGNORE INTO durable_schema (singleton, version) VALUES (1, 0)') return;
        deny();
      },
      transaction: async (callback) => callback(facade),
      close,
    };
    const storage = await SqliteStorage.open(facade);
    initializing = false;
    return storage;
  } catch (error) {
    await close();
    if (error instanceof FactoryError) throw error;
    throw new FactoryError('STORAGE_VERSION', 'Execution storage is unreadable or incompatible. Retain it for inspection.');
  }
}

export async function inspectExecution(directory, { stateRoot } = {}) {
  try { directory = await privateDirectory(directory, { create: false, mustBeWithin: stateRoot }); }
  catch (error) { if (error.code === 'ENOENT') return { status: 'missing' }; throw error; }
  const storage = await passiveStorage(join(directory, 'execution.sqlite'));
  if (!storage) return { status: 'missing' };
  let harness;
  try {
    harness = await Harness.open(storage, {
      readOnly: true, models: createModels(), registry: createRegistry(), settings,
    }, context);
    return await result(harness);
  } finally {
    if (harness) await harness.close(context);
    else await storage.close(context);
  }
}

export async function validateExecutionStores(stateDir, runs) {
  for (const run of runs) {
    const receipt = await inspectExecution(join(stateDir, 'runs', run.id), { stateRoot: stateDir });
    if ((receipt.runId && (receipt.runId !== run.id || receipt.requestId !== run.execution.requestId))
      || (run.execution.submissionId !== undefined && receipt.submissionId !== run.execution.submissionId)
      || (run.status === 'completed' && receipt.status !== 'done')) {
      throw new FactoryError('STORAGE_VERSION', 'Execution storage does not match its retained factory record.');
    }
  }
}

/** Explicit controlled adapter. It loads no user configuration or credentials and installs no tools. */
export function createFixtureExecution({ delayMs = 0, answer = 'Controlled fixture complete. No repository work was performed.' } = {}) {
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) throw new RangeError('Invalid fixture delay');
  return {
    mode: 'fixture', model: 'factory-fixture/no-tools-v1',
    async start({ directory, runId, requestId, brief }) {
      const path = join(directory, 'execution.sqlite');
      await privateFile(path);
      const models = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
        modelsPath: null, refreshOnCreate: false, allowModelNetwork: false,
      });
      const faux = fauxProvider({ provider: 'factory-fixture', models: [{ id: 'no-tools-v1', maxTokens: 8192 }], tokensPerSecond: Infinity });
      faux.setResponses([async (_transcript, options) => {
        await delay(delayMs, undefined, { signal: options?.signal });
        return fauxAssistantMessage(answer);
      }]);
      models.registerNativeProvider(faux.provider);
      const harness = await Harness.open(await openNodeSqliteStorage(path), {
        models, registry: createRegistry(), settings,
      }, context);
      try {
        const root = await harness.root(context, { agent: {
          model: { provider: 'factory-fixture', modelId: 'no-tools-v1' }, tools: [], maxTurns: 1,
        } });
        // This receipt is atomic with admission in the EXECUTION store, not with the factory store.
        const submissionId = await harness.commit(async (tx) => {
          const id = await root.submit(tx, { type: 'input', content: brief.text, requestId });
          Object.assign(await tx.doc(Receipt), { version: STORAGE_VERSIONS.execution, runId, requestId, submissionId: id });
          return id;
        }, context);
        harness.resume();
        const submission = await harness.submission(submissionId, context);
        const finished = submission.wait(context).then(() => result(harness));
        finished.catch(() => {});
        return { submissionId, finished, cancel: () => root.abort(context), close: () => harness.close(context) };
      } catch (error) { await harness.close(context); throw error; }
    },
  };
}
