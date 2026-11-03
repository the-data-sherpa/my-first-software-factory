import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyContainmentEnvelope } from '../../src/containment.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const launcher = fileURLToPath(new URL('../../bin/factory-contained.mjs', import.meta.url));
async function diagnose(t, scenario) {
  const directory = await mkdtemp('/tmp/factory-containment-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { stdout } = await exec(process.execPath, [launcher, 'diagnose', scenario, directory], { timeout: 30_000 });
  return JSON.parse(stdout);
}

// Agreed seam: factory-owned execution interface, with disposable OS fixtures.
test('repository tools refuse an uncontained backend, even with an alleged receipt', async () => {
  await assert.rejects(verifyContainmentEnvelope({ verified: true }), { code: 'CONTAINMENT_REQUIRED' });
});

test('the actual foreground launcher places the backend in the accepted transient resource envelope', async (t) => {
  const result = await diagnose(t, 'envelope');
  assert.equal(result.envelope.memoryBytes, 4294967296);
  assert.equal(result.envelope.swapBytes, 0);
  assert.equal(result.envelope.tasks, 256);
  assert.match(result.envelope.unit, /^factory-contained-.+\.scope$/);
});

test('actual direct-argv checks hide private files, scrub credentials, and deny controlled local network', async (t) => {
  const result = await diagnose(t, 'boundary');
  assert.equal(result.check.passed, true);
  assert.equal(result.check.kind, 'diagnostic');
  assert.equal(result.check.launch.parentPid, result.backendPid);
  assert.equal(result.check.launch.cgroup, result.envelope.cgroup);
  assert.equal(result.check.probe.hidden, true);
  assert.equal(result.check.probe.networkDenied, true);
  assert.equal(result.check.probe.udpDenied, true);
  assert.equal(result.check.probe.environmentScrubbed, true);
  assert.equal(result.check.probe.readOnly, true);
  assert.equal(result.check.probe.scratchBytes, 268435456);
  assert.equal(result.check.probe.noNewPrivileges, true);
  assert.equal(result.check.probe.seccomp, true);
  assert.equal(result.hostConnections, 0);
});

test('bounded file tools paginate text and reject traversal, links, private metadata and other runs', async (t) => {
  const result = await diagnose(t, 'files');
  assert.equal(result.first.bytes, 16384);
  assert.equal(result.first.nextOffset, 16384);
  assert.equal(result.second.bytes, 16384);
  assert.equal(result.last.nextOffset, null);
  assert.equal(result.written.bytesWritten, 65536);
  assert.equal(result.protectedCases, 12);
  assert.equal(result.sentinel, 'do not change');
  assert.equal(result.unicode, '€');
  assert.equal(result.tooLarge, 'WRITE_LIMIT');
  assert.equal(result.arbitraryCheck, 'CHECK_NOT_ALLOWED');
  assert.equal(result.repositoryCheck, 'DEPENDENCIES_NOT_PREPARED');
});

test('fixed checks retain failures for nonzero exit, signal, combined output overflow, and cancellation', async (t) => {
  const result = await diagnose(t, 'results');
  assert.equal(result.pass.passed, true);
  assert.equal(result.exit.passed, false); assert.equal(result.exit.exitCode, 7);
  assert.equal(result.signal.passed, false);
  assert.equal(result.output.passed, false); assert.equal(result.output.reason, 'output-limit');
  assert.equal(result.output.outputBytes, 1048576);
  assert.equal(result.abort.passed, false); assert.equal(result.abort.reason, 'aborted');
  assert.equal(result.overlap, 'EXECUTION_BUSY');
  assert.equal(result.afterClose, 'CONTAINMENT_CLOSED');
  assert.equal(result.pass.limits.checkMs, 120000);
});

test('normal completion and abort kill detached sessions and grandchildren, not just a process group', async (t) => {
  const result = await diagnose(t, 'cleanup');
  for (const mode of ['normal', 'abort', 'close']) {
    assert.ok(result[mode].observed.length >= 5);
    assert.ok(result[mode].observed.some((process) => process.session === process.pid));
    assert.deepEqual(result[mode].survivors, []);
  }
  assert.equal(result.normal.result.passed, true);
  assert.equal(result.abort.result.reason, 'aborted');
  assert.equal(result.close.result.reason, 'aborted');
});

test('a smaller disposable envelope actually enforces task and scratch limits and the check deadline', async (t) => {
  const result = await diagnose(t, 'resources');
  assert.equal(result.envelope.memoryBytes, 201326592);
  assert.equal(result.envelope.tasks, 48);
  assert.equal(result.pids.passed, false); assert.equal(result.pids.reason, 'task-limit');
  assert.ok(result.pids.resourceEvents.pidsMax > 0);
  assert.equal(result.scratch.passed, false); assert.equal(result.scratch.reason, 'scratch-limit');
  assert.equal(result.scratch.limits.scratchBytes, 1048576);
  assert.equal(result.timeout.passed, false); assert.equal(result.timeout.reason, 'timeout');
  assert.ok(result.timeout.observed.length >= 5);
  assert.deepEqual(result.timeout.survivors, []);
  assert.equal(result.productionGate, 'CONTAINMENT_REQUIRED');
});

test('production tools use live verification, reject forged preparation and unsafe snapshots, and retain source-bound receipts', async (t) => {
  const result = await diagnose(t, 'production');
  assert.equal(result.fixtureCheck, 'CHECK_NOT_ALLOWED');
  assert.equal(result.checkArgs, 'CHECK_NOT_ALLOWED');
  assert.equal(result.preparedClaim, 'DEPENDENCIES_NOT_PREPARED');
  assert.notEqual(result.beforeDigest, result.afterDigest);
  assert.equal(result.snapshotLinkBlocked, true);
  assert.equal(result.redirectedRoot, 'UNSAFE_PATH');
  assert.equal(result.changedEnvelope, 'CONTAINMENT_REQUIRED');
  assert.equal(result.receiptHidden, true);
});
