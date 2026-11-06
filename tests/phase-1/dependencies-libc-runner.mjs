// One fixed authored-package preparation through public dependency interfaces; no package code is imported.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, chmod, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { lockFixture, compatibilityRepository, bunPath } from './dependencies-compatibility-fixture.mjs';
import { admitDependencies, prepareDependencies, inspectDependencies, verifyDependencyBundle,
  dependencyDirectory, serializeDependencyError } from '../../src/dependencies.mjs';

const [root, scenario = 'declared', ...extra] = process.argv.slice(2);
assert.match(root, /^\/tmp\/factory-dependency-libc-[A-Za-z0-9]+$/);
assert.ok(['declared', 'null', 'shapes', 'invalid', 'contradictions', 'altered'].includes(scenario));
assert.deepEqual(extra, []);
const save = (name, value) => writeFile(`${root}/${name}.json`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
const sourceFiles = ['dependencies.mjs', 'dependencies-lock.mjs', 'dependencies-cache.mjs', 'dependencies-self-test.mjs',
  'dependencies-files.mjs', 'dependencies-registry.mjs', 'dependencies-process.mjs', 'dependencies-worker.mjs'];
async function sourceHashes() {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async name => {
    const bytes = await readFile(new URL(`../../src/${name}`, import.meta.url));
    return [name, createHash('sha256').update(bytes).digest('hex')];
  })));
}
const before = await sourceHashes(); await save('source-before', before);
const scriptNames = ['preinstall', 'install', 'postinstall'];
const scripts = kind => Object.fromEntries(scriptNames.map(phase => [phase,
  `bun -e 'require("fs").writeFileSync("/tmp/work/${kind}-${phase}", "executed")'`]));
