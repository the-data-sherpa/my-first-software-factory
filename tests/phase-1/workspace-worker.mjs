import { readFile } from 'node:fs/promises';
import { prepareWorkspace } from '../../src/workspace.mjs';

// Disposable-fixture process boundary. No factory/model/backend initialization.
const intent = JSON.parse(await readFile(process.argv[2], 'utf8'));
await prepareWorkspace(intent);
process.disconnect();
