import { parseReport, assertion } from './qualification-reporting.mjs';
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
for (const item of cases) test(item.id, () => {
  const actual = normalizeAddress(item.input);
  expect(actual).toBe(item.expected);
  // Object.is behind toBe is mutable shared state; typeof and === are not.
  if (typeof actual !== 'string' || actual !== item.expected) throw new Error('Strict string equality failed after toBe.');
});
`;
const bad = () => { throw Object.assign(new Error('The executed candidate or oracle does not establish the selected regression.'), { code: 'REGRESSION_UNVERIFIED' }); };
export function regressionEvidence(result, phase) {
  const report = parseReport(result);
  if (report.files.length !== 1 || report.files[0].path !== '/verification/selected.test.mjs'
    || report.cases.length !== SELECTION.cases.length) bad();
  for (let i = 0; i < SELECTION.cases.length; i++) {
    const expected = SELECTION.cases[i]; const actual = report.cases[i];
    const failed = phase === 'base' && expected.baseActual !== expected.expected;
    if (actual.name !== expected.id || actual.state !== (failed ? 'failed' : 'passed')) bad();
    if (failed && (actual.errors.length !== 1 || !assertion(actual.errors[0], expected.baseActual, expected.expected))) bad();
  }
  return report;
}
export function candidateEvidence(baseResult, draftResult) {
  const base = parseReport(baseResult);
  if (base.files.length !== 1 || base.files[0].path !== `/work/${SELECTION.test}`
    || !base.cases.some(c => c.state === 'failed')) bad();
  for (const c of base.cases) {
    if (!['passed', 'failed'].includes(c.state)) bad();
    if (c.state === 'failed' && (c.errors.length !== 1 || !SELECTION.cases.some(oracle => oracle.baseActual !== oracle.expected
      && assertion(c.errors[0], oracle.baseActual, oracle.expected)))) bad();
  }
  if (draftResult) {
    const draft = parseReport(draftResult);
    if (JSON.stringify(base.runtime) !== JSON.stringify(draft.runtime) || draft.files.length !== 1
      || draft.files[0].path !== `/work/${SELECTION.test}` || draft.cases.length !== base.cases.length) bad();
    for (let i = 0; i < base.cases.length; i++) {
      if (draft.cases[i].id !== base.cases[i].id || draft.cases[i].name !== base.cases[i].name || draft.cases[i].state !== 'passed') bad();
    }
  }
  return base;
}
export function finalVitestEvidence(result, candidate) {
  try {
    const report = parseReport(result); const regression = parseReport(candidate);
    if (JSON.stringify(report.runtime) !== JSON.stringify(regression.runtime) || report.cases.some(c => c.state !== 'passed')) bad();
    const retained = report.cases.filter(c => c.file === `/work/${SELECTION.test}`);
    if (retained.length !== regression.cases.length || retained.some((c, i) => c.id !== regression.cases[i].id
      || c.name !== regression.cases[i].name)) bad();
    return report;
  } catch { throw Object.assign(new Error('Final Vitest evidence must contain the executed passing regression.'), { code: 'FINAL_VITEST_UNVERIFIED' }); }
}
