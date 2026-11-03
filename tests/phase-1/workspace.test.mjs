import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, readdir, rename, symlink, mkdir, rm } from 'node:fs/promises';
import { watch } from 'node:fs';
import { fork } from 'node:child_process';
import { once as eventOnce } from 'node:events';
import { join } from 'node:path';
import { admitWorkspace, prepareWorkspace, inspectWorkspace } from '../../src/workspace.mjs';
import { fixture, git, gitInput } from './workspace-fixture.mjs';

// This module seam is explicitly assigned by the parent. Application/CLI integration belongs to the parent.
test('admission records exact committed source before creating a real private branch and worktree', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.repositoryPath, 'logic.txt'), 'owner dirty source\n');
  await writeFile(join(f.repositoryPath, 'bun.lock'), 'owner dirty bun\n');
  await writeFile(join(f.repositoryPath, 'package-lock.json'), 'owner dirty npm\n');
  await writeFile(join(f.repositoryPath, 'untracked.txt'), 'owner only\n');
  const before = git(f.repositoryPath, 'status', '--porcelain=v1');
  const intent = await admitWorkspace(f);
  assert.equal(intent.baseCommit, f.base);
  assert.equal(intent.projectId, 'vanguard');
  assert.equal(intent.runId, f.runId);
  assert.match(intent.sourceManifest.id, /^[a-f0-9]{64}$/);
  assert.deepEqual(intent.sourceManifest.entries.map(({ path, mode }) => [path, mode]), [
    ['bun.lock', '100644'], ['check.sh', '100755'], ['logic.txt', '100644'], ['package-lock.json', '100644'],
  ]);
  assert.equal((await inspectWorkspace(intent)).status, 'not-prepared');
  assert.deepEqual(await readdir(f.stateDir), []);
  const receipt = await prepareWorkspace(JSON.parse(JSON.stringify(intent)));
  assert.equal(receipt.status, 'prepared');
  assert.equal(git(receipt.worktree, 'rev-parse', 'HEAD').trim(), f.base);
  assert.equal(git(receipt.worktree, 'branch', '--show-current').trim(), intent.branch);
  assert.match(git(receipt.worktree, 'worktree', 'list', '--porcelain'), /locked/);
  assert.equal(await readFile(join(receipt.worktree, 'logic.txt'), 'utf8'), 'committed source\n');
  assert.equal(await readFile(join(receipt.worktree, 'bun.lock'), 'utf8'), 'committed bun\n');
  assert.equal(await readFile(join(receipt.worktree, 'package-lock.json'), 'utf8'), '{"committed":"npm"}\n');
  assert.equal(git(receipt.worktree, 'status', '--porcelain=v1'), '');
  assert.equal(git(f.repositoryPath, 'status', '--porcelain=v1'), before);
  assert.equal(await readFile(join(f.repositoryPath, 'bun.lock'), 'utf8'), 'owner dirty bun\n');
  assert.equal(await readFile(join(f.repositoryPath, 'package-lock.json'), 'utf8'), 'owner dirty npm\n');
  assert.equal(git(f.repositoryPath, 'branch', '--list', 'factory/*'), '');
  assert.equal((await inspectWorkspace(intent)).status, 'prepared');
});

test('source receipts bind raw binary blobs and executable types even with packed refs and objects', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.repositoryPath, 'binary.dat'), Buffer.from([0, 255, 13, 10]));
  git(f.repositoryPath, 'add', '.');
  git(f.repositoryPath, 'commit', '-m', 'binary source');
  const base = git(f.repositoryPath, 'rev-parse', 'main').trim();
  const tree = git(f.repositoryPath, 'rev-parse', 'main^{tree}').trim();
  const binary = git(f.repositoryPath, 'rev-parse', 'main:binary.dat').trim();
  git(f.repositoryPath, 'pack-refs', '--all', '--prune');
  git(f.repositoryPath, 'repack', '-ad');
  const intent = await admitWorkspace(f);
  assert.equal(intent.baseCommit, base);
  assert.equal(intent.sourceManifest.tree, tree);
  assert.deepEqual(intent.sourceManifest.entries.find(({ path }) => path === 'binary.dat'), {
    path: 'binary.dat', mode: '100644', objectId: binary, bytes: 4,
    // Independently checked with printf '\\000\\377\\r\\n' | sha256sum.
    sha256: 'e9489f37fb3051e9efa1dc916004d7274e7b63975e3209708947267f2393a9be',
  });
  const receipt = await prepareWorkspace(intent);
  assert.deepEqual(await readFile(join(receipt.worktree, 'binary.dat')), Buffer.from([0, 255, 13, 10]));
  assert.equal(git(receipt.worktree, 'ls-files', '--stage', 'check.sh').slice(0, 6), '100755');
});

