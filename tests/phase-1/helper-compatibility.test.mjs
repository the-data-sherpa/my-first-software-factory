import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOwnedScope } from '../fixtures/containment-harness.mjs';

async function cleanup(path) {
  await chmod(path, 0o700);
  for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await cleanup(join(path, entry.name));
  await rm(path, { recursive: true, force: true });
}
// Each case drives the factory application, CLI, composed executor, and real qualifier
// with controlled model transports and synthetic runner packages, never real Vitest.
const cases = [
  ['nullable-qualified'], ['nullable-candidate-mismatch'],
  ['nullable-qualified-at-write-limit'],
  ['changed-guard'], ['removed-guard'], ['changed-signature'], ['draft-reassignment'],
  ['wrong-write-pair'], ['stop-at-eligibility'], ['deadline-at-eligibility'], ['changed-before-read'], ['changed-same-size-before-read'],
  ['unsupported-base', 'reassignment,unguarded-nullable,non-empty-guard,second-guard'],
  ['unsupported-base', 'late-guard,guard-else,braced-guard,equality-guard'],
  ['unsupported-base', 'reordered-union,optional-parameter,other-call,operator'],
  ['unsupported-base', 'uninitialized-let,line-separator-comment,unicode-escape-name,regex-class-slash'],
  ['unsupported-base', 'compact-union,two-member-union,guard-return-newline,guard-return-comment-newline'],
  ['unsupported-base', 'invalid-utf8,absent-helper'],
  ['unsupported-base', 'oversized-comment'],
  ['unsupported-base', 'write-limit-comment'],
  ['unsupported-base', 'deep-parentheses'],
  ['unsupported-base', 'reassignment', 'legacy'],
];
for (const [scenario, names, legacy] of cases) {
  const label = [scenario, names, legacy && 'then legacy executor'].filter(Boolean).join(': ');
  test(`helper compatibility through composed qualification: ${label}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'factory-dependencies-'));
    const stateRoot = await mkdtemp('/tmp/factory-control-');
    let drained = false; let passed = false;
    try {
      const args = [fileURLToPath(new URL('./helper-compatibility-worker.mjs', import.meta.url)), root, scenario,
        names ?? '', legacy ?? '', join(stateRoot, 'state')];
      const result = await runOwnedScope(t, args);
      drained = true;
      if (process.env.FACTORY_HELPER_COMPATIBILITY_EVIDENCE) await writeFile(
        join(process.env.FACTORY_HELPER_COMPATIBILITY_EVIDENCE, `${label.replace(/[^a-z0-9-]+/g, '_')}.json`),
        JSON.stringify({ root, stateRoot, code: result.code, stdout: result.stdout, stderr: result.stderr }), { mode: 0o600 });
      assert.equal(result.code, 0, `${result.stderr}\nRetained fixture: ${root}; control state: ${stateRoot}`);
      passed = true;
    } finally {
      // Failed cases stay for diagnosis.
      if (drained && passed && !process.env.FACTORY_HELPER_COMPATIBILITY_EVIDENCE) { await cleanup(root); await cleanup(stateRoot); }
      else t.diagnostic(`Retained fixture: ${root}; control state: ${stateRoot}`);
    }
  });
}
