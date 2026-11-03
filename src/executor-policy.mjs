import { FactoryError } from './storage.mjs';
import { parts } from './containment-files.mjs';

export function validateExecutorScope(scope) {
  const fail = () => { throw new FactoryError('EXECUTOR_SCOPE', 'Select explicit relative source/test files only; configuration, dependencies and private metadata are protected.'); };
  if (!scope || Object.keys(scope).join() !== 'writePaths' || !Array.isArray(scope.writePaths)
    || !scope.writePaths.length || scope.writePaths.length > 32) fail();
  const paths = scope.writePaths;
  for (const path of paths) {
    try { parts(path, ['vendor', 'package.json', 'package-lock.json', 'bun.lock']); } catch { fail(); }
    if (!/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(path) || path.length > 256
      || path.split('/').some(p => p.startsWith('.') || ['vendor', 'config', 'configs', 'configuration'].includes(p)
        || /^(?:package(?:-lock)?\.json|.*\.lockb?|.*\.config\.[^.]+|[a-z]*config(?:\.[^.]+)?\.[^.]+|.*\.(?:json|ya?ml|toml)|AGENTS\.md|CLAUDE\.md)$/.test(p))) fail();
  }
  if (new Set(paths).size !== paths.length || paths.some(a => paths.some(b => a !== b && b.startsWith(`${a}/`)))) fail();
  return { writePaths: [...paths].sort() };
}

const object = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
export const EXECUTOR_TOOLS = Object.freeze([
  { name: 'read_file', description: 'Read a UTF-8 worktree evidence file, at most 16384 bytes. Use returned byte offsets for pagination.',
    parameters: object({ path: { type: 'string', maxLength: 256 }, offset: { type: 'integer', minimum: 0 } }, ['path', 'offset']) },
  { name: 'write_file', description: 'Replace one explicitly permitted UTF-8 source/test file. At most 65536 bytes. Interrupted writes are unsafe to replay.',
    parameters: object({ path: { type: 'string', maxLength: 256 }, text: { type: 'string', maxLength: 65536 } }, ['path', 'text']) },
  { name: 'run_check', description: 'Run one fixed contained one-shot check. No commands, arguments, environment or installs.',
    parameters: object({ name: { type: 'string', enum: ['vitest', 'lint'] } }, ['name']) },
]);

// Validate independently of SDK coercion/argument repair. No model-supplied capabilities.
export function validateExecutorCall(call) {
  const tool = EXECUTOR_TOOLS.find(t => t.name === call?.name);
  const args = call?.arguments;
  const fail = () => { throw new FactoryError('EXECUTOR_TOOL_SCHEMA', 'Only the registered bounded factory tool schemas are accepted.'); };
  if (!tool || !args || Array.isArray(args) || typeof args !== 'object'
    || Object.keys(args).length !== tool.parameters.required.length || tool.parameters.required.some(k => !Object.hasOwn(args, k))) fail();
  if (tool.name === 'run_check') { if (!['vitest', 'lint'].includes(args.name)) fail(); }
  else {
    if (typeof args.path !== 'string' || args.path.length > 256) fail();
    try { parts(args.path); } catch { fail(); }
    if (tool.name === 'read_file' && (!Number.isSafeInteger(args.offset) || args.offset < 0)) fail();
    if (tool.name === 'write_file' && (typeof args.text !== 'string' || Buffer.byteLength(args.text) > 65536
      || args.text !== Buffer.from(args.text).toString('utf8'))) fail();
  }
  return structuredClone(args);
}