test('owner replacement refs cannot change the admitted main object', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.repositoryPath, 'logic.txt'), 'replacement bytes\n');
  git(f.repositoryPath, 'add', '.');
  const tree = git(f.repositoryPath, 'write-tree').trim();
  const replacement = gitInput(f.repositoryPath, 'replacement', 'commit-tree', tree).trim();
  git(f.repositoryPath, 'replace', f.base, replacement);
  const intent = await admitWorkspace(f);
  const receipt = await prepareWorkspace(intent);
  assert.equal(receipt.baseCommit, f.base);
  assert.equal(await readFile(join(receipt.worktree, 'logic.txt'), 'utf8'), 'committed source\n');
});

test('saved intent survives main advancing and successful retries preserve a draft without rereading the owner', async (t) => {
  const f = await fixture(t);
  const intent = await admitWorkspace(f);
  await writeFile(join(f.repositoryPath, 'logic.txt'), 'new main\n');
  git(f.repositoryPath, 'add', '.');
  git(f.repositoryPath, 'commit', '-m', 'advance main');
  const receipt = await prepareWorkspace(intent);
  assert.equal(receipt.baseCommit, f.base);
  assert.equal(await readFile(join(receipt.worktree, 'logic.txt'), 'utf8'), 'committed source\n');
  await writeFile(join(receipt.worktree, 'logic.txt'), 'retained draft\n');
  await writeFile(join(receipt.worktree, 'new-test.txt'), 'untracked draft test\n');
  await rename(f.repositoryPath, join(f.root, 'owner-moved'));
  assert.deepEqual(await prepareWorkspace(intent), receipt);
  assert.equal(await readFile(join(receipt.worktree, 'logic.txt'), 'utf8'), 'retained draft\n');
  assert.equal(await readFile(join(receipt.worktree, 'new-test.txt'), 'utf8'), 'untracked draft test\n');
});

test('cancellation retains a partially registered worktree and explicit retry completes immutable intent', async (t) => {
  const f = await fixture(t);
  const intent = await admitWorkspace(f);
  const controller = new AbortController();
  const watcher = watch(f.stateDir, { recursive: true }, (_event, path) => {
    if (path?.endsWith('source/.git')) controller.abort();
  });
  t.after(() => watcher.close());
  await assert.rejects(prepareWorkspace(intent, { signal: controller.signal }), { code: 'WORKSPACE_CANCELLED' });
  watcher.close();
  assert.equal((await inspectWorkspace(intent)).status, 'preparing');
  assert.ok(await readFile(join(intent.worktree, '.git')));
  const receipt = await prepareWorkspace(intent);
  assert.equal(receipt.baseCommit, f.base);
  assert.equal(git(receipt.worktree, 'status', '--porcelain=v1'), '');
});

test('explicit retry retains truncated native registration and completes missing pieces without choosing a new worktree', async (t) => {
  const f = await fixture(t);
  const intent = await admitWorkspace(f);
  const controller = new AbortController();
  const watcher = watch(f.stateDir, { recursive: true }, (_event, path) => {
    if (path?.endsWith('source/.git')) controller.abort();
  });
  t.after(() => watcher.close());
  await assert.rejects(prepareWorkspace(intent, { signal: controller.signal }), { code: 'WORKSPACE_CANCELLED' });
  watcher.close();
  // Simulate an earlier process-death boundary in Git's multi-file registration.
  const gitDirectory = (await readFile(join(intent.worktree, '.git'), 'utf8')).trim().slice('gitdir: '.length);
  await writeFile(join(intent.worktree, '.git'), 'gitdir: ');
  await writeFile(join(gitDirectory, 'commondir'), '..');
  await rm(join(gitDirectory, 'HEAD'));
  const receipt = await prepareWorkspace(intent);
  assert.equal(receipt.worktree, intent.worktree);
  const retained = join(receipt.gitCommonDirectory, '..', 'retained');
  const evidence = await Promise.all((await readdir(retained)).map((name) => readFile(join(retained, name), 'utf8')));
  assert.ok(evidence.includes('gitdir: '));
  assert.ok(evidence.includes('..'));
  assert.equal(git(receipt.worktree, 'rev-parse', 'HEAD').trim(), f.base);
  assert.equal(git(receipt.worktree, 'status', '--porcelain=v1'), '');
});

