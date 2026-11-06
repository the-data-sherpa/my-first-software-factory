import test from 'node:test';
import assert from 'node:assert/strict';
import { lockFixture, admit } from './dependencies-compatibility-fixture.mjs';

// Agreed seam: owner registry admission (admitDependencies) over a disposable committed repository.
// Admission performs no Bun execution or network; these tests prove the admitted plan, not installation.
const paths = (intent) => intent.acquisition.archives.map((entry) => entry.path);
const leaf = (key, version = '1.0.0', metadata = {}) => [key, version, metadata];

test('Bun 1.3.14 hoisted lock with configuration version 0 is admitted for an ordinary root graph', async (t) => {
  const f = await admit(t, lockFixture({ configVersion: 0, dependencies: { left: '^1.0.0' },
    placements: [leaf('left', '1.2.0', { dependencies: { right: '~2.0.0' } }), leaf('right', '2.0.3')] }));
  assert.equal(f.failure, undefined);
  assert.deepEqual(paths(f.intent), ['/left/-/left-1.2.0.tgz', '/right/-/right-2.0.3.tgz']);
  assert.deepEqual(f.intent.acquisition.host, { os: 'linux', cpu: 'x64' });
  assert.deepEqual(f.intent.acquisition.excluded, []);
});

test('safe dotted package names in scoped, unscoped and nested placements are planned exactly', async (t) => {
  const f = await admit(t, lockFixture({ dependencies: { 'array.prototype.flat': '^1.3.0', '@nodelib/fs.walk': '1.2.8', '@nodelib/fs.scandir': '^3.0.0' },
    placements: [
      leaf('array.prototype.flat', '1.3.3', { dependencies: { 'es-abstract': '^1.23.0' } }), leaf('es-abstract', '1.24.0'),
      leaf('@nodelib/fs.walk', '1.2.8', { dependencies: { '@nodelib/fs.scandir': '2.1.5' } }),
      leaf('@nodelib/fs.scandir', '3.0.0'), leaf('@nodelib/fs.walk/@nodelib/fs.scandir', '2.1.5'),
    ] }));
  assert.equal(f.failure, undefined);
  assert.deepEqual(paths(f.intent), ['/@nodelib/fs.scandir/-/fs.scandir-2.1.5.tgz', '/@nodelib/fs.scandir/-/fs.scandir-3.0.0.tgz', '/@nodelib/fs.walk/-/fs.walk-1.2.8.tgz',
    '/array.prototype.flat/-/array.prototype.flat-1.3.3.tgz', '/es-abstract/-/es-abstract-1.24.0.tgz'].sort((a, b) => a.localeCompare(b, 'en')));
  assert.deepEqual(f.intent.acquisition.excluded, []);
});

test('observed prerelease versions and npm range expressions resolve only to satisfying locked versions', async (t) => {
  const specs = { gensync: '^1.0.0-beta.2', resolve: '^2.0.0-next.5', star: '*', hyphen: '1 - 3', partialHyphen: '1.2.0 - 3',
    xunion: '1.x.x || 2.x.x', caretUnion: '^2.4.1 || ^3.0.0', major: '4' };
  const versions = { gensync: '1.0.0-beta.2', resolve: '2.0.0-next.5', star: '7.1.0', hyphen: '3.9.9', partialHyphen: '3.0.1',
    xunion: '2.5.0', caretUnion: '3.0.0', major: '4.2.0' };
  const f = await admit(t, lockFixture({ dependencies: { root: '0.0.40' }, placements: [
    leaf('root', '0.0.40', { dependencies: Object.fromEntries(Object.entries(specs).map(([name, spec]) => [`dep-${name.toLowerCase()}`, spec])) }),
    ...Object.entries(versions).map(([name, version]) => leaf(`dep-${name.toLowerCase()}`, version)),
  ] }));
  assert.equal(f.failure, undefined);
  assert.equal(paths(f.intent).length, 9);
  assert.ok(paths(f.intent).includes('/dep-gensync/-/dep-gensync-1.0.0-beta.2.tgz'));
  assert.ok(paths(f.intent).includes('/dep-resolve/-/dep-resolve-2.0.0-next.5.tgz'));
});

test('declared peers are resolved and range-checked; unmet optional peers are not acquired', async (t) => {
  const react = '^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc';
  const f = await admit(t, lockFixture({ dependencies: { widget: '^1.0.0', react: '^19.2.3' }, devDependencies: { '@types/react': '^19.2.8' },
    placements: [
      leaf('widget', '1.1.15', { dependencies: { helper: '1.0.0' },
        peerDependencies: { '@types/react': '*', '@types/react-dom': '*', react, 'peer-only': '>=0.57.1 <1' }, optionalPeers: ['@types/react', '@types/react-dom'] }),
      leaf('helper', '1.0.0'), leaf('react', '19.2.3'), leaf('@types/react', '19.2.8'), leaf('peer-only', '0.60.0'),
    ] }));
  assert.equal(f.failure, undefined);
  assert.deepEqual(paths(f.intent), ['/@types/react/-/react-19.2.8.tgz', '/helper/-/helper-1.0.0.tgz', '/peer-only/-/peer-only-0.60.0.tgz',
    '/react/-/react-19.2.3.tgz', '/widget/-/widget-1.1.15.tgz']);
});

