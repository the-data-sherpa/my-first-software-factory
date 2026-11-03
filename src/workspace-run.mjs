import { inspectWorkspace, serializeWorkspaceError } from './workspace.mjs';
import { FactoryError } from './storage.mjs';

/** Passive application projection. Never repairs a workspace or consults the owner's repository. */
export async function observeWorkspace(record, stateDir) {
  if (!record.workspace?.intent) return record;
  const intent = record.workspace.intent;
  if (intent.stateDir !== stateDir || intent.runId !== record.id || intent.projectId !== record.project.id) {
    record.workspace.inspectionFailure = { code: 'WORKSPACE_RELOCATION_REQUIRED', message: 'The retained workspace belongs to another private location or run. Relocation is not supported.' };
    return record;
  }
  try {
    const artifact = await inspectWorkspace(intent);
    record.workspace.artifactStatus = artifact.status;
    if (artifact.status === 'prepared') record.workspace.receipt = artifact;
    delete record.workspace.inspectionFailure;
  } catch (error) { record.workspace.inspectionFailure = serializeWorkspaceError(error); }
  return record;
}

export async function prepareRunWorkspace({ get, save, stateDir, workspace, signal }) {
  let record = get();
  if (!record.workspace) return;
  if (!workspace) throw new FactoryError('WORKSPACE_NOT_ENABLED', 'This run requires explicit workspace preparation. No source was substituted.');
  try {
    if (!record.workspace.intent) {
      const intent = await workspace.admit({ stateDir, project: record.project, runId: record.id, signal });
      record = get();
      record.workspace.intent = intent;
      record.workspace.status = 'preparing';
      record.workspace.artifactStatus = 'not-prepared';
      save(record); // Immutable source intent precedes every retained Git/source effect.
    }
    const receipt = await workspace.prepare(record.workspace.intent, { signal });
    record = get();
    record.workspace.receipt = receipt;
    record.workspace.status = 'prepared';
    record.workspace.artifactStatus = 'prepared';
    delete record.workspace.failure;
    save(record); // A model, dependency operation, or tool may only see the retained receipt.
  } catch (error) {
    record = get();
    record.workspace.status = 'failed';
    record.workspace.failure = serializeWorkspaceError(error);
    save(record);
    throw error;
  }
}

export async function requireWorkspaceQuiescence(record, stateDir) {
  if (!record.workspace) return;
  await observeWorkspace(record, stateDir);
  if (record.workspace.inspectionFailure || record.workspace.artifactStatus !== 'prepared') {
    throw new FactoryError('WORKSPACE_RECOVERY_REQUIRED', 'Interrupted workspace preparation has not confirmed quiescence. Retain its artifacts for trusted reconciliation; no retry or replacement was started.');
  }
}
