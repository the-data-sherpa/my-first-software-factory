// Trusted Git plumbing only. Never point Git at the owner's Git directory or read its config.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, lstat, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FactoryError } from './storage.mjs';

const MESSAGES = Object.freeze({
  WORKSPACE_INVALID: 'The workspace admission identity or private layout is invalid.',
  WORKSPACE_SOURCE: 'The recorded local source is unavailable or invalid. No remote lookup was attempted.',
  WORKSPACE_UNSUPPORTED: 'The repository uses an unsupported source feature. Prepare a supported local source explicitly.',
  WORKSPACE_CONFLICT: 'Retained workspace artifacts do not match this admission. Nothing was reset or adopted.',
  WORKSPACE_CANCELLED: 'Workspace preparation was cancelled. Retained artifacts require explicit operator action.',
  WORKSPACE_LIMIT: 'Source preparation exceeded its local size or command deadline limit.',
  WORKSPACE_GIT: 'Trusted local Git preparation failed. Retained artifacts were not removed.',
  WORKSPACE_FAILED: 'Workspace preparation failed. Retained artifacts were not removed.',
});

export class WorkspaceError extends FactoryError {
  constructor(code) {
    code = Object.hasOwn(MESSAGES, code) ? code : 'WORKSPACE_FAILED';
    super(code, MESSAGES[code]);
  }
  toJSON() { return { code: this.code, message: this.message }; }
}
export const fail = (code) => { throw new WorkspaceError(code); };
export function serializeWorkspaceError(error) {
  return new WorkspaceError(error instanceof WorkspaceError ? error.code : 'WORKSPACE_FAILED').toJSON();
}
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const cancelled = (signal) => { if (signal?.aborted) fail('WORKSPACE_CANCELLED'); };
export const MAX_BYTES = 128 * 1024 * 1024;
const MAX_OBJECT = 16 * 1024 * 1024;
export const displaySafe = (value) => typeof value === 'string' && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);

export async function stat(path) {
  try { return await lstat(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export async function regular(path, max = MAX_BYTES) {
  const info = await stat(path);
  if (!info?.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > max) fail('WORKSPACE_SOURCE');
  return readFile(path);
}

export async function git(gitDir, args, { signal, input, objectDirectory } = {}) {
  cancelled(signal);
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/git', ['--git-dir', gitDir,
      '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=/dev/null',
      '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'protocol.allow=never', ...args], {
      cwd: gitDir, stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', HOME: gitDir, XDG_CONFIG_HOME: gitDir, LANG: 'C', LC_ALL: 'C',
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: '', GIT_PROTOCOL_FROM_USER: '0',
        GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0',
        ...(objectDirectory ? { GIT_OBJECT_DIRECTORY: objectDirectory } : {}) },
    });
    const chunks = [];
    let bytes = 0;
    let failure;
    const stop = (code) => { failure ??= code; child.kill('SIGKILL'); };
    const abort = () => stop('WORKSPACE_CANCELLED');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => stop('WORKSPACE_LIMIT'), 30_000);
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) stop('WORKSPACE_LIMIT');
      else chunks.push(chunk);
    });
    // Drain, but never retain or report repository-controlled diagnostics.
    child.stderr.on('data', (chunk) => { bytes += chunk.length; if (bytes > MAX_BYTES) stop('WORKSPACE_LIMIT'); });
    child.stdin.on('error', () => {});
    child.on('error', () => { failure ??= 'WORKSPACE_GIT'; });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure || code !== 0) reject(new WorkspaceError(failure ?? 'WORKSPACE_GIT'));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(input);
  });
}

async function directory(path) {
  const info = await stat(path);
  if (!info?.isDirectory() || info.isSymbolicLink()) fail('WORKSPACE_UNSUPPORTED');
}

async function checkObjects(path, signal, depth = 0, count = { value: 0 }) {
  cancelled(signal);
  if (depth > 3) fail('WORKSPACE_UNSUPPORTED');
  await directory(path);
  for (const name of await readdir(path)) {
    cancelled(signal);
    if (++count.value > 100_000) fail('WORKSPACE_LIMIT');
    if (name === 'alternates' || name === 'http-alternates' || name.endsWith('.promisor')) fail('WORKSPACE_UNSUPPORTED');
    const item = join(path, name);
    const info = await stat(item);
    if (info?.isDirectory()) await checkObjects(item, signal, depth + 1, count);
    else if (!info?.isFile() || info.isSymbolicLink()) fail('WORKSPACE_UNSUPPORTED');
  }
}

export async function sourceRepository(repositoryPath, signal) {
  if (!displaySafe(repositoryPath)) fail('WORKSPACE_INVALID');
  const path = await realpath(repositoryPath);
  if (!displaySafe(path)) fail('WORKSPACE_INVALID');
  const gitDir = join(path, '.git');
  await directory(gitDir); // Primary, non-bare checkouts only; never follow a .git file or symlink.
  await directory(join(gitDir, 'objects'));
  await checkObjects(join(gitDir, 'objects'), signal);
  return { path, gitDir, objects: join(gitDir, 'objects') };
}

