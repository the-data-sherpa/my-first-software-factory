// Read-only configuration discovery. Never prints keys, endpoints, headers, or auth errors.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getAgentDir, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryModelsStore } from '@earendil-works/pi-ai';

export async function inspectLocalConfiguration(agentDir = getAgentDir()) {
  let credentials = {};
  try { credentials = JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const runtime = await ModelRuntime.create({
    modelsPath: join(agentDir, 'models.json'),
    // The snapshot cannot refresh OAuth or write the real credential file.
    credentials: {
      read: async (id) => credentials[id],
      list: async () => Object.entries(credentials).map(([providerId, credential]) => ({ providerId, type: credential.type })),
      modify: async () => { throw new Error('Read-only credential probe'); },
      delete: async () => { throw new Error('Read-only credential probe'); },
    },
    modelsStore: new InMemoryModelsStore(), refreshOnCreate: false, allowModelNetwork: false,
  });
  if (runtime.getError()) throw new Error('Local model configuration could not be loaded');
  const localModels = runtime.getModels('local-ai');
  const storedCredentialProviders = (await runtime.listCredentials()).map(({ providerId }) => providerId).sort();
  const requestAuthStatus = runtime.getProviderAuthStatus('local-ai');
  return {
    modelConfigurationLoaded: true,
    storedCredentialProviders,
    localAi: {
      present: runtime.getProvider('local-ai') !== undefined,
      models: localModels.map(({ id }) => id),
      hasStoredCredential: storedCredentialProviders.includes('local-ai'),
      // With refresh disabled, this category describes models.json request auth, not validated stored auth.
      configuredRequestAuth: requestAuthStatus.configured,
      requestAuthSource: requestAuthStatus.source ?? null,
    },
    modelNetwork: 'disabled by configuration; not a measured request count',
    credentialResolution: 'not attempted; no OAuth refresh or configured key commands',
    liveInference: 'not tested',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await inspectLocalConfiguration();
    console.log(JSON.stringify(report, null, 2));
    if (!report.localAi.present || report.localAi.models.length === 0) process.exitCode = 1;
  } catch {
    // Library messages can contain configuration or credential values. Do not echo them.
    console.error('Credential discovery failed; inspect your Pi configuration locally. No details logged.');
    process.exitCode = 1;
  }
}
