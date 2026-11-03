import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { registryFixture, bunPath, tarball } from './dependencies-registry-fixture.mjs';
import { admitDependencies, prepareDependencies, prepareOwnerDependencies, dependencyDirectory, inspectDependencies, serializeDependencyError } from '../../src/dependencies.mjs';
import { acquireOwner } from '../../src/storage.mjs';
import { verifyContainmentEnvelope } from '../../src/containment.mjs';
import { scopeProcesses, waitForCleanup } from '../../src/containment-process-fixtures.mjs';

const code = async (operation) => { try { await operation(); return 'unexpected-success'; } catch (error) { return serializeDependencyError(error).code; } };
export async function failureScenario(scenario, root) {
  if (scenario === 'reject-locks') {
    const results = {};
    const cases = {
      arbitraryURL: (lock) => { lock.packages.vitest[1] = 'https://example.invalid/evil.tgz'; },
      credentials: (lock) => { lock.packages.vitest[1] = 'https://user:secret@registry.npmjs.org/vitest/-/vitest-1.0.0.tgz'; },
      git: (lock) => { lock.packages.vitest[0] = 'vitest@git+https://example.invalid/evil.git'; },
      transitiveURL: (lock) => { lock.packages.vitest[2].dependencies['fixture-leaf'] = 'https://example.invalid/leaf.tgz'; },
      transitiveFile: (lock) => { lock.packages.vitest[2].dependencies['fixture-leaf'] = 'file:../../escape'; },
      unknownTop: (lock) => { lock.futureNetworkFeature = true; },
      unknownTuple: (lock) => { lock.packages.vitest[2].future = true; },
      unknownTupleTail: (lock) => { lock.packages.vitest.push('future'); },
      missingIntegrity: (lock) => { lock.packages.vitest[3] = ''; },
      unsafeVersion: (lock) => { lock.packages.vitest[0] = 'vitest@9007199254740993.0.0'; lock.workspaces[''].dependencies.vitest = '9007199254740993.0.0'; },
      wrongRoot: (lock) => { lock.workspaces[''].dependencies = { vitest: '2.0.0' }; },
      missingTransitive: (lock) => { delete lock.packages['fixture-leaf']; },
      orphan: (lock) => { lock.packages.orphan = ['orphan@1.0.0', '', {}, lock.packages.vitest[3]]; },
      peer: (lock) => { lock.packages.vitest[2].peerDependencies = { other: '*' }; },
      platform: (lock) => { lock.packages.vitest[2].os = ['linux']; },
      duplicateKeys: () => {},
    };
    for (const [name, mutateLock] of Object.entries(cases)) {
      const path = `${root}/${name}`; await mkdir(path, { mode: 0o700 });
      const f = await registryFixture(path, { mutateLock });
      try {
        if (name === 'duplicateKeys') {
          // Commit an ambiguous lock rather than mutating an admitted source.
          const lockPath = `${f.repositoryPath}/bun.lock`; const bytes = await readFile(lockPath, 'utf8');
          await writeFile(lockPath, bytes.replace('"lockfileVersion":1', '"lockfileVersion":0,"lockfileVersion":1'));
          f.git('add', '.'); f.git('commit', '-m', 'ambiguous lock fixture');
          const { admitWorkspace, prepareWorkspace } = await import('../../src/workspace.mjs');
          f.workspaceIntent = await admitWorkspace({ stateDir: f.stateDir, project: { id: 'fixture', repositoryPath: f.repositoryPath }, runId: 'run_duplicate' });
          await prepareWorkspace(f.workspaceIntent);
        }
        results[name] = await code(() => admitDependencies({ workspaceIntent: f.workspaceIntent, bunPath, registry: true }));
        assert.match(results[name], /^DEPENDENCIES_(UNSAFE|UNSUPPORTED)$/);
        assert.equal(f.requests.length, 0);
      } finally { await f.close(); }
    }
    return results;
  }
  if (scenario === 'fetch-failures') {
    const results = {};
    for (const name of ['redirect', 'timeout', 'oversized', 'chunkedLimit', 'integrity', 'archiveTraversal', 'archiveConfig', 'hiddenDependency']) {
      const path = `${root}/${name}`; await mkdir(path, { mode: 0o700 });
      let archive;
      if (name.startsWith('archive') || name === 'hiddenDependency') archive = tarball({
        'package.json': JSON.stringify({ name: 'fixture-leaf', version: '2.0.0', ...(name === 'hiddenDependency' ? { dependencies: { hidden: '1.0.0' } } : {}) }),
        [name === 'archiveTraversal' ? '../../escape' : name === 'archiveConfig' ? '.npmrc' : 'index.js']: 'synthetic',
      });
      const f = await registryFixture(path, {
        mutateLock: archive ? (lock) => { lock.packages['fixture-leaf'][3] = `sha512-${createHash('sha512').update(archive).digest('base64')}`; } : undefined,
        response(req, res, archives) {
          if (name === 'redirect') { res.writeHead(302, { Location: '/unrequested-endpoint' }); res.end('synthetic secret'); }
          else if (name === 'timeout') { res.writeHead(200); res.flushHeaders(); }
          else if (name === 'oversized') { res.writeHead(200, { 'Content-Length': 17 * 1024 ** 2 }); res.end(); }
          else if (name === 'chunkedLimit') { res.writeHead(200); res.write(Buffer.alloc(17 * 1024 ** 2)); res.end(); }
          else { res.writeHead(200); res.end(archive ?? Buffer.from('synthetic secret wrong integrity')); }
        },
      });
      try {
        const intent = await admitDependencies({ workspaceIntent: f.workspaceIntent, bunPath, registry: true });
        await writeFile(`${path}/saved-intent.json`, JSON.stringify(intent), { mode: 0o600 });
        results[name] = await code(() => prepareDependencies(intent, { authorizeRegistryFetch: true, registryTransport: f.registryTransport }));
        assert.notEqual(results[name], 'unexpected-success');
        assert.equal(f.requests.length, 1);
        assert.equal(f.requests[0].path, '/fixture-leaf/-/fixture-leaf-2.0.0.tgz');
        const failure = await readFile(`${dependencyDirectory(intent)}/failure.json`, 'utf8');
        assert.doesNotMatch(failure, /synthetic secret|127\.0\.0\.1|unrequested|stack|\/tmp\//);
        assert.equal((await inspectDependencies(intent)).status, 'incomplete');
      } finally { await f.close(); }
    }
    return results;
  }
  if (scenario === 'authority') {
    let intent; let saved = false; let reservations = false;
    const f = await registryFixture(root, { async response(req, res, archives) {
      try {
        assert.deepEqual(JSON.parse(await readFile(`${root}/saved-intent.json`, 'utf8')), intent); saved = true;
        const reservation = JSON.parse(await readFile(`${dependencyDirectory(intent)}/acquisition.json`, 'utf8'));
        assert.equal(reservation.intentId, intent.id); assert.equal(reservation.archives.length, 2);
        assert.ok(reservation.deadlineAt > Date.now()); assert.ok(reservation.limits.totalBytes > 0); reservations = true;
        res.end(archives.get(req.url));
      } catch { res.writeHead(500); res.end(); }
    } });
    try {
      assert.equal(await code(() => admitDependencies({ workspaceIntent: f.workspaceIntent, bunPath })), 'DEPENDENCIES_UNSUPPORTED');
      intent = await admitDependencies({ workspaceIntent: f.workspaceIntent, bunPath, registry: true });
      await writeFile(`${root}/saved-intent.json`, JSON.stringify(intent), { mode: 0o600 });
      assert.equal(await code(() => prepareDependencies(intent, { registryTransport: f.registryTransport })), 'DEPENDENCIES_FETCH_AUTHORIZATION');
      assert.equal((await inspectDependencies(intent)).status, 'not-prepared');
      const manifest = `${f.workspaceIntent.worktree}/package.json`; const original = await readFile(manifest);
      await writeFile(manifest, '{}');
      assert.equal(await code(() => prepareDependencies(intent, { authorizeRegistryFetch: true, registryTransport: f.registryTransport })), 'DEPENDENCIES_STALE');
      assert.equal(f.requests.length, 0);
      await writeFile(manifest, original);
      await prepareDependencies(intent, { authorizeRegistryFetch: true, registryTransport: f.registryTransport });
      return { saved, reservations, requests: f.requests.length };
    } finally { await f.close(); }
  }
  if (scenario === 'cancel-install') {
    const f = await registryFixture(root, { extraFiles: 3000 });
    try {
      const intent = await admitDependencies({ workspaceIntent: f.workspaceIntent, bunPath, registry: true });
      await writeFile(`${root}/saved-intent.json`, JSON.stringify(intent), { mode: 0o600 });
      const controller = new AbortController(); const envelope = await verifyContainmentEnvelope();
      const operation = code(() => prepareOwnerDependencies(intent, { authorizeRegistryFetch: true, registryTransport: f.registryTransport, signal: controller.signal }));
      let observed = []; let bunObserved = false;
      try {
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          const launched = await lstat(`${dependencyDirectory(intent)}/launch.json`).catch(() => undefined);
          if (launched) {
            observed = await scopeProcesses(envelope);
            const commands = await Promise.all(observed.map(({ pid }) => readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')));
            if (commands.some((command) => command.startsWith('/runtime/bun\0install\0'))) { bunObserved = true; break; }
          }
          await delay(1);
        }
      } finally { controller.abort(); }
      const cancelled = await operation;
      assert.equal(bunObserved, true);
      const survivors = await waitForCleanup(observed); assert.deepEqual(survivors, []);
      const release = await acquireOwner(f.stateDir); release();
      return { cancelled, bunObserved, survivors, requests: f.requests.length, status: (await inspectDependencies(intent)).status };
    } finally { await f.close(); }
  }
  if (scenario === 'cancel-fetch') {
    let started; const observed = new Promise((resolve) => { started = resolve; });
    const f = await registryFixture(root, { response(req, res) { res.writeHead(200); res.write('partial'); started(); } });
    try {
      const intent = await admitDependencies({ workspaceIntent: f.workspaceIntent, bunPath, registry: true });
      await writeFile(`${root}/saved-intent.json`, JSON.stringify(intent), { mode: 0o600 });
      const controller = new AbortController();
      const operation = code(() => prepareOwnerDependencies(intent, { authorizeRegistryFetch: true, registryTransport: f.registryTransport, signal: controller.signal }));
      await observed;
      await assert.rejects(acquireOwner(f.stateDir), { code: 'BACKEND_OWNED' });
      controller.abort(); const cancelled = await operation;
      // Let the server observe FIN after the client has synchronously drained its request/socket.
      for (let i = 0; i < 100 && f.sockets.size; i++) await delay(2);
      assert.equal(f.sockets.size, 0);
      const release = await acquireOwner(f.stateDir); release();
      assert.equal((await inspectDependencies(intent)).status, 'incomplete');
      await assert.rejects(lstat(`${dependencyDirectory(intent)}/launch.json`), { code: 'ENOENT' });
      return { cancelled, sockets: f.sockets.size, ownerReleased: true, requests: f.requests.length };
    } finally { await f.close(); }
  }
  throw new Error('Unknown failure scenario');
}
