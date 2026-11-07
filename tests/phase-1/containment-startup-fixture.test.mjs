import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { stopPreparationStartup } from '../../src/containment-startup-fixture.mjs';

test('startup faults use the host disposable-root contract for both stages', () => {
  const originalTmpdir = process.env.TMPDIR;
  const spawn = childProcess.spawn;
  try {
    for (const parent of [undefined, join(process.cwd(), 'private-host-tmp')]) {
      if (parent === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = parent;
      const root = join(tmpdir(), 'factory-dependencies-Ab12cd');
      for (const stage of ['proof', 'target']) {
        const fault = stopPreparationStartup(root, stage, {});
        try { assert.notEqual(childProcess.spawn, spawn); }
        finally { fault.restore(); }
        assert.equal(childProcess.spawn, spawn);
        for (const invalid of [`${root}/nested`, `${tmpdir()}/other/factory-dependencies-Ab12cd`, `${tmpdir()}/../factory-dependencies-Ab12cd`,
          join(tmpdir(), 'factory-dependencies-bad-name')]) {
          assert.throws(() => stopPreparationStartup(invalid, stage, {}), /Disposable startup fixture required/);
          assert.equal(childProcess.spawn, spawn);
        }
      }
      assert.throws(() => stopPreparationStartup(root, 'unknown', {}), /Disposable startup fixture required/);
    }
  } finally {
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
  }
});
