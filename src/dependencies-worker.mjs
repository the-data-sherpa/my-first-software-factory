// Fixed, read-only sandbox program. All Bun work and caches live on bounded tmpfs.
import { mkdir, cp, readFile, readdir, lstat, readlink, rm, writeFile, access, statfs } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { createSocket } from 'node:dgram';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const fixture = process.argv[2] === 'fixture';
const tcp = await new Promise((resolve) => {
  const socket = createConnection({ host: '127.0.0.1', port: 9 });
  socket.on('error', (error) => resolve(error.code)); socket.on('connect', () => { socket.destroy(); resolve('connected'); });
});
const udp = await new Promise((resolve) => {
  const socket = createSocket('udp4');
  const done = (error) => { try { socket.close(); } catch {} resolve(error?.code ?? 'sent'); };
  socket.on('error', done); socket.send(Buffer.alloc(0), 9, '127.0.0.1', done);
});
let inputReadOnly = false;
try { await writeFile('/input/no-write', 'unsafe'); } catch (error) { inputReadOnly = error.code === 'EROFS'; }
const privatePathsHidden = (await Promise.all(['/home', '/run', '/etc', '/root', '/input/.npmrc', '/input/.env', '/input/bunfig.toml'].map(async (path) => {
  try { await access(path); return false; } catch (error) { return error.code === 'ENOENT'; }
}))).every(Boolean);
const environmentScrubbed = Object.keys(process.env).sort().join(',') === 'HOME,LANG,PATH,PWD,TMPDIR,UV_THREADPOOL_SIZE';
const scratch = await statfs('/tmp'); const scratchBytes = scratch.bsize * scratch.blocks;
const status = await readFile('/proc/self/status', 'utf8');
const noNewPrivileges = /^NoNewPrivs:\s+1$/m.test(status);
const seccomp = /^Seccomp:\s+2$/m.test(status) && /^CapEff:\s+0+$/m.test(status);
const boundary = { tcp, udp, inputReadOnly, privatePathsHidden, environmentScrubbed, scratchBytes, noNewPrivileges, seccomp };
if (tcp !== 'EPERM' || udp !== 'EPERM' || !inputReadOnly || !privatePathsHidden || !environmentScrubbed
  || scratchBytes !== 268435456 || !noNewPrivileges || !seccomp) process.exit(1);
await mkdir('/tmp/home'); await cp('/input', '/tmp/work', { recursive: true });
const install = (args) => {
  const child = spawnSync('/runtime/bun', ['install', '--no-cache', '--backend=copyfile', ...args], {
    cwd: '/tmp/work', env: { HOME: '/tmp/home', PATH: '/runtime:/bin', TMPDIR: '/tmp', LANG: 'C.UTF-8', BUN_INSTALL_CACHE_DIR: '/tmp/cache' },
    encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 100_000,
  });
  // Parent only counts this output; it never persists untrusted package diagnostics.
  process.stdout.write(child.stdout ?? ''); process.stderr.write(child.stderr ?? '');
  if (child.status !== 0 || child.error) process.exit(1);
};
const sentinelNames = ['dependency-install', 'dependency-postinstall', 'dependency-preinstall', 'root-install', 'root-postinstall', 'root-preinstall'];
const sentinels = async () => (await readdir('/tmp/work')).filter((name) => sentinelNames.includes(name)).sort();
let positiveSentinels;
if (fixture) {
  install(['--ignore-scripts']);
  await rm('/tmp/work/node_modules', { recursive: true });
  install(['--frozen-lockfile']);
  positiveSentinels = await sentinels();
  for (const name of positiveSentinels) await rm(`/tmp/work/${name}`);
  await rm('/tmp/work/node_modules', { recursive: true });
}
install(['--frozen-lockfile', '--ignore-scripts']);
const files = [];
async function walk(path = 'node_modules') {
  const info = await lstat(`/tmp/work/${path}`);
  if (info.isDirectory()) {
    files.push({ path, type: 'directory' });
    for (const name of (await readdir(`/tmp/work/${path}`)).sort()) await walk(`${path}/${name}`);
  } else if (info.isFile()) files.push({ path, type: 'file', executable: Boolean(info.mode & 0o111), data: (await readFile(`/tmp/work/${path}`)).toString('base64') });
  else if (info.isSymbolicLink()) files.push({ path, type: 'symlink', target: await readlink(`/tmp/work/${path}`) });
  else process.exit(1);
}
await walk();
const version = spawnSync('/runtime/bun', ['--version'], { encoding: 'utf8', env: {} });
writeFileSync(5, JSON.stringify({ files, boundary, bunVersion: version.stdout.trim(), sentinels: await sentinels(), positiveSentinels,
  lock: (await readFile('/tmp/work/bun.lock')).toString('base64'),
  manifest: (await readFile('/tmp/work/package.json')).toString('base64'),
  npmLock: (await readFile('/tmp/work/package-lock.json')).toString('base64') }));
