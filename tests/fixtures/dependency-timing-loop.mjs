// Fixed early-cancellation sweep through the standalone owner interface. No
// substitute bwrap/Bun, command, install option or caller-selected production limit.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dependencyFixture } from '../../src/dependencies-diagnostics.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { admitDependencies, prepareOwnerDependencies, dependencyDirectory } from '../../src/dependencies.mjs';
import { livingProcesses } from '../../src/containment-process-fixtures.mjs';
import { acquireOwner } from '../../src/storage.mjs';
const [root] = process.argv.slice(2);
const f = await dependencyFixture(root); const spawn = childProcess.spawn; const results = [];
for (const stage of ['proof', 'target']) {
  for (const offset of [-1, 0, 1, 2, 3, 5, 8, 13]) {
    const workspaceIntent = await admitWorkspace({ stateDir: f.workspaceIntent.stateDir,
      project: { id: 'fixture', repositoryPath: f.repositoryPath }, runId: `run_timing_${results.length}` });
    await prepareWorkspace(workspaceIntent);
    const intent = await admitDependencies({ workspaceIntent, bunPath: '/home/cowen/.bun/bin/bun' });
    const controller = new AbortController(); let timer; let launched = false;
    const directory = dependencyDirectory(intent);
    const input = stage === 'proof' ? `${directory}/script-proof/input` : `${directory}/input`;
    childProcess.spawn = (command, args, options) => {
      const child = spawn(command, args, options);
      if (command === '/usr/bin/bwrap' && args.includes(input)) {
        launched = true;
        if (offset < 0) controller.abort(); else timer = setTimeout(() => controller.abort(), offset);
      }
      return child;
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(prepareOwnerDependencies(intent, { signal: controller.signal }), { code: 'DEPENDENCIES_ABORTED' });
      assert.equal(launched, true);
      const launch = JSON.parse(await readFile(`${input.slice(0, -'/input'.length)}/launch.json`, 'utf8'));
      const survivors = await livingProcesses([launch, launch.sandbox]);
      assert.deepEqual(survivors, []); // Immediate, not eventually after owner release.
      const release = await acquireOwner(f.workspaceIntent.stateDir); release();
      results.push({ stage, offset, survivors, reason: 'DEPENDENCIES_ABORTED' });
    } finally { clearTimeout(timer); childProcess.spawn = spawn; syncBuiltinESMExports(); }
  }
}
console.log(JSON.stringify({ results }));
