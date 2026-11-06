import { constants } from 'node:fs';
import { open, lstat, readdir, mkdir, writeFile, chmod, readlink, symlink, rename } from 'node:fs/promises';
import { resolve, dirname, join, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const DEPENDENCY_FILE_BYTES = 8 * 1024 ** 2;
export const DEPENDENCY_EXPORT_BYTES = 64 * 1024 ** 2;
export const DEPENDENCY_RECEIPT_BYTES = 16 * 1024 ** 2;

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const unsafe = () => { throw Object.assign(new Error('Unsafe dependency input.'), { code: 'DEPENDENCIES_UNSAFE' }); };
export async function directory(path) {
  if (typeof path !== 'string' || resolve(path) !== path) unsafe();
  let at = '/';
  for (const part of path.split('/').filter(Boolean)) {
    at = join(at, part); const info = await lstat(at);
    if (!info.isDirectory()) unsafe();
  }
  const info = await lstat(path);
  if (info.uid !== process.getuid() || info.mode & 0o077) unsafe();
  return info;
}
export async function regular(path, max = 128 * 1024 ** 2) {
  await directory(dirname(path));
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || info.mode & 0o022 || info.size > max) unsafe();
    const bytes = Buffer.alloc(info.size + 1); let length = 0;
    while (length < bytes.length) { const read = await file.read(bytes, length, bytes.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
    if (length !== info.size) unsafe();
    return bytes.subarray(0, length);
  } finally { await file.close(); }
}
export async function save(path, object) {
  await writeFile(`${path}.pending`, `${JSON.stringify(object)}\n`, { flag: 'wx', mode: 0o600 });
  const file = await open(`${path}.pending`, 'r'); try { await file.sync(); } finally { await file.close(); }
  await rename(`${path}.pending`, path);
}
const badName = (name) => /^(?:\.env(?:\.|$)|\.npmrc$|\.yarnrc(?:\.|$)|bunfig\.toml$|\.git$)/i.test(name);
export function safePath(path) {
  if (typeof path !== 'string' || path.length > 1024 || !/^[A-Za-z0-9_@.+/-]+$/.test(path)
    || path.split('/').some((part) => !part || part === '.' || part === '..' || badName(part))) unsafe();
  return path;
}

// Reject duplicate object keys before either Bun or Node can interpret ambiguous inputs differently.
export function parseDependencyJSON(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const stack = [];
  for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]]/g)) {
    const token = match[0];
    if (token === '{' || token === '[') stack.push(token === '{' ? new Set() : null);
    else if (token === '}' || token === ']') stack.pop();
    else if (/^\s*:/.test(text.slice(match.index + token.length))) {
      const keys = stack.at(-1); const key = JSON.parse(token);
      if (!keys || keys.has(key)) unsafe(); keys.add(key);
    }
  }
  return JSON.parse(text);
}

// Narrow ustar admission: no links, devices, pax extensions, credentials, or path escapes.
export function archiveEntries(archive) {
  const tar = gunzipSync(archive, { maxOutputLength: 32 * 1024 ** 2 });
  const seen = new Map(); const files = []; let manifest; let ended = false;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512); offset += 512;
    if (header.every((byte) => byte === 0)) { if (tar.subarray(offset).some((byte) => byte !== 0)) unsafe(); ended = true; break; }
    const text = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/s, '');
    const sizeText = text(124, 136).trim();
    if (!/^[0-7]+$/.test(sizeText)) unsafe();
    const size = parseInt(sizeText, 8); const type = text(156, 157);
    if (text(257, 263) !== 'ustar' || text(263, 265) !== '00' || text(157, 257)
      || !/^[0-7]+$/.test(text(100, 108).trim()) || parseInt(text(100, 108).trim(), 8) > 0o777) unsafe();
    let name = text(0, 100); const prefix = text(345, 500);
    if (prefix) name = `${prefix}/${name}`;
    if (type === '5') name = name.replace(/\/$/, '');
    safePath(name);
    if ((!name.startsWith('package/') && name !== 'package') || seen.has(name) || !['', '0', '5'].includes(type)
      || (type === '5' && size !== 0) || size > 8 * 1024 ** 2 || offset + size > tar.length) unsafe();
    let checksum = 0; for (let index = 0; index < 512; index++) checksum += index >= 148 && index < 156 ? 32 : header[index];
    if (parseInt(text(148, 156).trim(), 8) !== checksum) unsafe();
    seen.set(name, type === '5' ? 'directory' : 'file');
    if (seen.size > 20000 || (name === 'package' && type !== '5')) unsafe();
    const data = tar.subarray(offset, offset + size);
    if (name === 'package/package.json' && type !== '5') manifest = parseDependencyJSON(data);
    if (name !== 'package') files.push({ path: name.slice(8), type: type === '5' ? 'directory' : 'file',
      executable: Boolean(parseInt(text(100, 108).trim(), 8) & 0o111), data });
    offset += Math.ceil(size / 512) * 512;
  }
  if (!ended || !manifest || typeof manifest !== 'object' || Array.isArray(manifest)) unsafe();
  for (const name of seen.keys()) {
    let parent = posix.dirname(name);
    while (parent !== '.') { if (seen.has(parent) && seen.get(parent) !== 'directory') unsafe(); parent = posix.dirname(parent); }
  }
  return { manifest, files };
}
export function archiveManifest(archive) {
  const { manifest } = archiveEntries(archive);
  // The original committed-tarball mode remains direct-only.
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'workspaces', 'patchedDependencies', 'overrides', 'resolutions', 'publishConfig', 'config', '_auth', '_authToken']) {
    if (manifest[key] && Object.keys(manifest[key]).length) unsafe();
  }
  return manifest;
}

