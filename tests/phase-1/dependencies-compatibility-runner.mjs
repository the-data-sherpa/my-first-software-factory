// Owned-scope runner: authored packages, trusted loopback acquisition, and actual Bun 1.3.14 in the network-denied sandbox.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { lockFixture, compatibilityRepository, bunPath } from './dependencies-compatibility-fixture.mjs';
import { admitDependencies, prepareDependencies, inspectDependencies, dependencyDirectory, serializeDependencyError } from '../../src/dependencies.mjs';
import { hash } from '../../src/dependencies-files.mjs';
import { prereleasePackages } from './dependencies-prerelease-fixture.mjs';

const [scenario, root] = process.argv.slice(2);
const leaf = (key, version, metadata = {}, archive = {}, files = {}) => [key, version, metadata, archive, files];
const scripts = (kind) => Object.fromEntries(['preinstall', 'install', 'postinstall'].map((phase) => [phase,
  `bun -e 'require("fs").writeFileSync("/tmp/work/${kind}-${phase}", "executed")'`]));
const code = (promise) => promise.then(() => 'unexpected-success', (error) => serializeDependencyError(error).code);
const cleanups = [];
const t = { after: (fn) => cleanups.push(fn) };

async function repository(name, fixture, mutate) {
  const directory = `${root}/${name}`; await mkdir(directory, { mode: 0o700 });
  mutate?.(fixture);
  return compatibilityRepository(t, fixture, { serve: true, root: directory });
}
async function prepare(f) {
  const intent = await admitDependencies({ workspaceIntent: f.workspaceIntent, bunPath, registry: true });
  const lock = await readFile(`${f.repositoryPath}/bun.lock`);
  const manifest = await readFile(`${f.repositoryPath}/package.json`);
  const npmLock = await readFile(`${f.repositoryPath}/package-lock.json`);
  const result = { planned: intent.acquisition.archives.map((entry) => entry.path), excluded: intent.acquisition.excluded };
  try {
    const receipt = await prepareDependencies(intent, { authorizeRegistryFetch: true, registryTransport: f.registryTransport });
    Object.assign(result, { status: receipt.status, bunVersion: receipt.bunVersion, network: receipt.network, sentinels: receipt.sentinels,
      suppression: receipt.suppression, inventory: receipt.inventory.filter((file) => file.type !== 'file').map((file) => file.target ? `${file.path} -> ${file.target}` : file.path) });
    result.installed = await Promise.all(receipt.inventory.filter((file) => file.type === 'file' && file.path.endsWith('/package.json')).map(async (file) => {
      const pkg = JSON.parse(await readFile(`${dependencyDirectory(intent)}/bundle/${file.path}`, 'utf8'));
      return { path: file.path, name: pkg.name, version: pkg.version };
    }));
  } catch (error) {
    result.code = serializeDependencyError(error).code;
    result.installLaunched = await readFile(`${dependencyDirectory(intent)}/launch.json`).then(() => true, () => false);
  }
  result.inspected = (await inspectDependencies(intent)).status;
  result.requests = f.requests.map(({ method, path, authorization }) => ({ method, path, authorization: authorization ?? null }));
  result.lockUnchanged = lock.equals(await readFile(`${f.workspaceIntent.worktree}/bun.lock`));
  result.manifestUnchanged = manifest.equals(await readFile(`${f.workspaceIntent.worktree}/package.json`));
  result.npmLockUnchanged = npmLock.equals(await readFile(`${f.workspaceIntent.worktree}/package-lock.json`));
  return result;
}

const profile = (configVersion) => lockFixture({ configVersion,
  dependencies: { 'array.prototype.flat': '^1.3.0', '@nodelib/fs.walk': '1.2.8', '@nodelib/fs.scandir': '^3.0.0', native: '^0.34.4', cli: '^2.0.0', multi: '1.0.0' },
  placements: [
    leaf('array.prototype.flat', '1.3.3'),
    leaf('@nodelib/fs.walk', '1.2.8', { dependencies: { '@nodelib/fs.scandir': '2.1.5' } }),
    leaf('@nodelib/fs.scandir', '3.0.0'), leaf('@nodelib/fs.walk/@nodelib/fs.scandir', '2.1.5'),
    leaf('native', '0.34.5', { optionalDependencies: { 'native-linux-x64': '0.34.5', 'native-darwin-arm64': '0.34.5' } }, { scripts: scripts('dependency') }),
    leaf('native-linux-x64', '0.34.5', { os: 'linux', cpu: 'x64' }, { scripts: scripts('dependency') }),
    leaf('native-darwin-arm64', '0.34.5', { os: 'darwin', cpu: 'arm64' }),
    leaf('cli', '2.0.0', { bin: 'bin/cli.js' }, { bin: { cli: './bin/cli.js' } }, { 'bin/cli.js': 'console.log(1);' }),
    leaf('multi', '1.0.0', { bin: { alpha: './a.js', beta: 'b.js' } }, {}, { 'a.js': '1', 'b.js': '1' }),
  ] });
