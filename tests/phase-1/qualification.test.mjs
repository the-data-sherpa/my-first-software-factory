import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runOwnedScope } from '../fixtures/containment-harness.mjs';
import { createDraftQualification } from '../../src/qualification.mjs';

for (const scenario of ['green', 'no-change', 'wrong-scope', 'same-helper-scope', 'unchanged-helper', 'fabricated', 'missing',
  'crash', 'wrong-case', 'wrong-assertion', 'malformed', 'skipped', 'no-tests', 'unrelated-error', 'final-vitest', 'final-lint', 'final-no-tests', 'final-skipped',
  'owner-advance', 'executable-base', 'deleted-file', 'mode-change', 'hidden-change', 'incomplete',
  'stale-source', 'stale-patch', 'stale-test', 'stale-toolchain', 'stale-check', 'stale-profile', 'missing-new-file',
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
