import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runOwnedScope } from '../fixtures/containment-harness.mjs';
import { prereleasePackages } from './dependencies-prerelease-fixture.mjs';

// Agreed seams: owner registry admission and preparation with trusted loopback acquisition and actual Bun 1.3.14.
// Authored synthetic packages only: this proves controlled Bun behavior, not real archives or the captured target lock.
async function scenario(t, name, verify) {
  const root = await mkdtemp('/tmp/factory-dependency-compatibility-');
  let drained = false; let passed = false;
  try {
    const terminal = await runOwnedScope(t, [fileURLToPath(new URL('./dependencies-compatibility-runner.mjs', import.meta.url)), name, root]);
    drained = true;
    if (process.env.FACTORY_DEPENDENCY_COMPATIBILITY_EVIDENCE) await writeFile(
      `${process.env.FACTORY_DEPENDENCY_COMPATIBILITY_EVIDENCE}/${name}.json`, JSON.stringify({ root, ...terminal }), { mode: 0o600 });
    assert.equal(terminal.code, 0, terminal.stderr);
    await verify(JSON.parse(terminal.stdout));
    passed = true;
  } finally {
    // Keep failed fixtures and any fixture whose drainage was not established.
    if (drained && passed) {
      async function writable(path) {
        await chmod(path, 0o700);
        for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await writable(`${path}/${entry.name}`);
      }
      await writable(root); await rm(root, { recursive: true, force: true });
    } else t.diagnostic(`Retained fixture: ${root}`);
  }
}
const planned = ['/@nodelib/fs.scandir/-/fs.scandir-2.1.5.tgz', '/@nodelib/fs.scandir/-/fs.scandir-3.0.0.tgz', '/@nodelib/fs.walk/-/fs.walk-1.2.8.tgz',
  '/array.prototype.flat/-/array.prototype.flat-1.3.3.tgz', '/cli/-/cli-2.0.0.tgz', '/multi/-/multi-1.0.0.tgz',
  '/native-linux-x64/-/native-linux-x64-0.34.5.tgz', '/native/-/native-0.34.5.tgz'];
const installed = ['node_modules', 'node_modules/.bin', 'node_modules/.bin/alpha -> ../multi/a.js', 'node_modules/.bin/beta -> ../multi/b.js',
  'node_modules/.bin/cli -> ../cli/bin/cli.js', 'node_modules/@nodelib', 'node_modules/@nodelib/fs.scandir', 'node_modules/@nodelib/fs.walk',
  'node_modules/@nodelib/fs.walk/node_modules', 'node_modules/@nodelib/fs.walk/node_modules/@nodelib', 'node_modules/@nodelib/fs.walk/node_modules/@nodelib/fs.scandir',
  'node_modules/array.prototype.flat', 'node_modules/cli', 'node_modules/cli/bin', 'node_modules/multi', 'node_modules/native', 'node_modules/native-linux-x64'];

for (const configVersion of [0, 1]) {
  test(`frozen Bun prepares configuration version ${configVersion}: dotted, nested, host-optional and bin forms from exactly the planned requests`, async (t) => {
    await scenario(t, `profile-${configVersion}`, result => {
      assert.equal(result.status, 'prepared');
      assert.equal(result.inspected, 'prepared');
      assert.equal(result.bunVersion, '1.3.14');
      assert.equal(result.network, 'kernel-denied');
      assert.equal(result.lockUnchanged, true);
      assert.deepEqual(result.planned, planned);
      assert.deepEqual(result.excluded, ['native-darwin-arm64']);
      assert.deepEqual(result.requests.map(({ path }) => path).sort((a, b) => a.localeCompare(b, 'en')), planned);
      assert.ok(result.requests.every(({ method, authorization }) => method === 'GET' && authorization === null));
      assert.deepEqual(result.inventory.sort((a, b) => a.localeCompare(b, 'en')), installed);
      // Root and dependency lifecycle scripts, including the host platform package's, stay suppressed.
      assert.deepEqual(result.sentinels, []);
      assert.equal(result.suppression.positive.length, 6);
      assert.deepEqual(result.suppression.suppressed, []);
    });
  });
}

