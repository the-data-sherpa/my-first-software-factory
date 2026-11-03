import { createHash } from 'node:crypto';
import { mkdir, open, rename, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { capturePrivateSource, sourceFingerprint, privateRoot, withFile } from './containment-files.mjs';
import { committedSource } from './workspace-git.mjs';
import { inspectWorkspace } from './workspace.mjs';
import { FactoryError } from './storage.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const fail = code => { throw new FactoryError(code, 'Inspect the retained private qualification evidence. No replay, repair, publication, or approval is authorized.'); };
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function save(path, value) {
  const file = await open(`${path}.pending`, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  await rename(`${path}.pending`, path);
}
export async function readArtifact(directory, path, max = 1024 * 1024) {
  const root = await privateRoot(directory);
  try { return await withFile(root, path, [], false, async file => {
    if ((await file.stat()).size > max) fail('QUALIFICATION_ARTIFACT_INVALID');
    return file.readFile();
  }); } finally { await root.close(); }
}
export async function json(directory, path, max) { return JSON.parse((await readArtifact(directory, path, max)).toString('utf8')); }
export async function validateWorkspace(directory, run) {
  const intent = run.workspace?.intent;
  if (!intent || intent.runId !== run.id || directory !== join(intent.stateDir, 'runs', run.id)
    || !same(await inspectWorkspace(intent), run.workspace.receipt)) fail('WORKSPACE_REQUIRED');
  const root = await privateRoot(directory);
  try { if ((await root.stat()).mode & 0o077) fail('PRIVATE_STORAGE_REQUIRED'); } finally { await root.close(); }
}

// Reads the retained private object store, not the owner checkout or a branch.
// Full reversible file replacements include additions, deletions and executable bits.
export async function captureDraft(directory, run, signal) {
  const root = join(directory, 'qualification');
  const intent = run.workspace.intent;
  const { manifest, objects } = await committedSource({ objects: join(intent.gitCommonDirectory, 'objects') }, intent.baseCommit, signal);
  if (!same(manifest, intent.sourceManifest)) fail('QUALIFICATION_BASE_INVALID');
  await mkdir(join(root, 'base'), { mode: 0o700 });
  for (const entry of manifest.entries) {
    const path = join(root, 'base', entry.path);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, objects.get(entry.objectId).data, { flag: 'wx', mode: entry.mode === '100755' ? 0o500 : 0o400 });
  }
  const base = await capturePrivateSource(join(root, 'base'));
  const draft = await capturePrivateSource(intent.worktree, join(root, 'draft'));
  if (!same(draft, await capturePrivateSource(intent.worktree))) fail('QUALIFICATION_SOURCE_CHANGED');
  const before = new Map(base.inventory.filter(e => e.type === 'file').map(e => [e.path, e]));
  const after = new Map(draft.inventory.filter(e => e.type === 'file').map(e => [e.path, e]));
  const changes = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    if (same(before.get(path), after.get(path))) continue;
    const content = async (side, entry) => entry ? { ...entry, contentBase64: (await readFile(join(root, side, path))).toString('base64') } : null;
    changes.push({ path, before: await content('base', before.get(path)), after: await content('draft', after.get(path)) });
  }
  const patch = { version: 1, format: 'complete-file-replacements-base64', complete: true,
    baseCommit: intent.baseCommit, baseDigest: base.digest, draftDigest: draft.digest,
    directories: { before: base.inventory.filter(e => e.type === 'directory'), after: draft.inventory.filter(e => e.type === 'directory') }, changes };
  await save(join(root, 'patch.json'), patch);
  return { base, draft, patchDigest: hash(JSON.stringify(patch)), changes: changes.map(c => ({ path: c.path,
    operation: !c.before ? 'add' : !c.after ? 'delete' : 'modify', beforeMode: c.before?.executable, afterMode: c.after?.executable })),
    sourceDigest: await sourceFingerprint(join(root, 'draft')),
    baseSourceDigest: await sourceFingerprint(join(root, 'base'), intent.sourceManifest) };
}
export async function verifyCaptured(directory, run, capture) {
  const root = join(directory, 'qualification');
  if (!same(await capturePrivateSource(join(root, 'base')), capture.base)
    || !same(await capturePrivateSource(join(root, 'draft')), capture.draft)
    || !same(await capturePrivateSource(run.workspace.intent.worktree), capture.draft)
    || hash(await readArtifact(root, 'patch.json', 384 * 1024 * 1024)) !== capture.patchDigest
    || await sourceFingerprint(join(root, 'base'), run.workspace.intent.sourceManifest) !== capture.baseSourceDigest
    || await sourceFingerprint(join(root, 'draft')) !== capture.sourceDigest) fail('QUALIFICATION_INVALIDATED');
}
