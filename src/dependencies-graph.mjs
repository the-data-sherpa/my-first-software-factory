// Verifies the actual Bun-installed layout without importing package code or treating lock keys as installed paths.
import { posix } from 'node:path';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { directory as privateDirectory, regular, hash, parseDependencyJSON, safePath, validateExport, unsafe,
  DEPENDENCY_FILE_BYTES, DEPENDENCY_EXPORT_BYTES, DEPENDENCY_RECEIPT_BYTES } from './dependencies-files.mjs';
import { canonical, registryPlan, registryArchive, registrySatisfies, validateRegistryManifest, registryBins, HOST } from './dependencies-lock.mjs';
import { FETCH_LIMITS, REGISTRY, retainedArchivePath } from './dependencies-registry.mjs';

export const INSTALLED_GRAPH_POLICY = 'bun-installed-graph-v1';
const unsupported = () => { throw Object.assign(new Error('Unsupported installed dependency graph.'), { code: 'DEPENDENCIES_UNSUPPORTED' }); };
const cancelled = signal => { if (signal?.aborted) throw Object.assign(new Error('Dependency verification aborted.'), { code: 'DEPENDENCIES_ABORTED' }); };
const identity = ({ name, version }) => `${name}\0${version}`;
const nameRE = /^(?:@[a-z0-9_-][a-z0-9._-]*\/)?[a-z0-9_-][a-z0-9._-]*$/;
const compare = (a, b) => a.localeCompare(b, 'en');

// A package root consists only of repeated node_modules/name groups, with scopes forming one name.
function placement(path) {
  const parts = path.split('/'); const roots = []; const containers = []; let at = 0; let name;
  while (at < parts.length) {
    if (parts[at++] !== 'node_modules' || at >= parts.length) return;
    containers.push(parts.slice(0, at).join('/'));
    name = parts[at++];
    if (name.startsWith('@')) {
      containers.push(parts.slice(0, at).join('/'));
      if (at >= parts.length) return;
      name += `/${parts[at++]}`;
    }
    if (!nameRE.test(name) || name.length > 150) return;
    roots.push(parts.slice(0, at).join('/'));
  }
  return { name, roots, containers };
}

async function packageTree(files, signal) {
  const tree = new Map();
  const add = (path, value) => {
    if (tree.has(path) && tree.get(path).type !== value.type) unsupported();
    tree.set(path, value);
    for (let parent = posix.dirname(path); parent !== '.'; parent = posix.dirname(parent)) {
      if (tree.has(parent) && tree.get(parent).type !== 'directory') unsupported();
      tree.set(parent, { type: 'directory' });
      if (tree.size > FETCH_LIMITS.entries) unsupported();
    }
    if (tree.size > FETCH_LIMITS.entries) unsupported();
  };
  let inspected = 0;
  for (const file of files) {
    cancelled(signal);
    if (++inspected % 64 === 0) { await yieldToLoop(); cancelled(signal); }
    // Direct nested packages are verified against their own planned archive rather than their carrier's files.
    if (file.path === 'node_modules' || file.path.startsWith('node_modules/')) continue;
    add(file.path, file.type === 'directory' ? { type: 'directory' }
      : { type: 'file', bytes: file.data.length, sha256: hash(file.data) });
  }
  return tree;
}

function lockedNodes(lock) {
  return new Map(Object.entries(lock.packages).map(([key, tuple]) => {
    const at = tuple[0].lastIndexOf('@');
    return [key, { name: tuple[0].slice(0, at), version: tuple[0].slice(at + 1) }];
  }));
}

function excludedOptional({ nodes, excluded, source, name, spec }) {
  const sources = [...nodes].filter(([key, node]) => !excluded.has(key) && identity(node) === identity(source));
  if (!sources.length) return false;
  for (const [sourceKey] of sources) {
    let ancestor = sourceKey; let target;
    while (ancestor) {
      const key = `${ancestor}/${name}`;
      if (nodes.has(key)) { target = key; break; }
      const parent = nodes.get(ancestor) ?? unsupported();
      ancestor = ancestor.slice(0, -(parent.name.length + 1));
    }
    target ??= nodes.has(name) ? name : undefined;
    if (target === undefined || !excluded.has(target) || nodes.get(target).name !== name
      || !registrySatisfies(nodes.get(target).version, spec)) return false;
  }
  // The rederived planner only excludes this optional edge from a planned source when its target is non-host.
  return true;
}

