#!/usr/bin/env node
import { request as httpRequest } from 'node:http';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { openFactory, inspectHistory, backupFactory, restoreFactory, DEFAULT_STATE_DIR, FactoryError } from '../src/factory.mjs';
import { createFixtureExecution, createOwnerModelPreflight, createRepositoryExecution } from '../src/execution.mjs';
import { admitWorkspace, prepareWorkspace, inspectWorkspace } from '../src/workspace.mjs';

const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
import { serveFactory, safeError } from '../src/control-server.mjs';
import { createAdmissionExecution } from '../src/admission.mjs';
const options = {
  'state-dir': { type: 'string', default: DEFAULT_STATE_DIR },
  fixture: { type: 'boolean' }, 'fixture-delay-ms': { type: 'string' }, 'prepare-workspace': { type: 'boolean' },
  'model-preflight': { type: 'boolean' }, 'fetch-locked-packages': { type: 'boolean' },
  'admit-agent': { type: 'boolean' }, 'execute-agent': { type: 'boolean' }, 'dependency-run': { type: 'string' },
  'write-path': { type: 'string', multiple: true }, event: { type: 'string' }, offset: { type: 'string' }, length: { type: 'string' },
  'project-path': { type: 'string' }, 'request-id': { type: 'string' }, 'bun-path': { type: 'string' },
  brief: { type: 'string' }, 'brief-text': { type: 'string' },
  to: { type: 'string' }, from: { type: 'string' }, review: { type: 'string' },
};

async function serve(values) {
  const modes = ['model-preflight', 'admit-agent', 'execute-agent'].filter(name => values[name]);
  if (modes.length > 1 || (modes.length && (values.fixture || values['prepare-workspace']))) {
    throw new FactoryError('INVALID_ARGUMENTS', 'Choose one owner execution mode, without fixture or workspace-only preparation flags.');
  }
  const fixture = values.fixture ? createFixtureExecution({ delayMs: Number(values['fixture-delay-ms'] ?? 0) }) : undefined;
  if (!values.fixture && values['fixture-delay-ms'] !== undefined) throw new FactoryError('INVALID_ARGUMENTS', 'Fixture options require --fixture.');
  const execution = fixture ?? (values['model-preflight'] ? createOwnerModelPreflight()
    : values['admit-agent'] ? createAdmissionExecution() : values['execute-agent'] ? createRepositoryExecution() : undefined);
  const mode = execution?.mode ?? 'production-blocked';
  const factory = await openFactory({ stateDir: values['state-dir'], execution,
    ...(values['prepare-workspace'] || values['admit-agent'] || values['execute-agent'] ? { workspace: { admit: admitWorkspace, prepare: prepareWorkspace, inspect: inspectWorkspace } } : {}),
    ...(values['project-path'] ? { project: { id: 'vanguard', repositoryPath: values['project-path'] } } : {}),
  });
  const server = await serveFactory({ factory, mode, fixture: Boolean(fixture) });
  let shutdown;
  const stop = () => shutdown ??= server.close().then(() => {
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
  }).catch(() => { process.stderr.write(`${JSON.stringify({ error: safeError() })}\n`); process.exitCode = 1; });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  print({ event: 'backend-ready', mode, storageVersions: factory.storageInfo() });
}

async function request(stateDir, method, path, data) {
  return new Promise((resolve, reject) => {
    const body = data === undefined ? undefined : JSON.stringify(data);
    const request = httpRequest({ socketPath: join(stateDir, 'backend.sock'), method, path,
      headers: body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (value.error) reject(new FactoryError(value.error.code, value.error.message,
            value.error.activeRunId ? { activeRunId: value.error.activeRunId } : {}));
          else resolve(value);
        } catch (error) { reject(error); }
      });
    });
    request.setTimeout(10_000, () => request.destroy(new FactoryError('BACKEND_TIMEOUT', 'The backend did not respond. Inspect retained state before retrying with the same request ID.')));
    request.on('error', reject);
    request.end(body);
  });
}

