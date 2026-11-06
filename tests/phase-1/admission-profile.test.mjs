import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runOwnedScope } from '../fixtures/containment-harness.mjs';

// Agreed seam: controlled admission execution with disposable packages and the actual contained check runner.
const worker = fileURLToPath(new URL('./admission-worker.mjs', import.meta.url));
async function cleanup(root) {
  if (process.env.FACTORY_ADMISSION_EVIDENCE) return;
  async function writable(path) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await writable(`${path}/${entry.name}`);
  }
  await writable(root);
  await rm(root, { recursive: true, force: true });
}

test('composed admission profile binds the qualified execution modules or fails closed without them', async t => {
  const root = await mkdtemp('/tmp/factory-dependencies-');
  let drained = false;
  try {
    const result = await runOwnedScope(t, [worker, root, 'qualified-profile'], { timeout: 60000 });
    drained = true;
    assert.equal(result.code, 0, `${result.stderr}\nRetained fixture: ${root}`);
    const evidence = JSON.parse(result.stdout);
    assert.equal(typeof evidence.composedModule, 'boolean');
    if (process.env.FACTORY_ADMISSION_EVIDENCE) await writeFile(`${process.env.FACTORY_ADMISSION_EVIDENCE}/qualified-profile.json`, JSON.stringify({ root, ...evidence }), { mode: 0o600 });
  } finally { if (drained) await cleanup(root); }
});
