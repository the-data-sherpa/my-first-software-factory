import test from 'node:test';
import assert from 'node:assert/strict';
import { runOwnedScope } from '../fixtures/containment-harness.mjs';
import { mkdtemp, chmod, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Agreed seams: trusted owner preparation and verified dependency mounts, with actual Bun and a loopback registry.
async function scenario(t, name, verify) {
  const root = await mkdtemp('/tmp/factory-dependencies-');
  let drained = false; let passed = false;
  try {
    const runner = fileURLToPath(new URL('./dependencies-registry-runner.mjs', import.meta.url));
    const terminal = await runOwnedScope(t, [runner, name, root]);
    drained = true;
    assert.equal(terminal.code, 0, terminal.stderr);
    await verify(JSON.parse(terminal.stdout));
    passed = true;
  } finally {
    // Preserve failed assertions and fixtures whose scope drainage was not established.
    if (drained && passed) {
      async function writable(path) {
        await chmod(path, 0o700);
        for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await writable(`${path}/${entry.name}`);
      }
      await writable(root); await rm(root, { recursive: true, force: true });
    } else t.diagnostic(`Retained fixture: ${root}`);
  }
}

test('real Bun resolves scoped and nested multi-version locked packages with bounded caret and tilde ranges', async (t) => {
  await scenario(t, 'nested', result => {
    assert.equal(result.check.passed, true);
    assert.equal(result.lockfilesUnchanged, true);
    assert.equal(JSON.parse(result.check.output).value, 'transitive registry fixture');
    assert.equal(JSON.parse(result.check.output).scoped, 'transitive registry fixture');
    assert.deepEqual(result.requests.map(({ path }) => path).sort(), ['/\u0040fixture/scoped/-/scoped-3.0.0.tgz', '/fixture-leaf/-/fixture-leaf-1.0.0.tgz', '/fixture-leaf/-/fixture-leaf-2.0.0.tgz', '/vitest/-/vitest-1.0.0.tgz']);
  });
});

test('fetch authority is explicit and saved intents plus bounded reservations precede every archive request', async (t) => {
  await scenario(t, 'authority', result => assert.deepEqual(result, { saved: true, reservations: true, requests: 2 }));
});

test('redirects, oversized bodies, wrong integrity and unsafe or hidden archive inputs fail without following endpoints', async (t) => {
  await scenario(t, 'fetch-failures', result => {
    assert.equal(result.redirect, 'DEPENDENCIES_FETCH_FAILED');
    assert.equal(result.timeout, 'DEPENDENCIES_TIMEOUT');
    assert.equal(result.oversized, 'DEPENDENCIES_FETCH_FAILED');
    assert.equal(result.chunkedLimit, 'DEPENDENCIES_FETCH_LIMIT');
    assert.equal(result.integrity, 'DEPENDENCIES_INTEGRITY');
    assert.equal(result.archiveTraversal, 'DEPENDENCIES_UNSAFE');
    assert.equal(result.archiveConfig, 'DEPENDENCIES_UNSAFE');
    assert.equal(result.hiddenDependency, 'DEPENDENCIES_UNSUPPORTED');
  });
});

test('cancelling the actual registry Bun install drains sandbox descendants before releasing owner authority', async (t) => {
  await scenario(t, 'cancel-install', result => assert.deepEqual(result, { cancelled: 'DEPENDENCIES_ABORTED', bunObserved: true, survivors: [], requests: 2, status: 'incomplete' }));
});

test('owner fetch cancellation drains the active socket before releasing ownership and cannot start Bun install', async (t) => {
  await scenario(t, 'cancel-fetch', result => assert.deepEqual(result, { cancelled: 'DEPENDENCIES_ABORTED', sockets: 0, ownerReleased: true, requests: 1 }));
});

for (const placement of ['scoped-substitution', 'nested-scoped-substitution']) {
  test(`${placement}: owner admission rejects an unscoped archive for a scoped dependency before fetching`, async (t) => {
    await scenario(t, placement, result => assert.deepEqual(result, { code: 'DEPENDENCIES_UNSUPPORTED', requests: 0 }));
  });
}

test('unknown or ambiguous lock features and arbitrary transitive sources fail before any request', async (t) => {
  await scenario(t, 'reject-locks', result => {
    assert.equal(Object.keys(result).length, 16);
  });
});

test('changed retained acquisitions cannot authorize registry bundle reuse', async (t) => {
  await scenario(t, 'tamper', result => {
    assert.equal(result.check.passed, true);
  });
});

test('verified registry bundles can target another private workspace of the same exact source and reject later config edits', async (t) => {
  await scenario(t, 'reuse', result => {
    assert.equal(result.targetBound, true);
    assert.equal(result.check.passed, true);
    assert.equal(result.requests.length, 2);
  });
});

test('explicit owner fetch installs an exact transitive registry graph using real frozen network-denied Bun', async (t) => {
  await scenario(t, 'prepare', result => {
    assert.equal(result.receipt.status, 'prepared');
    assert.equal(result.receipt.bunVersion, '1.3.14');
    assert.equal(result.receipt.network, 'kernel-denied');
    assert.equal(result.lockfilesUnchanged, true);
    assert.deepEqual(result.receipt.sentinels, []);
    assert.equal(result.receipt.suppression.positive.length, 6);
    assert.deepEqual(result.receipt.suppression.suppressed, []);
    assert.deepEqual(result.requests.map(({ method, path }) => [method, path]).sort(), [
      ['GET', '/fixture-leaf/-/fixture-leaf-2.0.0.tgz'], ['GET', '/vitest/-/vitest-1.0.0.tgz'],
    ]);
    assert.equal(result.requests.some((request) => request.authorization), false);
    assert.equal(result.check.passed, true);
    assert.equal(JSON.parse(result.check.output).value, 'transitive registry fixture');
  });
});
