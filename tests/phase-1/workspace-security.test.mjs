import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, readdir, mkdir, rename, symlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { admitWorkspace, prepareWorkspace, inspectWorkspace, serializeWorkspaceError, WorkspaceError } from '../../src/workspace.mjs';
import { fixture, git, gitInput } from './workspace-fixture.mjs';

const absent = async (path) => assert.rejects(lstat(path), { code: 'ENOENT' });

test('trusted preparation ignores owner hooks, filters, includes, fsmonitor, remotes and inherited Git configuration', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.repositoryPath, '.gitattributes'), '* filter=hostile\n');
  git(f.repositoryPath, 'add', '.gitattributes');
  git(f.repositoryPath, 'commit', '-m', 'raw filtered content');
  const marker = join(f.root, 'UNTRUSTED-CODE-RAN');
  const script = join(f.root, 'hostile.sh');
  await writeFile(script, `#!/bin/sh\ntouch '${marker}'\nexit 99\n`, { mode: 0o700 });
  await mkdir(join(f.repositoryPath, '.git', 'hooks'));
  await writeFile(join(f.repositoryPath, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\nexec '${script}'\n`, { mode: 0o700 });
  await writeFile(join(f.repositoryPath, '.git', 'config'), `[core]\nrepositoryformatversion = 0\nfsmonitor = ${script}\nhooksPath = ${join(f.repositoryPath, '.git', 'hooks')}\n[filter "hostile"]\nsmudge = ${script}\nprocess = ${script}\nrequired = true\n[remote "origin"]\nurl = ext::${script}\npromisor = true\n[include]\npath = ${join(f.root, 'invalid-config')}\n`);
  await writeFile(join(f.root, 'invalid-config'), 'THIS IS NOT VALID GIT CONFIG\n');
  const prior = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = join(f.root, 'invalid-config');
  t.after(() => { if (prior === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = prior; });
  const intent = await admitWorkspace(f);
  const receipt = await prepareWorkspace(intent);
  assert.equal(await readFile(join(receipt.worktree, 'logic.txt'), 'utf8'), 'committed source\n');
  assert.equal(await readFile(join(receipt.worktree, '.gitattributes'), 'utf8'), '* filter=hostile\n');
  await absent(marker);
  assert.deepEqual(receipt.toolAccess, { sourceRoot: receipt.worktree, excludedPaths: ['.git'], requiresVerifiedContainment: true });
  assert.ok(!receipt.gitDirectory.startsWith(`${receipt.worktree}/`));
  assert.ok(!receipt.gitCommonDirectory.startsWith(`${receipt.worktree}/`));
  assert.equal((await lstat(receipt.gitCommonDirectory)).mode & 0o077, 0);
});

for (const [name, setup] of [
  ['symbolic links', async (f) => { await symlink('/etc/passwd', join(f.repositoryPath, 'escape')); }],
  ['LFS pointers', async (f) => { await writeFile(join(f.repositoryPath, 'large.dat'), 'version https://git-lfs.github.com/spec/v1\noid sha256:abcd\nsize 123\n'); }],
  ['submodule declarations', async (f) => { await writeFile(join(f.repositoryPath, '.gitmodules'), '[submodule "x"]\npath=x\nurl=ext::no\n'); }],
]) {
  test(`admission blocks ${name} before retaining workspace artifacts`, async (t) => {
    const f = await fixture(t);
    await setup(f);
    git(f.repositoryPath, 'add', '.');
    git(f.repositoryPath, 'commit', '-m', 'unsupported fixture');
    await assert.rejects(admitWorkspace(f), { code: 'WORKSPACE_UNSUPPORTED' });
    assert.deepEqual(await readdir(f.stateDir), []);
  });
}

for (const name of ['.git', '.GiT', '../escape', 'bad\nname', 'bad\u202ename']) {
  test(`raw Git trees with unsafe path ${JSON.stringify(name).replace('\u202e', '\\u202e')} are rejected`, async (t) => {
    const f = await fixture(t);
    const blob = gitInput(f.repositoryPath, 'bad', 'hash-object', '-w', '--stdin').trim();
    const tree = gitInput(f.repositoryPath, Buffer.concat([Buffer.from(`100644 ${name}\0`), Buffer.from(blob, 'hex')]),
      'hash-object', '-w', '-t', 'tree', '--literally', '--stdin').trim();
    const commit = gitInput(f.repositoryPath, 'unsafe tree', 'commit-tree', tree).trim();
    git(f.repositoryPath, 'update-ref', 'refs/heads/main', commit);
    await assert.rejects(admitWorkspace(f), { code: 'WORKSPACE_UNSUPPORTED' });
    assert.deepEqual(await readdir(f.stateDir), []);
  });
}

test('object alternates and promisor packs are blocked without following external object paths', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.repositoryPath, '.git', 'objects', 'info', 'alternates'), '/never/read/these/objects\n');
  await assert.rejects(admitWorkspace(f), { code: 'WORKSPACE_UNSUPPORTED' });
  assert.deepEqual(await readdir(f.stateDir), []);
});

test('gitlinks without a declaration and promisor metadata are unsupported', async (t) => {
  const f = await fixture(t);
  const tree = gitInput(f.repositoryPath, `160000 commit ${f.base}\tvendor\n`, 'mktree').trim();
  const commit = gitInput(f.repositoryPath, 'gitlink', 'commit-tree', tree).trim();
  git(f.repositoryPath, 'update-ref', 'refs/heads/main', commit);
  await assert.rejects(admitWorkspace(f), { code: 'WORKSPACE_UNSUPPORTED' });
  git(f.repositoryPath, 'update-ref', 'refs/heads/main', f.base);
  await writeFile(join(f.repositoryPath, '.git', 'objects', 'pack', 'unavailable.promisor'), '');
  await assert.rejects(admitWorkspace(f), { code: 'WORKSPACE_UNSUPPORTED' });
});

test('canonical source paths cannot smuggle control characters through a symlink', async (t) => {
  const f = await fixture(t);
  const moved = join(f.root, 'hidden\nowner');
  await rename(f.repositoryPath, moved);
  await symlink(moved, f.repositoryPath);
  await assert.rejects(admitWorkspace(f), { code: 'WORKSPACE_INVALID' });
});

test('source size limits count every materialized path, not only deduplicated Git objects', async (t) => {
  const f = await fixture(t);
  const blob = gitInput(f.repositoryPath, Buffer.alloc(1024 * 1024, 97), 'hash-object', '-w', '--stdin').trim();
  const entries = Array.from({ length: 129 }, (_, n) => `100644 blob ${blob}\tfile-${String(n).padStart(3, '0')}\n`).join('');
  const tree = gitInput(f.repositoryPath, entries, 'mktree').trim();
  const commit = gitInput(f.repositoryPath, 'expanded fixture', 'commit-tree', tree).trim();
  git(f.repositoryPath, 'update-ref', 'refs/heads/main', commit);
  await assert.rejects(admitWorkspace(f), { code: 'WORKSPACE_LIMIT' });
  assert.deepEqual(await readdir(f.stateDir), []);
});

test('foreign workspace ownership and private-state path redirection are rejected without adopting artifacts', async (t) => {
  const f = await fixture(t);
  const intent = await admitWorkspace(f);
  await mkdir(intent.worktree, { recursive: true, mode: 0o700 });
  await writeFile(join(intent.worktree, 'foreign.txt'), 'do not adopt\n');
  await assert.rejects(prepareWorkspace(intent), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(await readFile(join(intent.worktree, 'foreign.txt'), 'utf8'), 'do not adopt\n');
  const other = await admitWorkspace({ ...f, runId: 'run_other' });
  await symlink(f.repositoryPath, join(f.stateDir, 'runs', 'run_other'));
  await assert.rejects(prepareWorkspace(other), { code: 'WORKSPACE_CONFLICT' });
  await absent(join(f.repositoryPath, 'workspace'));
});

test('metadata tampering cannot pass a prepared receipt or reset retained evidence', async (t) => {
  const f = await fixture(t);
  const intent = await admitWorkspace(f);
  const receipt = await prepareWorkspace(intent);
  const config = join(receipt.gitCommonDirectory, 'config');
  const original = await readFile(config);
  await writeFile(config, '[include]\npath=/never/read/this/config\n');
  await assert.rejects(prepareWorkspace(intent), { code: 'WORKSPACE_CONFLICT' });
  await assert.rejects(inspectWorkspace(intent), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(await readFile(config, 'utf8'), '[include]\npath=/never/read/this/config\n');
  await writeFile(config, original);
  await writeFile(join(receipt.gitCommonDirectory, 'refs', 'heads', intent.branch), '0'.repeat(40) + '\n');
  await assert.rejects(prepareWorkspace(intent), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(await readFile(join(receipt.worktree, 'logic.txt'), 'utf8'), 'committed source\n');
});

test('an already cancelled trusted signal causes no admission or workspace side effects', async (t) => {
  const f = await fixture(t);
  const intent = await admitWorkspace(f);
  const controller = new AbortController();
  controller.abort(new Error('private cancellation detail'));
  await assert.rejects(admitWorkspace({ ...f, signal: controller.signal }), { code: 'WORKSPACE_CANCELLED' });
  await assert.rejects(prepareWorkspace(intent, { signal: controller.signal }), { code: 'WORKSPACE_CANCELLED' });
  assert.deepEqual(await readdir(f.stateDir), []);
});

test('source lookup failure is serializable and sanitized, with intent retained for explicit retry', async (t) => {
  const f = await fixture(t);
  const intent = await admitWorkspace(f);
  // Deliberately remove availability, not run artifacts; the private intent must survive this failure.
  const objects = join(f.repositoryPath, '.git', 'objects');
  await rename(objects, join(f.root, 'retained-objects'));
  let failure;
  try { await prepareWorkspace(intent); } catch (error) { failure = error; }
  assert.ok(failure);
  const safe = serializeWorkspaceError(failure);
  assert.deepEqual(JSON.parse(JSON.stringify(failure)), safe);
  assert.doesNotMatch(JSON.stringify(safe), new RegExp(f.root));
  assert.equal((await inspectWorkspace(intent)).status, 'preparing');
  await rename(join(f.root, 'retained-objects'), objects);
  assert.equal((await prepareWorkspace(intent)).status, 'prepared');
  const unknown = { code: 'WORKSPACE_FAILED', message: 'Workspace preparation failed. Retained artifacts were not removed.' };
  assert.deepEqual(serializeWorkspaceError(new Error('secret token')), unknown);
  assert.deepEqual(serializeWorkspaceError(new WorkspaceError('secret token')), unknown);
});
