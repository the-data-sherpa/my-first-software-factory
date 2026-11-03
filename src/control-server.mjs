import { createServer } from 'node:http';
import { once } from 'node:events';
import { lstat, unlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { FactoryError } from './storage.mjs';

export const safeError = error => error instanceof FactoryError
  ? { code: error.code, message: error.message, ...error.details }
  : { code: 'OPERATION_FAILED', message: 'The operation failed. Private state was retained. No fallback was attempted.' };

/** Trusted application seam, not a CLI plugin loader. The caller supplies an already-owned factory. */
export async function serveFactory({ factory, mode = 'production-blocked', fixture = false }) {
  const socketPath = join(factory.stateDir, 'backend.sock');
  let server;
  try {
    if (Buffer.byteLength(socketPath) > 103) throw new FactoryError('SOCKET_PATH_TOO_LONG', 'Use a shorter private state directory for the Unix socket.');
    const previous = await lstat(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (previous) {
      if (!previous.isSocket() || (process.getuid && previous.uid !== process.getuid())) {
        throw new FactoryError('SOCKET_PATH_OCCUPIED', 'The backend socket path is occupied by a non-owned socket or another file.');
      }
      await unlink(socketPath);
    }
    const send = (response, status, body) => {
      response.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
      response.end(JSON.stringify(body));
    };
    server = createServer(async (request, response) => {
      try {
        if (request.method === 'GET' && request.url === '/health') return send(response, 200, { storageVersions: factory.storageInfo(), fixture, mode });
        if (request.method === 'GET' && request.url === '/runs') return send(response, 200, await factory.listRuns());
        if (request.method === 'GET' && /^\/runs\/run_[a-f0-9-]+$/.test(request.url)) return send(response, 200, await factory.inspectRun(request.url.slice('/runs/'.length)));
        const control = request.url.match(/^\/runs\/(run_[a-f0-9-]+)\/(stop|resume|replace|prepare-dependencies)$/);
        if (request.method === 'POST' && (request.url === '/runs' || control)) {
          const chunks = []; let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 512 * 1024) throw new FactoryError('INVALID_BRIEF', 'The admission request is too large.');
            chunks.push(chunk);
          }
          let input;
          try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { throw new FactoryError('INVALID_ARGUMENTS', 'Supply a JSON admission request.'); }
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FactoryError('INVALID_ARGUMENTS', 'Supply a JSON admission object.');
          const result = control ? await factory[control[2] === 'prepare-dependencies' ? 'prepareDependencies' : `${control[2]}Run`](control[1], input) : await factory.startRun(input);
          return send(response, 200, result);
        }
        throw new FactoryError('INVALID_COMMAND', 'Unknown factory operation.');
      } catch (error) { send(response, 400, { error: safeError(error) }); }
    });
    server.requestTimeout = 5000; server.headersTimeout = 5000;
    server.listen(socketPath);
    await once(server, 'listening');
    await chmod(socketPath, 0o600);
    let shutdown;
    const close = () => shutdown ??= (async () => {
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await factory.close();
      await closed;
    })();
    return { close };
  } catch (error) {
    server?.close();
    await factory.close();
    throw error;
  }
}
