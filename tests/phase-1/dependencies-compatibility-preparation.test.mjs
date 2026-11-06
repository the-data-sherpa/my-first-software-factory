import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runOwnedScope } from '../fixtures/containment-harness.mjs';

// Agreed seams: owner registry admission and preparation with trusted loopback acquisition and actual Bun 1.3.14.
// Authored synthetic packages only: this proves controlled Bun behavior, not real archives or the captured target lock.
async function scenario(t, name) {
  const root = await mkdtemp('/tmp/factory-dependency-compatibility-');
  t.after(async () => {
    async function writable(path) {
      await chmod(path, 0o700);
      for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await writable(`${path}/${entry.name}`);
    }
    await writable(root); await rm(root, { recursive: true, force: true });
  });
  const terminal = await runOwnedScope(t, [fileURLToPath(new URL('./dependencies-compatibility-runner.mjs', import.meta.url)), name, root]);
  assert.equal(terminal.code, 0, terminal.stderr);
  return JSON.parse(terminal.stdout);
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
    const result = await scenario(t, `profile-${configVersion}`);
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
}

test('published metadata the lock does not record refuses during acquisition before Bun installation starts', async (t) => {
  const results = await scenario(t, 'archive-metadata');
  assert.equal(Object.keys(results).length, 6);
  for (const [name, result] of Object.entries(results)) {
    assert.equal(result.code, 'DEPENDENCIES_UNSUPPORTED', name);
    assert.equal(result.installLaunched, false, name);
    assert.equal(result.inspected, 'incomplete', name);
    assert.equal(result.lockUnchanged, true, name);
    assert.deepEqual(result.requests.map(({ path }) => path), ['/left/-/left-1.2.0.tgz'], name);
  }
});

test('a saved intent with a forged host or a non-host archive is stale before any request or attempt', async (t) => {
  assert.deepEqual(await scenario(t, 'forged-plan'), {
    host: { code: 'DEPENDENCIES_STALE', attempt: false }, excludedPlanned: { code: 'DEPENDENCIES_STALE', attempt: false }, requests: 0 });
});
