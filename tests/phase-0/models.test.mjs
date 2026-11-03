import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { inspectLocalConfiguration } from '../../scripts/phase-0/check-credentials.mjs';

for (const source of ['auth.json', 'models.json']) {
test(`ModelRuntime sends a durable local-ai run using a key from ${source}, without OpenRouter`, { timeout: 20_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-models-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ path: request.url, auth: request.headers.authorization, body: JSON.parse(body) });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [delta, finish_reason] of [[{ role: 'assistant', content: 'OK' }, null], [{}, 'stop']]) {
      response.write(`data: ${JSON.stringify({ id: 'phase0', object: 'chat.completion.chunk', created: 1,
        model: 'phase0-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    }
    response.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const authPath = join(directory, 'auth.json');
  const modelsPath = join(directory, 'models.json');
  await writeFile(authPath, JSON.stringify(source === 'auth.json'
    ? { 'local-ai': { type: 'api_key', key: 'fixture-only-key' } } : {}), { mode: 0o600 });
  await writeFile(modelsPath, JSON.stringify({ providers: { 'local-ai': {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', authHeader: true,
    ...(source === 'models.json' ? { apiKey: 'fixture-only-key' } : {}),
    models: [{ id: 'phase0-model', contextWindow: 32768, maxTokens: 16 }],
  } } }), { mode: 0o600 });
  const originalAuth = await readFile(authPath, 'utf8');
  const originalModels = await readFile(modelsPath, 'utf8');
  // Discovery must neither resolve auth nor touch the network or change files.
  const discovery = await inspectLocalConfiguration(directory);
  assert.equal(discovery.localAi.present, true);
  assert.deepEqual(discovery.localAi.models, ['phase0-model']);
  assert.equal(discovery.localAi.hasStoredCredential, source === 'auth.json');
  assert.equal(discovery.localAi.configuredRequestAuth, source === 'models.json');
  assert.equal(discovery.localAi.requestAuthSource, source === 'models.json' ? 'models_json_key' : null);
  assert.equal(requests.length, 0);
  const runtime = await ModelRuntime.create({ authPath, modelsPath,
    modelsStorePath: join(directory, 'models-store.json'), allowModelNetwork: false, refreshOnCreate: false });
  const harness = await Harness.open(new MemoryStorage(), {
    models: runtime, registry: createRegistry(),
    settings: { retry: { enabled: false }, compaction: { enabled: false }, stream: { timeoutMs: 5000, maxRetries: 0 } },
  }, context);
  t.after(() => harness.close(context));
  const root = await harness.root(context, { agent: { model: { provider: 'local-ai', modelId: 'phase0-model' }, maxTurns: 1 } });
  const settled = await (await root.submit({ type: 'input', content: 'Reply OK' }, context)).wait(context);
  assert.equal(settled.status, 'done');
  const answer = await root.commit((tx) => tx.entry(settled.answer), context);
  assert.equal(answer.model[0].content[0].text, 'OK');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/v1/chat/completions');
  assert.equal(requests[0].auth, 'Bearer fixture-only-key');
  assert.equal(requests[0].body.model, 'phase0-model');
  assert.equal(await readFile(authPath, 'utf8'), originalAuth);
  assert.equal(await readFile(modelsPath, 'utf8'), originalModels);
});
}
