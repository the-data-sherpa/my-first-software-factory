import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import { lockFixture, admit } from './dependencies-compatibility-fixture.mjs';

// Agreed seam: owner registry admission (admitDependencies) over a disposable committed repository.
// Admission performs no Bun execution or network; these tests prove the admitted plan, not installation.
// Expected paths and exclusions are independent literals. Every lock uses configuration version 1.
const leaf = (key, version = '1.0.0', metadata = {}) => [key, version, metadata];
const sorted = (list) => [...list].sort();
const lockText = (lock) => `${JSON.stringify(lock, null, 2)}\n`;
const UNSUPPORTED = 'DEPENDENCIES_UNSUPPORTED';
const UNSAFE = 'DEPENDENCIES_UNSAFE';

// The shared fixture removes each repository in an unconditional t.after hook. Collect that removal instead and run
// it only after the checks pass, so a failing fixture's owner repository and private state stay inspectable.
async function admitted(t, fixture, check, options = {}) {
  const removals = [];
  const f = await admit({ after: (remove) => removals.push(remove) }, fixture, options);
  try {
    assert.equal(await readFile(`${f.repositoryPath}/bun.lock`, 'utf8'), options.lockText ?? lockText(fixture.lock), 'admission must not rewrite bun.lock');
    assert.equal(await lstat(`${f.stateDir}/runs/run_compatibility/dependencies`).then(() => true, () => false), false,
      'admission must not create a dependency attempt directory');
    check(f);
  } catch (error) { t.diagnostic(`retained failing fixture root: ${f.root}`); throw error; }
  for (const remove of removals) await remove();
}
function assertPlan(f, { paths, excluded }) {
  assert.equal(f.failure, undefined);
  assert.deepEqual(sorted(f.intent.acquisition.archives.map((entry) => entry.path)), sorted(paths));
  assert.deepEqual(sorted(f.intent.acquisition.excluded), sorted(excluded));
  assert.deepEqual(f.intent.acquisition.unmetPeers, []);
  assert.deepEqual(f.intent.acquisition.host, { os: 'linux', cpu: 'x64' });
}
function assertRefused(f, code) {
  assert.equal(f.failure, code);
  assert.equal(f.intent, undefined);
}
// Inserts raw text after the first `needle` that follows `anchor`; the result is never round-tripped through JSON.
function insertAfter(text, anchor, needle, insert) {
  const from = text.indexOf(anchor); assert.ok(from >= 0, `anchor ${anchor}`);
  const at = text.indexOf(needle, from); assert.ok(at >= 0, `needle ${needle}`);
  return text.slice(0, at + needle.length) + insert + text.slice(at + needle.length);
}

const nestedOptionalGraph = () => ({ configVersion: 1, dependencies: { esb: '0.27.0', vt: '7.0.0', '@s/p.q': '^1.0.0', 'r.s': '^3.0.0' }, placements: [
  leaf('esb', '0.27.0', { optionalDependencies: { '@esb/linux-x64': '0.27.0', '@esb/darwin-arm64': '0.27.0' } }),
  leaf('@esb/linux-x64', '0.27.0', { os: 'linux', cpu: 'x64' }),
  leaf('@esb/darwin-arm64', '0.27.0', { os: 'darwin', cpu: 'arm64' }),
  leaf('vt', '7.0.0', { dependencies: { esb: '^0.27.2' } }),
  leaf('vt/esb', '0.27.2', { optionalDependencies: { '@esb/linux-x64': '0.27.2', '@esb/darwin-arm64': '0.27.2' } }),
  leaf('vt/@esb/linux-x64', '0.27.2', { os: ['linux'], cpu: ['x64', 'arm64'] }),
  leaf('vt/esb/@esb/darwin-arm64', '0.27.2', { os: 'darwin', cpu: 'arm64' }),
  leaf('@s/p.q', '1.4.0', { dependencies: { 'r.s': '~2.1.0' } }),
  leaf('@s/p.q/r.s', '2.1.7'), leaf('r.s', '3.0.0'),
] });
const sharedClosureGraph = () => ({ configVersion: 1, dependencies: { native: '1.0.0' }, placements: [
  leaf('native', '1.0.0', { optionalDependencies: { 'native-linux-x64': '1.0.0', 'native-darwin-arm64': '1.0.0', 'native-wasm32': '1.0.0', 'native-netbsd': '1.0.0' } }),
  leaf('native-linux-x64', '1.0.0', { os: 'linux', cpu: 'x64', dependencies: { 'wasm-runtime': '^1.0.0' } }),
  leaf('native-wasm32', '1.0.0', { cpu: 'none', dependencies: { 'wasm-runtime': '^1.0.0', 'wasm-only': '1.0.0' } }),
  leaf('wasm-runtime', '1.0.0'), leaf('wasm-only', '1.0.0'),
  leaf('native-darwin-arm64', '1.0.0', { os: 'darwin', cpu: 'arm64', dependencies: { 'wasm-runtime': '^2.0.0' }, optionalDependencies: { 'darwin-helper': '1.0.0' } }),
  leaf('native-darwin-arm64/wasm-runtime', '2.0.0'),
  leaf('darwin-helper', '1.0.0', { os: 'darwin' }),
  leaf('native-netbsd', '1.0.0', { os: 'none', cpu: 'x64' }),
] });
const sharedClosurePlan = { paths: ['/native/-/native-1.0.0.tgz', '/native-linux-x64/-/native-linux-x64-1.0.0.tgz', '/wasm-runtime/-/wasm-runtime-1.0.0.tgz'],
  excluded: ['darwin-helper', 'native-darwin-arm64', 'native-darwin-arm64/wasm-runtime', 'native-netbsd', 'native-wasm32', 'wasm-only'] };
