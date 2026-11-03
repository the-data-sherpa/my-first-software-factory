#!/usr/bin/env node
// Explicit foreground scope, not an installed service. Never accepts an executable or shell command.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drainOwnedScope } from '../src/containment-lifetime.mjs';
import { DIAGNOSTIC_LIMITS, SMALL_DIAGNOSTICS } from '../src/containment-test-profile.mjs';

const args = process.argv.slice(2);
if (process.versions.node !== '24.21.0' || !['serve', 'diagnose', 'prepare-dependencies', 'dependencies-diagnose'].includes(args[0])) {
  process.stderr.write('Use Node 24.21.0: factory-contained.mjs serve [factory options] | diagnose CASE DIRECTORY | prepare-dependencies INTENT | dependencies-diagnose CASE DIRECTORY\n');
  process.exitCode = 1;
} else {
  const small = args[0] === 'diagnose' && SMALL_DIAGNOSTICS.includes(args[1]);
  const unit = `factory-contained-${small ? 'test-' : ''}${randomUUID()}.scope`;
  // Let an owning harness register exact-scope cleanup before any OS launch.
  if (process.send) await new Promise((resolve, reject) => process.send({ type: 'containment-scope', unit }, (error) => error ? reject(error) : resolve()));
  if (process.connected) process.disconnect();
  const child = spawn('/usr/bin/systemd-run', ['--user', '--scope', '--quiet', ...(args[0] === 'diagnose' && args[1] === 'memory' ? [] : ['--collect']),
    `--unit=${unit}`,
    `--property=MemoryMax=${small ? DIAGNOSTIC_LIMITS.memoryBytes : 4294967296}`, '--property=MemorySwapMax=0',
    `--property=TasksMax=${small ? DIAGNOSTIC_LIMITS.tasks : 256}`,
    '--property=OOMPolicy=kill', '--', process.execPath,
    fileURLToPath(new URL('../src/containment-entry.mjs', import.meta.url)), ...args], { stdio: 'inherit',
      env: { ...process.env, FACTORY_CONTAINMENT_UNIT: unit, FACTORY_CONTAINMENT_LAUNCHER_PID: String(process.pid) } });
  const stop = (signal) => child.kill(signal);
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  child.on('error', () => { process.stderr.write('Foreground containment unavailable. No fallback.\n'); process.exitCode = 1; });
  child.on('exit', async (code) => {
    // Exit is independent of descendant-held output pipes. Never wait for close
    // before removing leftovers from a crashed backend, including during startup.
    process.exitCode = code === 0 ? 0 : 1;
    try { await drainOwnedScope(unit); }
    catch { process.stderr.write('Owned containment scope cleanup was not confirmed.\n'); process.exitCode = 1; }
    finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); }
  });
}
