import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runOwnedScope } from '../fixtures/containment-harness.mjs';

async function cleanup(path) {
  await chmod(path, 0o700);
  for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await cleanup(join(path, entry.name));
  await rm(path, { recursive: true, force: true });
}
for (const scenario of ['green', 'stale-projection', 'stale-containment-entry', 'missing-qualification-module', 'tautology', 'final-lint', 'no-change', 'refusal', 'stop-check', 'stop-final',
  'deadline-final', 'deadline-cancel-join', 'report-failure', 'unexpected-qualifier-close', 'crash-check', 'crash-final']) {
  test(`qualified application and CLI integration: ${scenario}`, async t => {
    const root = await mkdtemp('/tmp/factory-dependencies-');
    let drained = false; let passed = false;
    try {
      const result = await runOwnedScope(t, [fileURLToPath(new URL('./qualification-integration-worker.mjs', import.meta.url)), root, scenario]);
      drained = true;
      if (process.env.FACTORY_QUALIFICATION_INTEGRATION_EVIDENCE) await writeFile(
        join(process.env.FACTORY_QUALIFICATION_INTEGRATION_EVIDENCE, `${scenario}.json`),
        JSON.stringify({ root, code: result.code, stdout: result.stdout, stderr: result.stderr }), { mode: 0o600 });
      if (scenario.startsWith('crash-')) {
        assert.notEqual(result.code, 0);
        const { stateDir, runId } = JSON.parse(await readFile(join(root, 'crash-input.json'), 'utf8'));
        const executable = fileURLToPath(new URL('../../bin/factory.mjs', import.meta.url));
        const exec = promisify(execFile);
        const inspect = async () => JSON.parse((await exec(process.execPath, [executable, 'inspect', runId, '--state-dir', stateDir], {
          env: { PATH: '/usr/bin', HOME: root }, timeout: 15000, maxBuffer: 4 * 1024 * 1024,
        })).stdout);
        const before = await readFile(join(stateDir, 'factory.sqlite'));
        const run = await inspect();
        assert.equal(run.status, 'interrupted');
        assert.equal(run.outcome.reason, 'executor_reconciliation_required');
        assert.equal(run.outcome.reviewReady, false);
        assert.equal(run.workItem, undefined);
        assert.notEqual(run.qualificationEvidence.status, 'qualified');
        assert.deepEqual(await inspect(), run);
        assert.deepEqual(await readFile(join(stateDir, 'factory.sqlite')), before, 'Disconnected inspection never finalizes interrupted qualification.');
      } else assert.equal(result.code, 0, result.stderr);
      passed = true;
    } finally {
      // Preserve failed cases for diagnosis, and optionally one complete green artifact example.
      if (drained && passed && !(scenario === 'green' && process.env.FACTORY_QUALIFICATION_INTEGRATION_KEEP === '1')) await cleanup(root);
    }
  });
}