export async function localMain(source) {
  for (const name of ['refs', 'refs/heads']) await directory(join(source.gitDir, name));
  const loose = join(source.gitDir, 'refs/heads/main');
  let oid;
  if (await stat(loose)) oid = (await regular(loose, 128)).toString('utf8').trim();
  else {
    const packed = (await regular(join(source.gitDir, 'packed-refs'), 8 * 1024 * 1024)).toString('utf8');
    const matches = packed.split('\n').filter((line) => line.endsWith(' refs/heads/main'));
    if (matches.length !== 1) fail('WORKSPACE_SOURCE');
    oid = matches[0].split(' ')[0];
  }
  if (!/^[a-f0-9]{40}$/.test(oid ?? '')) fail('WORKSPACE_UNSUPPORTED');
  return oid;
}

export function validPath(path) {
  if (!path || !displaySafe(path) || Buffer.byteLength(path) > 4096 || /[\\:]/.test(path)) return false;
  return path.split('/').every((part) => part && Buffer.byteLength(part) <= 255 && part !== '.' && part !== '..'
    && !/[ .]$/.test(part) && !['.git', 'git~1', '.gitmodules'].includes(part.toLowerCase()));
}

export async function committedSource(source, baseCommit, signal) {
  cancelled(signal);
  const scratch = await mkdtemp(join(tmpdir(), 'factory-source-reader-'));
  try {
    const reader = join(scratch, 'reader.git');
    await mkdir(join(reader, 'objects'), { recursive: true, mode: 0o700 });
    await mkdir(join(reader, 'refs'), { mode: 0o700 });
    await writeFile(join(reader, 'HEAD'), 'ref: refs/heads/unused\n', { mode: 0o600 });
    await writeFile(join(reader, 'config'), '[core]\nrepositoryformatversion = 0\nbare = true\n', { mode: 0o600 });
    const run = (args, input) => git(reader, args, { signal, input, objectDirectory: source.objects });
    const commit = await run(['cat-file', 'commit', baseCommit]);
    const tree = /^tree ([a-f0-9]{40})\n/.exec(commit.toString('utf8'))?.[1];
    if (!tree) fail('WORKSPACE_SOURCE');
    const listing = await run(['ls-tree', '-r', '-t', '-z', '--full-tree', baseCommit]);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(listing);
    const items = text.split('\0').filter(Boolean).map((line) => {
      const match = /^(\d{6}) (blob|tree|commit) ([a-f0-9]{40})\t(.+)$/.exec(line);
      if (!match || !validPath(match[4])) fail('WORKSPACE_UNSUPPORTED');
      const [, mode, type, objectId, path] = match;
      if (!['040000', '100644', '100755'].includes(mode)
        || (mode === '040000' ? type !== 'tree' : type !== 'blob')) fail('WORKSPACE_UNSUPPORTED');
      return { path, mode, type, objectId };
    });
    if (items.length > 20_000 || new Set(items.map(({ path }) => path.toLowerCase())).size !== items.length) fail('WORKSPACE_UNSUPPORTED');
    const ids = [...new Set([baseCommit, tree, ...items.map(({ objectId }) => objectId)])];
    const batch = await run(['cat-file', '--batch'], `${ids.join('\n')}\n`);
    const objects = new Map();
    let offset = 0;
    for (const oid of ids) {
      const end = batch.indexOf(10, offset);
      const header = batch.subarray(offset, end).toString('ascii');
      const match = /^([a-f0-9]{40}) (commit|tree|blob) (\d+)$/.exec(header);
      if (!match || match[1] !== oid) fail('WORKSPACE_SOURCE');
      const size = Number(match[3]);
      if (size > MAX_OBJECT) fail('WORKSPACE_LIMIT');
      const data = batch.subarray(end + 1, end + 1 + size);
      const raw = Buffer.concat([Buffer.from(`${match[2]} ${size}\0`), data]);
      if (data.length !== size || batch[end + 1 + size] !== 10
        || createHash('sha1').update(raw).digest('hex') !== oid) fail('WORKSPACE_SOURCE');
      objects.set(oid, { type: match[2], data, raw });
      offset = end + size + 2;
    }
    if (offset !== batch.length || !objects.get(baseCommit).data.equals(commit)) fail('WORKSPACE_SOURCE');
    let materializedBytes = 0;
    const entries = items.filter(({ type }) => type === 'blob').map(({ path, mode, objectId }) => {
      const { data, type } = objects.get(objectId);
      if (type !== 'blob') fail('WORKSPACE_SOURCE');
      materializedBytes += data.length;
      if (materializedBytes > MAX_BYTES) fail('WORKSPACE_LIMIT');
      if (data.subarray(0, 43).toString('ascii').startsWith('version https://git-lfs.github.com/spec/v1')) fail('WORKSPACE_UNSUPPORTED');
      return { path, mode, objectId, bytes: data.length, sha256: digest(data) };
    });
    const manifest = { version: 1, objectFormat: 'sha1', materialization: 'raw-blobs', baseCommit, tree, entries };
    return { manifest: { ...manifest, id: digest(JSON.stringify(manifest)) }, objects };
  } finally {
    // This is a disposable read adapter, not a run artifact. It contains no source, intent, or draft.
    await rm(scratch, { recursive: true, force: true });
  }
}
