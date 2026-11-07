import { mkdir, writeFile, readFile, lstat, chmod, readdir, rename } from 'node:fs/promises';
import { basename, dirname, join, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { privateDirectory } from './storage.mjs';
import { WorkspaceError, fail, digest, cancelled, stat, regular, git, displaySafe,
  sourceRepository, localMain, committedSource } from './workspace-git.mjs';

export { WorkspaceError, serializeWorkspaceError } from './workspace-git.mjs';

const CONFIG = '[core]\nrepositoryformatversion = 0\nbare = true\nsharedRepository = 0600\nhooksPath = /dev/null\nfsmonitor = false\n[gc]\nauto = 0\n[maintenance]\nauto = false\n[protocol]\nallow = never\n';
const inside = (root, path) => {
  const part = relative(root, path);
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`));
};
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const identity = (intent) => { const { id, ...body } = intent; return digest(JSON.stringify(body)); };
const paths = (intent) => ({
  workspace: dirname(intent.worktree), control: dirname(intent.gitCommonDirectory),
  owner: join(dirname(intent.worktree), 'intent.json'),
  receipt: join(dirname(intent.gitCommonDirectory), 'prepared.json'),
  gitDir: join(intent.gitCommonDirectory, 'worktrees', 'source'),
});

async function safe(operation) {
  try { return await operation(); }
  catch (error) { if (error instanceof WorkspaceError) throw error; throw new WorkspaceError('WORKSPACE_FAILED'); }
}

// Pure source admission apart from disposable, non-executing Git read-adapter metadata.
// Callers MUST persist the returned JSON before calling prepareWorkspace.
// baseCommit is a trusted linked-replacement input, never a CLI source override.
export async function admitWorkspace({ stateDir, project, runId, signal, baseCommit: admittedCommit } = {}) {
  return safe(async () => {
    cancelled(signal);
    if (!identifier(project?.id) || !identifier(runId) || typeof stateDir !== 'string') fail('WORKSPACE_INVALID');
    stateDir = await privateDirectory(stateDir, { create: false });
    if (!displaySafe(stateDir)) fail('WORKSPACE_INVALID');
    const source = await sourceRepository(project.repositoryPath, signal);
    if (inside(source.path, stateDir) || inside(stateDir, source.path)) fail('WORKSPACE_INVALID');
    if (admittedCommit !== undefined && !/^[a-f0-9]{40}$/.test(admittedCommit)) fail('WORKSPACE_INVALID');
    const baseCommit = admittedCommit ?? await localMain(source);
    const { manifest } = await committedSource(source, baseCommit, signal);
    cancelled(signal);
    const workspace = join(stateDir, 'runs', runId, 'workspace');
    const intent = {
      version: 1, projectId: project.id, runId, repositoryPath: source.path, stateDir,
      baseRef: 'refs/heads/main', baseCommit,
      branch: `factory/${project.id}/${runId}`,
      worktree: join(workspace, 'source'), gitCommonDirectory: join(workspace, 'control', 'repository.git'),
      sourceManifest: manifest,
    };
    return { ...intent, id: identity(intent) };
  });
}

async function validate(intent) {
  if (!intent || intent.version !== 1 || !identifier(intent.projectId) || !identifier(intent.runId)
    || typeof intent.stateDir !== 'string' || !/^[a-f0-9]{40}$/.test(intent.baseCommit ?? '')
    || intent.id !== identity(intent)) fail('WORKSPACE_INVALID');
  const stateDir = await privateDirectory(intent.stateDir, { create: false });
  const workspace = join(stateDir, 'runs', intent.runId, 'workspace');
  if (!displaySafe(stateDir) || !displaySafe(intent.repositoryPath) || stateDir !== intent.stateDir || intent.worktree !== join(workspace, 'source')
    || intent.gitCommonDirectory !== join(workspace, 'control', 'repository.git')
    || intent.branch !== `factory/${intent.projectId}/${intent.runId}` || intent.baseRef !== 'refs/heads/main') fail('WORKSPACE_INVALID');
  const { id, ...manifest } = intent.sourceManifest ?? {};
  if (id !== digest(JSON.stringify(manifest)) || manifest.baseCommit !== intent.baseCommit) fail('WORKSPACE_INVALID');
  // No path component below private state may be redirected, even for passive inspection.
  for (const path of [join(stateDir, 'runs'), join(stateDir, 'runs', intent.runId), workspace]) {
    const info = await stat(path);
    if (info && (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077))) fail('WORKSPACE_CONFLICT');
  }
  return paths(intent);
}

async function privateTree(path) {
  const info = await stat(path);
  if (!info) return;
  if (['alternates', 'http-alternates'].includes(basename(path)) || basename(path).endsWith('.promisor')
    || info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || (info.mode & 0o022)
    || (process.getuid && info.uid !== process.getuid()) || (info.isFile() && info.nlink !== 1)) fail('WORKSPACE_CONFLICT');
  if (info.isDirectory()) for (const name of await readdir(path)) await privateTree(join(path, name));
}

async function dir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) fail('WORKSPACE_CONFLICT');
}

// Existing bytes are evidence, never overwritten. Missing pieces can be completed from the saved intent.
async function once(path, data, mode = 0o600, stagingDirectory = dirname(path)) {
  data = Buffer.isBuffer(data) ? data : Buffer.from(data);
  await dir(dirname(path));
  if (await stat(path)) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o111) !== (mode & 0o111)
      || !(await readFile(path)).equals(data)) fail('WORKSPACE_CONFLICT');
    return;
  }
  await dir(stagingDirectory);
  const pending = join(stagingDirectory, `.workspace-write-${randomUUID()}`);
  await writeFile(pending, data, { flag: 'wx', mode });
  // The application holds exclusive ownership; no tools are enabled during preparation.
  // Install complete bytes atomically. A killed writer leaves its temporary evidence outside source.
  if (await stat(path)) fail('WORKSPACE_CONFLICT');
  await rename(pending, path);
}

async function owner(intent, p, create) {
  if (!await stat(p.owner)) {
    if (!create) return false;
    if (await stat(p.workspace) && (await readdir(p.workspace)).length) fail('WORKSPACE_CONFLICT');
    await once(p.owner, `${JSON.stringify(intent)}\n`, 0o600, dirname(p.workspace));
  } else if (!(await regular(p.owner)).equals(Buffer.from(`${JSON.stringify(intent)}\n`))) fail('WORKSPACE_CONFLICT');
  return true;
}

function receiptFor(intent, p) {
  return {
    version: 1, status: 'prepared', intentId: intent.id, projectId: intent.projectId, runId: intent.runId,
    baseCommit: intent.baseCommit, branch: intent.branch, worktree: intent.worktree,
    sourceManifestId: intent.sourceManifest.id,
    gitDirectory: p.gitDir, gitCommonDirectory: intent.gitCommonDirectory,
    toolAccess: { sourceRoot: intent.worktree, excludedPaths: ['.git'], requiresVerifiedContainment: true },
  };
}

async function prepared(intent, p) {
  if (!await stat(p.receipt)) return;
  const receipt = receiptFor(intent, p);
  if (!(await regular(p.receipt)).equals(Buffer.from(`${JSON.stringify(receipt)}\n`))) fail('WORKSPACE_CONFLICT');
  // Do not hash or reset source here: it may now contain a retained local draft.
  await verifyMetadata(intent, p);
  return receipt;
}

function metadata(intent, p) {
  return new Map([
    [join(intent.worktree, '.git'), `gitdir: ${p.gitDir}\n`],
    [join(p.gitDir, 'HEAD'), `ref: refs/heads/${intent.branch}\n`],
    [join(p.gitDir, 'commondir'), '../..\n'],
    [join(p.gitDir, 'gitdir'), `${intent.worktree}/.git\n`],
    [join(p.gitDir, 'locked'), 'factory-owned\n'],
    [join(intent.gitCommonDirectory, 'shallow'), `${intent.baseCommit}\n`],
    [join(intent.gitCommonDirectory, 'refs/heads', intent.branch), `${intent.baseCommit}\n`],
    [join(intent.gitCommonDirectory, 'config'), CONFIG],
  ]);
}

async function verifyMetadata(intent, p) {
  const info = await stat(intent.worktree);
  if (!info?.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)
    || (process.getuid && info.uid !== process.getuid())) fail('WORKSPACE_CONFLICT');
  for (const [path, value] of metadata(intent, p)) {
    if (!(await regular(path)).equals(Buffer.from(value))) fail('WORKSPACE_CONFLICT');
  }
}

// Explicit action only, under the application's single-owner lock; never call from inspection.
export async function prepareWorkspace(intent, { signal } = {}) {
  return safe(async () => {
    cancelled(signal);
    const p = await validate(intent);
    await owner(intent, p, true); // Ownership precedes any retained Git/source side effect.
    await privateTree(p.control);
    const existing = await prepared(intent, p);
    if (existing) { cancelled(signal); return existing; }
    const source = await sourceRepository(intent.repositoryPath, signal);
    const { manifest, objects } = await committedSource(source, intent.baseCommit, signal);
    if (manifest.id !== intent.sourceManifest.id) fail('WORKSPACE_CONFLICT');
    const common = intent.gitCommonDirectory;
    await dir(join(common, 'objects'));
    await dir(join(common, 'refs', 'heads'));
    await once(join(common, 'HEAD'), 'ref: refs/heads/unused\n');
    await once(join(common, 'config'), CONFIG);
    // A private shallow object store avoids alternates, owner metadata, and shared hardlinks.
    await once(join(common, 'shallow'), `${intent.baseCommit}\n`);
    for (const [oid, { raw }] of objects) {
      cancelled(signal);
      await once(join(common, 'objects', oid.slice(0, 2), oid.slice(2)), deflateSync(raw));
    }
    const branchFile = join(common, 'refs', 'heads', intent.branch);
    if (await stat(branchFile)) {
      if (!(await regular(branchFile)).equals(Buffer.from(`${intent.baseCommit}\n`))) fail('WORKSPACE_CONFLICT');
    } else {
      await prepareTransaction(`${branchFile}.lock`, join(p.control, 'branch-request.json'), intent, p);
      await git(common, ['update-ref', `refs/heads/${intent.branch}`, intent.baseCommit, '0'.repeat(40)], { signal });
    }
    cancelled(signal);
    const sourceInfo = await stat(intent.worktree);
    if (sourceInfo && (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink())) fail('WORKSPACE_CONFLICT');
    if (!await stat(p.gitDir)) {
      if (sourceInfo && (await readdir(intent.worktree)).length) fail('WORKSPACE_CONFLICT');
      await dir(intent.worktree);
      await once(join(p.control, 'worktree-request.json'), `${JSON.stringify({ intentId: intent.id })}\n`);
      // --no-checkout prevents filters, attributes, hooks and LFS from materializing anything.
      await git(common, ['worktree', 'add', '--no-checkout', '--lock', '--reason', 'factory-owned',
        intent.worktree, intent.branch], { signal });
    }
    if (!(await regular(join(p.control, 'worktree-request.json'))).equals(Buffer.from(`${JSON.stringify({ intentId: intent.id })}\n`))) fail('WORKSPACE_CONFLICT');
    await restrictTree(p.control);
    // Git registration is multi-file. Retain truncated native writes before completing them.
    // Never replace a different branch/pointer or repair metadata after a prepared receipt exists.
    for (const [path, value] of metadata(intent, p)) {
      if ((path === join(intent.worktree, '.git') || inside(p.gitDir, path)) && await stat(path)) {
        const bytes = await regular(path);
        const expected = Buffer.from(value);
        if (bytes.length < expected.length && expected.subarray(0, bytes.length).equals(bytes)) await retainArtifact(path, p);
      }
      await once(path, value, 0o600, p.control);
    }
    await verifyMetadata(intent, p);
    await validatePartialSource(intent);
    await chmod(join(intent.worktree, '.git'), 0o600);
    // Git's administrative files may follow the host umask. They remain in the private control tree.
    await restrictTree(p.control);
    for (const entry of manifest.entries) {
      cancelled(signal);
      await once(join(intent.worktree, entry.path), objects.get(entry.objectId).data, entry.mode === '100755' ? 0o700 : 0o600, p.control);
    }
    await prepareTransaction(join(p.gitDir, 'index.lock'), join(p.control, 'index-request.json'), intent, p);
    await git(p.gitDir, ['--work-tree', intent.worktree, 'read-tree', intent.baseCommit], { signal });
    await restrictTree(p.control);
    cancelled(signal);
    const receipt = receiptFor(intent, p);
    await once(p.receipt, `${JSON.stringify(receipt)}\n`);
    return receipt;
  });
}

async function prepareTransaction(lock, request, intent, p) {
  const token = `${JSON.stringify({ intentId: intent.id })}\n`;
  if (await stat(lock)) {
    // Only our recorded transaction may leave a stale lock. Preserve it, never adopt its bytes.
    if (!(await regular(request)).equals(Buffer.from(token))) fail('WORKSPACE_CONFLICT');
    await retainArtifact(lock, p);
  }
  await once(request, token);
}

async function retainArtifact(path, p) {
  await dir(join(p.control, 'retained'));
  await rename(path, join(p.control, 'retained', `${basename(path)}-${randomUUID()}`));
}

async function validatePartialSource(intent) {
  const files = new Set(['.git', ...intent.sourceManifest.entries.map(({ path }) => path)]);
  const directories = new Set(['']);
  for (const file of files) {
    for (let parent = dirname(file); parent !== '.'; parent = dirname(parent)) directories.add(parent);
  }
  const visit = async (path, local = '') => {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (info.isFile() && (info.nlink !== 1 || !files.has(local)))
      || (info.isDirectory() && !directories.has(local)) || (!info.isFile() && !info.isDirectory())) fail('WORKSPACE_CONFLICT');
    if (info.isDirectory()) for (const name of await readdir(path)) await visit(join(path, name), local ? `${local}/${name}` : name);
  };
  await visit(intent.worktree);
}

async function restrictTree(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) || (info.isFile() && info.nlink !== 1)) fail('WORKSPACE_CONFLICT');
  await chmod(path, info.isDirectory() ? 0o700 : 0o600);
  if (info.isDirectory()) for (const name of await readdir(path)) await restrictTree(join(path, name));
}

// Passive artifact lookup. The application owns and persists failed/stopped outcomes separately.
export async function inspectWorkspace(intent) {
  return safe(async () => {
    const p = await validate(intent);
    if (!await owner(intent, p, false)) {
      if (await stat(p.workspace) && (await readdir(p.workspace)).length) fail('WORKSPACE_CONFLICT');
      return { status: 'not-prepared', intentId: intent.id };
    }
    await privateTree(p.control);
    return (await prepared(intent, p)) ?? { status: 'preparing', intentId: intent.id, retained: true };
  });
}
