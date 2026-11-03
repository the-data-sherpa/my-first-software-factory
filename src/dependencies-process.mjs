// Trusted preparation launcher. No editable package code is a host command.
import { spawn } from 'node:child_process';
import { readFile, realpath, open, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { containmentFilter } from './containment-filter.mjs';
import { namespaceLifetime } from './containment-namespace.mjs';
import { verifyContainmentEnvelope, CONTAINMENT_LIMITS } from './containment.mjs';

export const libraries = ['libdl.so.2', 'libstdc++.so.6', 'libm.so.6', 'libgcc_s.so.1', 'libpthread.so.0', 'libc.so.6', 'ld-linux-x86-64.so.2'];
const worker = fileURLToPath(new URL('./dependencies-worker.mjs', import.meta.url));
const error = (code) => Object.assign(new Error('Private dependency preparation failed.'), { code });

// Internal host helper. Fixture mode is reachable only from the fixed disposable diagnostic.
export async function runPreparationSandbox({ inputDirectory, cacheDirectory, bunPath, receiptDirectory, signal, fixture = false }) {
  const envelope = await verifyContainmentEnvelope();
  if (signal?.aborted) throw error('DEPENDENCIES_ABORTED');
  const filterPath = `${receiptDirectory}/filter.bpf`;
  await writeFile(filterPath, containmentFilter(), { flag: 'wx', mode: 0o600 });
  const filter = await open(filterPath, 'r');
  let child; let lifetime; let timer; let reason;
  const stop = (why) => { reason ??= why; lifetime?.stop(); };
  const abort = () => stop('DEPENDENCIES_ABORTED');
  try {
    const args = ['--unshare-user', '--unshare-pid', '--unshare-net', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup',
      '--disable-userns', '--assert-userns-disabled', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv',
      '--setenv', 'PATH', '/runtime', '--setenv', 'HOME', '/tmp/home', '--setenv', 'TMPDIR', '/tmp', '--setenv', 'LANG', 'C.UTF-8',
      '--setenv', 'UV_THREADPOOL_SIZE', '2', '--ro-bind', await realpath(process.execPath), '/runtime/node',
      '--ro-bind', bunPath, '/runtime/bun'];
    // Bun's lifecycle shell is available only for the fixed positive-control fixture.
    if (fixture) {
      args.push('--ro-bind', '/usr/bin/bash', '/bin/sh');
      for (const library of ['libreadline.so.8', 'libncursesw.so.6']) args.push('--ro-bind', await realpath(`/usr/lib/${library}`), `/usr/lib/${library}`);
    }
    for (const library of libraries) args.push('--ro-bind', await realpath(`/usr/lib/${library}`), `/usr/lib/${library}`);
    if (cacheDirectory) args.push('--ro-bind', cacheDirectory, '/locked-cache');
    args.push('--symlink', 'usr/lib', '/lib64', '--symlink', 'usr/lib', '/lib',
      '--ro-bind', inputDirectory, '/input', '--ro-bind', worker, '/prepare.mjs', '--proc', '/proc', '--remount-ro', '/proc',
      '--dev', '/dev', '--remount-ro', '/dev', '--size', String(CONTAINMENT_LIMITS.scratchBytes), '--tmpfs', '/tmp',
      '--remount-ro', '/', '--chdir', '/tmp', '--seccomp', '3', '--block-fd', '4', '--info-fd', '6', '--',
      '/runtime/node', '/prepare.mjs', ...(fixture ? ['fixture'] : cacheDirectory ? ['registry'] : []));
    const events = async () => {
      const values = await Promise.all(['memory.events', 'pids.events'].map((name) => readFile(`/sys/fs/cgroup${envelope.cgroup}/${name}`, 'utf8')));
      return values.join('\n');
    };
    const before = await events();
    // fd5 is the bounded bundle export. Namespace information has its own fd6.
    child = spawn('/usr/bin/bwrap', args, { env: {}, stdio: ['ignore', 'pipe', 'pipe', filter.fd, 'pipe', 'pipe', 'pipe'] });
    lifetime = namespaceLifetime(child, envelope, 6);
    child.on('error', () => stop('DEPENDENCIES_LAUNCH_FAILED'));
    // Raw Bun diagnostics are deliberately not retained: they can quote package-controlled text.
    let logBytes = 0; const chunks = []; let exportBytes = 0;
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => {
      logBytes += data.length; if (logBytes > CONTAINMENT_LIMITS.outputBytes) stop('DEPENDENCIES_OUTPUT_LIMIT');
    });
    child.stdio[5].on('data', (data) => {
      exportBytes += data.length;
      if (exportBytes > 128 * 1024 ** 2) stop('DEPENDENCIES_BUNDLE_LIMIT'); else chunks.push(data);
    });
    child.stdio[4].on('error', () => stop('DEPENDENCIES_LAUNCH_FAILED'));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => stop('DEPENDENCIES_TIMEOUT'), CONTAINMENT_LIMITS.checkMs);
    if (signal?.aborted) abort();
    let launch;
    try {
      launch = await lifetime.verified;
      await writeFile(`${receiptDirectory}/launch.json`, JSON.stringify(launch), { flag: 'wx', mode: 0o600 });
      if (reason) await lifetime.drain();
      else child.stdio[4].end();
    } catch { stop('DEPENDENCIES_LAUNCH_FAILED'); await lifetime.drain(); }
    const { exitCode, exitSignal } = await lifetime.finished();
    const after = await events();
    const counters = (text) => text.match(/(?:oom_kill|max) \d+/g)?.join(',');
    if (counters(before) !== counters(after)) reason ??= 'DEPENDENCIES_RESOURCE_LIMIT';
    if (reason || exitCode !== 0 || exitSignal) throw error(reason ?? 'DEPENDENCIES_INSTALL_FAILED');
    let output;
    try { output = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw error('DEPENDENCIES_EXPORT_FAILED'); }
    return { output, envelope, launch, logBytes, network: 'kernel-denied' };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    const drainFailure = await lifetime?.drain().catch((error) => error);
    try { await filter.close(); } finally { if (drainFailure) throw drainFailure; }
  }
}
