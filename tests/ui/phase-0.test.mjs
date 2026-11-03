// Minimal browser adapter spike, not the upstream UI or the Phase 1 application.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { startWorker, until, assertOneInput } from '../phase-0/helpers.mjs';

const html = `<!doctype html><html lang="en"><title>Phase 0 reconnect probe</title>
<h1>Phase 0 reconnect probe</h1><pre id="state">Connecting</pre><script>
async function refresh() {
  try {
    const response = await fetch('/state', { cache: 'no-store' });
    if (!response.ok) throw Error('disconnected');
    document.querySelector('#state').textContent = JSON.stringify(await response.json());
  } catch { document.querySelector('#state').textContent = 'Disconnected'; }
  setTimeout(refresh, 50);
}
refresh();
</script></html>`;

test('live browser polling recovers across a worker outage, then a new tab shows completion', { timeout: 30_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-ui-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let worker = await startWorker(t, directory, 'approval');
  const before = await until(worker.snapshot, (state) => Object.keys(state.approvals?.items ?? {}).length === 1);
  const taskId = Object.values(before.approvals.items)[0].taskId;
  const server = createServer(async (request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html' }).end(html);
    } else if (request.url === '/state') {
      try {
        const state = await worker.snapshot();
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({
          submissionId: state.submission.id, status: state.submission.status,
          approvals: state.approvals, live: state.view.docs['pi.live'],
          transcript: state.view.entries.filter((entry) => entry.kind !== 'pi.system'),
        }));
      } catch { response.writeHead(503).end(); }
    } else response.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  // Use Playwright's installed Chromium by default, or an explicitly supplied system binary.
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  t.after(() => browser.close());
  const url = `http://127.0.0.1:${server.address().port}/`;
  let page = await browser.newPage();
  const displayed = async () => {
    const text = await page.locator('#state').textContent();
    try { return JSON.parse(text); } catch { return null; }
  };
  const isPending = (state) => state && Object.values(state.approvals?.items ?? {}).some((item) => item.status === 'pending');
  await page.goto(url);
  await until(displayed, isPending);
  await worker.stop();
  worker = undefined;
  // Keep this exact page open: the browser must render a failed read, retry, and recover.
  await until(() => page.locator('#state').textContent(), (text) => text === 'Disconnected');
  worker = await startWorker(t, directory, 'approval');
  const pending = await until(displayed, isPending);
  assert.equal(pending.submissionId, before.submission.id);
  assert.equal(Object.values(pending.approvals.items)[0].taskId, taskId);
  assert.equal(pending.approvals.effects, 0);
  await page.close();
  // No browser is connected while the human decision settles the run.
  await worker.request('decide', { decision: 'approved' });
  const done = await worker.done();
  assertOneInput(done);
  page = await browser.newPage();
  await page.goto(url);
  const final = await until(displayed, (state) => state?.status === 'done');
  assert.equal(final.submissionId, before.submission.id);
  assert.equal(final.approvals.effects, 1);
  assert.match(JSON.stringify(final.transcript), /Phase 0 complete/);
  assert.equal(final.live.run, undefined);
});
