import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const git = (directory, ...args) => gitInput(directory, undefined, ...args);
export const gitInput = (directory, input, ...args) => execFileSync('/usr/bin/git', ['-C', directory, ...args], {
  input, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: directory, GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' },
});

export async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'factory-workspace-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryPath = join(root, 'owner');
  const stateDir = join(root, 'private');
  await mkdir(repositoryPath, { mode: 0o700 });
  await mkdir(stateDir, { mode: 0o700 });
  git(repositoryPath, 'init', '--initial-branch=main', '--template=');
  await writeFile(join(repositoryPath, 'logic.txt'), 'committed source\n');
  await writeFile(join(repositoryPath, 'bun.lock'), 'committed bun\n');
  await writeFile(join(repositoryPath, 'package-lock.json'), '{"committed":"npm"}\n');
  await writeFile(join(repositoryPath, 'check.sh'), '#!/bin/sh\nexit 0\n');
  await chmod(join(repositoryPath, 'check.sh'), 0o755);
  git(repositoryPath, 'add', '.');
  git(repositoryPath, 'commit', '-m', 'fixture base');
  return { root, repositoryPath, stateDir, project: { id: 'vanguard', repositoryPath }, runId: 'run_fixture',
    base: git(repositoryPath, 'rev-parse', 'HEAD').trim() };
}