test('only host-applicable optional platform packages are planned; non-host optional closures are bound and excluded', async (t) => {
  const f = await admit(t, lockFixture({ dependencies: { native: '^0.34.4' }, placements: [
    leaf('native', '0.34.5', { optionalDependencies: { '@img/native-linux-x64': '0.34.5', '@img/native-darwin-arm64': '0.34.5',
      '@img/native-riscv64': '0.34.5', '@img/native-multi': '0.34.5', portable: '^3.0.0' } }),
    leaf('@img/native-linux-x64', '0.34.5', { os: 'linux', cpu: 'x64', optionalDependencies: { '@img/libvips-linux-x64': '1.2.4' } }),
    leaf('@img/libvips-linux-x64', '1.2.4', { os: 'linux', cpu: 'x64' }),
    leaf('@img/native-darwin-arm64', '0.34.5', { os: 'darwin', cpu: 'arm64', optionalDependencies: { '@img/libvips-darwin-arm64': '1.2.4' } }),
    leaf('@img/libvips-darwin-arm64', '1.2.4', { os: 'darwin', cpu: 'arm64' }),
    leaf('@img/native-riscv64', '0.34.5', { os: 'linux', cpu: 'none' }),
    leaf('@img/native-multi', '0.34.5', { os: ['linux', 'android', 'freebsd'], cpu: 'x64', bin: 'bin/native.js' }),
    leaf('portable', '3.0.0'),
  ] }));
  assert.equal(f.failure, undefined);
  assert.deepEqual(paths(f.intent), ['/@img/libvips-linux-x64/-/libvips-linux-x64-1.2.4.tgz', '/@img/native-linux-x64/-/native-linux-x64-0.34.5.tgz',
    '/@img/native-multi/-/native-multi-0.34.5.tgz', '/native/-/native-0.34.5.tgz', '/portable/-/portable-3.0.0.tgz']);
  assert.deepEqual(f.intent.acquisition.excluded, ['@img/libvips-darwin-arm64', '@img/native-darwin-arm64', '@img/native-riscv64']);
});

test('the unapproved out-of-range peer candidate records its mismatch without adding an archive', async (t) => {
  const f = await admit(t, lockFixture({ dependencies: { linter: '^9.0.0', bundler: '^5.0.0' }, placements: [
    leaf('linter', '9.39.2', { dependencies: { ajv: '^6.12.4' } }), leaf('ajv', '6.12.6'),
    leaf('bundler', '5.105.4', { dependencies: { 'schema-utils': '^4.3.3' } }),
    leaf('schema-utils', '4.3.3', { dependencies: { ajv: '^8.9.0', 'ajv-keywords': '^5.1.0' } }), leaf('schema-utils/ajv', '8.18.0'),
    leaf('ajv-keywords', '5.1.0', { peerDependencies: { ajv: '^8.8.2' } }),
  ] }));
  assert.equal(f.failure, undefined);
  assert.deepEqual(paths(f.intent), ['/ajv-keywords/-/ajv-keywords-5.1.0.tgz', '/ajv/-/ajv-6.12.6.tgz', '/ajv/-/ajv-8.18.0.tgz',
    '/bundler/-/bundler-5.105.4.tgz', '/linter/-/linter-9.39.2.tgz', '/schema-utils/-/schema-utils-4.3.3.tgz']);
  assert.deepEqual(f.intent.acquisition.unmetPeers, [{ placement: 'ajv-keywords', peer: 'ajv', range: '^8.8.2', provider: 'ajv', version: '6.12.6' }]);
});

