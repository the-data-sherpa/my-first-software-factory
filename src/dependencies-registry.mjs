// Only this trusted host code has fetch authority. Bun and all package code remain network-denied.
import http from 'node:http';
import https from 'node:https';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { save, hash, regular, directory, unsafe } from './dependencies-files.mjs';
import { createHash } from 'node:crypto';
import { registryArchive } from './dependencies-lock.mjs';

export const REGISTRY = 'https://registry.npmjs.org';
export const FETCH_LIMITS = Object.freeze({ archives: 2000, archiveBytes: 16 * 1024 ** 2, totalBytes: 64 * 1024 ** 2,
  expandedBytes: 64 * 1024 ** 2, entries: 20000, durationMs: 120_000, idleMs: 10_000 });
const failure = (code) => Object.assign(new Error('Locked registry acquisition failed.'), { code });
function endpoint(transport) {
  if (transport === undefined) return REGISTRY;
  // A trusted test adapter, never taken from package.json, a lock URL, environment or user configuration.
  if (!transport || Object.keys(transport).join(',') !== 'loopbackPort' || !Number.isInteger(transport.loopbackPort)
    || transport.loopbackPort < 1 || transport.loopbackPort > 65535) throw failure('DEPENDENCIES_UNSUPPORTED');
  return `http://127.0.0.1:${transport.loopbackPort}`;
}
function requestArchive(origin, path, signal, maxBytes) {
  return new Promise((resolve, reject) => {
    let request; let socket; let response; let requestClosed = false; let socketClosed = true; let responseClosed = true;
    let reason; let result; let bytes = 0; const chunks = [];
    const done = () => {
      if (!requestClosed || !socketClosed || !responseClosed) return;
      signal.removeEventListener('abort', abort);
      if (reason || !result) reject(failure(reason ?? 'DEPENDENCIES_FETCH_FAILED')); else resolve(result);
    };
    const stop = (code) => { reason ??= code; response?.destroy(); request?.destroy(); socket?.destroy(); };
    const abort = () => stop('DEPENDENCIES_ABORTED');
    if (signal.aborted) { reject(failure('DEPENDENCIES_ABORTED')); return; }
    request = (origin === REGISTRY ? https : http).request(`${origin}${path}`, {
      method: 'GET', agent: false, maxHeaderSize: 16 * 1024,
      headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity', Connection: 'close' },
    });
    request.on('socket', (value) => { socket = value; socketClosed = false; socket.once('close', () => { socketClosed = true; done(); }); });
    request.once('close', () => { requestClosed = true; done(); });
    request.on('error', () => stop('DEPENDENCIES_FETCH_FAILED'));
    request.setTimeout(FETCH_LIMITS.idleMs, () => stop('DEPENDENCIES_TIMEOUT'));
    request.on('response', (value) => {
      response = value; responseClosed = false;
      response.once('close', () => { responseClosed = true; done(); });
      response.on('error', () => stop('DEPENDENCIES_FETCH_FAILED'));
      const length = response.headers['content-length'];
      if (response.statusCode !== 200 || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')
        || (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes))) { stop('DEPENDENCIES_FETCH_FAILED'); return; }
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) stop('DEPENDENCIES_FETCH_LIMIT'); else chunks.push(chunk);
      });
      response.on('end', () => {
        if (!response.complete) stop('DEPENDENCIES_FETCH_FAILED');
        else { result = Buffer.concat(chunks); request.destroy(); socket?.destroy(); }
      });
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else request.end();
  });
}

