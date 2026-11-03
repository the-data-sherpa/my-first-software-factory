// Deliberately small Bun 1.3.14 registry-lock grammar, not a package-manager resolver.
import { createHash } from 'node:crypto';
import { archiveEntries, parseDependencyJSON } from './dependencies-files.mjs';

const fail = () => { throw Object.assign(new Error('Unsupported locked dependency graph.'), { code: 'DEPENDENCIES_UNSUPPORTED' }); };
const namePattern = '(?:@[a-z0-9_-]+/)?[a-z0-9_-]+';
const nameRE = new RegExp(`^${namePattern}$`);
const keyRE = new RegExp(`^${namePattern}(?:/${namePattern})*$`);
const versionRE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const versionOK = (value) => typeof value === 'string' && value.length <= 64 && versionRE.test(value)
  && value.split('.').every((part) => Number.isSafeInteger(Number(part)));
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
  for (const [name, spec] of Object.entries(value)) {
    if (!nameRE.test(name) || name.length > 150 || typeof spec !== 'string' || !versionOK(spec.replace(/^[~^]/, ''))) fail();
  }
  return value;
}
function matches(version, spec) {
  if (!['^', '~'].includes(spec[0])) return version === spec;
  const v = version.split('.').map(Number); const s = spec.slice(1).split('.').map(Number);
  const compare = v[0] - s[0] || v[1] - s[1] || v[2] - s[2];
  if (compare < 0 || v[0] !== s[0]) return false;
  return spec[0] === '~' || s[0] === 0 ? v[1] === s[1] && (spec[0] === '~' || s[1] !== 0 || v[2] === s[2]) : true;
}
export function registryPlan(manifest, lock) {
  only(lock, ['lockfileVersion', 'configVersion', 'workspaces', 'trustedDependencies', 'packages']);
  if (lock.lockfileVersion !== 1 || lock.configVersion !== 1) fail();
  only(lock.workspaces, ['']);
  only(lock.workspaces[''], ['name', 'version', 'dependencies', 'devDependencies']);
  for (const key of ['optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies', 'os', 'cpu', 'libc']) if (manifest[key]) fail();
  for (const key of ['dependencies', 'devDependencies']) {
    dependencies(manifest[key]);
    if (canonical(manifest[key] ?? {}) !== canonical(lock.workspaces[''][key] ?? {})) fail();
  }
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
    if (!nameRE.test(name) || name.length > 150 || !versionOK(version) || (key !== name && !key.endsWith(`/${name}`))
      || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(tuple[3])) fail();
    only(tuple[2], ['dependencies', 'bin']); dependencies(tuple[2].dependencies);
    if (tuple[2].bin !== undefined && (!object(tuple[2].bin) || Object.entries(tuple[2].bin).some(([name, path]) =>
      !/^[a-zA-Z0-9_-]+$/.test(name) || typeof path !== 'string' || !/^(?:\.\/)?[A-Za-z0-9_./-]+$/.test(path) || path.split('/').includes('..')))) fail();
    const entry = { name, version, integrity: tuple[3], metadata: tuple[2],
      path: `/${name}/-/${name.split('/').at(-1)}-${version}.tgz`, cachePath: `${name}@${version}@@@1` };
    const id = `${name}@${version}`;
    if (archives.has(id) && canonical(archives.get(id)) !== canonical(entry)) fail();
    archives.set(id, entry); packages.set(key, entry);
  }
  const reached = new Set();
  function visit(parent, edges) {
    for (const [name, spec] of Object.entries(edges ?? {})) {
      // Bun lock keys encode nested package placements, without literal node_modules components.
      let ancestor = parent; let key;
      while (ancestor) {
        if (packages.has(`${ancestor}/${name}`)) { key = `${ancestor}/${name}`; break; }
        const entry = packages.get(ancestor); ancestor = entry ? ancestor.slice(0, -(entry.name.length + 1)) : '';
      }
      key ??= name;
      const entry = packages.get(key);
      if (!entry || !matches(entry.version, spec)) fail();
      if (!reached.has(key)) { reached.add(key); visit(key, entry.metadata.dependencies); }
    }
  }
  visit('', manifest.dependencies); visit('', manifest.devDependencies);
  if (reached.size !== packages.size) fail(); // No orphan archives may be requested.
  const plan = [...archives.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (Buffer.byteLength(JSON.stringify(plan)) > 1024 * 1024) fail();
  return plan;
}
export function registryArchive(bytes, entry) {
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== entry.integrity) {
    throw Object.assign(new Error('Locked archive integrity mismatch.'), { code: 'DEPENDENCIES_INTEGRITY' });
  }
  const { manifest, files } = archiveEntries(bytes);
  if (manifest.name !== entry.name || manifest.version !== entry.version) fail();
  for (const key of ['dependencies', 'bin']) if (canonical(manifest[key] ?? {}) !== canonical(entry.metadata[key] ?? {})) fail();
  for (const key of ['devDependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies',
    'workspaces', 'patchedDependencies', 'overrides', 'resolutions', 'publishConfig', 'config', '_auth', '_authToken', 'os', 'cpu', 'libc']) {
    if (manifest[key] && Object.keys(manifest[key]).length) fail();
  }
  return files;
}
