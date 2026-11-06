import { defineTool } from '@earendil-works/pi-durable';
import { createRunTools } from './run-tools.mjs';
import { privateRoot, withFile, sourceFingerprint } from './containment-files.mjs';
import { EXECUTOR_TOOLS, validateExecutorCall } from './executor-policy.mjs';
import { digest } from './executor-artifacts.mjs';
import { FactoryError } from './storage.mjs';
import { CONTAINMENT_LIMITS } from './containment.mjs';

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
          if (stat.size > CONTAINMENT_LIMITS.writeBytes || Boolean(stat.mode & 0o111) !== (prior?.mode === '100755')) throw new FactoryError('EXECUTOR_SOURCE', 'Draft mode or size is outside the admitted scope.');
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

// Bound the serialized envelope before the SDK sees it. JSON escaping can make
// a valid 16 KiB read much larger; SDK truncation would discard its continuation.
function encodeToolResult(name, result, artifact) {
  const limit = 16384;
  const oversized = () => { throw new FactoryError('EXECUTOR_OUTPUT_LIMIT', 'The tool response cannot fit its bounded evidence envelope.'); };
  if (name === 'write_file') {
    const text = JSON.stringify(result);
    if (Buffer.byteLength(text) > limit) oversized();
    return text;
  }
  const content = Buffer.from(name === 'read_file' ? result.text : result.output);
  const maximum = Math.min(content.length, name === 'run_check' ? 8192 : content.length);
  const encode = length => {
    while (length > 0 && length < content.length && (content[length] & 0xc0) === 0x80) length--;
    const text = content.subarray(0, length).toString('utf8');
    const output = name === 'read_file' ? { ...result, text, bytes: length,
      nextOffset: length < content.length ? result.offset + length : result.nextOffset }
      : { passed: result.passed, reason: result.reason, sourceDigest: result.sourceDigest,
        artifact, output: text, outputTruncated: length < content.length };
    return { text: JSON.stringify(output), bytes: length };
  };
  const full = encode(maximum);
  if (Buffer.byteLength(full.text) <= limit) return full.text;
  let low = 0; let high = maximum; let best;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = encode(middle);
    if (Buffer.byteLength(candidate.text) <= limit) { best = candidate; low = middle + 1; }
    else high = middle - 1;
  }
  if (!best || (content.length > 0 && best.bytes === 0)) oversized();
  return best.text;
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
        if (schema.name === 'run_check' && result.reason === 'output-limit') {
          throw new FactoryError('CHECK_OUTPUT_LIMIT', 'The check reached its output limit. Retain the partial draft and check evidence; no successful handoff is available.');
        }
        await verify();
        return { output: [{ type: 'text', text: encodeToolResult(schema.name, result, artifact) }] };
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