const base = () => ({ dependencies: { app: '^1.0.0' }, placements: [
  leaf('app', '1.0.0', { dependencies: { lib: '^2.0.0' }, optionalDependencies: { 'app-darwin': '1.0.0' } }),
  leaf('lib', '2.1.0'), leaf('app-darwin', '1.0.0', { os: 'darwin', cpu: 'arm64' }),
] });
test('the unmodified refusal base graph is admitted, so each refusal below is caused by its single mutation', async (t) => {
  const f = await admit(t, lockFixture(base()));
  assert.equal(f.failure, undefined);
  assert.deepEqual(paths(f.intent), ['/app/-/app-1.0.0.tgz', '/lib/-/lib-2.1.0.tgz']);
  assert.deepEqual(f.intent.acquisition.excluded, ['app-darwin']);
});
const refusals = {
  'unknown metadata key': (l) => { l.placements[1][2].libc = ['glibc']; },
  'absolute string bin path': (l) => { l.placements[1][2].bin = '/usr/bin/x'; },
  'absolute object bin path': (l) => { l.placements[1][2].bin = { command: '/usr/bin/x' }; },
  'unknown platform value': (l) => { l.placements[2][2].os = 'netbsd'; },
  'negated platform value': (l) => { l.placements[2][2].os = '!win32'; },
  'empty platform list': (l) => { l.placements[2][2].cpu = []; },
  'required dependency on a non-host package': (l) => { l.placements[0][2].dependencies['app-darwin'] = '1.0.0'; delete l.placements[0][2].optionalDependencies; },
  'required peer on a non-host package': (l) => { l.placements[0][2].peerDependencies = { 'app-darwin': '1.0.0' }; },
  'unexplained orphan': (l) => { l.placements.push(leaf('stray', '1.0.0')); },
  'platform-shaped orphan with no optional edge': (l) => { l.placements.push(leaf('stray-win32', '1.0.0', { os: 'win32', cpu: 'x64' })); },
  'missing optional target': (l) => { l.placements.pop(); },
  'optional target outside its range': (l) => { l.placements[0][2].optionalDependencies['app-darwin'] = '^2.0.0'; },
  'unmet required peer that would be acquired only for that peer': (l) => {
    l.placements[0][2].peerDependencies = { 'peer-only': '^3.0.0' }; l.placements.push(leaf('peer-only', '2.0.0'));
  },
  'missing required peer': (l) => { l.placements[0][2].peerDependencies = { absent: '*' }; },
  'optional peer that is not declared as a peer': (l) => { l.placements[0][2].optionalPeers = ['lib']; },
  'name declared as both required and optional': (l) => { l.placements[0][2].optionalDependencies.lib = '^2.0.0'; },
  'prerelease outside a release range': (l) => { l.placements[1][1] = '2.2.0-beta.1'; },
  'build metadata version': (l) => { l.placements[1][1] = '2.1.0+build.5'; },
  'leading-dot package name': (l) => { l.placements[1][0] = '.lib'; l.placements[0][2].dependencies = { '.lib': '^2.0.0' }; },
  'unsupported greater-than range': (l) => { l.placements[0][2].dependencies.lib = '>2.0.0'; },
  'tag range': (l) => { l.placements[0][2].dependencies.lib = 'latest'; },
  'alias range': (l) => { l.placements[0][2].dependencies.lib = 'npm:lib@^2.0.0'; },
  'loose v-prefixed range': (l) => { l.placements[0][2].dependencies.lib = 'v2.1.0'; },
  'over-long range': (l) => { l.placements[0][2].dependencies.lib = Array(40).fill('^2.0.0').join(' || '); },
  'future configuration version': (l) => { l.configVersion = 2; },
};
for (const [name, mutate] of Object.entries(refusals)) {
  test(`registry admission refuses ${name} before any acquisition`, async (t) => {
    const fixture = base(); mutate(fixture);
    const f = await admit(t, lockFixture(fixture));
    assert.equal(f.failure, 'DEPENDENCIES_UNSUPPORTED');
    assert.equal(f.intent, undefined);
  });
}

const withRange = (spec, version) => { const l = base(); l.placements[0][2].dependencies.lib = spec; l.placements[1][1] = version; return l; };
const admitted = [['^0.7.1', '0.7.9'], ['1.2.0 - 3', '3.99.0'], ['>=1.0.0 <1.10.0', '1.9.9'], ['>= 4.21.0', '4.21.0'], ['^1.8', '1.99.0'],
  ['~19.3.0-0', '19.3.0-rc.1'], ['^19.0.0-0', '19.0.0-rc-de68d2f4-20241204'], ['^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0', '19.0.0-rc-de68d2f4-20241204'],
  ['^13.2.0 || ^14.0 || ^15.0.0-rc.0 || ^16.0.0-0', '15.0.0-rc.2'], ['16.x || 17.x', '17.0.2']];
for (const [spec, version] of admitted) {
  test(`registry admission accepts ${version} for the range ${spec}`, async (t) => {
    const f = await admit(t, lockFixture(withRange(spec, version)));
    assert.equal(f.failure, undefined);
    assert.ok(paths(f.intent).includes(`/lib/-/lib-${version}.tgz`));
  });
}
const outside = [['^0.7.1', '0.8.0'], ['^0.0.3', '0.0.4'], ['~2.0.0', '2.1.0'], ['1 - 3', '4.0.0'], ['1.2.0 - 3', '1.1.9'], ['1.x.x || 2.x.x', '3.0.0'],
  ['>=0.57.1 <1', '1.0.0'], ['>=1.0.0 <1.10.0', '1.10.0'], ['>=1.0.0 <1.10.0', '1.10.0-rc.1'], ['4', '5.0.0'], ['*', '1.0.0-rc.1'],
  ['^1.0.0-beta.2', '1.0.0-beta.1'], ['^1.0.0-beta.2', '1.1.0-beta.1'], ['~19.3.0-0', '19.4.0'], ['^19.0.0', '19.0.0-rc.1']];
for (const [spec, version] of outside) {
  test(`registry admission refuses ${version} for the range ${spec}`, async (t) => {
    const f = await admit(t, lockFixture(withRange(spec, version)));
    assert.equal(f.failure, 'DEPENDENCIES_UNSUPPORTED');
  });
}
