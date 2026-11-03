import { admitDependencies, prepareDependencies, inspectDependencies, serializeDependencyError } from './dependencies.mjs';
import { verifyContainmentEnvelope } from './containment.mjs';
import { requireWorkspaceQuiescence } from './workspace-run.mjs';
import { FactoryError } from './storage.mjs';

const preparation = { admit: admitDependencies, prepare: prepareDependencies };
function requireIntent(record, stateDir) {
  const intent = record.dependencies?.intent;
  if (!intent || intent.workspaceIntent.stateDir !== stateDir || intent.workspaceIntent.runId !== record.id
    || JSON.stringify(intent.workspaceIntent) !== JSON.stringify(record.workspace?.intent)) {
    throw new FactoryError('DEPENDENCIES_UNSAFE', 'The dependency intent does not belong to this run and saved workspace.');
  }
  return intent;
}

/** Passive projection only: never creates a process, repairs artifacts, or installs. */
export async function observeDependencies(record, stateDir) {
  if (!record.dependencies?.intent) return record;
  try {
    const receipt = await inspectDependencies(requireIntent(record, stateDir));
    record.dependencies.artifactStatus = receipt.status;
    if (receipt.status === 'prepared') record.dependencies.receipt = receipt;
    delete record.dependencies.inspectionFailure;
  } catch (error) {
    record.dependencies.artifactStatus = 'invalid';
    record.dependencies.inspectionFailure = serializeDependencyError(error);
  }
  return record;
}

/** A source receipt alone cannot establish quiescence for an interrupted installer. */
export async function requireDependencyQuiescence(record, stateDir) {
  if (!record.dependencies) return;
  // Admission itself launches no process and saves its intent before preparation can start.
  if (!record.dependencies.intent) return;
  await observeDependencies(record, stateDir);
  if (record.dependencies.inspectionFailure || record.dependencies.artifactStatus !== 'prepared') {
    throw new FactoryError('DEPENDENCIES_RECOVERY_REQUIRED', 'Interrupted dependency preparation has not confirmed quiescence. Retain its artifacts for trusted reconciliation.');
  }
}

/** Called only by the explicit owner operation while the application holds lifetime ownership. */
export async function prepareRunDependencies({ get, save, stateDir, signal, dependencyPreparation = preparation }) {
  let record = get();
  try {
    await verifyContainmentEnvelope();
    await requireWorkspaceQuiescence(record, stateDir);
    const intent = await dependencyPreparation.admit({ workspaceIntent: record.workspace.intent,
      bunPath: record.dependencies.bunPath, registry: record.dependencies.registry === true });
    record = get();
    record.dependencies.intent = intent;
    record.dependencies.status = 'preparing';
    record.dependencies.artifactStatus = 'not-prepared';
    requireIntent(record, stateDir);
    save(record); // Save exact intent before any installer, fetch, or retained preparation effect.
    const receipt = await dependencyPreparation.prepare(intent, { signal, authorizeRegistryFetch: record.dependencies.registry === true });
    record = get();
    record.dependencies.receipt = receipt;
    record.dependencies.status = 'prepared';
    record.dependencies.artifactStatus = 'prepared';
    delete record.dependencies.failure;
    save(record); // A later executor must see the saved receipt, not a caller's prepared flag.
  } catch (error) {
    const drainFailed = ['MODEL_DRAIN_FAILED', 'DRAIN_FAILED'].includes(error?.code);
    try {
      record = get();
      record.dependencies.status = 'failed';
      record.dependencies.failure = error?.code === 'CONTAINMENT_REQUIRED'
        ? { code: 'CONTAINMENT_REQUIRED', message: 'Dependency preparation requires the verified foreground resource scope. No fallback was attempted.' }
        : serializeDependencyError(error);
      save(record);
    } catch (receiptError) {
      // Reporting failure cannot turn uncertain drainage into an ordinary failure
      // and release the application's live ownership fence.
      if (!drainFailed) throw receiptError;
    }
    if (error instanceof FactoryError || drainFailed) throw error;
    throw new FactoryError(record.dependencies.failure.code, record.dependencies.failure.message);
  }
}
