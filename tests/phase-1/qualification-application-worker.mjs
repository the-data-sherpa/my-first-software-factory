// Runs inside an exact-owned scope. Dies after a qualified-looking verdict was
// persisted and the receipt settled, but before application finalization.
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openFactory } from '../../src/factory.mjs';
import { git } from './workspace-fixture.mjs';
import { composed, workspace, brief, dependencyRunId, scope, fabricatedQualified, writeState, receiptFor } from './qualification-application-fixture.mjs';

const [root, scenario] = process.argv.slice(2);
if (scenario !== 'crash') throw new Error(`Unknown scenario ${scenario}`);
globalThis.fetch = async () => { throw new Error('Uncontrolled network forbidden'); };
const repositoryPath = join(root, 'owner');
const stateDir = join(root, 'private');
await mkdir(repositoryPath, { mode: 0o700 });
await mkdir(stateDir, { mode: 0o700 });
git(repositoryPath, 'init', '--initial-branch=main', '--template=');
await writeFile(join(repositoryPath, 'logic.txt'), 'committed source\n');
await writeFile(join(repositoryPath, 'check.sh'), '#!/bin/sh\nexit 0\n');
await chmod(join(repositoryPath, 'check.sh'), 0o755);
git(repositoryPath, 'add', '.');
git(repositoryPath, 'commit', '-m', 'fixture base');
const project = { id: 'vanguard', repositoryPath };
const execution = composed({
  async run(input) {
    const state = fabricatedQualified(input.runId);
    await writeState(input.directory, state);
    input.saveQualification(state);
    writeFileSync(join(root, 'application-input.json'), JSON.stringify({ stateDir, project, runId: input.runId }), { mode: 0o600 });
    return receiptFor(input, state.verdict);
  },
  // The receipt settled; the application is draining and has not finalized.
  close() { process.kill(process.pid, 'SIGKILL'); return new Promise(() => {}); },
});
const factory = await openFactory({ stateDir, project, workspace, execution });
await factory.startRun({ requestId: 'crash', brief, dependencyRunId, scope });
await new Promise(() => {});