const withRootScripts = (fixture) => {
  fixture.manifest.scripts = scripts('root');
  fixture.manifest.trustedDependencies = fixture.lock.trustedDependencies = ['native', 'native-linux-x64'];
};
// Each variant publishes `left` with metadata its lock tuple does not record. The archive check must refuse it during
// acquisition: one request for the first planned archive, and Bun installation never starts.
const archiveVariants = {
  'undeclared peer': [{ dependencies: { right: '~2.0.0' } }, { peerDependencies: { right: '^2.0.0' } }],
  'optional-peer metadata the lock records as required': [{ peerDependencies: { right: '^2.0.0' } }, { peerDependenciesMeta: { right: { optional: true } } }],
  'dependency also published as an optional peer': [{ dependencies: { right: '~2.0.0' } },
    { peerDependencies: { right: '~2.0.0' }, peerDependenciesMeta: { right: { optional: true } } }],
  'different platform': [{ dependencies: { right: '~2.0.0' }, os: 'linux' }, { os: ['darwin'] }],
  'different bin': [{ dependencies: { right: '~2.0.0' }, bin: 'cli.js' }, { bin: { left: './other.js' } }, { 'cli.js': '1', 'other.js': '1' }],
  'libc declaration': [{ dependencies: { right: '~2.0.0' }, os: 'linux', cpu: 'x64' }, { libc: ['musl'] }],
};

try {
  if (scenario === 'profile-0' || scenario === 'profile-1') {
    console.log(JSON.stringify(await prepare(await repository('profile', profile(Number(scenario.at(-1))), withRootScripts))));
  } else if (scenario === 'prerelease') {
    console.log(JSON.stringify(await prepare(await repository('prerelease', lockFixture({
      dependencies: { gensync: '^1.0.0-beta.2' }, placements: [leaf('gensync', '1.0.0-beta.2')],
    })))));
  } else if (scenario === 'prerelease-boundaries') {
    console.log(JSON.stringify(await prepare(await repository('prerelease-boundaries', lockFixture({
      dependencies: Object.fromEntries(prereleasePackages.map(pkg => [pkg.name, pkg.spec])),
      placements: prereleasePackages.map(pkg => leaf(pkg.name, pkg.version)),
    })))));
  } else if (scenario === 'archive-metadata') {
    const results = {};
    for (const [index, [name, [metadata, archive, files]]] of Object.entries(archiveVariants).entries()) {
      const f = await repository(`variant-${index}`, lockFixture({ dependencies: { left: '^1.0.0' },
        placements: [leaf('left', '1.2.0', metadata, archive, files), leaf('right', '2.0.3')] }));
      results[name] = await prepare(f);
    }
    console.log(JSON.stringify(results));
  } else if (scenario === 'forged-plan') {
    const f = await repository('forged', profile(0));
    const intent = await admitDependencies({ workspaceIntent: f.workspaceIntent, bunPath, registry: true });
    await writeFile(`${root}/saved-intent.json`, JSON.stringify(intent), { mode: 0o600 });
    const forge = {
      host: (body) => { body.acquisition.host = { os: 'darwin', cpu: 'arm64' }; },
      cacheImplementation: (body) => { body.toolchain.files.find(file => file.path.endsWith('/dependencies-cache.mjs')).sha256 = '0'.repeat(64); },
      excludedPlanned: (body) => {
        const entry = body.acquisition.archives.find((archive) => archive.name === 'native-linux-x64');
        body.acquisition.archives.push({ ...entry, name: 'native-darwin-arm64', path: '/native-darwin-arm64/-/native-darwin-arm64-0.34.5.tgz',
          cachePath: 'native-darwin-arm64@0.34.5@@@1' });
        body.acquisition.excluded = [];
      },
    };
    const results = {};
    for (const [name, change] of Object.entries(forge)) {
      // A writer of saved state can recompute the content identity; preparation must rederive the plan instead.
      const { id, ...body } = structuredClone(intent); change(body);
      const forged = { ...body, id: hash(JSON.stringify(body)) };
      results[name] = { code: await code(prepareDependencies(forged, { authorizeRegistryFetch: true, registryTransport: f.registryTransport })),
        attempt: await readFile(`${dependencyDirectory(forged)}/intent.json`).then(() => true, () => false) };
    }
    console.log(JSON.stringify({ ...results, requests: f.requests.length }));
  } else throw new Error('Unknown compatibility scenario');
} finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