async function readBrief(values) {
  if (Boolean(values.brief) === (values['brief-text'] !== undefined)) throw new FactoryError('INVALID_ARGUMENTS', 'Choose exactly one of --brief FILE or --brief-text TEXT.');
  if (values['brief-text'] !== undefined) return values['brief-text'];
  const file = await open(values.brief, 'r');
  try {
    const buffer = Buffer.alloc(65_537);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > 65_536) throw new FactoryError('INVALID_BRIEF', 'The task brief exceeds 64 KiB.');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)); }
    catch { throw new FactoryError('INVALID_BRIEF', 'The task brief must be UTF-8 text.'); }
  } finally { await file.close(); }
}

try {
  if (process.versions.node !== '24.21.0') throw new FactoryError('NODE_VERSION', 'Use the repository-local Node 24.21.0 runtime.');
  let parsed;
  try { parsed = parseArgs({ options, allowPositionals: true }); }
  catch { throw new FactoryError('INVALID_ARGUMENTS', 'Invalid factory command arguments.'); }
  const { values, positionals } = parsed;
  const [command, runId] = positionals;
  const allowed = {
    serve: ['fixture', 'fixture-delay-ms', 'project-path', 'prepare-workspace', 'model-preflight', 'admit-agent', 'execute-agent'],
    start: ['request-id', 'brief', 'brief-text', 'dependency-run', 'write-path'], inspect: ['event', 'offset', 'length'], list: [], info: [],
    stop: [], resume: ['review'], replace: ['request-id', 'review'], 'prepare-dependencies': ['bun-path', 'fetch-locked-packages'],
    backup: ['to'], restore: ['from'],
  };
  if (!allowed[command] || positionals.length !== (['inspect', 'stop', 'resume', 'replace', 'prepare-dependencies'].includes(command) ? 2 : 1)) {
    throw new FactoryError('INVALID_COMMAND', 'Use serve, start, inspect RUN_ID, stop RUN_ID, resume RUN_ID --review TEXT, replace RUN_ID --request-id ID --review TEXT, prepare-dependencies RUN_ID --bun-path PATH, list, info, backup, or restore.');
  }
  for (const key of Object.keys(values)) {
    if (key !== 'state-dir' && !allowed[command].includes(key)) throw new FactoryError('INVALID_ARGUMENTS', 'An option does not apply to this command.');
  }
  if (command === 'serve') await serve(values);
  else if (command === 'backup') print(await backupFactory({ stateDir: values['state-dir'], destination: values.to }));
  else if (command === 'restore') print(await restoreFactory({ stateDir: values['state-dir'], backupDir: values.from }));
  else {
    const stateDir = values['state-dir'];
    const inspection = {};
    for (const [option, name] of [['event', 'page'], ['offset', 'offset'], ['length', 'length']]) {
      if (values[option] === undefined) continue;
      if (!/^(0|[1-9][0-9]*)$/.test(values[option]) || !Number.isSafeInteger(Number(values[option]))) {
        throw new FactoryError('INVALID_ARGUMENTS', 'Executor inspection pagination requires nonnegative integer arguments.');
      }
      inspection[name] = Number(values[option]);
    }
    const query = Object.keys(inspection).length ? `?${new URLSearchParams(inspection)}` : '';
    try {
      if (command === 'start') print(await request(stateDir, 'POST', '/runs', { requestId: values['request-id'], brief: await readBrief(values), dependencyRunId: values['dependency-run'],
        ...(values['write-path'] ? { scope: { writePaths: values['write-path'] } } : {}) }));
      else if (['stop', 'resume', 'replace', 'prepare-dependencies'].includes(command)) print(await request(stateDir, 'POST', `/runs/${encodeURIComponent(runId)}/${command}`,
        { review: values.review, requestId: values['request-id'], bunPath: values['bun-path'], registry: values['fetch-locked-packages'] ?? false }));
      else print(await request(stateDir, 'GET', command === 'info' ? '/health' : command === 'list' ? '/runs' : `/runs/${encodeURIComponent(runId)}${query}`));
    } catch (error) {
      if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
      if (command === 'inspect' || command === 'list') print(await inspectHistory({ stateDir, runId, inspection }));
      else throw new FactoryError('BACKEND_UNAVAILABLE', 'Start the foreground backend explicitly before submitting work.');
    }
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: safeError(error) })}\n`);
  process.exitCode = 1;
}
