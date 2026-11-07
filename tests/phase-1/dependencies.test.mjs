import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm, chmod, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runForeground } from '../fixtures/containment-harness.mjs';
import { fixture, git } from './workspace-fixture.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { admitDependencies, prepareDependencies, serializeDependencyError } from '../../src/dependencies.mjs';

// Agreed seams: owner preparation and factory-owned contained execution; no private SQL or CLI-string assertions.
test('owner dependency admission rejects escaping local packages with an explicit preparation instruction', async (t) => {
  const f = await fixture(t);
  await writeFile(`${f.repositoryPath}/package.json`, JSON.stringify({ dependencies: { escape: 'file:../../private' } }));
  git(f.repositoryPath, 'add', '.'); git(f.repositoryPath, 'commit', '-m', 'unsafe package fixture');
  const workspaceIntent = await admitWorkspace(f); await prepareWorkspace(workspaceIntent);
  await assert.rejects(admitDependencies({ workspaceIntent, bunPath: '/home/cowen/.bun/bin/bun' }), (error) => {
    const failure = serializeDependencyError(error);
    assert.equal(failure.code, 'DEPENDENCIES_UNSUPPORTED');
    assert.match(failure.message, /owner.*prepar/i);
    assert.doesNotMatch(JSON.stringify(failure), /private\/|token|stack/);
    return true;
  });
});

async function diagnose(t, scenario) {
  const root = await mkdtemp(join(tmpdir(), 'factory-dependencies-'));
  t.after(async () => {
    async function writable(path) {
      await chmod(path, 0o700);
      for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await writable(`${path}/${entry.name}`);
    }
    await writable(root); await rm(root, { recursive: true, force: true });
  });
  const { stdout } = await runForeground(t, ['dependencies-diagnose', scenario, root]);
  return JSON.parse(stdout);
}

test('owner preparation uses real frozen Bun with root and trusted dependency scripts suppressed', async (t) => {
  const result = await diagnose(t, 'prepare');
  assert.equal(result.bunVersion, '1.3.14');
  assert.deepEqual(result.positiveSentinels, ['dependency-install', 'dependency-postinstall', 'dependency-preinstall', 'root-install', 'root-postinstall', 'root-preinstall']);
  assert.deepEqual(result.preparation.sentinels, []);
  assert.deepEqual(result.preparation.suppression.positive, result.positiveSentinels);
  assert.deepEqual(result.preparation.suppression.suppressed, []);
  assert.equal(result.preparation.suppression.toolchainSha256, result.preparation.toolchain.files[0].sha256);
  assert.equal(result.preparation.status, 'prepared');
  assert.equal(result.lockfilesUnchanged, true);
  assert.equal(result.preparation.network, 'kernel-denied');
  assert.deepEqual(result.preparation.boundary, { tcp: 'EPERM', udp: 'EPERM', inputReadOnly: true, privatePathsHidden: true, environmentScrubbed: true,
    scratchBytes: 268435456, noNewPrivileges: true, seccomp: true });
  assert.equal(result.preparation.launch.parentPid, result.backendPid);
  assert.equal(result.preparation.launch.sandbox.parentPid, result.preparation.launch.pid);
  assert.equal(result.preparation.suppression.launch.sandbox.parentPid, result.preparation.suppression.launch.pid);
  assert.equal(result.preparation.envelope.memoryBytes, 4294967296);
  assert.equal(result.preparation.envelope.tasks, 256);
});

test('fixed execution reuses installed packages on kernel read-only mounts with no network or preparation authority', async (t) => {
  const result = await diagnose(t, 'reuse');
  assert.equal(result.check.passed, true);
  assert.equal(result.check.kind, 'repository');
  assert.equal(result.check.reviewReady, false);
  assert.equal(result.boundary.probe.readOnlyBundle, true);
  const output = JSON.parse(result.check.output);
  assert.equal(output.installed, '1.0.0');
  assert.deepEqual(output.argv, ['run', '--maxWorkers=2', '--no-file-parallelism']);
  assert.deepEqual(Object.values(output.writes), ['EROFS', 'EROFS', 'EROFS']);
  assert.equal(output.network, 'EPERM');
  assert.equal(result.forged, 'DEPENDENCIES_UNSAFE');
  assert.equal(result.extraArgs, 'CHECK_NOT_ALLOWED');
  assert.equal(result.noInstall, 'CHECK_NOT_ALLOWED');
  assert.equal(result.lint.passed, true);
  assert.deepEqual(JSON.parse(result.lint.output).argv, ['.', '--no-cache']);
});

test('missing, stale, redirected, changed, extra, and unsafe bundle contents cannot grant reuse', async (t) => {
  const result = await diagnose(t, 'integrity');
  for (const name of ['missing', 'manifest', 'bunLock', 'npmLock', 'archive', 'toolchain', 'fileBytes', 'fileMode', 'extra', 'hardlink', 'symlink', 'directoryLink', 'binLink', 'receipt', 'suppressionProof']) {
    assert.match(result[name].code, /^DEPENDENCIES_(?:MISSING|UNSAFE|STALE)$/i, name);
    assert.match(result[name].message, /owner.*prepar/i, name);
  }
  assert.equal(result.draftAllowed, true);
  assert.equal(result.recheckAfterTamper, 'DEPENDENCIES_UNSAFE');
});

test('frozen-lock failure is retained sanitized and passive inspection never installs or retries', async (t) => {
  const result = await diagnose(t, 'frozen');
  assert.equal(result.code, 'DEPENDENCIES_INSTALL_FAILED');
  assert.equal(result.inspection.status, 'incomplete');
  assert.equal(result.failureRetained, true);
  assert.equal(result.repeated, 'DEPENDENCIES_EXISTS');
  assert.equal(result.noRawDiagnostic, true);
});

test('unsupported dependency sources, config credentials and unsafe archives fail closed before installation', async (t) => {
  const result = await diagnose(t, 'unsupported');
  for (const name of ['registry', 'registryCredentials', 'git', 'directory', 'link', 'workspaces', 'patches', 'publishConfig', 'archiveTraversal', 'archiveCredentials', 'archiveLink']) {
    assert.match(result[name], /^DEPENDENCIES_(?:UNSUPPORTED|UNSAFE)$/, name);
  }
});

test('owner preparation refuses another owner and drains cancelled sandbox descendants before returning', async (t) => {
  const result = await diagnose(t, 'cancel');
  assert.equal(result.otherOwner, 'BACKEND_OWNED');
  assert.equal(result.cancelled, 'DEPENDENCIES_ABORTED');
  assert.ok(result.observedChildren >= 2);
  assert.deepEqual(result.survivors, []);
  assert.equal(result.inspection.status, 'incomplete');
  assert.equal(result.failure.code, 'DEPENDENCIES_ABORTED');
  assert.equal(result.ownerReleased, true);
});

test('only the explicit foreground owner command turns a saved admission into a prepared bundle', async (t) => {
  const admitted = await diagnose(t, 'admit');
  assert.equal(admitted.before.status, 'not-prepared');
  const { stdout } = await runForeground(t, ['prepare-dependencies', admitted.intentPath], 30000);
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.status, 'prepared');
  assert.equal(receipt.intentId, admitted.before.intentId);
  assert.equal(receipt.network, 'kernel-denied');
  assert.equal(receipt.suppression.positive.length, 6);
});

test('preparation cannot execute outside the verified foreground owner envelope', async () => {
  await assert.rejects(prepareDependencies({ prepared: true }), { code: 'CONTAINMENT_REQUIRED' });
});
