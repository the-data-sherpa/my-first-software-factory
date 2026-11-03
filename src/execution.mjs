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

// The factory owns this interface. Diagnostics-only exports are intentionally not re-exported here.
export { createModelRequests, MODEL_ROUTE, MODEL_LIMITS } from './model.mjs';
export { createModelExecution } from './model-execution.mjs';
// Internal factory adapter building blocks; never expose SDK handles to the app or CLI.
export { Receipt as executionReceiptDocument, result as readExecutionResult };
export { createRunTools } from './run-tools.mjs';
export { createContainedExecution, verifyContainmentEnvelope, inspectContainedChecks, CONTAINMENT_LIMITS, ContainmentError } from './containment.mjs';

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
  const identity = { submissionId: receipt.submissionId, runId: receipt.runId, requestId: receipt.requestId,
    ...(receipt.safety ? { safety: receipt.safety } : {}) };
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

/** Explicit controlled adapter. It loads no user configuration or credentials and installs no tools.
 * Recovery proves only that this in-process, tool-free fixture has no surviving external effects.
 * It does not verify any production containment boundary.
 */
export function createFixtureExecution({ delayMs = 0, transientFailures = 0, answer = 'Controlled fixture complete. No repository work was performed.' } = {}) {
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) throw new RangeError('Invalid fixture delay');
  if (!Number.isInteger(transientFailures) || transientFailures < 0 || transientFailures > 2) throw new RangeError('Invalid fixture failure count');
  const mode = 'fixture';
  const model = 'factory-fixture/no-tools-v1';
  const safety = { kind: 'tool-free-fixture', version: 1 };
  async function assessRecovery({ directory, run }) {
    const receipt = await inspectExecution(directory);
    const fixtureOnly = run.execution.mode === mode && run.execution.model === model
      && !run.capabilities.repositoryTools && !run.reservations?.some((item) => item.kind === 'tool-round')
      && (receipt.status === 'missing' || (receipt.runId === run.id && receipt.requestId === run.execution.requestId
        && receipt.safety?.kind === safety.kind && receipt.safety?.version === 1));
    const attempts = run.reservations?.filter((item) => item.kind === 'model' && item.generationId === run.execution.requestId).length ?? run.counters.modelAttempts;
    return { ...safety, quiescent: fixtureOnly,
      resumable: fixtureOnly && ['queued', 'placed'].includes(receipt.status) && attempts < 2,
      evidence: fixtureOnly ? 'In-process controlled provider; no tools, subprocesses, external requests or repository writes. Not production containment.' : 'Fixture-only safety cannot establish quiescence or reconcile these effects.' };
  }
  async function runFixture({ directory, runId, requestId, brief, budget, run }, resume) {
      const path = join(directory, 'execution.sqlite');
      await privateFile(path);
      const models = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
        modelsPath: null, refreshOnCreate: false, allowModelNetwork: false,
      });
      const faux = fauxProvider({ provider: 'factory-fixture', models: [{ id: 'no-tools-v1', maxTokens: 8192 }], tokensPerSecond: Infinity });
      let reservation;
      let invoked = 0;
      const respond = async (_transcript, options) => {
        budget.assertActive();
        if (invoked) reservation = budget.reserveModelAttempt({ generationId: requestId, retry: true });
        invoked++;
        const signal = AbortSignal.any([budget.signal, ...(options?.signal ? [options.signal] : [])]);
        await delay(delayMs, undefined, { signal });
        budget.settle(reservation.id, 'Controlled tool-free response returned; usage is not billed spend.');
        if (invoked <= transientFailures) return fauxAssistantMessage('', { stopReason: 'error', errorMessage: '429 rate limit exceeded (controlled fixture)' });
        return fauxAssistantMessage(answer);
      };
      // Each permitted durable attempt must pass the reservation gate, including an automatic transient retry.
      faux.setResponses([respond, respond]);
      models.registerNativeProvider(faux.provider);
      const harness = await Harness.open(await openNodeSqliteStorage(path), {
        models, registry: createRegistry(), settings: { ...settings, retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 } },
      }, context);
      try {
        const root = await harness.root(context, { agent: {
          model: { provider: 'factory-fixture', modelId: 'no-tools-v1' }, tools: [], maxTurns: 1,
        } });
        // Resume reacquires ONLY the original durable submission. Never submit another input.
        let submissionId;
        if (resume) {
          const receipt = await harness.snapshot(Receipt, context);
          if (receipt?.runId !== runId || receipt.requestId !== requestId || receipt.submissionId !== run.execution.submissionId) {
            throw new FactoryError('RECEIPT_MISMATCH', 'Resume requires the original durable submission.');
          }
          submissionId = receipt.submissionId;
        } else {
          // Atomic in the execution store, not across both stores.
          submissionId = await harness.commit(async (tx) => {
            const id = await root.submit(tx, { type: 'input', content: brief.text, requestId });
            Object.assign(await tx.doc(Receipt), { version: STORAGE_VERSIONS.execution, runId, requestId, submissionId: id, safety });
            return id;
          }, context);
        }
        reservation = budget.reserveModelAttempt({ generationId: requestId, retry: resume });
        harness.resume();
        const submission = await harness.submission(submissionId, context);
        const finished = submission.wait(context).then(() => result(harness));
        finished.catch(() => {});
        return { submissionId, finished, cancel: () => root.abort(context), close: () => harness.close(context) };
      } catch (error) { await harness.close(context); throw error; }
  }
  return { mode, model, assessRecovery,
    start: (input) => runFixture(input, false),
    async resume(input) {
      const assessment = await assessRecovery(input);
      if (!assessment.resumable) throw new FactoryError('UNSAFE_RESUME', 'The original fixture submission is not safely resumable.');
      return runFixture(input, true);
    },
  };
}
