// Independently specified task oracle: accepted Q21/Q24 and the retained static
// task facts. Never inferred from a model-selected test name or process exit.
export const SELECTION = Object.freeze({
  version: 1, id: 'normalize-address-whitespace-v1',
  provenance: 'Phase 1 Q21/Q24; retained 2026-11-02 normalizeAddress examples',
  helper: 'convex/syncHelpers.ts', test: 'lib/__tests__/normalize-address.test.ts',
  cases: [
    { id: 'hash-separated-unit', input: '100 Main Street # 2', expected: '100 MAIN ST 2', baseActual: '100 MAIN ST  2' },
    { id: 'trailing-period', input: '100 Main St .', expected: '100 MAIN ST', baseActual: '100 MAIN ST ' },
    { id: 'compact-unit', input: '100 Main Street #2', expected: '100 MAIN ST 2', baseActual: '100 MAIN ST 2' },
    { id: 'unit-preservation', input: '100 Main Street # 23B', expected: '100 MAIN ST 23B', baseActual: '100 MAIN ST  23B' },
    { id: 'abbreviation-preservation', input: ' 100  Main Street ', expected: '100 MAIN ST', baseActual: '100 MAIN ST' },
  ],
});
export const selectedTest = `import { test, expect } from '/work/node_modules/vitest/dist/index.js';
import { normalizeAddress } from '/work/convex/syncHelpers.ts';
const cases = ${JSON.stringify(SELECTION.cases)};
for (const item of cases) test(item.id, () => { expect(normalizeAddress(item.input)).toBe(item.expected); });
`;
export const selectedConfig = `export default { root: '/work', test: { include: ['/verification/selected.test.mjs'],
  environment: 'node', maxWorkers: 2, minWorkers: 1, isolate: true, retry: 0 } };\n`;
// Compatibility is deliberately gated in qualification.mjs. This legacy reporter
// shape has controlled coverage only; no real Vitest version is authorized yet.
export const selectedReporter = `export default class Reporter {
  onFinished(files, errors) {
    const cases = []; const failures = [...(errors ?? [])];
    const walk = tasks => { for (const t of tasks ?? []) {
      if (t.type === 'suite') { failures.push(...(t.result?.errors ?? [])); walk(t.tasks); }
      else cases.push({ id: t.name, state: t.result?.state,
        errors: (t.result?.errors ?? []).map(e => ({ name: e.name, actual: e.actual, expected: e.expected, operator: e.operator })) });
    } };
    for (const f of files ?? []) { failures.push(...(f.result?.errors ?? [])); walk(f.tasks); }
    console.log(JSON.stringify({ protocol: 'factory-vitest-selection-v1', files: (files ?? []).map(f => f.filepath), cases,
      errors: failures.map(e => ({ name: e.name })) }));
  }
}\n`;
// The controlled final runner emits the same narrow report. Owner/default Vitest
// output is not declared compatible by this parser.
export function finalVitestEvidence(result) {
  try {
    const report = JSON.parse(result.output);
    if (report.protocol !== 'factory-vitest-selection-v1' || !Array.isArray(report.files)
      || !report.files.includes(`/work/${SELECTION.test}`) || !Array.isArray(report.errors) || report.errors.length
      || !Array.isArray(report.cases) || !report.cases.length
      || report.cases.some(c => typeof c.id !== 'string' || !c.id || c.state !== 'pass' || !Array.isArray(c.errors) || c.errors.length)) throw new Error();
    return report;
  } catch { const error = new Error('Final Vitest evidence must contain executed, passing tests.'); error.code = 'FINAL_VITEST_UNVERIFIED'; throw error; }
}
export function regressionEvidence(result, phase) {
  const bad = () => { const error = new Error('The selected assertion evidence is unsupported or does not match the task oracle.'); error.code = 'REGRESSION_UNVERIFIED'; throw error; };
  if (result.exitSignal !== null || result.reason !== (phase === 'base' ? 'exit' : 'passed')
    || result.exitCode !== (phase === 'base' ? 1 : 0)) bad();
  let report;
  try { report = JSON.parse(result.output); } catch { bad(); }
  if (report?.protocol !== 'factory-vitest-selection-v1'
    || JSON.stringify(report.files) !== JSON.stringify(['/verification/selected.test.mjs'])
    || !Array.isArray(report.errors) || report.errors.length || !Array.isArray(report.cases)
    || report.cases.length !== SELECTION.cases.length) bad();
  for (let i = 0; i < SELECTION.cases.length; i++) {
    const expected = SELECTION.cases[i]; const actual = report.cases[i];
    const failed = phase === 'base' && expected.baseActual !== expected.expected;
    if (actual.id !== expected.id || actual.state !== (failed ? 'fail' : 'pass') || !Array.isArray(actual.errors)) bad();
    if (failed) {
      if (actual.errors.length !== 1 || actual.errors[0].name !== 'AssertionError'
        || actual.errors[0].operator !== 'strictEqual' || actual.errors[0].actual !== expected.baseActual
        || actual.errors[0].expected !== expected.expected) bad();
    } else if (actual.errors.length) bad();
  }
  return report;
}
