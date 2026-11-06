import { readFile, mkdir, realpath, lstat, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectWorkspace } from './workspace.mjs';
import { acquireOwner, privateDirectory, openRecords } from './storage.mjs';
import { verifyContainmentEnvelope } from './containment.mjs';
import { hash, directory, regular, save, archiveManifest, seal, verifyInventory, parseDependencyJSON } from './dependencies-files.mjs';
import { libraries, runPreparationSandbox } from './dependencies-process.mjs';
import { proveScriptSuppression } from './dependencies-self-test.mjs';
import { parseBunLock, registryPlan, HOST } from './dependencies-lock.mjs';
import { acquireRegistry, verifyAcquisition, REGISTRY } from './dependencies-registry.mjs';

const INSTRUCTION = 'Ask the owner to admit and explicitly prepare a matching private dependency bundle through the foreground preparation operation. Agent tools cannot install packages.';
const explanations = {
  DRAIN_FAILED: 'Preparation cleanup was not confirmed. Ownership remains fenced; require trusted quiescence review.',
  DEPENDENCIES_UNSUPPORTED: 'Unsupported dependency input.',
  DEPENDENCIES_STALE: 'The source or toolchain fingerprint changed.',
  DEPENDENCIES_UNSAFE: 'The private dependency inputs or bundle failed integrity checks.',
  DEPENDENCIES_EXISTS: 'An attempt already exists. Inspect its evidence and require explicit owner cleanup before preparing again.',
  DEPENDENCIES_ACTIVE_RUN: 'Review and settle the active run before preparing dependencies.',
  DEPENDENCIES_FETCH_AUTHORIZATION: 'Locked registry fetching requires explicit owner authorization.',
  DEPENDENCIES_FETCH_FAILED: 'The locked archive request failed. No redirect or retry was attempted.',
  DEPENDENCIES_FETCH_LIMIT: 'Locked registry acquisition exceeded its byte or entry limit.',
  DEPENDENCIES_INTEGRITY: 'A downloaded archive did not match its locked integrity.',
};
export class DependencyError extends Error {
  constructor(code) { super(`${explanations[code] ?? 'Private dependencies are unavailable.'} ${INSTRUCTION}`); this.name = 'DependencyError'; this.code = code; }
  toJSON() { return { code: this.code, message: this.message }; }
}
const failureCodes = new Set(['DRAIN_FAILED', 'DEPENDENCIES_ABORTED', 'DEPENDENCIES_LAUNCH_FAILED', 'DEPENDENCIES_OUTPUT_LIMIT', 'DEPENDENCIES_BUNDLE_LIMIT',
  'DEPENDENCIES_TIMEOUT', 'DEPENDENCIES_RESOURCE_LIMIT', 'DEPENDENCIES_INSTALL_FAILED', 'DEPENDENCIES_EXPORT_FAILED', 'DEPENDENCIES_SCRIPT_SUPPRESSION',
  'DEPENDENCIES_FETCH_FAILED', 'DEPENDENCIES_FETCH_LIMIT', 'DEPENDENCIES_INTEGRITY', 'DEPENDENCIES_FETCH_AUTHORIZATION']);
export const serializeDependencyError = (error) => (error instanceof DependencyError ? error : new DependencyError(failureCodes.has(error?.code) ? error.code : 'DEPENDENCIES_FAILED')).toJSON();
const fail = (code) => { throw new DependencyError(code); };
const cancelled = (signal) => { if (signal?.aborted) fail('DEPENDENCIES_ABORTED'); };
async function safe(operation) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof DependencyError || ['CONTAINMENT_REQUIRED', 'DRAIN_FAILED'].includes(error.code)) throw error;
    throw new DependencyError(/^DEPENDENCIES_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'DEPENDENCIES_UNSAFE');
  }
}
const identity = ({ id, ...body }) => hash(JSON.stringify(body));
const capabilities = new WeakMap();
// Keep the SQLite owner handle reachable when drainage fails. Releasing it (even
// through garbage collection) would admit another live owner over uncertain work.
const undrainedOwners = new Set();

