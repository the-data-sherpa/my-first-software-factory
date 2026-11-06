// Deliberately small Bun 1.3.14 registry-lock grammar, not a package-manager resolver.
import { createHash } from 'node:crypto';
import { archiveEntries, parseDependencyJSON } from './dependencies-files.mjs';

const fail = () => { throw Object.assign(new Error('Unsupported locked dependency graph.'), { code: 'DEPENDENCIES_UNSUPPORTED' }); };
// npm names may contain dots, but never start with one; scope and name segments are separate placement components.
const namePattern = '(?:@[a-z0-9_-][a-z0-9._-]*/)?[a-z0-9_-][a-z0-9._-]*';
const nameRE = new RegExp(`^${namePattern}$`);
const keyRE = new RegExp(`^${namePattern}(?:/${namePattern})*$`);
// Strict SemVer 2.0 without build metadata. Prerelease identifiers are ordered as SemVer specifies.
const identifier = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const prerelease = `${identifier}(?:\\.${identifier})*`;
const versionRE = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${prerelease}))?$`);
function parseVersion(value) {
  const match = typeof value === 'string' && value.length <= 64 ? versionRE.exec(value) : null;
  if (!match) return undefined;
  const release = match.slice(1, 4).map(Number);
  if (!release.every(Number.isSafeInteger)) return undefined;
  const pre = match[4] === undefined ? [] : match[4].split('.').map((part) => /^\d+$/.test(part) ? Number(part) : part);
  if (pre.some((part) => typeof part === 'number' && !Number.isSafeInteger(part))) return undefined;
  return { release, pre };
}
function compare(a, b) {
  for (let index = 0; index < 3; index++) if (a.release[index] !== b.release[index]) return a.release[index] - b.release[index];
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index++) {
    const x = a.pre[index]; const y = b.pre[index];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    if (typeof x !== typeof y) return typeof x === 'number' ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// Range grammar (observed npm forms only): `||` unions of whitespace-separated comparators, where a comparator is
// `*`, a partial or x-range (`4`, `17.x`, `1.x.x`), `^`/`~` with a partial or full version, `>=` or `<` with a
// numeric partial or full version, or a single hyphen range `A - B`. No `>`, `<=`, `=`, `v`, `~>`, tags, aliases,
// URLs, files, workspaces or build metadata. Semantics follow npm: missing parts lower-bound to zero, upper bounds
// exclude every prerelease of the bound, and a prerelease version satisfies a set only when some comparator in that
// set names a prerelease of the same release triple.
const part = '(?:0|[1-9]\\d*)'; const wild = `(?:${part}|[xX*])`;
const partialRE = new RegExp(`^(${wild})(?:\\.(${wild})(?:\\.(${wild})(?:-(${prerelease}))?)?)?$`);
function partial(text, { numeric = false } = {}) {
  const match = partialRE.exec(text);
  if (!match) fail();
  const parts = match.slice(1, 4).map((value) => value === undefined || /^[xX*]$/.test(value) ? undefined : Number(value));
  const known = parts.findIndex((value) => value === undefined); const count = known === -1 ? 3 : known;
  // A wildcard may not precede a number, and a prerelease needs a full release.
  if (parts.slice(count).some((value) => value !== undefined) || (match[4] !== undefined && count !== 3)
    || (numeric && (count === 0 || match.slice(1, 4).some((value) => value !== undefined && /^[xX*]$/.test(value))))
    || parts.slice(0, count).some((value) => !Number.isSafeInteger(value))) fail();
  const version = parseVersion(`${parts.map((value) => value ?? 0).join('.')}${match[4] === undefined ? '' : `-${match[4]}`}`) ?? fail();
  return { count, version };
}
const bound = (release, pre = []) => ({ release, pre });
const upper = (release, index) => bound(release.map((value, at) => at < index ? value : at === index ? value + 1 : 0), [0]);
function comparators(token) {
  if (token === '*') return [];
  let match;
  if ((match = /^(>=|<)(.+)$/.exec(token))) {
    const { count, version } = partial(match[2], { numeric: true });
    return match[1] === '>=' ? [['>=', version]] : [['<', count === 3 ? version : bound(version.release, [0])]];
  }
  if ((match = /^([~^])(.+)$/.exec(token))) {
    const { count, version } = partial(match[2]); const [major, minor] = version.release;
    if (!count) fail();
    // ^ keeps the first non-zero part fixed among the specified parts; ~ fixes minor when given, otherwise major.
    const fixed = match[1] === '~' ? (count > 1 ? 1 : 0) : major !== 0 || count === 1 ? 0 : minor !== 0 || count === 2 ? 1 : 2;
    return [['>=', version], ['<', upper(version.release, fixed)]];
  }
  const { count, version } = partial(token);
  if (count === 3) return [['=', version]];
  return count ? [['>=', version], ['<', upper(version.release, count - 1)]] : [];
}
function parseRange(spec) {
  if (typeof spec !== 'string' || spec.length > 256 || !/^[0-9A-Za-z.*^~<>=|\- ]+$/.test(spec)) fail();
  const sets = spec.split('||').map((text) => text.trim());
  if (sets.length > 16) fail();
  return sets.map((text) => {
    let match;
    if ((match = /^(\S+) - (\S+)$/.exec(text))) {
      const low = partial(match[1]); const high = partial(match[2]);
      if (!low.count || !high.count) fail();
      return [['>=', low.version], ['<', high.count === 3 ? null : upper(high.version.release, high.count - 1)], ['<=', high.count === 3 ? high.version : null]]
        .filter(([, version]) => version);
    }
    // Comparator operators may be separated from their version by spaces (`>= 4.21.0`).
    const tokens = text.replace(/(>=|<)\s+/g, '$1').split(/\s+/);
    if (!text || tokens.length > 4) fail();
    return tokens.flatMap(comparators);
  });
}
function satisfies(version, sets) {
  return sets.some((set) => set.every(([operator, bound]) => {
    const order = compare(version, bound);
    return operator === '>=' ? order >= 0 : operator === '<' ? order < 0 : operator === '<=' ? order <= 0 : order === 0;
  }) && (!version.pre.length || set.some(([, bound]) => bound.pre.length && bound.release.every((value, index) => value === version.release[index]))));
}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => { if (!object(value) || Object.keys(value).some((key) => !keys.includes(key))) fail(); };
export const canonical = (value) => JSON.stringify(value, function (key, item) {
  return object(item) ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]])) : item;
});
export function parseBunLock(bytes) {
  // Accept emitted JSON with trailing commas, but not comments or arbitrary JSONC syntax.
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return parseDependencyJSON(Buffer.from(text.replace(/"(?:\\.|[^"\\])*"|,(?=\s*[}\]])/g, (token) => token === ',' ? '' : token)));
}
function dependencies(value = {}) {
  if (!object(value) || Object.keys(value).length > 2000) fail();
  for (const [name, spec] of Object.entries(value)) if (!nameRE.test(name) || name.length > 150) fail(); else parseRange(spec);
  return value;
}

// Explicit preparation host: the factory's pinned linux x86-64 glibc runtime (see dependencies-process libraries).
// Bun lock platform metadata is a single value or a list; `none` is Bun's encoding for no supported value.
export const HOST = Object.freeze({ os: 'linux', cpu: 'x64' });
const platforms = { os: ['aix', 'android', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32'], cpu: ['arm', 'arm64', 'ia32', 'ppc64', 's390x', 'x64'] };
function platform(value, key) {
  if (value === undefined) return undefined;
  if (value === 'none') return [];
  const values = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(values) || !values.length || new Set(values).size !== values.length || values.some((item) => !platforms[key].includes(item))) fail();
  return values;
}
const binPath = (path) => typeof path === 'string' && !path.startsWith('/')
  && /^(?:\.\/)?[A-Za-z0-9_./-]+$/.test(path) && !path.split('/').includes('..');
function metadata(value) {
  only(value, ['dependencies', 'optionalDependencies', 'peerDependencies', 'optionalPeers', 'os', 'cpu', 'bin']);
  const edges = {};
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) edges[key] = dependencies(value[key]);
  const names = Object.values(edges).flatMap(Object.keys);
  if (new Set(names).size !== names.length) fail(); // One package name, one edge kind.
  const optionalPeers = value.optionalPeers ?? [];
  if (!Array.isArray(optionalPeers) || new Set(optionalPeers).size !== optionalPeers.length
    || optionalPeers.some((name) => typeof name !== 'string' || !Object.hasOwn(edges.peerDependencies, name))) fail();
  if (value.bin !== undefined && !(binPath(value.bin) || (object(value.bin) && Object.keys(value.bin).length
    && Object.entries(value.bin).every(([name, path]) => /^[a-zA-Z0-9_-]+$/.test(name) && binPath(path))))) fail();
  const os = platform(value.os, 'os'); const cpu = platform(value.cpu, 'cpu');
  return { ...edges, optionalPeers, host: (!os || os.includes(HOST.os)) && (!cpu || cpu.includes(HOST.cpu)) };
}

/**
 * Plans the exact host acquisition for a Bun 1.3.14 hoisted lock. Every locked placement must be either planned
 * (reached from the root through dependencies, required peers, or host-applicable optional dependencies) or
 * excluded as part of a non-host optional closure. Each relationship is resolved with Node's ancestor lookup
 * and checked against its declared range.
 */
export function registryPlan(manifest, lock) {
  only(lock, ['lockfileVersion', 'configVersion', 'workspaces', 'trustedDependencies', 'packages']);
  // configVersion 0 and 1 both select Bun's hoisted layout for a single root package with no workspaces.
  if (lock.lockfileVersion !== 1 || ![0, 1].includes(lock.configVersion)) fail();
  only(lock.workspaces, ['']);
  only(lock.workspaces[''], ['name', 'version', 'dependencies', 'devDependencies']);
  for (const key of ['optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies', 'os', 'cpu', 'libc']) if (manifest[key]) fail();
  for (const key of ['dependencies', 'devDependencies']) {
    dependencies(manifest[key]);
    if (canonical(manifest[key] ?? {}) !== canonical(lock.workspaces[''][key] ?? {})) fail();
  }
  const rootNames = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
  if (new Set(rootNames).size !== rootNames.length) fail();
  if (lock.workspaces[''].name !== manifest.name || (lock.workspaces[''].version !== undefined && lock.workspaces[''].version !== manifest.version)) fail();
  const trusted = (value) => {
    if (!Array.isArray(value) || value.some((name) => typeof name !== 'string' || !nameRE.test(name)) || new Set(value).size !== value.length) fail();
    return [...value].sort();
  };
  if (canonical(trusted(manifest.trustedDependencies ?? [])) !== canonical(trusted(lock.trustedDependencies ?? []))) fail();
  if (!object(lock.packages) || !Object.keys(lock.packages).length || Object.keys(lock.packages).length > 2000) fail();
  const packages = new Map(); const archives = new Map();
  for (const [key, tuple] of Object.entries(lock.packages)) {
    if (key.length > 500 || !keyRE.test(key) || !Array.isArray(tuple) || tuple.length !== 4 || tuple[1] !== '') fail();
    const at = typeof tuple[0] === 'string' ? tuple[0].lastIndexOf('@') : -1;
    const name = tuple[0]?.slice(0, at); const version = tuple[0]?.slice(at + 1);
    if (!nameRE.test(name) || name.length > 150 || !parseVersion(version) || key.match(new RegExp(namePattern, 'g')).at(-1) !== name
      || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(tuple[3])) fail();
    const entry = { name, version, integrity: tuple[3], metadata: tuple[2],
      path: `/${name}/-/${name.split('/').at(-1)}-${version}.tgz`, cachePath: `${name}@${version}@@@1` };
    const id = `${name}@${version}`;
    if (archives.has(id) && canonical(archives.get(id)) !== canonical(entry)) fail();
    archives.set(id, entry); packages.set(key, { entry, version: parseVersion(version), ...metadata(tuple[2]) });
  }
  // Bun lock keys encode hoisted node_modules placements, without literal node_modules components.
  function locate(parent, name) {
    let ancestor = parent; let key;
    while (ancestor) {
      if (packages.has(`${ancestor}/${name}`)) { key = `${ancestor}/${name}`; break; }
      ancestor = ancestor.slice(0, -(packages.get(ancestor).entry.name.length + 1));
    }
    key ??= name;
    if (!packages.has(key)) return undefined;
    if (packages.get(key).entry.name !== name) fail();
    return key;
  }
  const satisfied = (key, spec) => satisfies(packages.get(key).version, parseRange(spec));
  const resolve = (parent, name, spec) => { const key = locate(parent, name); if (key === undefined || !satisfied(key, spec)) fail(); return key; };
  const planned = new Set(); const pending = []; const nonHostOptional = []; const unmetPeers = [];
  const plan = (key) => { if (!packages.get(key).host) fail(); if (!planned.has(key)) { planned.add(key); pending.push(key); } };
  for (const [name, spec] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) plan(resolve('', name, spec));
  while (pending.length) {
    const key = pending.pop(); const node = packages.get(key);
    for (const [name, spec] of Object.entries(node.dependencies)) plan(resolve(key, name, spec));
    for (const [name, spec] of Object.entries(node.optionalDependencies)) {
      const target = resolve(key, name, spec);
      if (packages.get(target).host) plan(target); else nonHostOptional.push(target);
    }
    for (const [name, spec] of Object.entries(node.peerDependencies)) {
      if (node.optionalPeers.includes(name)) continue;
      const provider = locate(key, name) ?? fail();
      if (satisfied(provider, spec)) plan(provider);
      else unmetPeers.push({ placement: key, peer: name, range: spec, provider, version: packages.get(provider).entry.version });
    }
  }
  // Unapproved compatibility candidate: an out-of-range peer never causes acquisition.
  // Its provider must already be planned through satisfied relationships; pinned-Bun proof and an owner policy decision remain required.
  for (const { provider } of unmetPeers) if (!planned.has(provider)) fail();
  // Optional peers are constraints only: a locked provider must be installed here and satisfy the declared range.
  for (const key of planned) {
    const node = packages.get(key);
    for (const name of node.optionalPeers) {
      const provider = locate(key, name);
      if (provider !== undefined && (!planned.has(provider) || !satisfied(provider, node.peerDependencies[name]))) fail();
    }
  }
  // A non-host optional target and everything only it reaches is locked but never installed on this host.
  const excluded = new Set();
  for (const start of nonHostOptional) {
    const walk = [start];
    while (walk.length) {
      const key = walk.pop();
      if (planned.has(key) || excluded.has(key)) continue;
      excluded.add(key); const node = packages.get(key);
      for (const kind of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
        for (const [name, spec] of Object.entries(node[kind])) {
          if (kind !== 'peerDependencies') walk.push(resolve(key, name, spec));
          else if (!node.optionalPeers.includes(name)) { const provider = locate(key, name) ?? fail(); if (satisfied(provider, spec)) walk.push(provider); }
        }
      }
    }
  }
  if (planned.size + excluded.size !== packages.size) fail(); // No unexplained orphan may be locked or requested.
  const ids = new Set([...planned].map((key) => `${packages.get(key).entry.name}@${packages.get(key).entry.version}`));
  const result = { archives: [...ids].map((id) => archives.get(id)).sort((a, b) => a.path.localeCompare(b.path, 'en')),
    excluded: [...excluded].sort((a, b) => a.localeCompare(b, 'en')),
    unmetPeers: unmetPeers.sort((a, b) => `${a.placement}\0${a.peer}`.localeCompare(`${b.placement}\0${b.peer}`, 'en')) };
  if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) fail();
  return result;
}

// A published manifest must declare exactly the relationships, platforms, and bins its lock tuple records.
const binMap = (bin, name) => typeof bin === 'string' ? { [name.split('/').at(-1)]: bin } : bin ?? {};
const binsMatch = (archive, locked, name) => canonical(Object.fromEntries(Object.entries(binMap(archive, name)).map(([key, path]) => [key, String(path).replace(/^\.\//, '')])))
  === canonical(Object.fromEntries(Object.entries(binMap(locked, name)).map(([key, path]) => [key, path.replace(/^\.\//, '')])));
export function registryArchive(bytes, entry) {
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== entry.integrity) {
    throw Object.assign(new Error('Locked archive integrity mismatch.'), { code: 'DEPENDENCIES_INTEGRITY' });
  }
  const { manifest, files } = archiveEntries(bytes);
  const locked = entry.metadata;
  if (manifest.name !== entry.name || manifest.version !== entry.version) fail();
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) if (canonical(manifest[key] ?? {}) !== canonical(locked[key] ?? {})) fail();
  const meta = manifest.peerDependenciesMeta ?? {};
  if (!object(meta) || Object.values(meta).some((value) => !object(value) || Object.keys(value).some((key) => key !== 'optional') || typeof value.optional !== 'boolean')
    || canonical(Object.keys(meta).filter((name) => meta[name].optional).sort()) !== canonical([...(locked.optionalPeers ?? [])].sort())) fail();
  for (const key of ['os', 'cpu']) {
    const values = (value) => value === undefined ? undefined : [...(typeof value === 'string' ? [value] : value)].sort();
    if (canonical(values(manifest[key])) !== canonical(values(locked[key]))) fail();
  }
  if (!(manifest.bin === undefined || typeof manifest.bin === 'string' || object(manifest.bin))
    || !binsMatch(manifest.bin, locked.bin, entry.name) || manifest.directories?.bin !== undefined) fail();
  for (const key of ['devDependencies', 'bundledDependencies', 'bundleDependencies',
    'workspaces', 'patchedDependencies', 'overrides', 'resolutions', 'publishConfig', 'config', '_auth', '_authToken', 'libc']) {
    if (manifest[key] && Object.keys(manifest[key]).length) fail();
  }
  return files;
}
