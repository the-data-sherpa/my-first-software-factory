import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runOwnedScope } from '../fixtures/containment-harness.mjs';

async function cleanup(path) {
  await chmod(path, 0o700);
  for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await cleanup(`${path}/${entry.name}`);
  await rm(path, { recursive: true, force: true });
}

async function scenario(t, name, verify) {
  const root = await mkdtemp('/tmp/factory-dependency-graph-');
  let drained = false; let passed = false;
  try {
    const terminal = await runOwnedScope(t, [fileURLToPath(new URL('./dependencies-graph-runner.mjs', import.meta.url)), name, root]);
    drained = true;
    if (process.env.FACTORY_DEPENDENCY_GRAPH_EVIDENCE) await writeFile(
      `${process.env.FACTORY_DEPENDENCY_GRAPH_EVIDENCE}/${name}.json`, JSON.stringify({ root, ...terminal }), { mode: 0o600 });
    assert.equal(terminal.code, 0, terminal.stderr);
    const result = JSON.parse(terminal.stdout);
    await verify(result);
    passed = true;
  } finally {
    if (drained && passed) await cleanup(root);
    else t.diagnostic(`Retained fixture: ${root}`);
  }
}

// Public preparation, passive inspection and bundle verification with authored packages and actual pinned Bun.
// The graph expectation describes Bun's observed layout, independently of its lock-key placements.
test('prepared registry bundle verifies the actual rehoisted ordinary and peer relationships before reuse', async t => {
  await scenario(t, 'rehoisted', result => {
    assert.equal(result.status, 'prepared', JSON.stringify(result));
    assert.equal(result.inspected, 'prepared');
    assert.equal(result.bundleVerified, true);
    assert.equal(result.bunVersion, '1.3.14');
    assert.equal(result.network, 'kernel-denied');
    assert.equal(result.lockUnchanged, true);
    assert.deepEqual(result.sentinels, []);
    assert.deepEqual(result.unmetPeers, [{ placement: 'kw', peer: 'lowpeer', range: '^8.0.0', provider: 'lowpeer', version: '6.0.0' }]);
    assert.equal(result.graph?.status, 'verified', 'Prepared status requires verified installed relationships.');
    assert.equal(result.graph.version, 1);
    assert.equal(result.graph.policy, 'bun-installed-graph-v1');
    assert.equal(result.graph.inventoryDigest, result.inventoryDigest);
    assert.equal(result.graphMatchesInspection, true);
    assert.deepEqual(result.graph.nodes.map(({ path, name, version }) => ({ path, name, version })), [
      { path: 'node_modules/holder', name: 'holder', version: '4.0.0' },
      { path: 'node_modules/kw', name: 'kw', version: '5.0.0' },
      { path: 'node_modules/lowpeer', name: 'lowpeer', version: '8.0.0' },
      { path: 'node_modules/user', name: 'user', version: '9.0.0' },
      { path: 'node_modules/user/node_modules/lowpeer', name: 'lowpeer', version: '6.0.0' },
    ]);
    assert.deepEqual(result.graph.relationships, [
      { from: '', kind: 'dependencies', name: 'holder', range: '4.0.0', to: 'node_modules/holder', version: '4.0.0', optional: false },
      { from: '', kind: 'dependencies', name: 'user', range: '9.0.0', to: 'node_modules/user', version: '9.0.0', optional: false },
      { from: 'node_modules/holder', kind: 'dependencies', name: 'kw', range: '^5.0.0', to: 'node_modules/kw', version: '5.0.0', optional: false },
      { from: 'node_modules/holder', kind: 'dependencies', name: 'lowpeer', range: '^8.0.0', to: 'node_modules/lowpeer', version: '8.0.0', optional: false },
      { from: 'node_modules/kw', kind: 'peerDependencies', name: 'lowpeer', range: '^8.0.0', to: 'node_modules/lowpeer', version: '8.0.0', optional: false },
      { from: 'node_modules/user', kind: 'dependencies', name: 'lowpeer', range: '^6.0.0', to: 'node_modules/user/node_modules/lowpeer', version: '6.0.0', optional: false },
    ]);
    assert.deepEqual(result.graph.absentOptional, []);
    assert.deepEqual(result.requests.map(({ path }) => path), [
      '/holder/-/holder-4.0.0.tgz', '/kw/-/kw-5.0.0.tgz', '/lowpeer/-/lowpeer-6.0.0.tgz', '/lowpeer/-/lowpeer-8.0.0.tgz', '/user/-/user-9.0.0.tgz',
    ]);
    assert.ok(result.requests.every(({ method, authorization }) => method === 'GET' && authorization === null));
  });
});

test('an unsatisfied actual installed required peer cannot produce a prepared bundle', async t => {
  await scenario(t, 'unsatisfied-peer', result => {
    assert.equal(result.failure, 'DEPENDENCIES_UNSUPPORTED', JSON.stringify(result));
    assert.equal(result.inspected, 'incomplete');
    assert.equal(result.resultPresent, false);
    assert.deepEqual(result.installedEvidence, { peer: '^8.0.0', provider: '6.0.0' });
    assert.equal(result.lockUnchanged, true);
    assert.deepEqual(result.requests.map(({ path }) => path), ['/kw/-/kw-5.0.0.tgz', '/lowpeer/-/lowpeer-6.0.0.tgz']);
  });
});

