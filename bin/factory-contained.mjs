#!/usr/bin/env node
// Explicit foreground scope, not an installed service. Never accepts an executable or shell command.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DIAGNOSTIC_LIMITS, SMALL_DIAGNOSTICS } from '../src/containment-test-profile.mjs';

const args = process.argv.slice(2);
if (process.versions.node !== '24.21.0' || !['serve', 'diagnose'].includes(args[0])) {
  process.stderr.write('Use Node 24.21.0: factory-contained.mjs serve [factory options] | diagnose CASE DIRECTORY\n');
  process.exitCode = 1;
} else {
  const small = args[0] === 'diagnose' && SMALL_DIAGNOSTICS.includes(args[1]);
  const child = spawn('/usr/bin/systemd-run', ['--user', '--scope', '--quiet', ...(args[0] === 'diagnose' && args[1] === 'memory' ? [] : ['--collect']),
    `--unit=factory-contained-${small ? 'test-' : ''}${randomUUID()}.scope`,
    `--property=MemoryMax=${small ? DIAGNOSTIC_LIMITS.memoryBytes : 4294967296}`, '--property=MemorySwapMax=0',
    `--property=TasksMax=${small ? DIAGNOSTIC_LIMITS.tasks : 256}`,
    '--property=OOMPolicy=kill', '--', process.execPath,
    fileURLToPath(new URL('../src/containment-entry.mjs', import.meta.url)), ...args], { stdio: 'inherit' });
  const stop = (signal) => child.kill(signal);
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  child.on('error', () => { process.stderr.write('Foreground containment unavailable. No fallback.\n'); process.exitCode = 1; });
  child.on('close', (code) => {
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
    process.exitCode = code === 0 ? 0 : 1;
  });
}