async function toolchain(bunPath, registry = false) {
  // Toolchain paths are trusted owner inputs, not repository fields. Never read user Bun config.
  if (typeof bunPath !== 'string' || await realpath(bunPath) !== bunPath) fail('DEPENDENCIES_UNSAFE');
  const paths = [bunPath, await realpath(process.execPath), await realpath('/usr/bin/bwrap'),
    ...await Promise.all(libraries.map((library) => realpath(`/usr/lib/${library}`)))];
  const files = [];
  for (const path of paths) {
    const info = await lstat(path);
    if (!info.isFile() || info.mode & 0o022 || ![0, process.getuid()].includes(info.uid) || info.size > 256 * 1024 ** 2) fail('DEPENDENCIES_UNSAFE');
    files.push({ path, sha256: hash(await readFile(path)), mode: info.mode & 0o777 });
  }
  return { policy: registry ? 'bun-registry-cache-v2' : 'offline-tarball-v1', nodeVersion: process.versions.node, files };
}

async function inputs(workspaceIntent, registry = false) {
  const workspace = await inspectWorkspace(workspaceIntent);
  if (workspace.status !== 'prepared') fail('DEPENDENCIES_MISSING');
  // Configuration is never mounted, but changed or newly introduced configuration invalidates reuse.
  for (const path of ['.npmrc', '.yarnrc', '.yarnrc.yml', 'bunfig.toml', '.bunfig.toml', 'pnpm-workspace.yaml', '.pnpmfile.cjs']) {
    const entry = workspaceIntent.sourceManifest.entries.find((entry) => entry.path === path);
    const info = await lstat(join(workspace.worktree, path)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    if (Boolean(entry) !== Boolean(info)) fail('DEPENDENCIES_STALE');
    if (entry && hash(await regular(join(workspace.worktree, path), 65536)) !== entry.sha256) fail('DEPENDENCIES_STALE');
  }
  const names = ['package.json', 'bun.lock', 'package-lock.json'];
  const read = async (path) => {
    const entry = workspaceIntent.sourceManifest.entries.find((entry) => entry.path === path);
    if (!entry) fail('DEPENDENCIES_UNSUPPORTED');
    const data = await regular(join(workspace.worktree, path), 32 * 1024 ** 2);
    if (hash(data) !== entry.sha256 || data.length !== entry.bytes) fail('DEPENDENCIES_STALE');
    return data;
  };
  const packageBytes = await read('package.json');
  const manifest = parseDependencyJSON(packageBytes);
  for (const key of ['workspaces', 'patchedDependencies', 'overrides', 'resolutions', 'catalog', 'catalogs', 'publishConfig', 'config', '_auth', '_authToken']) if (manifest[key]) fail('DEPENDENCIES_UNSUPPORTED');
  if (registry) {
    // Platform selection is bound to the intent: a different preparation host is a different, unsupported profile.
    if (process.platform !== HOST.os || process.arch !== HOST.cpu) fail('DEPENDENCIES_UNSUPPORTED');
    const { archives, excluded, unmetPeers } = registryPlan(manifest, parseBunLock(await read('bun.lock')));
    const files = [];
    for (const path of names.sort()) { const data = await read(path); files.push({ path, sha256: hash(data), bytes: data.length }); }
    return { files, acquisition: { registry: REGISTRY, host: HOST, archives, excluded, unmetPeers } };
  }
  const packages = new Map();
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (field === 'peerDependencies' && manifest[field] && Object.keys(manifest[field]).length) fail('DEPENDENCIES_UNSUPPORTED');
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (!/^(?:@[a-z0-9_-]+\/)?[a-z0-9_-]+$/.test(name) || typeof spec !== 'string' || !/^file:vendor\/[a-zA-Z0-9_-]+\.tgz$/.test(spec)
        || packages.has(name)) fail('DEPENDENCIES_UNSUPPORTED');
      const path = spec.slice(5); const archive = await read(path);
      const pkg = archiveManifest(archive);
      if (pkg.name !== name || typeof pkg.version !== 'string') fail('DEPENDENCIES_UNSUPPORTED');
      packages.set(name, { spec, integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}` }); names.push(path);
    }
  }
  if (!packages.size) fail('DEPENDENCIES_UNSUPPORTED');
  const lockBytes = await read('bun.lock');
  // Bun's emitted JSON permits trailing commas. Tokenize strings so their contents are never rewritten.
  const lock = parseBunLock(lockBytes);
  if (lock.lockfileVersion !== 1 || lock.configVersion !== 1
    || Object.keys(lock).some((key) => !['lockfileVersion', 'configVersion', 'workspaces', 'trustedDependencies', 'packages'].includes(key))
    || Object.keys(lock.workspaces ?? {}).some((name) => name !== '')
    || Object.keys(lock.packages ?? {}).length !== packages.size) fail('DEPENDENCIES_UNSUPPORTED');
  for (const [name, { spec, integrity }] of packages) {
    const tuple = lock.packages?.[name];
    if (!Array.isArray(tuple) || tuple.length !== 3 || tuple[0] !== `${name}@${spec.slice(5)}` || tuple[2] !== integrity
      || Object.keys(tuple[1] ?? {}).some((key) => key !== 'bin')) fail('DEPENDENCIES_UNSUPPORTED');
  }
  const files = [];
  for (const path of [...new Set(names)].sort()) { const data = await read(path); files.push({ path, sha256: hash(data), bytes: data.length }); }
  return { files };
}

/** Admission performs no install, process launch, network, or retained write. Save this intent before preparation. */
export async function admitDependencies({ workspaceIntent, bunPath, registry = false } = {}) {
  return safe(async () => {
    if (typeof registry !== 'boolean') fail('DEPENDENCIES_UNSUPPORTED');
    const snapshot = await inputs(workspaceIntent, registry);
    const intent = { version: 1, workspaceIntent, sourceManifestId: workspaceIntent.sourceManifest.id,
      ...snapshot, toolchain: await toolchain(bunPath, registry) };
    return { ...intent, id: identity(intent) };
  });
}
export function dependencyDirectory(intent) {
  return join(intent.workspaceIntent.stateDir, 'runs', intent.workspaceIntent.runId, 'dependencies', intent.id);
}
async function validate(intent) {
  if (!intent || intent.version !== 1 || intent.id !== identity(intent) || intent.sourceManifestId !== intent.workspaceIntent?.sourceManifest?.id) fail('DEPENDENCIES_UNSAFE');
  const registry = intent.acquisition !== undefined;
  const snapshot = await inputs(intent.workspaceIntent, registry);
  if (JSON.stringify(snapshot.files) !== JSON.stringify(intent.files) || JSON.stringify(snapshot.acquisition) !== JSON.stringify(intent.acquisition)
    || JSON.stringify(await toolchain(intent.toolchain?.files?.[0]?.path, registry)) !== JSON.stringify(intent.toolchain)) fail('DEPENDENCIES_STALE');
  return dependencyDirectory(intent);
}

/** Standalone owner entry: excludes a live backend, and refuses unresolved active-run records. */
export async function prepareOwnerDependencies(intent, options = {}) {
  await verifyContainmentEnvelope();
  // Validate trusted workspace ownership before deriving or locking any destination.
  await safe(() => validate(intent));
  const stateDir = await privateDirectory(intent.workspaceIntent.stateDir, { create: false });
  const release = await acquireOwner(stateDir);
  try {
    const exists = await lstat(join(stateDir, 'factory.sqlite')).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    if (exists) {
      const records = await openRecords(stateDir, { readOnly: true });
      try { if (records.active()) fail('DEPENDENCIES_ACTIVE_RUN'); } finally { records.close(); }
    }
    return await prepareDependencies(intent, options);
  } catch (error) {
    if (error?.code === 'DRAIN_FAILED') undrainedOwners.add(release);
    throw error;
  } finally { if (!undrainedOwners.has(release)) release(); }
}

/** Explicit owner operation only. Caller holds lifetime ownership and excludes every agent/tool while preparing. */
export async function prepareDependencies(intent, { signal, authorizeRegistryFetch = false, registryTransport } = {}) {
  return safe(async () => {
    await verifyContainmentEnvelope(); cancelled(signal);
    const destination = await validate(intent);
    if (intent.acquisition && authorizeRegistryFetch !== true) fail('DEPENDENCIES_FETCH_AUTHORIZATION');
    if (!intent.acquisition && (authorizeRegistryFetch || registryTransport)) fail('DEPENDENCIES_UNSUPPORTED');
    await directory(dirname(dirname(destination)));
    await mkdir(dirname(destination), { mode: 0o700 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    await directory(dirname(destination));
    try { await lstat(destination); fail('DEPENDENCIES_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(destination, { mode: 0o700 });
    await save(`${destination}/intent.json`, intent); // Ownership before retained effects.
    try {
      const input = `${destination}/input`; await mkdir(input, { mode: 0o700 }); await mkdir(`${input}/vendor`, { mode: 0o700 });
      for (const file of intent.files) {
        cancelled(signal);
        const data = await regular(join(intent.workspaceIntent.worktree, file.path), 32 * 1024 ** 2);
        if (hash(data) !== file.sha256) fail('DEPENDENCIES_STALE');
        await writeFile(join(input, file.path), data, { flag: 'wx', mode: 0o400 });
      }
      await save(`${destination}/started.json`, { intentId: intent.id, status: 'preparing', startedAt: new Date().toISOString() });
      const suppression = await proveScriptSuppression(destination, intent.toolchain, signal);
      // Cache layout is deliberately version-bound. A different Bun requires a new verified policy.
      if (intent.acquisition && suppression.bunVersion !== '1.3.14') fail('DEPENDENCIES_UNSUPPORTED');
      cancelled(signal);
      const acquisition = intent.acquisition ? await acquireRegistry({ destination, intentId: intent.id, plan: intent.acquisition.archives, signal, registryTransport }) : undefined;
      cancelled(signal);
      await validate(intent);
      const installed = await runPreparationSandbox({ inputDirectory: input, cacheDirectory: intent.acquisition ? `${destination}/cache` : undefined,
        bunPath: intent.toolchain.files[0].path, receiptDirectory: destination, signal });
      cancelled(signal);
      for (const [key, path] of [['manifest', 'package.json'], ['lock', 'bun.lock'], ['npmLock', 'package-lock.json']]) {
        if (hash(Buffer.from(installed.output[key], 'base64')) !== intent.files.find((file) => file.path === path).sha256) fail('DEPENDENCIES_LOCK_CHANGED');
      }
      await validate(intent); // Toolchain/source changed while preparing: never seal as valid.
      const inventory = await seal(`${destination}/bundle`, installed.output.files, () => cancelled(signal));
      cancelled(signal);
      const receipt = { version: 1, status: 'prepared', intentId: intent.id, sourceManifestId: intent.sourceManifestId,
        toolchain: intent.toolchain, inventory, inventoryDigest: hash(JSON.stringify(inventory)),
        bunVersion: installed.output.bunVersion, sentinels: installed.output.sentinels,
        network: installed.network, boundary: installed.output.boundary, launch: installed.launch, envelope: installed.envelope, logBytes: installed.logBytes,
        scripts: 'disabled', suppression, acquisition, frozenLockfile: true, reviewReady: false };
      await save(`${destination}/result.json`, receipt); return receipt;
    } catch (error) {
      try { await save(`${destination}/failure.json`, serializeDependencyError(error)); }
      catch (receiptError) { if (error?.code !== 'DRAIN_FAILED') throw receiptError; }
      throw error;
    }
  });
}

/** Passive inspection: no toolchain execution, network, installation, repair, or scheduler. */
export async function inspectDependencies(intent) {
  return safe(async () => {
    const destination = await validate(intent);
    try { await directory(destination); } catch (error) { if (error.code === 'ENOENT') return { status: 'not-prepared', intentId: intent.id }; throw error; }
    if (!Buffer.from(`${JSON.stringify(intent)}\n`).equals(await regular(`${destination}/intent.json`))) fail('DEPENDENCIES_UNSAFE');
    try {
      const receipt = JSON.parse((await regular(`${destination}/result.json`, 16 * 1024 ** 2)).toString('utf8'));
      if (receipt.status !== 'prepared' || receipt.intentId !== intent.id || receipt.sourceManifestId !== intent.sourceManifestId
        || JSON.stringify(receipt.toolchain) !== JSON.stringify(intent.toolchain) || receipt.inventoryDigest !== hash(JSON.stringify(receipt.inventory))) fail('DEPENDENCIES_UNSAFE');
      const proof = JSON.parse((await regular(`${destination}/script-proof/result.json`, 65536)).toString('utf8'));
      if (receipt.scripts !== 'disabled' || receipt.frozenLockfile !== true || receipt.network !== 'kernel-denied'
        || JSON.stringify(proof) !== JSON.stringify(receipt.suppression) || proof.toolchainSha256 !== intent.toolchain.files[0].sha256
        || proof.bunVersion !== receipt.bunVersion || proof.positive?.length !== 6 || proof.suppressed?.length !== 0) fail('DEPENDENCIES_UNSAFE');
      await verifyAcquisition(destination, intent, receipt.acquisition);
      await verifyInventory(`${destination}/bundle`, receipt.inventory);
      return receipt;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A missing terminal receipt is incomplete, never permission to replay preparation.
      return { status: 'incomplete', intentId: intent.id };
    }
  });
}

/** Validated opaque handle for trusted execution input. JSON/booleans cannot confer preparation authority. */
async function verifyTarget(intent, target) {
  for (const key of ['projectId', 'repositoryPath', 'stateDir', 'baseRef', 'baseCommit']) {
    if (target?.[key] !== intent.workspaceIntent[key]) fail('DEPENDENCIES_STALE');
  }
  if (target.sourceManifest?.id !== intent.sourceManifestId) fail('DEPENDENCIES_STALE');
  const snapshot = await inputs(target, intent.acquisition !== undefined);
  if (JSON.stringify(snapshot.files) !== JSON.stringify(intent.files) || JSON.stringify(snapshot.acquisition) !== JSON.stringify(intent.acquisition)) fail('DEPENDENCIES_STALE');
}
export async function verifyDependencyBundle(intent, { workspaceIntent = intent?.workspaceIntent } = {}) {
  return safe(async () => {
    const receipt = await inspectDependencies(intent);
    if (receipt.status !== 'prepared') fail('DEPENDENCIES_MISSING');
    await verifyTarget(intent, workspaceIntent);
    const handle = Object.freeze({ intentId: intent.id });
    capabilities.set(handle, { intent: structuredClone(intent), target: structuredClone(workspaceIntent) }); return handle;
  });
}
// Existing containment contract: target binding is fixed when the handle is issued, never at mount time.
export async function dependencyMount(handle, worktree) {
  return safe(async () => {
    const binding = capabilities.get(handle);
    if (!binding || binding.target.worktree !== worktree) fail('DEPENDENCIES_UNSAFE');
    const { intent, target } = binding;
    if ((await inspectDependencies(intent)).status !== 'prepared') fail('DEPENDENCIES_MISSING');
    await verifyTarget(intent, target);
    return { path: `${dependencyDirectory(intent)}/bundle/node_modules`, intentId: intent.id };
  });
}
