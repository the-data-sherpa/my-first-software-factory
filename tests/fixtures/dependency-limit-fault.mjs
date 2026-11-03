// Inject a deadline callback or counted diagnostic bytes while actual preparation
// is stopped at startup. This tests cleanup/reason propagation, not elapsed-time
// accuracy or an actual Bun output flood. Production limits are unchanged.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { dependencyFixture } from '../../src/dependencies-diagnostics.mjs';
import { prepareOwnerDependencies, dependencyDirectory } from '../../src/dependencies.mjs';
import { verifyContainmentEnvelope } from '../../src/containment.mjs';
import { stopPreparationStartup } from '../../src/containment-startup-fixture.mjs';
import { acquireOwner } from '../../src/storage.mjs';
import { livingProcesses } from '../../src/containment-process-fixtures.mjs';
import { readFile } from 'node:fs/promises';
const [root, stage, trigger] = process.argv.slice(2);
const f = await dependencyFixture(root); const envelope = await verifyContainmentEnvelope();
const fault = stopPreparationStartup(root, stage, envelope);
const spawn = childProcess.spawn; const setTimer = globalThis.setTimeout;
let selected; let deadline;
childProcess.spawn = (command, args, options) => {
  const child = spawn(command, args, options);
  if (command === '/usr/bin/bwrap' && args.includes(`${dependencyDirectory(f.intent)}/${stage === 'proof' ? 'script-proof/input' : 'input'}`)) selected = child;
  return child;
};
globalThis.setTimeout = (callback, ms, ...args) => {
  if (selected && ms === 120000) deadline = callback;
  return setTimer(callback, ms, ...args);
};
syncBuiltinESMExports();
try {
  const operation = prepareOwnerDependencies(f.intent); operation.catch(() => {});
  const ready = await fault.ready;
  assert.equal(typeof deadline, 'function');
  if (trigger === 'timeout') deadline();
  else if (trigger === 'output') selected.stdout.emit('data', Buffer.alloc(1024 ** 2 + 1));
  else throw new Error('Unknown fixed fault.');
  const code = trigger === 'timeout' ? 'DEPENDENCIES_TIMEOUT' : 'DEPENDENCIES_OUTPUT_LIMIT';
  await assert.rejects(operation, { code });
  assert.deepEqual(await livingProcesses(ready.observed), []);
  assert.equal(ready.events().closed, true);
  assert.equal(JSON.parse(await readFile(`${dependencyDirectory(f.intent)}/failure.json`, 'utf8')).code, code);
  const release = await acquireOwner(f.workspaceIntent.stateDir); release();
  console.log(JSON.stringify({ code, survivors: [], closed: true, ownerReleased: true }));
} finally {
  childProcess.spawn = spawn; globalThis.setTimeout = setTimer; syncBuiltinESMExports(); fault.restore();
}
