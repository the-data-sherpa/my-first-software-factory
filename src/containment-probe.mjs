// Factory-owned fixed executable. Mounted read-only, never loaded from the worktree.
import { readFile, access, writeFile, statfs, open } from 'node:fs/promises';
import { once } from 'node:events';
import { connect, createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { createSocket } from 'node:dgram';

async function absent(path) { try { await access(path); return false; } catch (error) { return error.code === 'ENOENT'; } }
async function deniedWrite(path) {
  try { await writeFile(path, 'must not write'); return false; } catch (error) { return ['EROFS', 'EACCES'].includes(error.code); }
}
async function deniedNetwork(address) {
  return new Promise((resolve) => {
    const socket = connect(address); const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 1000);
    socket.on('connect', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
    socket.on('error', (error) => { clearTimeout(timer); resolve(error.code === 'EPERM'); });
  });
}
if (process.argv[2] === 'boundary') {
  const input = JSON.parse(await readFile('/input.json', 'utf8'));
  const hidden = (await Promise.all(['/home', '/run', '/sys', '/etc', '/root', '/work/.git', '/work/.factory-owner',
    '/work/ownership.json', input.sentinel, input.socket].map(absent))).every(Boolean);
  const environmentScrubbed = Object.keys(process.env).sort().join(',') === 'HOME,LANG,NODE_ENV,PATH,PWD,TMPDIR,UV_THREADPOOL_SIZE'
    && process.env.HOME === '/tmp' && !process.env.FACTORY_DUMMY_SECRET;
  const networkDenied = (await Promise.all([input.tcp, input.abstract, input.socket].map(deniedNetwork))).every(Boolean)
    && await new Promise((resolve) => {
      const server = createServer(); server.on('error', (error) => resolve(error.code === 'EPERM'));
      server.listen({ host: '127.0.0.1', port: 0 }, () => server.close(() => resolve(false)));
    });
  const udpDenied = await new Promise((resolve) => {
    const udp = createSocket('udp4');
    const finish = (error) => { try { udp.close(); } catch { /* The sandbox denied socket creation. */ } resolve(error?.code === 'EPERM'); };
    udp.on('error', finish); udp.send(Buffer.alloc(0), input.udp.port, input.udp.host, finish);
  });
  const readOnly = (await Promise.all(['/work/must-not-write', '/must-not-write', '/dev/shm/must-not-write',
    '/runtime/must-not-write', '/usr/lib/must-not-write'].map(deniedWrite))).every(Boolean);
  const scratch = await statfs('/tmp');
  const status = await readFile('/proc/self/status', 'utf8');
  await writeFile('/tmp/scratch-proof', 'scratch is writable');
  console.log(JSON.stringify({ hidden, environmentScrubbed, environmentKeys: Object.keys(process.env).sort(), networkDenied, udpDenied, readOnly,
    scratchBytes: scratch.bsize * scratch.blocks, noNewPrivileges: /^NoNewPrivs:\s+1$/m.test(status),
    seccomp: /^Seccomp:\s+2$/m.test(status) && /^CapEff:\s+0+$/m.test(status) }));
} else if (process.argv[2] === 'pass') {
  console.log('controlled fixed check passed');
} else if (process.argv[2] === 'memory') {
  // This fixed command is admitted ONLY in the 192 MiB diagnostic scope.
  // Touch at most 512 MiB, never run an unbounded host stressor.
  const buffers = [];
  await new Promise((resolve) => setTimeout(resolve, 250));
  for (let index = 0; index < 64; index++) buffers.push(Buffer.alloc(8 * 1024 ** 2, 'm'));
  console.log(buffers.length); process.exitCode = 2; // Reaching here means the limit was not demonstrated.
} else if (process.argv[2] === 'scratch') {
  const file = await open('/tmp/fill', 'w');
  try {
    for (let index = 0; index < 17; index++) await file.write(Buffer.alloc(65536, 'x'));
    process.exitCode = 2; // Expected ENOSPC before exceeding the 1 MiB test-only tmpfs.
  } catch (error) {
    if (error.code !== 'ENOSPC') throw error;
    console.log('controlled tmpfs ENOSPC'); process.exitCode = 73;
  } finally { await file.close(); }
} else if (process.argv[2] === 'pids') {
  const children = []; const closed = [];
  try {
    for (let index = 0; index < 64; index++) {
      const child = spawn('/runtime/sleep', ['10'], { stdio: 'ignore' });
      children.push(child); closed.push(new Promise((resolve) => child.on('close', resolve)));
      await once(child, 'spawn');
    }
    process.exitCode = 2;
  } catch (error) {
    if (error.code !== 'EAGAIN') throw error;
    console.log('controlled task EAGAIN'); process.exitCode = 74;
  } finally { for (const child of children) child.kill('SIGKILL'); await Promise.all(closed); }
} else if (process.argv[2] === 'fail') {
  process.exitCode = 7;
} else if (process.argv[2] === 'signal') {
  process.kill(process.pid, 'SIGTERM');
} else if (process.argv[2] === 'output') {
  process.stdout.write(Buffer.alloc(600 * 1024, 'o'));
  process.stderr.write(Buffer.alloc(600 * 1024, 'e'));
  setInterval(() => {}, 1000);
} else if (['hang', 'descendants', 'escaped-child', 'escaped-grandchild'].includes(process.argv[2])) {
  if (process.argv[2] !== 'escaped-grandchild') {
    const child = spawn('/runtime/node', ['/probe.mjs', process.argv[2] === 'escaped-child' ? 'escaped-grandchild' : 'escaped-child'],
      { detached: true, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
    child.unref();
  }
  console.log('controlled fixture ready');
  if (process.argv[2] === 'descendants') setTimeout(() => process.exit(0), 800);
  else setInterval(() => {}, 1000);
} else {
  process.exitCode = 2;
}