test('frozen Bun prepares an authored prerelease from exactly its locked archive', async (t) => {
  await scenario(t, 'prerelease', result => {
    assert.equal(result.status, 'prepared', JSON.stringify(result));
    assert.equal(result.inspected, 'prepared');
    assert.equal(result.bunVersion, '1.3.14');
    assert.equal(result.network, 'kernel-denied');
    assert.equal(result.lockUnchanged, true);
    assert.equal(result.manifestUnchanged, true);
    assert.equal(result.npmLockUnchanged, true);
    assert.deepEqual(result.sentinels, []);
    assert.equal(result.suppression.positive.length, 6);
    assert.deepEqual(result.suppression.suppressed, []);
    assert.deepEqual(result.planned, ['/gensync/-/gensync-1.0.0-beta.2.tgz']);
    assert.deepEqual(result.requests, [{ method: 'GET', path: '/gensync/-/gensync-1.0.0-beta.2.tgz', authorization: null }]);
    assert.deepEqual(result.installed, [{ path: 'node_modules/gensync/package.json', name: 'gensync', version: '1.0.0-beta.2' }]);
  });
});

test('frozen Bun resolves prerelease cache boundaries with exact identities, case, scoped names, leading zeroes and stable controls', async (t) => {
  await scenario(t, 'prerelease-boundaries', result => {
    assert.equal(result.status, 'prepared', JSON.stringify(result));
    assert.equal(result.inspected, 'prepared');
    assert.equal(result.bunVersion, '1.3.14');
    assert.equal(result.network, 'kernel-denied');
    assert.equal(result.lockUnchanged, true);
    assert.equal(result.manifestUnchanged, true);
    assert.equal(result.npmLockUnchanged, true);
    assert.deepEqual(result.sentinels, []);
    assert.equal(result.suppression.positive.length, 6);
    assert.deepEqual(result.suppression.suppressed, []);
    const compare = (a, b) => a.path.localeCompare(b.path, 'en');
    const expected = prereleasePackages.map(pkg => ({ path: `node_modules/${pkg.name}/package.json`, name: pkg.name, version: pkg.version }));
    assert.deepEqual(result.installed.sort(compare), expected.sort(compare));
    const paths = prereleasePackages.map(pkg => `/${pkg.name}/-/${pkg.name.split('/').at(-1)}-${pkg.version}.tgz`).sort((a, b) => a.localeCompare(b, 'en'));
    assert.deepEqual(result.planned, paths);
    assert.deepEqual(result.requests.map(({ path }) => path), paths);
    assert.ok(result.requests.every(({ method, authorization }) => method === 'GET' && authorization === null));
    assert.deepEqual(result.excluded, []);
  });
});

test('published metadata the lock does not record refuses during acquisition before Bun installation starts', async (t) => {
  await scenario(t, 'archive-metadata', results => {
    assert.equal(Object.keys(results).length, 5);
    for (const [name, result] of Object.entries(results)) {
      assert.equal(result.code, 'DEPENDENCIES_UNSUPPORTED', name);
      assert.equal(result.installLaunched, false, name);
      assert.equal(result.inspected, 'incomplete', name);
      assert.equal(result.lockUnchanged, true, name);
      assert.deepEqual(result.requests.map(({ path }) => path), ['/left/-/left-1.2.0.tgz'], name);
    }
  });
});

test('a saved intent with a forged host, cache implementation or non-host archive is stale before any request or attempt', async (t) => {
  await scenario(t, 'forged-plan', result => assert.deepEqual(result, {
    host: { code: 'DEPENDENCIES_STALE', attempt: false }, cacheImplementation: { code: 'DEPENDENCIES_STALE', attempt: false },
    excludedPlanned: { code: 'DEPENDENCIES_STALE', attempt: false }, requests: 0 }));
});