function declaredFixture() {
  const fixture = lockFixture({
    dependencies: { 'native-glibc-x64': '1.0.0', 'native-musl-x64': '1.0.0' },
    placements: [
      ['native-glibc-x64', '1.0.0', { os: 'linux', cpu: 'x64' }, { libc: ['glibc'], scripts: scripts('dependency') }],
      ['native-musl-x64', '1.0.0', { os: 'linux', cpu: 'x64' }, { libc: ['musl'], scripts: scripts('dependency') }],
    ],
  });
  fixture.manifest.scripts = scripts('root');
  fixture.manifest.trustedDependencies = fixture.lock.trustedDependencies = ['native-glibc-x64', 'native-musl-x64'];
  return fixture;
}
function shapesFixture() {
  const packages = [
    ['libc-absent', {}], ['libc-array-both', { libc: ['musl', 'glibc'] }],
    ['libc-string-glibc', { libc: 'glibc' }], ['libc-string-musl', { libc: 'musl' }],
  ];
  const fixture = lockFixture({
    dependencies: Object.fromEntries(packages.map(([name]) => [name, '1.0.0'])),
    placements: packages.map(([name, archive]) => [name, '1.0.0', { os: 'linux', cpu: 'x64' }, { ...archive, scripts: scripts('dependency') }]),
  });
  fixture.manifest.scripts = scripts('root');
  fixture.manifest.trustedDependencies = fixture.lock.trustedDependencies = packages.map(([name]) => name);
  return fixture;
}
const leafFixture = (libc, extra = {}) => lockFixture({
  dependencies: { 'libc-leaf': '1.0.0' },
  placements: [['libc-leaf', '1.0.0', { os: 'linux', cpu: 'x64' }, { libc, ...extra }]],
});
async function prepare(name, fixture, { alterDeclaration = false } = {}) {
  const inner = `${root}/${name}`; await mkdir(inner, { mode: 0o700 });
  const cleanups = []; const t = { after: fn => cleanups.push(fn) };
  let result; let after;
  try {
    const f = await compatibilityRepository(t, fixture, { root: inner, serve: true });
    const original = Object.fromEntries(await Promise.all([
      ['manifest', 'package.json'], ['lock', 'bun.lock'], ['npmLock', 'package-lock.json'],
    ].map(async ([key, path]) => [key, await readFile(`${f.repositoryPath}/${path}`)])));
    const intent = await admitDependencies({ workspaceIntent: f.workspaceIntent, bunPath, registry: true });
    await writeFile(`${inner}/saved-intent.json`, `${JSON.stringify(intent)}\n`, { mode: 0o600, flag: 'wx' });
    result = { host: intent.acquisition.host, planned: intent.acquisition.archives.map(entry => entry.path), excluded: intent.acquisition.excluded };
    try {
      const receipt = await prepareDependencies(intent, { authorizeRegistryFetch: true, registryTransport: f.registryTransport });
      Object.assign(result, { status: receipt.status, bunVersion: receipt.bunVersion, network: receipt.network, boundary: receipt.boundary,
        scripts: receipt.scripts, sentinels: receipt.sentinels, suppression: receipt.suppression,
        frozenLockfile: receipt.frozenLockfile, reviewReady: receipt.reviewReady });
      result.installed = await Promise.all(receipt.inventory.filter(file => file.type === 'file' && file.path.endsWith('/package.json')).map(async file => {
        const manifest = JSON.parse(await readFile(`${dependencyDirectory(intent)}/bundle/${file.path}`, 'utf8'));
        return { path: file.path, name: manifest.name, version: manifest.version, os: manifest.os, cpu: manifest.cpu, libc: manifest.libc };
      }));
      result.installed.sort((a, b) => a.path.localeCompare(b.path, 'en'));
      const requestsBeforeReuse = f.requests.length;
      result.inspected = (await inspectDependencies(intent)).status;
      result.verifiedReuse = (await verifyDependencyBundle(intent)).intentId === intent.id;
      result.inspectedAgain = (await inspectDependencies(intent)).status;
      result.reuseMadeRequests = f.requests.length !== requestsBeforeReuse;
      if (alterDeclaration) {
        const path = `${dependencyDirectory(intent)}/bundle/node_modules/libc-leaf/package.json`;
        const metadata = JSON.parse(await readFile(path, 'utf8'));
        const mode = (await stat(path)).mode & 0o777;
        after = { declarationBefore: metadata.libc };
        metadata.libc = ['musl'];
        await chmod(path, mode | 0o200);
        try { await writeFile(path, JSON.stringify(metadata)); } finally { await chmod(path, mode); }
        after.declarationAfter = JSON.parse(await readFile(path, 'utf8')).libc;
        after.modeRestored = ((await stat(path)).mode & 0o777) === mode;
        const requestsBefore = f.requests.length;
        const failure = promise => promise.then(() => 'unexpected-success', error => serializeDependencyError(error).code);
        after.inspectionFailure = await failure(inspectDependencies(intent));
        after.reuseFailure = await failure(verifyDependencyBundle(intent));
        after.requestsUnchanged = f.requests.length === requestsBefore;
      }
    } catch (error) {
      result.failure = serializeDependencyError(error).code;
      result.installLaunched = await readFile(`${dependencyDirectory(intent)}/launch.json`).then(() => true, () => false);
      result.inspected = (await inspectDependencies(intent)).status;
    }
    result.unchanged = Object.fromEntries(await Promise.all([
      ['manifest', 'package.json'], ['lock', 'bun.lock'], ['npmLock', 'package-lock.json'],
    ].map(async ([key, path]) => [key, original[key].equals(await readFile(`${f.repositoryPath}/${path}`))
      && original[key].equals(await readFile(`${f.workspaceIntent.worktree}/${path}`))])));
    result.requests = f.requests.map(({ method, path, authorization }) => ({ method, path, authorization: authorization ?? null }));
    if (after) result = { before: result, after };
    await writeFile(`${inner}/public-result.json`, `${JSON.stringify(result)}\n`, { mode: 0o600, flag: 'wx' });
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
  }
  return result;
}
let result;
if (scenario === 'declared') result = await prepare('fixture', declaredFixture());
else if (scenario === 'shapes') result = await prepare('shapes', shapesFixture());
else if (scenario === 'null') result = await prepare('null', leafFixture(null));
else if (scenario === 'altered') result = await prepare('altered', leafFixture(['glibc']), { alterDeclaration: true });
else if (scenario === 'invalid') {
  const values = { 'empty-string': '', 'empty-array': [], 'empty-object': {}, numeric: 0, boolean: false,
    unknown: 'uclibc', negated: '!glibc', duplicate: ['glibc', 'glibc'], mixed: ['glibc', null], 'unknown-array': ['glibc', 'uclibc'] };
  result = {};
  for (const [name, value] of Object.entries(values)) result[name] = await prepare(`invalid-${name}`, leafFixture(value));
} else if (scenario === 'contradictions') {
  const values = { os: { os: ['darwin'] }, cpu: { cpu: ['arm64'] }, relationships: { dependencies: { unplanned: '1.0.0' } } };
  result = {};
  for (const [name, extra] of Object.entries(values)) result[name] = await prepare(`contradiction-${name}`, leafFixture(['glibc'], extra));
}
const after = await sourceHashes(); await save('source-after', after);
assert.deepEqual(after, before, 'Factory source must remain frozen throughout the preparation check.');
await save('public-result', result);
console.log(JSON.stringify(result));