function declaredShim(file, nodes) {
  const name = posix.basename(file.path);
  const target = posix.normalize(posix.join(posix.dirname(file.path), file.target));
  for (let ancestor = posix.dirname(target); ancestor !== '.'; ancestor = posix.dirname(ancestor)) {
    const node = nodes.get(ancestor);
    if (!node) continue;
    const bins = registryBins(node.metadata.bin, node.name);
    if (Object.hasOwn(bins, name) && posix.join(node.path, bins[name]) === target) return true;
  }
  return false;
}

/** Caller supplies the sealed/verified inventory and hash-validated retained inputs. No receipt is saved here.
 * Every package's own file bytes/types must match its exact acquired archive; nested packages have independent
 * identities. The actual ancestor lookup, not a guessed translation of lock placements, resolves all edges.
 */
export async function verifyInstalledGraph({ directory, archivesDirectory, inventory, manifest, lock, plan, signal }) {
  cancelled(signal);
  await privateDirectory(directory); await privateDirectory(archivesDirectory);
  if (!Array.isArray(inventory)) unsafe();
  validateExport(inventory.map(file => file.type === 'file' ? { ...file, data: '' } : file));
  let installedBytes = 0;
  for (const file of inventory) {
    cancelled(signal);
    if (file.type !== 'file') continue;
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > DEPENDENCY_FILE_BYTES) unsafe();
    installedBytes += file.bytes;
    if (installedBytes > DEPENDENCY_EXPORT_BYTES) unsafe();
  }
  const rederived = registryPlan(manifest, lock);
  if (plan?.registry !== REGISTRY || canonical(plan.host) !== canonical(HOST)
    || Object.keys(plan).some(key => !['registry', 'host', 'archives', 'excluded', 'unmetPeers'].includes(key))
    || ['archives', 'excluded', 'unmetPeers'].some(key => canonical(plan[key]) !== canonical(rederived[key]))) unsupported();
  const locked = lockedNodes(lock); const excluded = new Set(plan.excluded); const multiplicities = new Map();
  for (const [key, node] of locked) {
    cancelled(signal);
    if (!excluded.has(key)) multiplicities.set(identity(node), (multiplicities.get(identity(node)) ?? 0) + 1);
  }

  const expected = new Map(); let compressed = 0; let expanded = 0; let entries = 0; let expectedEntries = 0;
  for (const [index, entry] of plan.archives.entries()) {
    cancelled(signal);
    const bytes = await regular(retainedArchivePath(archivesDirectory, index), FETCH_LIMITS.archiveBytes);
    compressed += bytes.length;
    if (compressed > FETCH_LIMITS.totalBytes) unsupported();
    const files = registryArchive(bytes, entry);
    for (const file of files) {
      cancelled(signal); expanded += file.data.length; entries++;
      if (expanded > FETCH_LIMITS.expandedBytes || entries > FETCH_LIMITS.entries) unsupported();
    }
    const key = identity(entry);
    if (expected.has(key)) unsupported();
    const tree = await packageTree(files, signal);
    expectedEntries += tree.size;
    if (expectedEntries > FETCH_LIMITS.entries) unsupported();
    expected.set(key, { entry, tree });
  }

  const nodes = new Map(); const copies = new Map(); const containers = new Set(['node_modules', 'node_modules/.bin']);
  for (const file of inventory) {
    cancelled(signal);
    if (file.type !== 'file' || !file.path.endsWith('/package.json')) continue;
    const path = posix.dirname(file.path); const structural = placement(path);
    if (!structural) continue;
    const bytes = await regular(`${directory}/${file.path}`, DEPENDENCY_FILE_BYTES);
    if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) unsafe();
    const pkg = parseDependencyJSON(bytes);
    if (pkg?.name !== structural.name) unsupported();
    const acquired = expected.get(identity(pkg)) ?? unsupported();
    validateRegistryManifest(pkg, acquired.entry);
    if (nodes.has(path)) unsupported();
    const count = (copies.get(identity(pkg)) ?? 0) + 1;
    // Rehoisting may move or collapse locked copies, but cannot justify installing an extra instance.
    if (count > (multiplicities.get(identity(pkg)) ?? 0)) unsupported();
    copies.set(identity(pkg), count);
    nodes.set(path, { path, name: pkg.name, version: pkg.version, metadata: acquired.entry.metadata,
      integrity: acquired.entry.integrity, manifestSha256: hash(bytes), tree: acquired.tree, actual: new Map(), structural,
      ...(pkg.libc === undefined ? {} : { libc: pkg.libc }) });
    for (const container of structural.containers) containers.add(container);
  }
  for (const node of nodes.values()) {
    for (const ancestor of node.structural.roots.slice(0, -1)) if (!nodes.has(ancestor)) unsupported();
  }
  const present = new Set([...nodes.values()].map(identity));
  if (present.size !== expected.size || [...expected.keys()].some(key => !present.has(key))) unsupported();

  let inspected = 0;
  for (const file of inventory) {
    cancelled(signal);
    if (++inspected % 64 === 0) { await yieldToLoop(); cancelled(signal); }
    safePath(file.path);
    if (nodes.has(file.path) || containers.has(file.path)) { if (file.type !== 'directory') unsupported(); continue; }
    if (file.type === 'symlink') {
      // validateExport has already restricted these to safe root .bin shims whose targets are regular files.
      if (!file.path.startsWith('node_modules/.bin/') || !declaredShim(file, nodes)) unsupported();
      continue;
    }
    let owner = posix.dirname(file.path);
    while (owner !== '.' && !nodes.has(owner)) owner = posix.dirname(owner);
    if (owner === '.') unsupported();
    const relative = file.path.slice(owner.length + 1);
    if (relative === 'node_modules' || relative.startsWith('node_modules/')) unsupported();
    const node = nodes.get(owner); const expectedFile = node.tree.get(relative) ?? unsupported();
    if (file.type !== expectedFile.type || (file.type === 'file'
      && (file.bytes !== expectedFile.bytes || file.sha256 !== expectedFile.sha256))) unsafe();
    node.actual.set(relative, file.type);
  }
  for (const node of nodes.values()) if (node.actual.size !== node.tree.size) unsafe();

  const graph = { version: 1, status: 'verified', policy: INSTALLED_GRAPH_POLICY,
    inventoryDigest: hash(JSON.stringify(inventory)), nodes: [], relationships: [], absentOptional: [] };
  let observationBytes = Buffer.byteLength(JSON.stringify(graph));
  const append = (collection, value) => {
    observationBytes += Buffer.byteLength(JSON.stringify(value)) + 1;
    if (observationBytes > DEPENDENCY_RECEIPT_BYTES) unsupported();
    collection.push(value);
  };
  const lookup = (from, name) => {
    let ancestor = from;
    while (ancestor) {
      const candidate = `${ancestor}/node_modules/${name}`;
      if (nodes.has(candidate)) return nodes.get(candidate);
      ancestor = posix.dirname(ancestor);
      // Node skips a candidate whose parent is itself called node_modules.
      if (posix.basename(ancestor) === 'node_modules') ancestor = posix.dirname(ancestor);
      if (ancestor === '.') ancestor = '';
    }
    return nodes.get(`node_modules/${name}`);
  };
  const visited = new Set(); const pending = ['']; let traversed = 0; let edges = 0;
  while (traversed < pending.length) {
    cancelled(signal);
    if (traversed % 64 === 0) { await yieldToLoop(); cancelled(signal); }
    const from = pending[traversed++]; const source = from ? nodes.get(from) : undefined;
    const metadata = source?.metadata ?? manifest;
    const kinds = from ? ['dependencies', 'optionalDependencies', 'peerDependencies'] : ['dependencies', 'devDependencies'];
    for (const kind of kinds) for (const [name, spec] of Object.entries(metadata[kind] ?? {})) {
      cancelled(signal);
      if (++edges % 64 === 0) { await yieldToLoop(); cancelled(signal); }
      const optional = kind === 'optionalDependencies' || (kind === 'peerDependencies' && (metadata.optionalPeers ?? []).includes(name));
      const target = lookup(from, name);
      if (!target) {
        const reason = kind === 'peerDependencies' && optional ? 'optional-peer-absent'
          : kind === 'optionalDependencies' && excludedOptional({ nodes: locked, excluded, source, name, spec }) ? 'non-host-optional' : undefined;
        if (!reason) unsupported();
        append(graph.absentOptional, { from, kind, name, range: spec, reason });
        continue;
      }
      if (target.name !== name || !registrySatisfies(target.version, spec)) unsupported();
      append(graph.relationships, { from, kind, name, range: spec, to: target.path, version: target.version, optional });
      if (!visited.has(target.path)) { visited.add(target.path); pending.push(target.path); }
    }
  }
  if (visited.size !== nodes.size) unsupported();
  for (const node of [...nodes.values()].sort((a, b) => compare(a.path, b.path))) {
    append(graph.nodes, { path: node.path, name: node.name, version: node.version, integrity: node.integrity,
      manifestSha256: node.manifestSha256, ...(node.libc === undefined ? {} : { libc: node.libc }) });
  }
  const edgeOrder = (a, b) => compare(a.from, b.from) || compare(a.kind, b.kind) || compare(a.name, b.name);
  graph.relationships.sort(edgeOrder); graph.absentOptional.sort(edgeOrder);
  await yieldToLoop();
  cancelled(signal);
  return graph;
}
