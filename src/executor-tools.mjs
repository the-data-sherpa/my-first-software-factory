import { defineTool } from '@earendil-works/pi-durable';
import { createRunTools } from './run-tools.mjs';
import { privateRoot, withFile, sourceFingerprint } from './containment-files.mjs';
import { EXECUTOR_TOOLS, validateExecutorCall } from './executor-policy.mjs';
import { digest } from './executor-artifacts.mjs';
import { FactoryError } from './storage.mjs';

/** Keep the original manifest immutable; replace only explicit permitted file entries
 * in a detached expected manifest. The existing snapshot validator checks everything
 * else, including directories, modes, new files and excluded/private paths.
 */
export async function scopedSource(run, scope) {
  const manifest = structuredClone(run.workspace.intent.sourceManifest);
  const root = await privateRoot(run.workspace.intent.worktree);
  try {
    for (const path of scope.writePaths) {
      const prior = manifest.entries.find(e => e.path === path);
      let entry;
      try {
        entry = await withFile(root, path, [], false, async file => {
          const stat = await file.stat();
          if (stat.size > 65536 || Boolean(stat.mode & 0o111) !== (prior?.mode === '100755')) throw new FactoryError('EXECUTOR_SOURCE', 'Draft mode or size is outside the admitted scope.');
          const bytes = Buffer.alloc(stat.size + 1);
          const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
          if (bytesRead !== stat.size) throw new FactoryError('EXECUTOR_SOURCE', 'Draft changed during validation.');
          return { ...prior, path, mode: prior?.mode ?? '100644', bytes: bytesRead, sha256: digest(bytes.subarray(0, bytesRead)) };
        });
      } catch (error) { if (error.code !== 'ENOENT' || prior) throw error; }
      manifest.entries = manifest.entries.filter(e => e.path !== path);
      if (entry) manifest.entries.push(entry);
    }
    return await sourceFingerprint(run.workspace.intent.worktree, manifest);
  } finally { await root.close(); }
}

export async function createExecutorTools({ input, dependencyBundle, scope, verify, journal, hasPlan, fail }) {
  const owned = await createRunTools({ ...input, dependencyBundle });
  const calls = new Set();
  const tools = EXECUTOR_TOOLS.map(schema => defineTool({ ...schema,
    replay: schema.name === 'write_file' ? 'unsafe' : 'safe', executionMode: 'sequential', callers: ['model'],
    outputLimits: { maxBytes: 20000, maxLines: 20000 },
    async execute(args, api) {
      const id = api.callId.split('|')[0];
      let started = false;
      try {
        await verify();
        validateExecutorCall({ name: schema.name, arguments: args });
        if (calls.has(id)) throw new FactoryError('EXECUTOR_CALL_REUSED', 'A tool identity may execute only once. Inspect retained effects.');
        calls.add(id);
        if (schema.name === 'write_file' && (!scope.writePaths.includes(args.path) || !hasPlan())) {
          throw new FactoryError('EXECUTOR_WRITE_DENIED', 'Write only admitted files after recording your own plan.');
        }
        await journal({ type: 'tool-intent', callId: id, tool: schema.name, arguments: args, replay: schema.name === 'write_file' ? 'unsafe' : 'safe' });
        started = true;
        const result = schema.name === 'read_file' ? await owned.read(args.path, { offset: args.offset })
          : schema.name === 'write_file' ? await owned.write(args.path, args.text) : await owned.check(args.name);
        // Actual effects are retained before cross-store/application acknowledgement.
        const artifact = await journal({ type: 'tool-result', callId: id, tool: schema.name, result });
        await verify();
        const output = schema.name === 'run_check' ? { passed: result.passed, reason: result.reason, sourceDigest: result.sourceDigest,
          artifact, output: result.output.slice(0, 8192), outputTruncated: result.output.length > 8192 } : result;
        return { output: [{ type: 'text', text: JSON.stringify(output) }] };
      } catch (error) {
        fail(error);
        try { await journal({ type: 'tool-failure', callId: id, tool: schema.name, reason: error.code ?? 'EXECUTOR_TOOL_FAILED',
          uncertain: started && schema.name === 'write_file' }); } catch { /* Original drain/effect failure remains latched. */ }
        // No raw exception text or paths from host failures enters the model context.
        return { isError: true, output: [{ type: 'text', text: error.code ?? 'EXECUTOR_TOOL_FAILED' }] };
      }
    },
  }));
  return { tools, close: () => owned.close() };
}
