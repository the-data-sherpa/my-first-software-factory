// Owned-scope worker. Only authored packages cross the existing public dependency-preparation seam.
import { mkdir, readFile, writeFile, access, chmod, unlink, symlink } from 'node:fs/promises';
import { lockFixture, compatibilityRepository, bunPath } from './dependencies-compatibility-fixture.mjs';
import { admitDependencies, prepareDependencies, inspectDependencies, verifyDependencyBundle, dependencyDirectory, serializeDependencyError } from '../../src/dependencies.mjs';
import { hash } from '../../src/dependencies-files.mjs';

const [scenario, root] = process.argv.slice(2);
if (!['rehoisted', 'unsatisfied-peer', 'nested-payload', 'spoofed-content', 'extra-copy', 'optional-scoped', 'graph-observations', 'bin-observation'].includes(scenario)
  || !/^\/tmp\/factory-dependency-graph-[A-Za-z0-9]+$/.test(root)) throw new Error('Unknown fixed graph fixture.');
globalThis.fetch = async () => { throw new Error('Uncontrolled network forbidden'); };
const cleanups = [];
const t = { after: callback => cleanups.push(callback) };
try {
  await mkdir(`${root}/fixture`, { mode: 0o700 });
  const fixture = lockFixture(scenario === 'bin-observation' ? { dependencies: { cli: '1.0.0', other: '1.0.0' }, placements: [
    ['cli', '1.0.0', { bin: { cli: './bin/cli.js' } }, {}, { 'bin/cli.js': 'console.log("cli");' }], ['other', '1.0.0'],
  ] } : scenario === 'optional-scoped' ? { configVersion: 0,
    dependencies: { '@scope/consumer': '1.0.0', '@scope/provider': '3.0.0' }, placements: [
      ['@scope/consumer', '1.0.0', { dependencies: { '@scope/provider': '^2.0.0' }, optionalDependencies: { 'native-darwin': '1.0.0' },
        peerDependencies: { ghost: '^1.0.0' }, optionalPeers: ['ghost'] }],
      ['@scope/provider', '3.0.0'], ['@scope/consumer/@scope/provider', '2.0.0'],
      ['native-darwin', '1.0.0', { os: 'darwin', cpu: 'arm64' }],
    ] } : ['spoofed-content', 'extra-copy'].includes(scenario) ? { configVersion: 0, dependencies: { carrier: '1.0.0', known: '1.0.0' }, placements: [
    ['carrier', '1.0.0', { dependencies: { known: '1.0.0' } }, {}, {
      'node_modules/known/package.json': JSON.stringify({ name: 'known', version: '1.0.0', type: 'module', exports: './index.js' }),
      'node_modules/known/index.js': scenario === 'extra-copy' ? 'export const value = "known@1.0.0";' : 'export const value = "spoofed";',
    }], ['known', '1.0.0'], ...(scenario === 'extra-copy' ? [] : [['carrier/known', '1.0.0']]),
  ] } : scenario === 'nested-payload' ? { configVersion: 0, dependencies: { carrier: '1.0.0' }, placements: [
    ['carrier', '1.0.0', {}, {}, { 'node_modules/phantom/package.json': JSON.stringify({ name: 'phantom', version: '9.0.0' }),
      'node_modules/phantom/index.js': 'export const value = "unplanned";' }],
  ] } : scenario === 'unsatisfied-peer' ? { configVersion: 0, dependencies: { kw: '5.0.0', lowpeer: '6.0.0' }, placements: [
    ['kw', '5.0.0', { peerDependencies: { lowpeer: '^8.0.0' } }], ['lowpeer', '6.0.0'],
  ] } : { configVersion: 0, dependencies: { user: '9.0.0', holder: '4.0.0' }, placements: [
    ['user', '9.0.0', { dependencies: { lowpeer: '^6.0.0' } }], ['lowpeer', '6.0.0'],
    ['holder', '4.0.0', { dependencies: { lowpeer: '^8.0.0', kw: '^5.0.0' } }], ['holder/lowpeer', '8.0.0'],
    ['kw', '5.0.0', { peerDependencies: { lowpeer: '^8.0.0' } }],
  ] });
  const f = await compatibilityRepository(t, fixture, { serve: true, root: `${root}/fixture` });
  const intent = await admitDependencies({ workspaceIntent: f.workspaceIntent, bunPath, registry: true });
  const lock = await readFile(`${f.repositoryPath}/bun.lock`);
  const output = { unmetPeers: intent.acquisition.unmetPeers, excluded: intent.acquisition.excluded };
  try {
    const receipt = await prepareDependencies(intent, { authorizeRegistryFetch: true, registryTransport: f.registryTransport });
    const inspected = await inspectDependencies(intent);
    await verifyDependencyBundle(intent);
    Object.assign(output, { status: receipt.status, inspected: inspected.status, bundleVerified: true,
      bunVersion: receipt.bunVersion, network: receipt.network, sentinels: receipt.sentinels,
      inventoryDigest: receipt.inventoryDigest, graph: receipt.graph,
      graphMatchesInspection: JSON.stringify(receipt.graph) === JSON.stringify(inspected.graph) });
  } catch (error) {
    output.failure = serializeDependencyError(error).code;
    output.inspected = (await inspectDependencies(intent)).status;
  }
  if (scenario === 'unsatisfied-peer') {
    const destination = dependencyDirectory(intent);
    const peer = JSON.parse(await readFile(`${destination}/bundle/node_modules/kw/package.json`, 'utf8'));
    const provider = JSON.parse(await readFile(`${destination}/bundle/node_modules/lowpeer/package.json`, 'utf8'));
    output.installedEvidence = { peer: peer.peerDependencies.lowpeer, provider: provider.version };
    output.resultPresent = await access(`${destination}/result.json`).then(() => true, () => false);
  }
  if (scenario === 'nested-payload') {
    const destination = dependencyDirectory(intent);
    output.payloadPresent = await access(`${destination}/bundle/node_modules/carrier/node_modules/phantom/package.json`).then(() => true, () => false);
    output.resultPresent = await access(`${destination}/result.json`).then(() => true, () => false);
  }
  if (['spoofed-content', 'extra-copy'].includes(scenario)) {
    const destination = dependencyDirectory(intent);
    const payload = `${destination}/bundle/node_modules/carrier/node_modules/known/index.js`;
    output.payloadPresent = await access(payload).then(() => true, () => false);
    if (output.payloadPresent) output.payloadContents = await readFile(payload, 'utf8');
    output.rootContents = await readFile(`${destination}/bundle/node_modules/known/index.js`, 'utf8');
    output.resultPresent = await access(`${destination}/result.json`).then(() => true, () => false);
  }
  if (scenario === 'graph-observations' && output.status === 'prepared') {
    const destination = dependencyDirectory(intent); const resultPath = `${destination}/result.json`;
    const original = await readFile(resultPath); const receipt = JSON.parse(original);
    const requests = f.requests.length;
    const failure = promise => promise.then(() => 'unexpected-success', error => serializeDependencyError(error).code);
    const tamper = {
      missing: body => { delete body.graph; },
      digest: body => { body.graph.inventoryDigest = '0'.repeat(64); },
      relationship: body => {
        const peer = body.graph.relationships.find(edge => edge.from === 'node_modules/kw' && edge.name === 'lowpeer');
        if (!peer) throw new Error('The genuine graph must contain the observed peer.');
        peer.to = 'node_modules/user/node_modules/lowpeer'; peer.version = '6.0.0';
      },
      policy: body => { body.graph.policy = 'unverified-policy-label'; },
    };
    output.tamperChecks = {};
    try {
      for (const [name, change] of Object.entries(tamper)) {
        const changed = structuredClone(receipt); change(changed);
        const bytes = `${JSON.stringify(changed)}\n`;
        await writeFile(`${root}/tamper-${name}.json`, bytes, { mode: 0o600 });
        await writeFile(resultPath, bytes);
        const inspection = await failure(inspectDependencies(intent));
        const bundle = await failure(verifyDependencyBundle(intent));
        await writeFile(resultPath, original);
        output.tamperChecks[name] = { inspection, bundle, restored: (await inspectDependencies(intent)).status };
      }
    } finally { await writeFile(resultPath, original); }
    const { id, ...body } = structuredClone(intent);
    const implementation = body.toolchain.files.find(file => file.path.endsWith('/dependencies-graph.mjs'));
    if (!implementation) throw new Error('Preparation must bind the graph implementation.');
    implementation.sha256 = '0'.repeat(64);
    const forged = { ...body, id: hash(JSON.stringify(body)) };
    await writeFile(`${root}/forged-graph-intent.json`, JSON.stringify(forged), { mode: 0o600 });
    output.staleGraphImplementation = {
      code: await failure(prepareDependencies(forged, { authorizeRegistryFetch: true, registryTransport: f.registryTransport })),
      attempt: await access(`${dependencyDirectory(forged)}/intent.json`).then(() => true, () => false),
    };
    output.requestsUnchanged = f.requests.length === requests;
  }
  if (scenario === 'bin-observation' && output.status === 'prepared') {
    const destination = dependencyDirectory(intent); const resultPath = `${destination}/result.json`;
    const original = await readFile(resultPath); const receipt = JSON.parse(original);
    const changed = structuredClone(receipt); const shim = changed.inventory.find(file => file.path === 'node_modules/.bin/cli');
    if (!shim || shim.type !== 'symlink') throw new Error('The genuine install must contain the CLI shim.');
    output.originalShim = shim.target; const previous = shim.target; shim.target = '../other/index.js';
    changed.inventoryDigest = hash(JSON.stringify(changed.inventory)); changed.graph.inventoryDigest = changed.inventoryDigest;
    await writeFile(`${root}/tamper-bin-receipt.json`, JSON.stringify(changed), { mode: 0o600 });
    const bin = `${destination}/bundle/node_modules/.bin`; const path = `${bin}/cli`; const requests = f.requests.length;
    const failure = promise => promise.then(() => 'unexpected-success', error => serializeDependencyError(error).code);
    try {
      await chmod(bin, 0o700); await unlink(path); await symlink(shim.target, path); await chmod(bin, 0o500);
      await writeFile(resultPath, JSON.stringify(changed));
      output.binTamper = { inspection: await failure(inspectDependencies(intent)), bundle: await failure(verifyDependencyBundle(intent)) };
    } finally {
      await chmod(bin, 0o700); await unlink(path); await symlink(previous, path); await chmod(bin, 0o500);
      await writeFile(resultPath, original);
    }
    output.binTamper.restored = (await inspectDependencies(intent)).status;
    output.requestsUnchanged = f.requests.length === requests;
  }
  output.lockUnchanged = lock.equals(await readFile(`${f.workspaceIntent.worktree}/bun.lock`)) && lock.equals(await readFile(`${f.repositoryPath}/bun.lock`));
  output.requests = f.requests.map(({ method, path, authorization }) => ({ method, path, authorization: authorization ?? null }));
  console.log(JSON.stringify(output));
} finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
