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

async function scenario(t, name, verify) {
  const root = await mkdtemp('/tmp/factory-dependency-libc-');
  let drained = false; let passed = false;
  try {
    const terminal = await runOwnedScope(t, [fileURLToPath(new URL('./dependencies-libc-runner.mjs', import.meta.url)), root, name]);
    drained = true;
    if (process.env.FACTORY_LIBC_EVIDENCE) await writeFile(join(process.env.FACTORY_LIBC_EVIDENCE, `${name}.json`),
      JSON.stringify({ root, ...terminal }), { mode: 0o600, flag: 'wx' });
    assert.equal(terminal.code, 0, `${terminal.stderr}\nRetained fixture: ${root}`);
    await verify(JSON.parse(terminal.stdout));
    passed = true;
  } finally {
    if (drained && passed) await cleanup(root);
    else t.diagnostic(`Retained fixture: ${root}`);
  }
}

function prepared(result, expected) {
  assert.equal(result.status, 'prepared', JSON.stringify(result));
  assert.equal(result.inspected, 'prepared');
  assert.equal(result.inspectedAgain, 'prepared');
  assert.equal(result.verifiedReuse, true);
  assert.equal(result.reuseMadeRequests, false);
  assert.equal(result.bunVersion, '1.3.14');
  assert.equal(result.network, 'kernel-denied');
  assert.equal(result.frozenLockfile, true);
  assert.equal(result.reviewReady, false);
  assert.deepEqual(result.host, { os: 'linux', cpu: 'x64' });
  assert.equal(result.boundary.tcp, 'EPERM');
  assert.equal(result.boundary.udp, 'EPERM');
  assert.equal(result.boundary.scratchBytes, 268_435_456);
  assert.equal(result.boundary.inputReadOnly, true);
  assert.equal(result.boundary.privatePathsHidden, true);
  assert.equal(result.boundary.environmentScrubbed, true);
  assert.equal(result.boundary.noNewPrivileges, true);
  assert.equal(result.boundary.seccomp, true);
  assert.deepEqual(result.sentinels, []);
  assert.equal(result.scripts, 'disabled');
  assert.equal(result.suppression.positive.length, 6);
  assert.deepEqual(result.suppression.suppressed, []);
  assert.deepEqual(result.unchanged, { manifest: true, lock: true, npmLock: true });
  assert.deepEqual(result.planned, expected.planned);
  assert.deepEqual(result.requests, expected.planned.map(path => ({ method: 'GET', path, authorization: null })));
  assert.deepEqual(result.excluded, []);
  assert.deepEqual(result.installed, expected.installed);
}

function refused(result, label) {
  assert.equal(result.failure, 'DEPENDENCIES_UNSUPPORTED', label);
  assert.equal(result.status, undefined, label);
  assert.equal(result.installLaunched, false, label);
  assert.equal(result.inspected, 'incomplete', label);
  assert.deepEqual(result.host, { os: 'linux', cpu: 'x64' }, label);
  assert.deepEqual(result.excluded, [], label);
  assert.deepEqual(result.unchanged, { manifest: true, lock: true, npmLock: true }, label);
  assert.deepEqual(result.planned, ['/libc-leaf/-/libc-leaf-1.0.0.tgz'], label);
  assert.deepEqual(result.requests, [{ method: 'GET', path: '/libc-leaf/-/libc-leaf-1.0.0.tgz', authorization: null }], label);
}

// Authored package metadata only: successful preparation does not establish native-code compatibility.
test('frozen Bun retains declared glibc and musl packages under the same Linux/x64 selection', async t => {
  await scenario(t, 'declared', result => prepared(result, {
    planned: [
      '/native-glibc-x64/-/native-glibc-x64-1.0.0.tgz',
      '/native-musl-x64/-/native-musl-x64-1.0.0.tgz',
    ],
    installed: [
      { path: 'node_modules/native-glibc-x64/package.json', name: 'native-glibc-x64', version: '1.0.0', os: ['linux'], cpu: ['x64'], libc: ['glibc'] },
      { path: 'node_modules/native-musl-x64/package.json', name: 'native-musl-x64', version: '1.0.0', os: ['linux'], cpu: ['x64'], libc: ['musl'] },
    ],
  }));
});

test('published null libc metadata refuses before package installation', async t => {
  await scenario(t, 'null', result => refused(result, 'null'));
});

test('bounded libc scalar and multi-value declarations retain metadata without filtering', async t => {
  await scenario(t, 'shapes', result => prepared(result, {
    planned: [
      '/libc-absent/-/libc-absent-1.0.0.tgz',
      '/libc-array-both/-/libc-array-both-1.0.0.tgz',
      '/libc-string-glibc/-/libc-string-glibc-1.0.0.tgz',
      '/libc-string-musl/-/libc-string-musl-1.0.0.tgz',
    ],
    installed: [
      { path: 'node_modules/libc-absent/package.json', name: 'libc-absent', version: '1.0.0', os: ['linux'], cpu: ['x64'] },
      { path: 'node_modules/libc-array-both/package.json', name: 'libc-array-both', version: '1.0.0', os: ['linux'], cpu: ['x64'], libc: ['musl', 'glibc'] },
      { path: 'node_modules/libc-string-glibc/package.json', name: 'libc-string-glibc', version: '1.0.0', os: ['linux'], cpu: ['x64'], libc: 'glibc' },
      { path: 'node_modules/libc-string-musl/package.json', name: 'libc-string-musl', version: '1.0.0', os: ['linux'], cpu: ['x64'], libc: 'musl' },
    ],
  }));
});

test('invalid libc declarations refuse during acquisition without changing inputs', async t => {
  await scenario(t, 'invalid', results => {
    assert.deepEqual(Object.keys(results), ['empty-string', 'empty-array', 'empty-object', 'numeric', 'boolean',
      'unknown', 'negated', 'duplicate', 'mixed', 'unknown-array']);
    for (const [name, result] of Object.entries(results)) refused(result, name);
  });
});

test('libc recognition preserves OS CPU and relationship metadata refusals', async t => {
  await scenario(t, 'contradictions', results => {
    assert.deepEqual(Object.keys(results), ['os', 'cpu', 'relationships']);
    for (const [name, result] of Object.entries(results)) refused(result, name);
  });
});

test('altered retained libc declarations invalidate passive inspection and verified reuse', async t => {
  await scenario(t, 'altered', result => {
    prepared(result.before, {
      planned: ['/libc-leaf/-/libc-leaf-1.0.0.tgz'],
      installed: [{ path: 'node_modules/libc-leaf/package.json', name: 'libc-leaf', version: '1.0.0', os: ['linux'], cpu: ['x64'], libc: ['glibc'] }],
    });
    assert.deepEqual(result.after.declarationBefore, ['glibc']);
    assert.deepEqual(result.after.declarationAfter, ['musl']);
    assert.equal(result.after.modeRestored, true);
    assert.equal(result.after.inspectionFailure, 'DEPENDENCIES_UNSAFE');
    assert.equal(result.after.reuseFailure, 'DEPENDENCIES_UNSAFE');
    assert.equal(result.after.requestsUnchanged, true);
  });
});