export async function verifyAcquisition(destination, intent, receipt) {
  if (!intent.acquisition) { if (receipt !== undefined) unsafe(); return; }
  const reservation = JSON.parse((await regular(`${destination}/acquisition.json`, 4 * 1024 ** 2)).toString('utf8'));
  const acquired = JSON.parse((await regular(`${destination}/acquired.json`, 4 * 1024 ** 2)).toString('utf8'));
  if (JSON.stringify(acquired) !== JSON.stringify(receipt) || acquired.intentId !== intent.id
    || acquired.reservationDigest !== hash(JSON.stringify(reservation)) || reservation.intentId !== intent.id
    || reservation.registry !== REGISTRY || JSON.stringify(reservation.limits) !== JSON.stringify(FETCH_LIMITS)
    || JSON.stringify(reservation.archives) !== JSON.stringify(intent.acquisition.archives)
    || !Number.isSafeInteger(reservation.startedAt) || reservation.deadlineAt !== reservation.startedAt + FETCH_LIMITS.durationMs
    || acquired.archives?.length !== intent.acquisition.archives.length) unsafe();
  await directory(`${destination}/archives`);
  if ((await readdir(`${destination}/archives`)).length !== acquired.archives.length) unsafe();
  let total = 0;
  for (const [index, entry] of intent.acquisition.archives.entries()) {
    const data = await regular(`${destination}/archives/${index}.tgz`, FETCH_LIMITS.archiveBytes);
    const actual = { path: entry.path, integrity: `sha512-${createHash('sha512').update(data).digest('base64')}`, sha256: hash(data), bytes: data.length };
    if (actual.integrity !== entry.integrity || JSON.stringify(actual) !== JSON.stringify(acquired.archives[index])) unsafe();
    total += data.length;
  }
  if (total !== acquired.bytes || total > FETCH_LIMITS.totalBytes) unsafe();
}

export async function acquireRegistry({ destination, plan, intentId, signal, registryTransport }) {
  const origin = endpoint(registryTransport);
  const controller = new AbortController(); let timedOut = false;
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const startedAt = Date.now();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, FETCH_LIMITS.durationMs);
  try {
    // Entire finite request set and conservative reservations are durable BEFORE any request opens.
    const reservation = { version: 1, intentId, registry: REGISTRY, transportOrigin: origin, limits: FETCH_LIMITS,
      startedAt, deadlineAt: startedAt + FETCH_LIMITS.durationMs, archives: plan };
    await save(`${destination}/acquisition.json`, reservation);
    await mkdir(`${destination}/archives`, { mode: 0o700 });
    const cache = `${destination}/cache`; await mkdir(cache, { mode: 0o700 });
    const acquired = []; let total = 0; let expanded = 0; let entries = 0;
    for (const [index, entry] of plan.entries()) {
      if (controller.signal.aborted) throw failure('DEPENDENCIES_ABORTED');
      const bytes = await requestArchive(origin, entry.path, controller.signal, Math.min(FETCH_LIMITS.archiveBytes, FETCH_LIMITS.totalBytes - total));
      total += bytes.length;
      const files = registryArchive(bytes, entry);
      for (const file of files) { expanded += file.data.length; entries++; }
      if (expanded > FETCH_LIMITS.expandedBytes || entries > FETCH_LIMITS.entries) throw failure('DEPENDENCIES_FETCH_LIMIT');
      await writeFile(`${destination}/archives/${index}.tgz`, bytes, { flag: 'wx', mode: 0o400 });
      const base = `${cache}/${entry.cachePath}`; await mkdir(base, { recursive: true, mode: 0o700 });
      for (const file of files) {
        if (controller.signal.aborted) throw failure('DEPENDENCIES_ABORTED');
        const path = `${base}/${file.path}`;
        if (file.type === 'directory') await mkdir(path, { recursive: true, mode: 0o700 });
        else {
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          await writeFile(path, file.data, { flag: 'wx', mode: file.executable ? 0o500 : 0o400 });
        }
      }
      acquired.push({ path: entry.path, integrity: entry.integrity, sha256: hash(bytes), bytes: bytes.length });
    }
    if (controller.signal.aborted) throw failure('DEPENDENCIES_ABORTED');
    const receipt = { intentId, reservationDigest: hash(JSON.stringify(reservation)), archives: acquired, bytes: total, expandedBytes: expanded, entries };
    await save(`${destination}/acquired.json`, receipt);
    return receipt;
  } catch (error) { if (timedOut) throw failure('DEPENDENCIES_TIMEOUT'); throw error; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