test('an unplanned nested package carried by an acquired archive cannot produce a prepared bundle', async t => {
  await scenario(t, 'nested-payload', result => {
    assert.equal(result.failure, 'DEPENDENCIES_UNSUPPORTED', JSON.stringify(result));
    assert.equal(result.payloadPresent, true, 'The negative must reach the installed nested payload, rather than an earlier refusal.');
    assert.equal(result.resultPresent, false);
    assert.equal(result.inspected, 'incomplete');
    assert.equal(result.lockUnchanged, true);
    assert.deepEqual(result.requests.map(({ path }) => path), ['/carrier/-/carrier-1.0.0.tgz']);
  });
});

test('a nested payload cannot borrow a planned identity while changing its acquired file contents', async t => {
  await scenario(t, 'spoofed-content', result => {
    assert.equal(result.failure, 'DEPENDENCIES_UNSAFE', JSON.stringify(result));
    assert.equal(result.payloadPresent, true);
    assert.equal(result.payloadContents, 'export const value = "spoofed";');
    assert.equal(result.resultPresent, false);
    assert.equal(result.inspected, 'incomplete');
    assert.equal(result.lockUnchanged, true);
    assert.deepEqual(result.requests.map(({ path }) => path), ['/carrier/-/carrier-1.0.0.tgz', '/known/-/known-1.0.0.tgz']);
  });
});

test('an acquired carrier cannot create more copies than the planned locked occurrences', async t => {
  await scenario(t, 'extra-copy', result => {
    assert.equal(result.failure, 'DEPENDENCIES_UNSUPPORTED', JSON.stringify(result));
    assert.equal(result.payloadPresent, true);
    assert.equal(result.payloadContents, 'export const value = "known@1.0.0";');
    assert.equal(result.rootContents, result.payloadContents, 'This case uses genuine matching bytes, so changed contents are not its refusal.');
    assert.equal(result.resultPresent, false);
    assert.equal(result.inspected, 'incomplete');
    assert.equal(result.lockUnchanged, true);
  });
});

test('scoped nested providers and explicit optional absences remain supported', async t => {
  await scenario(t, 'optional-scoped', result => {
    assert.equal(result.status, 'prepared', JSON.stringify(result));
    assert.equal(result.inspected, 'prepared');
    assert.equal(result.bundleVerified, true);
    assert.equal(result.graph?.status, 'verified');
    assert.equal(result.lockUnchanged, true);
    assert.deepEqual(result.excluded, ['native-darwin']);
    assert.deepEqual(result.graph.nodes.map(({ path, name, version }) => ({ path, name, version })), [
      { path: 'node_modules/@scope/consumer', name: '@scope/consumer', version: '1.0.0' },
      { path: 'node_modules/@scope/consumer/node_modules/@scope/provider', name: '@scope/provider', version: '2.0.0' },
      { path: 'node_modules/@scope/provider', name: '@scope/provider', version: '3.0.0' },
    ]);
    assert.ok(result.graph.relationships.some(edge => edge.from === 'node_modules/@scope/consumer'
      && edge.to === 'node_modules/@scope/consumer/node_modules/@scope/provider' && edge.version === '2.0.0'));
    assert.deepEqual(result.graph.absentOptional, [
      { from: 'node_modules/@scope/consumer', kind: 'optionalDependencies', name: 'native-darwin', range: '1.0.0', reason: 'non-host-optional' },
      { from: 'node_modules/@scope/consumer', kind: 'peerDependencies', name: 'ghost', range: '^1.0.0', reason: 'optional-peer-absent' },
    ]);
    assert.deepEqual(result.requests.map(({ path }) => path), [
      '/@scope/consumer/-/consumer-1.0.0.tgz', '/@scope/provider/-/provider-2.0.0.tgz', '/@scope/provider/-/provider-3.0.0.tgz',
    ]);
  });
});

test('genuine preparation does not let missing or forged graph observations confer reuse authority', async t => {
  await scenario(t, 'graph-observations', result => {
    assert.equal(result.status, 'prepared', JSON.stringify(result));
    assert.equal(result.graph?.status, 'verified');
    for (const [name, observation] of Object.entries(result.tamperChecks)) {
      assert.deepEqual(observation, { inspection: 'DEPENDENCIES_UNSAFE', bundle: 'DEPENDENCIES_UNSAFE', restored: 'prepared' }, name);
    }
    assert.deepEqual(Object.keys(result.tamperChecks), ['missing', 'digest', 'relationship', 'policy']);
    assert.deepEqual(result.staleGraphImplementation, { code: 'DEPENDENCIES_STALE', attempt: false });
    assert.equal(result.requestsUnchanged, true, 'Inspection and stale validation never acquire or install again.');
    assert.equal(result.lockUnchanged, true);
  });
});

test('a genuine prepared bin shim cannot be redirected to another planned regular file', async t => {
  await scenario(t, 'bin-observation', result => {
    assert.equal(result.status, 'prepared', JSON.stringify(result));
    assert.equal(result.graph?.status, 'verified');
    assert.equal(result.originalShim, '../cli/bin/cli.js');
    assert.deepEqual(result.binTamper, { inspection: 'DEPENDENCIES_UNSUPPORTED', bundle: 'DEPENDENCIES_UNSUPPORTED', restored: 'prepared' });
    assert.equal(result.requestsUnchanged, true);
    assert.equal(result.lockUnchanged, true);
  });
});