const duplicateIdentityGraph = () => ({ configVersion: 1, dependencies: { a: '1.0.0', b: '1.0.0', dup: '2.0.0', native: '1.0.0' }, placements: [
  leaf('a', '1.0.0', { dependencies: { dup: '^1.0.0' } }), leaf('a/dup', '1.0.0'),
  leaf('b', '1.0.0', { dependencies: { dup: '~1.0.0' } }), leaf('b/dup', '1.0.0'),
  leaf('dup', '2.0.0'),
  leaf('native', '1.0.0', { optionalDependencies: { 'native-darwin': '1.0.0' } }),
  leaf('native-darwin', '1.0.0', { os: 'darwin', dependencies: { dup: '1.0.0' } }), leaf('native-darwin/dup', '1.0.0'),
] });
const duplicateIdentityPlan = { paths: ['/a/-/a-1.0.0.tgz', '/b/-/b-1.0.0.tgz', '/dup/-/dup-1.0.0.tgz', '/dup/-/dup-2.0.0.tgz', '/native/-/native-1.0.0.tgz'],
  excluded: ['native-darwin', 'native-darwin/dup'] };
const dupCopies = ['a/dup', 'b/dup', 'native-darwin/dup'];

test('root and nested optional platform packages resolve to their own exact versions through an intermediate hoisted placement', async (t) => {
  await admitted(t, lockFixture(nestedOptionalGraph()), (f) => assertPlan(f, {
    paths: ['/esb/-/esb-0.27.0.tgz', '/esb/-/esb-0.27.2.tgz', '/@esb/linux-x64/-/linux-x64-0.27.0.tgz', '/@esb/linux-x64/-/linux-x64-0.27.2.tgz',
      '/vt/-/vt-7.0.0.tgz', '/@s/p.q/-/p.q-1.4.0.tgz', '/r.s/-/r.s-2.1.7.tgz', '/r.s/-/r.s-3.0.0.tgz'],
    excluded: ['@esb/darwin-arm64', 'vt/esb/@esb/darwin-arm64'],
  }));
});

test('a root host package does not satisfy a nested exact optional version once the hoisted nested copy is removed', async (t) => {
  const graph = nestedOptionalGraph();
  graph.placements = graph.placements.filter(([key]) => key !== 'vt/@esb/linux-x64');
  await admitted(t, lockFixture(graph), (f) => assertRefused(f, UNSUPPORTED));
});

test('a host child shared with non-host optional closures is planned once while those closures stay excluded', async (t) => {
  await admitted(t, lockFixture(sharedClosureGraph()), (f) => assertPlan(f, sharedClosurePlan));
});

test('a package reachable only through a required peer is planned with its own required children and peers', async (t) => {
  await admitted(t, lockFixture({ configVersion: 1, dependencies: { app: '1.0.0' }, placements: [
    leaf('app', '1.0.0', { dependencies: { plugin: '^1.0.0' } }),
    leaf('app/plugin', '1.0.0', { peerDependencies: { 'host-peer': '^5.1.0' } }),
    leaf('host-peer', '5.2.0', { dependencies: { 'host-child': '1.0.0' }, optionalDependencies: { 'host-peer-darwin': '5.2.0' }, peerDependencies: { 'peer-of-peer': '>=2 <3' } }),
    leaf('host-child', '1.0.0'), leaf('host-peer-darwin', '5.2.0', { os: 'darwin', cpu: 'arm64' }), leaf('peer-of-peer', '2.9.9'),
  ] }), (f) => assertPlan(f, {
    paths: ['/app/-/app-1.0.0.tgz', '/plugin/-/plugin-1.0.0.tgz', '/host-peer/-/host-peer-5.2.0.tgz', '/host-child/-/host-child-1.0.0.tgz',
      '/peer-of-peer/-/peer-of-peer-2.9.9.tgz'],
    excluded: ['host-peer-darwin'],
  }));
});

