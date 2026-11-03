import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const reporter = readFileSync(new URL('./qualification-reporter.mjs', import.meta.url), 'utf8');
export const protocol = 'factory-vitest-4.0.17-v2';
export const probeTest = `import { test, expect } from '/work/node_modules/vitest/dist/index.js';
test('probe-pass', () => expect('factory expected').toBe('factory expected'));
test('probe-fail', () => expect('factory actual').toBe('factory expected'));
test('probe-empty', () => {});
test.skip('probe-skip', () => expect('never').toBe('executed'));
`;
export const reportOperations = ['runner-probe', 'selected-regression', 'candidate-regression', 'qualification-vitest'];
export function reportConfig(operation) {
  if (operation === 'qualification-vitest') return undefined; // Preserve the repository's final-suite configuration.
  const file = operation === 'runner-probe' ? '/verification/probe.test.mjs'
    : operation === 'selected-regression' ? '/verification/selected.test.mjs' : '/work/lib/__tests__/normalize-address.test.ts';
  return `export default { root: '/work', cacheDir: '/tmp/factory-vitest', test: { include: [${JSON.stringify(file)}], environment: 'node',
    watch: false, maxWorkers: 2, fileParallelism: false, isolate: true, retry: 0, allowOnly: false,
    passWithNoTests: false, expect: { requireAssertions: true } } };\n`;
}
export function reportFiles(operation, selectedTest) {
  if (!reportOperations.includes(operation)) return undefined;
  return { 'reporter.mjs': reporter, ...(reportConfig(operation) ? { 'config.mjs': reportConfig(operation) } : {}),
    ...(operation === 'selected-regression' ? { 'selected.test.mjs': selectedTest } : {}),
    ...(operation === 'runner-probe' ? { 'probe.test.mjs': probeTest } : {}) };
}
export const filesDigest = files => createHash('sha256').update(JSON.stringify(files)).digest('hex');
const bad = () => { throw Object.assign(new Error('Unsupported, incomplete, or inconsistent structured runner evidence.'), { code: 'REGRESSION_UNVERIFIED' }); };
export function parseReport(result) {
  let report;
  try {
    const frame = Buffer.from(result.report, 'utf8');
    const newline = frame.indexOf(10); const header = frame.subarray(0, newline).toString();
    if (!/^[1-9][0-9]{0,5}$/.test(header) || Number(header) > 256 * 1024 || frame.at(-1) !== 10
      || frame.length !== newline + 1 + Number(header) + 1) bad();
    report = JSON.parse(frame.subarray(newline + 1, -1).toString());
    if (report.protocol !== protocol || JSON.stringify(report.binding) !== JSON.stringify(result.reportBinding)
      || report.runtime?.node !== '24.21.0' || report.runtime.vitest !== '4.0.17'
      || !/^[a-f0-9]{64}$/.test(report.runtime.manifestDigest) || !Array.isArray(report.files) || !report.files.length
      || !Array.isArray(report.errors) || report.errors.length || !Array.isArray(report.cases) || !report.cases.length
      || !['passed', 'failed'].includes(report.reason) || result.exitSignal !== null
      || result.exitCode !== (report.reason === 'passed' ? 0 : 1)
      || result.reason !== (report.reason === 'passed' ? 'passed' : 'exit')) bad();
    const paths = new Set(); const ids = new Set();
    for (const file of report.files) {
      if (typeof file.path !== 'string' || paths.has(file.path) || !['passed', 'failed'].includes(file.state)) bad();
      paths.add(file.path);
    }
    for (const c of report.cases) {
      if (typeof c.id !== 'string' || !c.id || ids.has(c.id) || typeof c.name !== 'string' || !c.name || !paths.has(c.file)
        || !['passed', 'failed', 'skipped'].includes(c.state) || !Array.isArray(c.errors)) bad();
      ids.add(c.id);
      if (c.state !== 'skipped' && (c.ready !== true || c.completed !== true || !Number.isFinite(c.diagnostic?.startTime)
        || c.diagnostic.startTime <= 0 || !Number.isFinite(c.diagnostic.duration) || c.diagnostic.duration < 0
        || c.diagnostic.retryCount !== 0 || c.diagnostic.repeatCount !== 0)) bad();
      if ((c.state === 'failed') !== Boolean(c.errors.length)) bad();
    }
    for (const file of report.files) {
      const cases = report.cases.filter(c => c.file === file.path);
      if (!cases.length || (file.state === 'failed') !== cases.some(c => c.state === 'failed')) bad();
    }
    if ((report.reason === 'failed') !== report.cases.some(c => c.state === 'failed')) bad();
  } catch { bad(); }
  return report;
}
export function assertion(error, actual, expected) {
  return error?.name === 'AssertionError' && error.actual === actual && error.expected === expected
    && typeof error.message === 'string' && error.message.endsWith('// Object.is equality');
}
export function probeEvidence(result) {
  const report = parseReport(result); const cases = report.cases;
  if (report.files.length !== 1 || report.files[0].path !== '/verification/probe.test.mjs' || cases.length !== 4
    || cases.map(c => c.name).join(',') !== 'probe-pass,probe-fail,probe-empty,probe-skip'
    || cases.map(c => c.state).join(',') !== 'passed,failed,failed,skipped'
    || cases[1].errors.length !== 1 || !assertion(cases[1].errors[0], 'factory actual', 'factory expected')
    || cases[2].errors.length !== 1 || cases[2].errors[0].name !== 'Error'
    || cases[2].errors[0].message !== 'expected any number of assertion, but got none') bad();
  return report.runtime;
}
