// Authored helper shapes equivalent to the selected Vanguard helper's signature,
// guard, and `let` binding. They are tiny controlled fixtures, never the captured
// Vanguard module. The controlled model only proposes tool calls; the real executor
// tools write every draft byte.
import { writeFile, rm } from 'node:fs/promises';
import { eventsResponse } from '../phase-1/model-fixtures.mjs';
import { executorToolResponse } from './executor-model.mjs';
import { qualificationProject, candidateTest } from './qualification-project.mjs';
import { helperPath, testPath } from './qualified-execution-model.mjs';

const signature = 'export function normalizeAddress(raw: string | null | undefined): string {';
const guard = '  if (!raw) return "";';
const chain = "raw.trim().toUpperCase().replace(/\\s+/g, ' ').replace(/\\bSTREET\\b/g, 'ST').replace(/\\./g, '').replace(/#/g, '')";
const helper = (...body) => [signature, guard, ...body, '}', ''].join('\n');

// Same observable outputs as the existing controlled base for the five oracle cases.
export const nullableBase = helper('  // Canonical uppercase street form.', `  let normalized = ${chain};`, '  return normalized;');
export const nullableDraft = helper('  // Canonical uppercase street form.',
  `  let normalized = ${chain}.replace(/\\s+/g, ' ').trim();`, '  return normalized;');
export const writeLimitBase = nullableBase.replace(guard, `${guard}\n/*${'x'.repeat(65_536 - Buffer.byteLength(nullableBase) - 5)}*/`);

// The fixed five-case oracle has no null, undefined, or empty input. These extra
// authored candidate cases must pass on base and draft; candidateEvidence permits
// extra passing cases without changing the independent selection.
const nullableCases = `test('nullable contract returns empty', () => {
  expect(normalizeAddress(null)).toBe('');
  expect(normalizeAddress(undefined)).toBe('');
  expect(normalizeAddress('')).toBe('');
});
`;
export const nullableCandidate = candidateTest('green') + nullableCases;
export const mismatchedNullableCandidate = candidateTest('green') + nullableCases.replace("normalizeAddress(null)).toBe('')", "normalizeAddress(null)).toBe('NULL')");

// Draft bodies that keep a supported grammar but change the immutable envelope, or
// introduce a construct the grammar refuses.
export const draftVariants = {
  'changed-guard': nullableDraft.replace(guard, "  if (!raw) return '';"),
  'removed-guard': nullableDraft.replace(`${guard}\n`, ''),
  'changed-signature': nullableDraft.replace('raw: string | null | undefined', 'raw: string'),
  'draft-reassignment': nullableDraft.replace('  return normalized;', '  normalized = normalized.trim();\n  return normalized;'),
};

// Admitted bases outside the bounded grammar. Each must refuse before any ModelRuntime.
export const unsupportedBases = {
  'write-limit-comment': nullableBase.replace(guard, `${guard}\n/*${'x'.repeat(65_537 - Buffer.byteLength(nullableBase) - 5)}*/`),
  'oversized-comment': nullableBase.replace(guard, `${guard}\n/*${'x'.repeat(1_048_577 - Buffer.byteLength(nullableBase) - 5)}*/`),
  'deep-parentheses': nullableBase.replace(chain, `${'('.repeat(20_000)}${chain}${')'.repeat(20_000)}`),
  reassignment: nullableBase.replace('  return normalized;', '  normalized = normalized.trim();\n  return normalized;'),
  'unguarded-nullable': nullableBase.replace(`${guard}\n`, ''),
  'non-empty-guard': nullableBase.replace(guard, '  if (!raw) return "EMPTY";'),
  'second-guard': nullableBase.replace(guard, `${guard}\n  if (!raw) return "";`),
  'late-guard': nullableBase.replace(`${guard}\n`, '').replace('  return normalized;', `${guard}\n  return normalized;`),
  'guard-else': nullableBase.replace(guard, '  if (!raw) return ""; else return "x";'),
  'braced-guard': nullableBase.replace(guard, '  if (!raw) { return ""; }'),
  'equality-guard': nullableBase.replace(guard, '  if (raw == null) return "";'),
  'reordered-union': nullableBase.replace('string | null | undefined', 'string | undefined | null'),
  'optional-parameter': nullableBase.replace('raw: string | null | undefined', 'raw?: string'),
  'other-call': nullableBase.replace(`let normalized = ${chain};`, `let normalized = String(${chain});`),
  'operator': nullableBase.replace(`let normalized = ${chain};`, `let normalized = ${chain} + "";`),
  'uninitialized-let': nullableBase.replace(`  let normalized = ${chain};\n  return normalized;`, `  let normalized;\n  return ${chain};`),
  'line-separator-comment': nullableBase.replace('  // Canonical uppercase street form.', '  // Canonical raw = "x";'),
  'unicode-escape-name': nullableBase.replace('  return normalized;', '  return normaliz\\u0065d;'),
  'regex-class-slash': nullableBase.replace("replace(/#/g, '')", "replace(/[/]/g, ''); raw = (/x/)"),
  // Exact observed union only.
  'compact-union': nullableBase.replace('string | null | undefined', 'string|null|undefined'),
  'two-member-union': nullableBase.replace('string | null | undefined', 'string | null'),
  // A line terminator after the guard's return makes JavaScript return undefined.
  'guard-return-newline': nullableBase.replace(guard, '  if (!raw) return\n    "";'),
  'guard-return-comment-newline': nullableBase.replace(guard, '  if (!raw) return /*\n*/ "";'),
  // Otherwise supported; only a comment byte is not UTF-8.
  'invalid-utf8': Buffer.concat(nullableBase.split('  return normalized;')
    .flatMap((part, index) => index ? [Buffer.from([0xff]), Buffer.from(`\n  return normalized;${part}`)] : [Buffer.from(`${part}  // x`)])),
  'absent-helper': null,
};

/** Commit `helperSource` (string or bytes) as the helper, or remove it when null. */
export async function commitHelper(fixture, helperSource, message) {
  if (helperSource === null) await rm(`${fixture.repositoryPath}/${helperPath}`);
  else await writeFile(`${fixture.repositoryPath}/${helperPath}`, helperSource);
  fixture.git('add', '-A', helperPath); fixture.git('commit', '-m', message);
}
/** A committed controlled project whose admitted helper is `helperSource`. */
export async function helperProject(root, helperSource) {
  const fixture = await qualificationProject(root, 'green');
  await commitHelper(fixture, helperSource, 'controlled authored helper shape');
  return fixture;
}

/** Request 1 is the admission smoke. Later requests drive the executor's tool loop. */
export function helperExecutorReply(draft, candidate = nullableCandidate) {
  return async (request, index) => {
    if (index === 1) return eventsResponse();
    if (index === 2) return executorToolResponse('read_file', { path: helperPath, offset: 0 }, 'read',
      'Plan: inspect normalizeAddress, keep its nullable contract and guard, canonicalize whitespace, and add a focused regression test.');
    if (index === 3) return executorToolResponse('write_file', { path: helperPath, text: draft }, 'helper');
    if (index === 4) return executorToolResponse('write_file', { path: testPath, text: candidate }, 'test');
    return eventsResponse({ text: 'Draft retained; independent qualification is required.' });
  };
}
