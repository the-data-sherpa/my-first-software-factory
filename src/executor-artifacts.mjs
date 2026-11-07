import { open, readdir, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { privateDirectory, FactoryError } from './storage.mjs';
import { privateRoot, withFile, sourceFingerprint } from './containment-files.mjs';
import { validateExecutorScope } from './executor-policy.mjs';

const fail = () => { throw new FactoryError('EXECUTOR_ARTIFACT', 'Retain invalid or incomplete executor evidence for owner inspection.'); };
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function createExecutorArtifacts(directory) {
  await privateDirectory(directory, { create: false });
  const path = await privateDirectory(join(directory, 'executor'), { newOnly: true, mustBeWithin: directory });
  const root = await privateRoot(path);
  let count = 0;
  return {
    async append(event) {
      if (count >= 256) fail();
      const data = JSON.stringify({ version: 1, ...event });
      if (Buffer.byteLength(data) > 2 * 1024 ** 2) fail();
      const name = `${String(++count).padStart(4, '0')}.json`;
      const file = await open(`/proc/self/fd/${root.fd}/${name}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
      return `executor/${name}`;
    },
    close: () => root.close(),
  };
}

/** Read-only, no runtime or SQLite access. Page is a zero-based event index;
 * offset is a byte offset returned by this function; length is 4..16384 bytes.
 * Every artifact remains inspectable even when the application's last save failed.
 */
export async function inspectExecutor({ directory, run, page = 0, offset = 0, length = 16384 }) {
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(offset) || offset < 0
    || !Number.isInteger(length) || length < 4 || length > 16384) fail();
  if (!run.executor) return { status: 'missing', reviewReady: false };
  const scope = validateExecutorScope(run.executor.scope);
  await privateDirectory(directory, { create: false });
  const path = join(directory, 'executor');
  let info;
  try { info = await lstat(path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!info) return { status: run.executor.status, scope, artifactStatus: 'missing', reviewReady: false };
  if (!info.isDirectory() || (info.mode & 0o077)) fail();
  const root = await privateRoot(path);
  try {
    const names = (await readdir(`/proc/self/fd/${root.fd}`)).sort();
    if (names.length > 256 || names.some(n => !/^\d{4}\.json$/.test(n))) fail();
    const events = []; const operations = [];
    let content; let totalBytes = 0; let plan; let completion; let retainedFailure;
    for (const [index, name] of names.entries()) {
      await withFile(root, name, [], false, async file => {
        const stat = await file.stat();
        totalBytes += stat.size;
        if (stat.size > 2 * 1024 ** 2 || totalBytes > 128 * 1024 ** 2 || (stat.mode & 0o077)
          || name !== `${String(index + 1).padStart(4, '0')}.json`) fail();
        const artifact = `executor/${name}`;
        const bytes = Buffer.alloc(stat.size + 1);
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
        if (bytesRead !== stat.size) fail();
        let event;
        try { event = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes.subarray(0, bytesRead))); } catch { fail(); }
        if (event.version !== 1 || !['intent', 'model-intent', 'model-response', 'tool-intent', 'tool-result', 'tool-failure', 'submission', 'completion', 'failure'].includes(event.type)) fail();
        if (index === 0 && (event.type !== 'intent' || event.runId !== run.id || event.requestId !== run.execution.requestId
          || event.kind !== run.executor.kind || JSON.stringify(event.scope) !== JSON.stringify(scope)
          || JSON.stringify(event.brief) !== JSON.stringify(run.brief)
          || JSON.stringify(event.source) !== JSON.stringify(run.workspace.intent.sourceManifest)
          || JSON.stringify(event.limits) !== JSON.stringify(run.limits) || event.deadlineAt !== run.deadlineAt
          || event.recoveryOwnerId !== run.executor.recoveryOwner?.id)) fail();
        events.push({ index, artifact, bytes: stat.size, type: event.type });
        if (event.type.startsWith('tool-')) operations.push({ type: event.type, callId: event.callId, tool: event.tool, artifact,
          ...(event.uncertain ? { uncertain: true } : {}) });
        if (event.type === 'model-response' && event.message?.stopReason === 'toolUse' && !plan && event.message?.content?.some(b => b.type === 'text' && b.text.trim())) plan = { artifact, provenance: 'model-authored' };
        if (event.type === 'completion') completion = event;
        if (event.type === 'failure') retainedFailure = { status: event.status, reason: event.reason };
        if (index === page) {
          const bytes = Buffer.alloc(length);
          const { bytesRead } = await file.read(bytes, 0, length, offset);
          let end = bytesRead; let text;
          for (; end >= Math.max(0, bytesRead - 3); end--) {
            try { text = new TextDecoder('utf8', { fatal: true }).decode(bytes.subarray(0, end)); break; } catch { /* UTF-8 page boundary */ }
          }
          if (text === undefined) fail();
          content = { artifact, text, offset, nextOffset: offset + end < stat.size ? offset + end : null };
        }
      });
    }
    let draftCurrent = false;
    try { draftCurrent = run.executor.draft?.sourceDigest === await sourceFingerprint(run.workspace.intent.worktree); } catch { /* Evidence remains available. */ }
    const complete = ['draft-produced', 'no-change'].includes(run.executor.status);
    if (complete && (!completion || completion.status !== run.executor.status || completion.sourceDigest !== run.executor.draft?.sourceDigest)) fail();
    for (const reference of [run.executor.plan, ...(run.executor.events ?? []), ...(run.executor.operations ?? [])].filter(Boolean)) {
      if (!events.some(e => e.artifact === reference.artifact)) fail();
    }
    return { ...structuredClone(run.executor), scope, reviewReady: false,
      ...(run.status === 'interrupted' && !complete ? { status: 'interrupted' } : {}),
      uncertainOperations: operations.filter(op => op.type === 'tool-intent' && !operations.some(result => result.callId === op.callId && result.type === 'tool-result')),
      artifactStatus: complete && !draftCurrent ? 'invalidated' : complete && !retainedFailure ? 'retained' : 'incomplete',
      draftCurrent, events, operations, ...(plan ? { plan } : {}), ...(retainedFailure ? { retainedFailure } : {}), ...(content ? { page: content } : {}) };
  } finally { await root.close(); }
}
