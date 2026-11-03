import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFixtureExecution } from '../../src/execution.mjs';

// Deliberately NOT a containment adapter. This fixture owns only one in-process write;
// process death establishes quiescence, but the deliberately partial write is not replay-safe.
export function createPartialEffectFixture({ delayMs = 60_000 } = {}) {
  const fixture = createFixtureExecution({ delayMs });
  return { ...fixture, mode: 'partial-effect-fixture',
    async start(input) {
      input.budget.reserveToolRound({ roundId: 'partial-write' });
      await writeFile(join(input.directory, 'partial-effect.txt'), 'partial effect; do not replay', { mode: 0o600, flag: 'wx' });
      return fixture.start(input);
    },
    async assessRecovery({ directory }) {
      const partial = await readFile(join(directory, 'partial-effect.txt'), 'utf8');
      return { kind: 'partial-effect-fixture', quiescent: true, resumable: false,
        evidence: `One in-process file write, no children or network. Retained but unreconciled: ${partial}` };
    },
  };
}
