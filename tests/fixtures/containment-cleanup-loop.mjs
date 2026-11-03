// Disposable actual-OS reproducer. Own the scope name before spawning, including on timeout.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { waitForCleanup } from '../../src/containment-process-fixtures.mjs';
import { ownedProcesses, stopOwnedScope } from './containment-harness.mjs';
const entry = fileURLToPath(new URL('../../src/containment-entry.mjs', import.meta.url));
const manager = { PATH: '/usr/bin', XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus` };
for (let iteration = 0; iteration < Number(process.argv[2] ?? 20); iteration++) {
  const directory = await mkdtemp('/tmp/factory-containment-');
  const unit = `factory-contained-${randomUUID()}.scope`;
  let observed = []; let timer; let stderr = ''; let stdout = '';
  const started = performance.now();
  const child = spawn('/usr/bin/systemd-run', ['--user', '--scope', '--quiet', '--collect', `--unit=${unit}`,
    '--property=MemoryMax=4294967296', '--property=MemorySwapMax=0', '--property=TasksMax=256', '--property=OOMPolicy=kill',
    '--', process.execPath, entry, 'diagnose', process.argv[3] ?? 'cleanup', directory], { env: manager, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const finished = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal })); });
  try {
    const terminal = await Promise.race([finished, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Descendant cleanup exceeded 3 seconds')), 3000);
    })]);
    assert.equal(terminal.code, 0, stderr);
    const result = JSON.parse(stdout);
    if (result.results) for (const check of result.results) {
      assert.equal(check.reason, 'aborted'); assert.deepEqual(check.survivors, []);
    }
    else for (const mode of ['normal', 'abort', 'close']) {
      assert.ok(result[mode].observed.length >= 5);
      assert.deepEqual(result[mode].survivors, []);
    }
    console.log(JSON.stringify({ iteration, elapsedMs: Math.round(performance.now() - started), pass: true, unit }));
  } catch (error) {
    observed = await ownedProcesses(unit);
    console.error(JSON.stringify({ iteration, elapsedMs: Math.round(performance.now() - started), error: error.message, unit, directory, observed, stdout, stderr }));
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    await stopOwnedScope(unit);
    child.kill('SIGKILL'); await finished;
    assert.deepEqual(await waitForCleanup(observed), []);
    if (!process.exitCode) await rm(directory, { recursive: true, force: true });
  }
  if (process.exitCode) break;
}
