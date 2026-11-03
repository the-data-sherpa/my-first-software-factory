import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { prepareFixture } from './dependencies-registry-fixture.mjs';
import { failureScenario } from './dependencies-registry-failures.mjs';
import { verifyDependencyBundle } from '../../src/dependencies.mjs';
import { createContainedExecution } from '../../src/containment.mjs';

const [scenario, root] = process.argv.slice(2);
if (!['prepare', 'reuse', 'tamper', 'nested'].includes(scenario)) console.log(JSON.stringify(await failureScenario(scenario, root)));
else {
const f = await prepareFixture(root, { nested: scenario === 'nested' });
try {
  if (scenario === 'tamper') {
    for (const path of ['archives/0.tgz', 'acquired.json', 'acquisition.json']) {
      const absolute = `${f.directory}/${path}`; const original = await readFile(absolute);
      await chmod(absolute, 0o600); await writeFile(absolute, 'tampered acquisition');
      await assert.rejects(verifyDependencyBundle(f.intent), { code: 'DEPENDENCIES_UNSAFE' });
      await writeFile(absolute, original); if (path.endsWith('.tgz')) await chmod(absolute, 0o400);
    }
  }
  const receiptDirectory = `${root}/checks`; await mkdir(receiptDirectory, { mode: 0o700 });
  let target = f.workspaceIntent;
  if (scenario === 'reuse') {
    target = await admitWorkspace({ stateDir: f.stateDir, project: { id: 'fixture', repositoryPath: f.repositoryPath }, runId: 'run_later' });
    await prepareWorkspace(target);
    const otherProject = await admitWorkspace({ stateDir: f.stateDir, project: { id: 'other', repositoryPath: f.repositoryPath }, runId: 'run_other' });
    await prepareWorkspace(otherProject);
    await assert.rejects(verifyDependencyBundle(f.intent, { workspaceIntent: otherProject }), { code: 'DEPENDENCIES_STALE' });
    await writeFile(`${f.repositoryPath}/different-source.js`, 'export const different = true;');
    f.git('add', '.'); f.git('commit', '-m', 'different base fixture');
    const differentBase = await admitWorkspace({ stateDir: f.stateDir, project: { id: 'fixture', repositoryPath: f.repositoryPath }, runId: 'run_different' });
    await prepareWorkspace(differentBase);
    await assert.rejects(verifyDependencyBundle(f.intent, { workspaceIntent: differentBase }), { code: 'DEPENDENCIES_STALE' });
    await assert.rejects(createContainedExecution({ worktree: target.worktree, receiptDirectory, dependencyBundle: await verifyDependencyBundle(f.intent) }), { code: 'DEPENDENCIES_UNSAFE' });
  }
  const handle = await verifyDependencyBundle(f.intent, { workspaceIntent: target });
  const tools = await createContainedExecution({ worktree: target.worktree, receiptDirectory, dependencyBundle: handle });
  try {
    const check = await tools.check('vitest');
    if (scenario === 'reuse') {
      await writeFile(`${target.worktree}/bunfig.toml`, '[install]\nregistry="https://example.invalid"');
      await assert.rejects(tools.check('vitest'), { code: 'DEPENDENCIES_STALE' });
    }
    console.log(JSON.stringify({ receipt: f.receipt, requests: f.requests, lockfilesUnchanged: f.lockfilesUnchanged, check, targetBound: target.worktree !== f.workspaceIntent.worktree }));
  }
  finally { await tools.close(); }
} finally { await f.close(); }
}
