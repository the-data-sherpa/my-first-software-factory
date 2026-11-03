// Disposable Phase 0 process, never a production runner. No credentials or network models.
import { appendFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import {
  Harness, createRegistry, defineDoc, defineTask, defineExtension, defineTool, hook, ToolTask,
} from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { CodingTools } from '@earendil-works/pi-durable/tools';
import { obj } from '@earendil-works/pi-schema';

const [directory, scenario] = process.argv.slice(2);
const send = (message) => process.send?.(message);
const exists = (file) => access(file).then(() => true, () => false);
const forever = () => new Promise(() => {});
const Approvals = defineDoc({
  kind: 'probe.approvals', version: 1, scope: 'session',
  initial: () => ({ items: {}, effects: 0 }), checkpointWhen: () => true,
});
const ApprovalTask = defineTask({
  name: 'probe.approval', version: 1, initial: () => ({ phase: 'wait' }),
  phases: {
    wait: async (task, runtime, ctx) => {
      const item = (await runtime.snapshot(Approvals, ctx)).items[task.input.key];
      if (item.status === 'pending') {
        await runtime.sleepUntil(runtime.now() + 50, { phase: 'wait' }, ctx);
        return;
      }
      if (scenario === 'approval-after-decision' && !(await exists(join(directory, 'release')))) {
        send({ event: 'decision-observed' });
        await forever(); // Deterministic kill point after the decision commit, before the fake effect.
      }
      // A fake local effect and its receipt are atomic. NOT an exactly-once external API example.
      await runtime.commit(async (tx) => {
        const doc = await tx.doc(Approvals);
        if (item.status === 'approved') doc.effects++;
        return { status: 'terminal', outcome: { status: 'completed', result: item.status } };
      }, ctx);
    },
  },
  abort: (_task, runtime, ctx) => runtime.commit(
    () => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx,
  ),
});
const approvalTool = defineTool({
  name: 'approval', description: 'Wait for a recorded human decision', parameters: obj({}), replay: 'safe',
  execute: async (_args, api, ctx) => {
    const key = String(api.taskId);
    const child = await api.commit(async (tx) => {
      const doc = await tx.doc(Approvals);
      if (doc.items[key]) return doc.items[key].taskId;
      const taskId = await tx.createTask(ApprovalTask, { key }, {
        ownership: { kind: 'task', taskId: api.taskId },
      });
      doc.items[key] = { taskId, status: 'pending', proposal: 'fake-local-effect-v1' };
      return taskId;
    }, ctx);
    send({ event: 'approval-waiting' });
    const result = await api.waitForTask(child, ctx);
    return { output: [{ type: 'text', text: JSON.stringify(result.state.outcome) }] };
  },
});
const probeTool = defineTool({
  name: 'probe', description: 'A controlled crash checkpoint', parameters: obj({}),
  replay: scenario === 'unsafe' ? 'unsafe' : 'safe',
  execute: async () => {
    await appendFile(join(directory, 'executions.log'), 'executed\n');
    send({ event: 'executing' });
    if (!(await exists(join(directory, 'release')))) await forever();
    return { output: [{ type: 'text', text: 'probe completed' }] };
  },
});
const registry = createRegistry();
registry.install(CodingTools);
registry.install(defineExtension({
  name: 'probe', tools: [probeTool, approvalTool], tasks: [ApprovalTask],
  hooks: [hook(ToolTask, {
    beforeTool: (call) => call.name === 'bash' && call.arguments.command === 'git push'
      ? { block: 'Publishing requires approval (Phase 0 fixture only)' } : undefined,
  })],
}));
const models = createModels();
const faux = fauxProvider({ tokensPerSecond: Infinity });
models.setProvider(faux.provider);
faux.setResponses(Array.from({ length: 10 }, () => async (transcript) => {
  await appendFile(join(directory, 'model-requests.log'), 'request\n');
  send({ event: 'model-request' });
  if (scenario === 'model-crash' && !(await exists(join(directory, 'release')))) {
    await forever();
  }
  if (scenario === 'model-crash' || transcript.messages.some((message) => message.role === 'toolResult')) {
    return fauxAssistantMessage('Phase 0 complete');
  }
  const tool = scenario.startsWith('approval') ? 'approval' : scenario === 'blocked' ? 'bash' : 'probe';
  return fauxAssistantMessage(fauxToolCall(tool, tool === 'bash' ? { command: 'git push' } : {}), { stopReason: 'toolUse' });
}));
const reports = [];
const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'run.sqlite')), {
  models, registry,
  env: ({ cwd }) => {
    const env = new NodeExecutionEnv({ cwd });
    // Even a broken guard must never actually publish during this experiment.
    env.exec = async () => {
      await appendFile(join(directory, 'shell-executions.log'), 'attempted\n');
      throw new Error('Phase 0 fixture refuses all real shell execution');
    };
    return env;
  },
  settings: { retry: { maxRetries: 2, baseDelayMs: 1 }, compaction: { enabled: false } },
  onReport: (report) => reports.push({ kind: report.kind, reason: report.reason }),
}, context);
const model = faux.getModel();
const root = await harness.root(context, {
  agent: { model: { provider: model.provider, modelId: model.id }, cwd: directory, maxTurns: 4 },
});
// Deliberately repeat admission after a restart; requestId must find the original submission.
const submission = await root.submit({ type: 'input', content: `Run ${scenario}`, requestId: 'phase0-manual-1' }, context);
harness.resume();
let watch = await root.watch(context);
watch.start(() => {});

process.on('message', async ({ id, command, decision }) => {
  try {
    let value;
    if (command === 'snapshot' || command === 'reconnect') {
      if (command === 'reconnect') {
        await watch.stop();
        watch = await root.watch(context);
        watch.start(() => {});
      }
      // A newly attached watch supplies authoritative state, not an event replay.
      const snapshot = await root.watch(context);
      value = { submission: await submission.status(context), view: snapshot.value,
        approvals: await harness.snapshot(Approvals, context), reports };
      await snapshot.stop();
    } else if (command === 'decide') {
      if (!['approved', 'rejected'].includes(decision)) throw new Error('Invalid decision');
      await harness.commit(async (tx) => {
        const doc = await tx.doc(Approvals);
        const item = Object.values(doc.items).find((candidate) => candidate.status === 'pending');
        if (!item) throw new Error('No pending proposal');
        const task = await tx.task(item.taskId);
        if (!task || task.abortRequested || ['completing', 'terminal'].includes(task.state.status)) {
          throw new Error('Approval task is no longer active');
        }
        item.status = decision;
        item.approver = 'phase0-test-human';
        item.decidedAt = new Date().toISOString();
      }, context);
      value = true;
    } else if (command === 'idle') {
      await root.waitForIdle(context);
      value = true;
    } else if (command === 'close') {
      await watch.stop();
      await harness.close(context);
      send({ id, value: true });
      process.disconnect();
      return;
    } else throw new Error('Unknown command');
    send({ id, value });
  } catch (error) {
    send({ id, error: error.message });
  }
});
send({ event: 'ready', submissionId: submission.id });
