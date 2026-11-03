// Executed only inside the existing contained Vitest process. Pinned 4.0.17 API.
import { readFileSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
const binding = JSON.parse(readFileSync('/verification/binding.json', 'utf8'));
const digest = data => createHash('sha256').update(data).digest('hex');
const error = e => ({ name: e.name, message: e.message, actual: e.actual, expected: e.expected });
export default class QualificationReporter {
  ready = new Set();
  results = new Set();
  started = false;
  ended = false;
  onInit(ctx) {
    const bytes = readFileSync('/work/node_modules/vitest/package.json');
    const pkg = JSON.parse(bytes);
    const c = ctx.config;
    if (pkg.name !== 'vitest' || pkg.version !== '4.0.17' || ctx.version !== pkg.version
      || process.versions.node !== '24.21.0' || c.watch !== false || c.maxWorkers !== 1 || c.fileParallelism !== false
      || c.retry !== 0 || c.allowOnly !== false || c.passWithNoTests !== false
      || (binding.operation !== 'qualification-vitest' && c.expect.requireAssertions !== true)) throw new Error('Unsupported qualification runtime');
    this.runtime = { node: process.versions.node, vitest: ctx.version, manifestDigest: digest(bytes),
      maxWorkers: c.maxWorkers, fileParallelism: c.fileParallelism };
  }
  onTestRunStart() {
    if (this.started || !this.runtime) throw new Error('Duplicate or uninitialized test run');
    this.started = true;
  }
  onTestCaseReady(test) {
    if (this.ready.has(test.id)) throw new Error('Duplicate test execution');
    this.ready.add(test.id);
  }
  onTestCaseResult(test) {
    if (this.results.has(test.id)) throw new Error('Duplicate test result');
    this.results.add(test.id);
  }
  onTestRunEnd(modules, errors, reason) {
    if (!this.started || this.ended) throw new Error('Incomplete or duplicate test run');
    this.ended = true;
    const cases = []; const failures = errors.map(error);
    const walk = collection => {
      for (const task of collection) {
        if (task.type === 'suite') { failures.push(...task.errors().map(error)); walk(task.children); }
        else if (task.type === 'test') {
          const r = task.result(); const d = task.diagnostic();
          cases.push({ id: task.id, name: task.fullName, file: task.module.moduleId, state: r.state,
            ready: this.ready.has(task.id), completed: this.results.has(task.id),
            diagnostic: d && { startTime: d.startTime, duration: d.duration, retryCount: d.retryCount, repeatCount: d.repeatCount },
            errors: (r.errors ?? []).map(error) });
        } else throw new Error('Unknown test entity');
      }
    };
    const files = modules.map(m => {
      failures.push(...m.errors().map(error)); walk(m.children);
      return { path: m.moduleId, state: m.state() };
    });
    const report = { protocol: 'factory-vitest-4.0.17-v2', binding, runtime: this.runtime, reason, files, cases, errors: failures };
    const bytes = Buffer.from(JSON.stringify(report));
    if (bytes.length > 256 * 1024) throw new Error('Qualification report limit');
    const frame = Buffer.concat([Buffer.from(String(bytes.length) + '\n'), bytes, Buffer.from('\n')]);
    for (let offset = 0; offset < frame.length;) offset += writeSync(6, frame, offset);
  }
}
