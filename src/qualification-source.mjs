// Opaque trusted source capability. There is no caller-selected root, argv, or
// fabricated workspace intent, and the dependency handle remains bound to worktree.
import { join } from 'node:path';
import { privateRoot, snapshot, sourceFingerprint } from './containment-files.mjs';
import { validateWorkspace, verifyCaptured, fail } from './qualification-artifacts.mjs';
const sources = new WeakMap();
export async function qualificationSource({ directory, run, capture, variant }) {
  if (!['base', 'candidate-base', 'draft'].includes(variant)) fail('QUALIFICATION_SOURCE_INVALID');
  await validateWorkspace(directory, run);
  await verifyCaptured(directory, run, capture);
  const token = Object.freeze({});
  sources.set(token, { directory, run: structuredClone(run), capture: structuredClone(capture), variant });
  return token;
}
export async function snapshotQualificationSource(token, worktree, destination) {
  const record = sources.get(token);
  if (!record || record.run.workspace.intent.worktree !== worktree) fail('QUALIFICATION_SOURCE_INVALID');
  await validateWorkspace(record.directory, record.run);
  await verifyCaptured(record.directory, record.run, record.capture);
  const source = join(record.directory, 'qualification', record.variant);
  const expected = record.variant === 'base' ? record.capture.baseSourceDigest
    : record.variant === 'candidate-base' ? record.capture.candidateBase?.sourceDigest : record.capture.sourceDigest;
  if (await sourceFingerprint(source) !== expected) fail('QUALIFICATION_SOURCE_INVALID');
  const root = await privateRoot(source);
  try {
    const digest = await snapshot(root, destination, []);
    if (digest !== expected) fail('QUALIFICATION_SOURCE_INVALID');
    return digest;
  } finally { await root.close(); }
}