test('partial preparation never follows redirected source ancestors or resets conflicting bytes', async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.repositoryPath, 'nested', 'deep'), { recursive: true });
  await writeFile(join(f.repositoryPath, 'nested', 'deep', 'file.txt'), 'committed nested bytes\n');
  git(f.repositoryPath, 'add', '.');
  git(f.repositoryPath, 'commit', '-m', 'nested fixture');
  const intent = await admitWorkspace(f);
  const controller = new AbortController();
  const watcher = watch(f.stateDir, { recursive: true }, (_event, path) => {
    if (path?.endsWith('source/.git')) controller.abort();
  });
  t.after(() => watcher.close());
  await assert.rejects(prepareWorkspace(intent, { signal: controller.signal }), { code: 'WORKSPACE_CANCELLED' });
  watcher.close();
  const outside = join(f.root, 'outside');
  await mkdir(join(outside, 'deep'), { recursive: true, mode: 0o700 });
  await symlink(outside, join(intent.worktree, 'nested'));
  await assert.rejects(prepareWorkspace(intent), { code: 'WORKSPACE_CONFLICT' });
  assert.deepEqual(await readdir(join(outside, 'deep')), []);
  await rm(join(intent.worktree, 'nested'));
  await writeFile(join(intent.worktree, 'logic.txt'), 'retain partial conflicting bytes\n');
  await assert.rejects(prepareWorkspace(intent), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(await readFile(join(intent.worktree, 'logic.txt'), 'utf8'), 'retain partial conflicting bytes\n');
});

test('process death during materialization retains complete installed blobs and permits explicit retry', { timeout: 20_000 }, async (t) => {
  const f = await fixture(t);
  const bytes = Buffer.alloc(8 * 1024 * 1024, 97);
  await writeFile(join(f.repositoryPath, 'a-large.bin'), bytes);
  for (let n = 0; n < 30; n++) await writeFile(join(f.repositoryPath, `z-${n}.txt`), `retained ${n}\n`);
  git(f.repositoryPath, 'add', '.');
  git(f.repositoryPath, 'commit', '-m', 'materialization crash fixture');
  const intent = await admitWorkspace(f);
  const intentFile = join(f.root, 'saved-intent.json');
  await writeFile(intentFile, JSON.stringify(intent));
  let child;
  const watcher = watch(f.stateDir, { recursive: true }, (_event, path) => {
    if (path?.endsWith('source/a-large.bin')) child.kill('SIGKILL');
  });
  child = fork(new URL('./workspace-worker.mjs', import.meta.url), [intentFile], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => { watcher.close(); child.kill('SIGKILL'); });
  const [, signal] = await eventOnce(child, 'exit');
  watcher.close();
  assert.equal(signal, 'SIGKILL');
  assert.equal((await inspectWorkspace(intent)).status, 'preparing');
  const receipt = await prepareWorkspace(intent);
  assert.deepEqual(await readFile(join(receipt.worktree, 'a-large.bin')), bytes);
  assert.equal(git(receipt.worktree, 'status', '--porcelain=v1'), '');
});

test('cancellation during the native index transaction retains its artifacts and allows explicit retry', async (t) => {
  const f = await fixture(t);
  const intent = await admitWorkspace(f);
  const controller = new AbortController();
  const watcher = watch(f.stateDir, { recursive: true }, (_event, path) => {
    if (path?.endsWith('/index.lock')) controller.abort();
  });
  t.after(() => watcher.close());
  await assert.rejects(prepareWorkspace(intent, { signal: controller.signal }), { code: 'WORKSPACE_CANCELLED' });
  watcher.close();
  assert.equal((await inspectWorkspace(intent)).status, 'preparing');
  const receipt = await prepareWorkspace(intent);
  assert.equal(git(receipt.worktree, 'status', '--porcelain=v1'), '');
});

test('a later admission for the same run cannot adopt an earlier workspace', async (t) => {
  const f = await fixture(t);
  const original = await admitWorkspace(f);
  const receipt = await prepareWorkspace(original);
  await writeFile(join(f.repositoryPath, 'logic.txt'), 'later main\n');
  git(f.repositoryPath, 'add', '.');
  git(f.repositoryPath, 'commit', '-m', 'different admission');
  const different = await admitWorkspace(f);
  assert.notEqual(different.id, original.id);
  await assert.rejects(prepareWorkspace(different), { code: 'WORKSPACE_CONFLICT' });
  assert.deepEqual(await inspectWorkspace(original), receipt);
  assert.equal(await readFile(join(receipt.worktree, 'logic.txt'), 'utf8'), 'committed source\n');
});

test('ready source redirection is refused rather than handing owner paths to tools', async (t) => {
  const f = await fixture(t);
  const intent = await admitWorkspace(f);
  await prepareWorkspace(intent);
  await rename(intent.worktree, join(f.root, 'stolen-source'));
  await symlink(join(f.root, 'stolen-source'), intent.worktree);
  await assert.rejects(prepareWorkspace(intent), { code: 'WORKSPACE_CONFLICT' });
  await assert.rejects(inspectWorkspace(intent), { code: 'WORKSPACE_CONFLICT' });
});
