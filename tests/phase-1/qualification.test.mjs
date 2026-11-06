import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runOwnedScope } from '../fixtures/containment-harness.mjs';
import { createDraftQualification } from '../../src/qualification.mjs';

for (const scenario of ['green', 'candidate-tautology', 'candidate-unrelated', 'candidate-empty', 'candidate-skipped', 'candidate-crash', 'candidate-missing',
  'candidate-mixed-empty', 'candidate-valid-literal', 'candidate-stale-live', 'no-change', 'wrong-scope', 'same-helper-scope', 'unchanged-helper', 'fabricated', 'missing',
  'crash', 'wrong-case', 'wrong-assertion', 'malformed', 'skipped', 'no-tests', 'unrelated-error', 'final-vitest', 'final-lint', 'final-no-tests', 'final-skipped',
  'owner-advance', 'executable-base', 'deleted-file', 'mode-change', 'hidden-change', 'incomplete',
  'ignored-reporter', 'unsupported-version', 'report-stdout', 'report-truncated', 'report-duplicate', 'report-overflow', 'report-missing-events', 'report-inconsistent',
  'probe-empty-passes', 'probe-skips-run', 'runner-worker-count', 'runner-file-parallelism', 'final-missing-candidate', 'final-renamed-candidate',
  'stale-overlay', 'stale-candidate', 'stale-report', 'stop-finalization',
  'stale-source', 'stale-patch', 'stale-test', 'stale-toolchain', 'stale-check', 'stale-profile', 'missing-new-file',
  'policy-live', 'policy-passive', 'module-live', 'module-passive', 'qualifier-module-passive', 'composed-modules', 'composed-missing',
  'profile-traversal', 'profile-policy-absent', 'object-is-gaming', 'helper-unsupported', 'async-save',
  'stop-capture', 'stop-during-capture', 'forged-state', 'runner-pool-threads', 'final-pool-threads',
  'late-source', 'tool-limit', 'stop', 'deadline', 'report-failure', 'drain-report', 'crash-inspect']) {
  test(`independent draft qualification through trusted execution: ${scenario}`, async t => {
    const root = await mkdtemp('/tmp/factory-dependencies-');
    let drained = false;
    try {
      const result = await runOwnedScope(t, [fileURLToPath(new URL(scenario === 'drain-report' ? './qualification-drain-worker.mjs' : './qualification-worker.mjs', import.meta.url)), root, scenario]);
      drained = true;
      let evidence;
      if (scenario === 'crash-inspect') {
        assert.notEqual(result.code, 0);
        const input = JSON.parse(await readFile(`${root}/inspection-input.json`, 'utf8'));
        const qualifier = createDraftQualification({ verifyDraft() { assert.fail('Passive reopen cannot request live authority.'); } });
        evidence = await qualifier.inspect(input);
        assert.equal(evidence.status, 'interrupted');
        assert.equal(evidence.artifactStatus, 'verified');
        assert.equal(evidence.artifacts.complete, true);
        assert.equal(evidence.reviewReady, false);
        assert.deepEqual(await qualifier.inspect(input), evidence);
      } else {
        assert.equal(result.code, 0, result.stderr);
        evidence = JSON.parse(result.stdout);
      }
      if (process.env.FACTORY_QUALIFICATION_EVIDENCE) await writeFile(`${process.env.FACTORY_QUALIFICATION_EVIDENCE}/${scenario}.json`, JSON.stringify({ root, ...evidence }), { mode: 0o600 });
    } finally {
      if (drained && !process.env.FACTORY_QUALIFICATION_EVIDENCE) {
        async function writable(path) {
          await chmod(path, 0o700);
          for (const item of await readdir(path, { withFileTypes: true })) if (item.isDirectory()) await writable(`${path}/${item.name}`);
        }
        await writable(root); await rm(root, { recursive: true, force: true });
      }
    }
  });
}