export function validateExport(files) {
  if (!Array.isArray(files) || !files.length || files.length > 20000) unsafe();
  const paths = new Map(); let bytes = 0;
  for (const file of files) {
    safePath(file.path);
    if ((file.path !== 'node_modules' && !file.path.startsWith('node_modules/')) || paths.has(file.path)) unsafe();
    if (file.type === 'file') {
      if (typeof file.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) unsafe();
      bytes += Buffer.byteLength(file.data, 'base64');
      if (Buffer.byteLength(file.data, 'base64') > DEPENDENCY_FILE_BYTES || bytes > DEPENDENCY_EXPORT_BYTES) unsafe();
    } else if (!['directory', 'symlink'].includes(file.type)) unsafe();
    paths.set(file.path, file);
  }
  if (paths.get('node_modules')?.type !== 'directory') unsafe();
  for (const file of files) {
    if (file.path !== 'node_modules' && paths.get(posix.dirname(file.path))?.type !== 'directory') unsafe();
    if (file.type === 'symlink') {
      // Bun bin shims only; no package-provided links or symlink ancestors.
      if (!/^node_modules\/\.bin\/[A-Za-z0-9_-]+$/.test(file.path) || typeof file.target !== 'string'
        || !/^\.\.\/[A-Za-z0-9_@.+/-]+$/.test(file.target)) unsafe();
      const target = posix.normalize(posix.join(posix.dirname(file.path), file.target));
      if (!target.startsWith('node_modules/') || paths.get(target)?.type !== 'file') unsafe();
    }
  }
}
export async function seal(destination, files, cancelled = () => {}) {
  cancelled(); validateExport(files); await mkdir(destination, { mode: 0o700 });
  const inventory = [];
  for (const file of files.filter((file) => file.type === 'directory').sort((a, b) => a.path.length - b.path.length)) { cancelled(); await mkdir(join(destination, file.path), { mode: 0o700 }); }
  for (const file of files) {
    cancelled();
    const path = join(destination, file.path);
    if (file.type === 'file') {
      const data = Buffer.from(file.data, 'base64'); const mode = file.executable ? 0o500 : 0o400;
      await writeFile(path, data, { flag: 'wx', mode }); inventory.push({ path: file.path, type: 'file', mode, bytes: data.length, sha256: hash(data) });
    } else if (file.type === 'symlink') { await symlink(file.target, path); inventory.push({ path: file.path, type: file.type, target: file.target }); }
    else inventory.push({ path: file.path, type: file.type, mode: 0o500 });
  }
  for (const file of files.filter((file) => file.type === 'directory')) { cancelled(); await chmod(join(destination, file.path), 0o500); }
  await chmod(destination, 0o500);
  return inventory.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
export async function verifyInventory(destination, inventory) {
  await directory(destination);
  if (((await lstat(destination)).mode & 0o777) !== 0o500) unsafe();
  const actual = [];
  async function walk(path = '') {
    for (const name of (await readdir(join(destination, path))).sort()) {
      const relative = path ? `${path}/${name}` : name; safePath(relative);
      const absolute = join(destination, relative); const info = await lstat(absolute);
      if (info.uid !== process.getuid()) unsafe();
      if (info.isDirectory()) { if ((info.mode & 0o777) !== 0o500) unsafe(); actual.push({ path: relative, type: 'directory', mode: 0o500 }); await walk(relative); }
      else if (info.isFile()) { const data = await regular(absolute, DEPENDENCY_FILE_BYTES); actual.push({ path: relative, type: 'file', mode: info.mode & 0o777, bytes: data.length, sha256: hash(data) }); }
      else if (info.isSymbolicLink()) actual.push({ path: relative, type: 'symlink', target: await readlink(absolute) });
      else unsafe();
      if (actual.length > 20000) unsafe();
    }
  }
  await walk(); actual.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (JSON.stringify(actual) !== JSON.stringify(inventory)) unsafe();
  // Revalidate target/type rules from trusted inventory too, never follow symlinks during hashing.
  validateExport(actual.map((file) => file.type === 'file' ? { ...file, data: '' } : file));
}
