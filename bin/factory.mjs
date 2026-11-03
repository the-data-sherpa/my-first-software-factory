#!/usr/bin/env node
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { lstat, open, unlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { openFactory, inspectHistory, backupFactory, restoreFactory, DEFAULT_STATE_DIR, FactoryError } from '../src/factory.mjs';
import { createFixtureExecution } from '../src/execution.mjs';
import { admitWorkspace, prepareWorkspace, inspectWorkspace } from '../src/workspace.mjs';

const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const safeError = (error) => error instanceof FactoryError
  ? { code: error.code, message: error.message, ...error.details }
  : { code: 'OPERATION_FAILED', message: 'The operation failed. Private state was retained. No fallback was attempted.' };
const options = {
  'state-dir': { type: 'string', default: DEFAULT_STATE_DIR },
  fixture: { type: 'boolean' }, 'fixture-delay-ms': { type: 'string' }, 'prepare-workspace': { type: 'boolean' },
  'project-path': { type: 'string' }, 'request-id': { type: 'string' },
  brief: { type: 'string' }, 'brief-text': { type: 'string' },
  to: { type: 'string' }, from: { type: 'string' }, review: { type: 'string' },
};

async function serve(values) {
  const fixture = values.fixture ? createFixtureExecution({ delayMs: Number(values['fixture-delay-ms'] ?? 0) }) : undefined;
  if (!values.fixture && values['fixture-delay-ms'] !== undefined) throw new FactoryError('INVALID_ARGUMENTS', 'Fixture options require --fixture.');
  const factory = await openFactory({ stateDir: values['state-dir'], execution: fixture,
    ...(values['prepare-workspace'] ? { workspace: { admit: admitWorkspace, prepare: prepareWorkspace, inspect: inspectWorkspace } } : {}),
    ...(values['project-path'] ? { project: { id: 'vanguard', repositoryPath: values['project-path'] } } : {}),
  });
  const socketPath = join(factory.stateDir, 'backend.sock');
  let server;
  try {
    if (Buffer.byteLength(socketPath) > 103) throw new FactoryError('SOCKET_PATH_TOO_LONG', 'Use a shorter private state directory for the Unix socket.');
    const previous = await lstat(socketPath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    if (previous) {
      if (!previous.isSocket() || (process.getuid && previous.uid !== process.getuid())) {
        throw new FactoryError('SOCKET_PATH_OCCUPIED', 'The backend socket path is occupied by a non-owned socket or another file.');
      }
      await unlink(socketPath); // The lifetime owner lock fences stale-socket removal.
    }
    const send = (response, status, body) => {
      response.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
      response.end(JSON.stringify(body));
    };
    server = createServer(async (request, response) => {
      try {
        if (request.method === 'GET' && request.url === '/health') return send(response, 200, { storageVersions: factory.storageInfo(), fixture: Boolean(fixture) });
        if (request.method === 'GET' && request.url === '/runs') return send(response, 200, await factory.listRuns());
        if (request.method === 'GET' && /^\/runs\/run_[a-f0-9-]+$/.test(request.url)) {
          return send(response, 200, await factory.inspectRun(request.url.slice('/runs/'.length)));
        }
        const control = request.url.match(/^\/runs\/(run_[a-f0-9-]+)\/(stop|resume|replace)$/);
        if (request.method === 'POST' && (request.url === '/runs' || control)) {
          const chunks = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 512 * 1024) throw new FactoryError('INVALID_BRIEF', 'The admission request is too large.');
            chunks.push(chunk);
          }
          let input;
          try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { throw new FactoryError('INVALID_ARGUMENTS', 'Supply a JSON admission request.'); }
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FactoryError('INVALID_ARGUMENTS', 'Supply a JSON admission object.');
          const result = control ? await factory[`${control[2]}Run`](control[1], input) : await factory.startRun(input);
          return send(response, 200, result);
        }
        throw new FactoryError('INVALID_COMMAND', 'Unknown factory operation.');
      } catch (error) { send(response, 400, { error: safeError(error) }); }
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.listen(socketPath);
    await once(server, 'listening');
    await chmod(socketPath, 0o600);
    let shutdown;
    const stop = () => shutdown ??= (async () => {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await factory.close();
      await closed;
      process.off('SIGTERM', stop);
      process.off('SIGINT', stop);
    })().catch(() => { process.stderr.write(`${JSON.stringify({ error: safeError() })}\n`); process.exitCode = 1; });
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    print({ event: 'backend-ready', mode: fixture ? 'fixture' : 'production-blocked', storageVersions: factory.storageInfo() });
  } catch (error) {
    server?.close();
    await factory.close();
    throw error;
  }
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
    serve: ['fixture', 'fixture-delay-ms', 'project-path', 'prepare-workspace'],
    start: ['request-id', 'brief', 'brief-text'], inspect: [], list: [], info: [],
    stop: [], resume: ['review'], replace: ['request-id', 'review'],
    backup: ['to'], restore: ['from'],
  };
  if (!allowed[command] || positionals.length !== (['inspect', 'stop', 'resume', 'replace'].includes(command) ? 2 : 1)) {
    throw new FactoryError('INVALID_COMMAND', 'Use serve, start, inspect RUN_ID, stop RUN_ID, resume RUN_ID --review TEXT, replace RUN_ID --request-id ID --review TEXT, list, info, backup, or restore.');
  }
  for (const key of Object.keys(values)) {
    if (key !== 'state-dir' && !allowed[command].includes(key)) throw new FactoryError('INVALID_ARGUMENTS', 'An option does not apply to this command.');
  }
  if (command === 'serve') await serve(values);
  else if (command === 'backup') print(await backupFactory({ stateDir: values['state-dir'], destination: values.to }));
  else if (command === 'restore') print(await restoreFactory({ stateDir: values['state-dir'], backupDir: values.from }));
  else {
    const stateDir = values['state-dir'];
    try {
      if (command === 'start') print(await request(stateDir, 'POST', '/runs', { requestId: values['request-id'], brief: await readBrief(values) }));
      else if (['stop', 'resume', 'replace'].includes(command)) print(await request(stateDir, 'POST', `/runs/${encodeURIComponent(runId)}/${command}`, { review: values.review, requestId: values['request-id'] }));
      else print(await request(stateDir, 'GET', command === 'info' ? '/health' : command === 'list' ? '/runs' : `/runs/${encodeURIComponent(runId)}`));
    } catch (error) {
      if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
      if (command === 'inspect' || command === 'list') print(await inspectHistory({ stateDir, runId }));
      else throw new FactoryError('BACKEND_UNAVAILABLE', 'Start the foreground backend explicitly before submitting work.');
    }
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: safeError(error) })}\n`);
  process.exitCode = 1;
}
