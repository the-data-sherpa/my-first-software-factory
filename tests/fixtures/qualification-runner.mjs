// Synthetic framework executable. Loads emitted config and reporter, runs actual
// disposable test functions, then supplies documented Vitest 4.0.17 events.
import { existsSync, readFileSync, writeSync } from 'node:fs';
const scenario = SCENARIO;
const argv = process.argv.slice(2);
const option = name => argv[argv.indexOf(name) + 1];
const reported = argv.includes('--reporter');
const config = argv.includes('--config') ? (await import(option('--config'))).default.test : {};
const selected = config.include?.[0] === '/verification/selected.test.mjs';
const candidate = config.include?.[0] === '/work/lib/__tests__/normalize-address.test.ts';
const probe = config.include?.[0] === '/verification/probe.test.mjs';
const final = reported && !argv.includes('--config');
if (selected && scenario === 'crash') throw new Error('Controlled check crash, not a regression.');
if (selected && scenario === 'slow') await new Promise(r => setTimeout(r, 10000));
const files = config.include ?? ['/work/lib/__tests__/existing.test.ts',
  ...(existsSync('/work/lib/__tests__/normalize-address.test.ts') ? ['/work/lib/__tests__/normalize-address.test.ts'] : [])];
let reporter;
if (reported && scenario !== 'ignored-reporter') {
  const Reporter = (await import(option('--reporter'))).default;
  reporter = new Reporter();
  // Vitest 4.0.17 resolves fileParallelism:false to maxWorkers:1, even when
  // --maxWorkers=2 was supplied. Exercise resolved config, not requested limits.
  const fileParallelism = !argv.includes('--no-file-parallelism') && config.fileParallelism !== false;
  // CLI --pool overrides config; Vitest 4.0.17 defaults to forks. The
  // final-pool-threads repository configuration selects threads.
  const cliPool = argv.find(a => a.startsWith('--pool='))?.slice(7) ?? (argv.includes('--pool') ? option('--pool') : undefined);
  const pool = scenario === 'runner-pool-threads' ? 'threads'
    : cliPool ?? config.pool ?? (final && scenario === 'final-pool-threads' ? 'threads' : 'forks');
  if (scenario === 'final-pool-threads' && final) console.log(JSON.stringify({ fixturePool: pool, cliPool: cliPool ?? null }));
  reporter.onInit({ version: JSON.parse(readFileSync('/work/node_modules/vitest/package.json')).version,
    config: { ...config, watch: false,
      fileParallelism: scenario === 'runner-file-parallelism' ? true : fileParallelism,
      maxWorkers: scenario === 'runner-worker-count' ? 2 : fileParallelism ? 2 : 1,
      pool, retry: 0, allowOnly: false, passWithNoTests: false } });
  reporter.onTestRunStart([]);
}
const modules = []; let failed = false;
for (const file of files) {
  globalThis.fixtureTests = [];
  await import(file);
  const cases = []; const module = { type: 'module', moduleId: file, children: cases, errors: () => [],
    state: () => cases.some(t => t.result().state === 'failed') ? 'failed' : 'passed' };
  for (const [index, test] of globalThis.fixtureTests.entries()) {
    if (probe && scenario === 'probe-skips-run') test.skip = false;
    let state = test.skip ? 'skipped' : 'passed'; let errors = []; const startTime = Date.now();
    const task = { type: 'test', id: file + ':' + index, fullName: test.name, module,
      result: () => ({ state, errors }), diagnostic: () => state === 'skipped' ? undefined
        : { startTime, duration: Date.now() - startTime, retryCount: 0, repeatCount: 0 } };
    if (!test.skip) {
      if (scenario !== 'report-missing-events') reporter?.onTestCaseReady(task);
      globalThis.fixtureAssertions = 0;
      try {
        await test.run();
        if (scenario !== 'probe-empty-passes' && config.expect?.requireAssertions && globalThis.fixtureAssertions === 0) throw new Error('expected any number of assertion, but got none');
      } catch (e) { state = 'failed'; errors = [e]; }
    }
    if (selected && index === 0) {
      if (scenario === 'wrong-case') task.fullName = 'unrelated-test';
      if (scenario === 'wrong-assertion') errors[0].actual = 'unrelated';
      if (scenario === 'skipped') { state = 'skipped'; errors = []; }
    }
    if (final && scenario === 'final-skipped') { state = 'skipped'; errors = []; }
    if (final && scenario === 'final-renamed-candidate' && file.endsWith('normalize-address.test.ts')) task.fullName = 'different executed test';
    if (scenario !== 'report-missing-events') reporter?.onTestCaseResult(task);
    cases.push(task);
  }
  if ((selected && scenario === 'no-tests') || (final && scenario === 'final-no-tests')) cases.length = 0;
  if (cases.some(c => c.result().state === 'failed')) failed = true;
  if (!(final && scenario === 'final-missing-candidate' && file.endsWith('normalize-address.test.ts'))) modules.push(module);
}
process.exitCode = failed ? 1 : 0;
// Banners and test logs are not a report channel and must never become evidence.
console.log('Controlled framework banner and ordinary test output');
if (reported && scenario === 'report-stdout') {
  console.log(JSON.stringify({ protocol: 'fake-pass', files }));
} else if (selected && scenario === 'malformed') writeSync(6, 'not a report\n');
else if (reported && scenario === 'report-truncated') writeSync(6, '999\n{}\n');
else {
  reporter?.onTestRunEnd(modules, selected && scenario === 'unrelated-error' ? [new Error('Unrelated error')] : [], scenario === 'report-inconsistent' ? 'passed' : failed ? 'failed' : 'passed');
  if (reported && scenario === 'report-duplicate') writeSync(6, '2\n{}\n');
  if (reported && scenario === 'report-overflow') { console.log('x'.repeat(800000)); writeSync(6, 'x'.repeat(300000)); }
}
if (final && scenario === 'final-vitest') process.exitCode = 3;