test('one locked identity at two planned placements and one excluded placement has one planned archive', async (t) => {
  await admitted(t, lockFixture(duplicateIdentityGraph()), (f) => assertPlan(f, duplicateIdentityPlan));
});

// The metadata below changes only after lockFixture has built archives and integrities, so every copy keeps one integrity.
test('consistent host-applicable lock metadata on every copy of one identity is admitted', async (t) => {
  const fixture = lockFixture(duplicateIdentityGraph());
  for (const key of dupCopies) fixture.lock.packages[key][2] = { os: 'linux' };
  await admitted(t, fixture, (f) => assertPlan(f, duplicateIdentityPlan));
});

test('conflicting lock metadata on copies of one identity with the same integrity is refused', async (t) => {
  const fixture = lockFixture(duplicateIdentityGraph());
  fixture.lock.packages['b/dup'][2] = { os: 'linux' };
  assert.equal(new Set(dupCopies.map((key) => fixture.lock.packages[key][3])).size, 1, 'precondition: one shared archive integrity');
  await admitted(t, fixture, (f) => assertRefused(f, UNSUPPORTED));
});

const escapedDuplicateText = (lock) => insertAfter(lockText(lock), '"darwin-helper@1.0.0"', '"os": "darwin"', ',\n        "o\\u0073": "linux"');
test('the last-wins value of an escaped duplicate metadata key is admitted when written without duplication', async (t) => {
  const fixture = lockFixture(sharedClosureGraph());
  fixture.lock.packages['darwin-helper'][2] = { os: 'linux' };
  await admitted(t, fixture, (f) => assertPlan(f, sharedClosurePlan));
});

test('an escaped duplicate metadata key inside a lock tuple is refused as unsafe', async (t) => {
  const fixture = lockFixture(sharedClosureGraph());
  const text = escapedDuplicateText(fixture.lock);
  assert.equal(JSON.parse(text).packages['darwin-helper'][2].os, 'linux', 'precondition: last-wins parsing yields the admitted value');
  await admitted(t, fixture, (f) => assertRefused(f, UNSAFE), { lockText: text });
});

test('a duplicate package-entry key whose parsed value equals an admitted lock is refused as unsafe', async (t) => {
  const fixture = lockFixture(sharedClosureGraph());
  const text = insertAfter(lockText(fixture.lock), '"packages": {', '"packages": {', `\n    "wasm-only": ${JSON.stringify(fixture.lock.packages['wasm-only'])},`);
  assert.deepEqual(JSON.parse(text), fixture.lock, 'precondition: parsing yields the admitted lock');
  await admitted(t, fixture, (f) => assertRefused(f, UNSAFE), { lockText: text });
});

test('numeric prerelease identifiers are ordered numerically and below alphanumeric identifiers', async (t) => {
  const single = (spec, version) => lockFixture({ configVersion: 1, dependencies: { host: '1.0.0' }, placements: [
    leaf('host', '1.0.0', { dependencies: { leaf: spec } }), leaf('leaf', version)] });
  await admitted(t, single('>=1.0.0-beta.9 <1.0.0', '1.0.0-beta.10'), (f) => assertPlan(f, { paths: ['/host/-/host-1.0.0.tgz', '/leaf/-/leaf-1.0.0-beta.10.tgz'], excluded: [] }));
  await admitted(t, single('~1.2.3-alpha.1', '1.2.3-alpha.beta'), (f) => assertPlan(f, { paths: ['/host/-/host-1.0.0.tgz', '/leaf/-/leaf-1.2.3-alpha.beta.tgz'], excluded: [] }));
  await admitted(t, single('>=1.0.0-beta.10', '1.0.0-beta.9'), (f) => assertRefused(f, UNSUPPORTED));
  await admitted(t, single('^1.0.0-alpha.beta', '1.0.0-alpha.1'), (f) => assertRefused(f, UNSUPPORTED));
});
