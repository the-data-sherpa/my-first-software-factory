// Private implementation helper. Paths are walked through pinned directory descriptors;
// no realpath/check-then-open shortcut and no following repository symlinks.
import { constants } from 'node:fs';
import { open, lstat, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const denied = (name) => name === '.git' || name === 'node_modules' || name === 'ownership.json'
  || name.startsWith('.factory') || name.startsWith('.ownership') || /^\.env(?:\.|$)/.test(name)
  || ['.npmrc', '.yarnrc', '.yarnrc.yml', 'bunfig.toml'].includes(name);
function reject() { const error = new Error('Only owned regular worktree files are available.'); error.code = 'UNSAFE_PATH'; throw error; }
const flags = constants.O_NOFOLLOW | constants.O_NONBLOCK;
function owned(info, directory = false) {
  if (info.uid !== process.getuid() || (info.mode & 0o022) || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)) reject();
}
export async function privateRoot(path) {
  if (typeof path !== 'string' || resolve(path) !== path) reject();
  let current = '/';
  for (const part of path.split('/').filter(Boolean)) {
    current = join(current, part);
    if (!(await lstat(current)).isDirectory()) reject(); // Symlink ancestors are not allowed.
  }
  const root = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | flags);
  try { owned(await root.stat(), true); return root; } catch (error) { await root.close(); throw error; }
}
export function parts(path, protectedPaths = []) {
  if (typeof path !== 'string' || path.length > 4096 || path.includes('\0') || path.includes('\\')) reject();
  const names = path.split('/');
  if (names.some((name) => !name || name === '.' || name === '..' || denied(name))
    || protectedPaths.some((entry) => path === entry || path.startsWith(`${entry}/`))) reject();
  return names;
}
export async function withFile(root, path, protectedPaths, write, callback) {
  const names = parts(path, protectedPaths);
  const directories = [];
  let parent = root;
  try {
    for (const name of names.slice(0, -1)) {
      parent = await open(`/proc/self/fd/${parent.fd}/${name}`, constants.O_RDONLY | constants.O_DIRECTORY | flags);
      directories.push(parent); owned(await parent.stat(), true);
    }
    const file = await open(`/proc/self/fd/${parent.fd}/${names.at(-1)}`,
      flags | (write ? constants.O_WRONLY | constants.O_CREAT : constants.O_RDONLY), 0o600);
    try { owned(await file.stat()); return await callback(file); } finally { await file.close(); }
  } catch (error) {
    if (['ELOOP', 'ENOTDIR', 'ENXIO'].includes(error.code)) reject();
    throw error;
  } finally { for (const directory of directories.reverse()) await directory.close(); }
}
export async function snapshot(root, destination, protectedPaths) {
  await mkdir(destination, { mode: 0o700 });
  const hash = createHash('sha256');
  let bytes = 0; let entries = 0;
  async function copy(directory, relative = '') {
    const names = (await readdir(`/proc/self/fd/${directory.fd}`)).sort();
    for (const name of names) {
      const path = relative ? `${relative}/${name}` : name;
      if (denied(name) || protectedPaths.some((entry) => path === entry || path.startsWith(`${entry}/`))) continue;
      if (++entries > 20_000) reject();
      const file = await open(`/proc/self/fd/${directory.fd}/${name}`, flags | constants.O_RDONLY);
      try {
        const info = await file.stat();
        if (info.isDirectory()) {
          owned(info, true); await mkdir(join(destination, path), { mode: 0o700 });
          hash.update(`directory:${JSON.stringify(path)}\n`); await copy(file, path);
        } else {
          owned(info); bytes += info.size;
          if (info.size > 8 * 1024 ** 2 || bytes > 128 * 1024 ** 2) reject();
          // Bound even a file concurrently enlarged by an operator outside the factory.
          const buffer = Buffer.alloc(info.size + 1);
          let length = 0;
          while (length < buffer.length) {
            const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
            if (!bytesRead) break;
            length += bytesRead;
          }
          if (length !== info.size) reject();
          const data = buffer.subarray(0, length);
          hash.update(`file:${JSON.stringify(path)}:${info.mode & 0o111}:${length}\n`); hash.update(data);
          await writeFile(join(destination, path), data, { flag: 'wx', mode: (info.mode & 0o111) ? 0o500 : 0o400 });
        }
      } finally { await file.close(); }
    }
  }
  await copy(root);
  return hash.digest('hex');
}
