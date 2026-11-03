// Operator-only controlled fixtures. No script paths, code, commands or argv are inputs.
import { mkdir, writeFile, readFile, symlink, link, rename, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { createContainedExecution, createContainmentFixture, verifyContainmentEnvelope, ContainmentError } from './containment.mjs';
import { processIdentity, observeDescendants, waitForCleanup } from './containment-process-fixtures.mjs';

export async function runContainmentDiagnostic(scenario, directory) {
  if (!/^\/tmp\/factory-containment-[A-Za-z0-9]+$/.test(directory ?? '') || !['boundary', 'files', 'results', 'cleanup', 'resources', 'crash', 'memory', 'production'].includes(scenario)) {
    throw new ContainmentError('INVALID_DIAGNOSTIC', 'Choose a fixed diagnostic and disposable directory.');
  }
  const worktree = join(directory, 'work'); const receiptDirectory = join(directory, 'receipts');
  await mkdir(worktree, { mode: 0o700 }); await mkdir(receiptDirectory, { mode: 0o700 });
  await writeFile(join(worktree, '.git'), 'private gitdir must stay hidden');
  await writeFile(join(worktree, '.factory-owner'), 'private ownership must stay hidden');
  await writeFile(join(worktree, 'ownership.json'), 'private ownership must stay hidden');
  await writeFile(join(worktree, 'source.txt'), 'controlled source');
  process.env.FACTORY_DUMMY_SECRET = 'dummy-not-a-credential';
  const execution = await (scenario === 'production' ? createContainedExecution : createContainmentFixture)({
    worktree, receiptDirectory, protectedPaths: ['owner-record'], allegedPreparedReceipt: { verified: true },
  });
  try {
    if (scenario === 'production') {
      async function code(operation) { try { await operation(); return 'UNEXPECTED_SUCCESS'; } catch (error) { return error.code; } }
      const fixtureCheck = await code(() => execution.check('pass'));
      const checkArgs = await code(() => execution.check('boundary', { argv: ['evil'] }));
      const preparedClaim = await code(() => execution.check('vitest'));
      const beforeDigest = execution.verification.sourceDigest;
      await execution.write('untracked-test.txt', 'new draft evidence');
      const afterDigest = (await execution.check('boundary')).sourceDigest;
      await symlink(receiptDirectory, join(worktree, 'escape'));
      const snapshotLinkBlocked = await code(() => execution.check('boundary')) !== 'UNEXPECTED_SUCCESS';
      await unlink(join(worktree, 'escape'));
      const moved = join(directory, 'moved-work');
      await rename(worktree, moved); await symlink(moved, worktree);
      const redirectedRoot = await code(() => execution.read('source.txt'));
      await unlink(worktree); await rename(moved, worktree);
      const receiptHidden = await code(() => execution.read('../receipts')) === 'UNSAFE_PATH';
      // This is the exact disposable scope created for this diagnostic, not a global setting.
      await promisify(execFile)('/usr/bin/systemctl', ['--user', '--runtime', 'set-property', execution.envelope.unit, 'TasksMax=255']);
      const changedEnvelope = await code(() => execution.read('source.txt'));
      return { fixtureCheck, checkArgs, preparedClaim, beforeDigest, afterDigest, snapshotLinkBlocked, redirectedRoot, changedEnvelope, receiptHidden };
    }
    if (scenario === 'crash' || scenario === 'memory') {
      const backendIdentity = await processIdentity(process.pid);
      if (scenario === 'memory') {
        process.stdout.write(`${JSON.stringify({ envelope: execution.envelope, backendIdentity })}\n`);
        return await execution.check('memory');
      }
      const running = execution.check('hang');
      const observed = await observeDescendants(execution.envelope);
      process.stdout.write(`${JSON.stringify({ envelope: execution.envelope, backendIdentity, observed })}\n`);
      return await running;
    }
    if (scenario === 'resources') {
      let productionGate;
      try { await verifyContainmentEnvelope(); } catch (error) { productionGate = error.code; }
      const pids = await execution.check('pids');
      const scratch = await execution.check('scratch');
      const running = execution.check('hang');
      const observed = await observeDescendants(execution.envelope);
      const timeout = { ...await running, observed, survivors: await waitForCleanup(observed) };
      return { envelope: execution.envelope, pids, scratch, timeout, productionGate };
    }
    if (scenario === 'cleanup') {
      const results = {};
      for (const mode of ['normal', 'abort', 'close']) {
        const controller = new AbortController();
        const running = execution.check(mode === 'normal' ? 'descendants' : 'hang', { signal: controller.signal });
        const observed = await observeDescendants(execution.envelope);
        if (mode === 'abort') controller.abort();
        if (mode === 'close') await execution.close();
        const { output, ...result } = await running;
        results[mode] = { observed, result, survivors: await waitForCleanup(observed) };
      }
      return results;
    }
    if (scenario === 'results') {
      const slim = ({ output, ...result }) => result;
      const pass = slim(await execution.check('pass'));
      const exit = slim(await execution.check('fail'));
      const signal = slim(await execution.check('signal'));
      const output = slim(await execution.check('output'));
      const controller = new AbortController();
      const running = execution.check('hang', { signal: controller.signal });
      let overlap; try { await execution.check('pass'); } catch (error) { overlap = error.code; }
      const timer = setTimeout(() => controller.abort(), 200);
      const abort = slim(await running); clearTimeout(timer);
      await execution.close();
      let afterClose; try { await execution.read('source.txt'); } catch (error) { afterClose = error.code; }
      return { pass, exit, signal, output, abort, overlap, afterClose };
    }
    if (scenario === 'files') {
      const written = await execution.write('source.txt', 'a'.repeat(65536));
      const first = await execution.read('source.txt');
      const second = await execution.read('source.txt', { offset: first.nextOffset });
      const last = await execution.read('source.txt', { offset: 49152 });
      await execution.write('unicode.txt', 'a'.repeat(16383) + '€');
      const unicodeFirst = await execution.read('unicode.txt');
      assert.equal(unicodeFirst.bytes, 16383);
      const unicode = (await execution.read('unicode.txt', { offset: unicodeFirst.nextOffset })).text;
      const outside = join(directory, 'other-run'); await mkdir(outside, { mode: 0o700 });
      await writeFile(join(outside, 'sentinel'), 'do not change');
      await symlink(outside, join(worktree, 'linked-directory'));
      await symlink(join(outside, 'sentinel'), join(worktree, 'linked-file'));
      await link(join(outside, 'sentinel'), join(worktree, 'hard-linked-file'));
      let protectedCases = 0;
      for (const path of ['../other-run/sentinel', '/etc/passwd', 'a/../../other-run/sentinel', '.git', '.git/config',
        '.factory-owner', 'ownership.json', 'owner-record', 'linked-directory/sentinel', 'linked-file', 'hard-linked-file', 'a\\b']) {
        await assert.rejects(execution.read(path)); await assert.rejects(execution.write(path, 'corrupted'));
        protectedCases++;
      }
      async function code(operation) { try { await operation(); return 'UNEXPECTED_SUCCESS'; } catch (error) { return error.code; } }
      return { written, first, second, last, unicode, protectedCases, sentinel: await readFile(join(outside, 'sentinel'), 'utf8'),
        tooLarge: await code(() => execution.write('source.txt', '€'.repeat(21846))),
        arbitraryCheck: await code(() => execution.check('sh -c true')),
        repositoryCheck: await code(() => execution.check('vitest')) };
    }
    return { backendPid: process.pid, envelope: execution.envelope,
      check: execution.verification, hostConnections: execution.verification.hostConnections };
  } finally { await execution.close(); }
}
