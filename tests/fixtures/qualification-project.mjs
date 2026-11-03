// Synthetic runner packages ONLY. Their success is not real Vitest/ESLint compatibility.
import { writeFile, mkdir, copyFile, readFile, chmod } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { dependencyFixture } from '../../src/dependencies-diagnostics.mjs';
import { runPreparationSandbox } from '../../src/dependencies-process.mjs';
function tarball(files) {
  const blocks = [];
  for (const [path, text] of Object.entries(files)) {
    const data = Buffer.from(text); const header = Buffer.alloc(512);
    header.write(`package/${path}`, 0, 100); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124); header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
    header.write(`${header.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
export const baseHelper = `export function normalizeAddress(address) {
  return address.trim().toUpperCase().replace(/\\s+/g, ' ').replace(/\\bSTREET\\b/g, 'ST').replace(/\\./g, '').replace(/#/g, '');
}\n`;
export const draftHelper = `export function normalizeAddress(address) {
  return address.trim().toUpperCase().replace(/\\s+/g, ' ').replace(/\\bSTREET\\b/g, 'ST').replace(/\\./g, '').replace(/#/g, '').replace(/\\s+/g, ' ').trim();
}\n`;
export const draftTest = `import { test, expect } from 'vitest';
import { normalizeAddress } from '../../convex/syncHelpers.ts';
test('retains a unit after canonicalizing whitespace', () => expect(normalizeAddress('100 Main Street # 2')).toBe('100 MAIN ST 2'));
`;
export async function qualificationProject(root, scenario) {
  const fixture = await dependencyFixture(root, { copyToolchain: true });
  const repo = fixture.repositoryPath;
  const manifest = JSON.parse(await readFile(`${repo}/package.json`, 'utf8'));
  await writeFile(`${repo}/package.json`, JSON.stringify({ ...manifest, type: 'module' }));
  const index = `import assert from 'node:assert/strict';
export function expect(actual) { return { toBe(expected) { assert.equal(actual, expected); } }; }
export function test(id, run) {
  globalThis.fixtureCases ??= [];
  try { run(); globalThis.fixtureCases.push({id, state:'pass',errors:[]}); }
  catch (e) { globalThis.fixtureCases.push({id,state:'fail',errors:[{name:e.name,actual:e.actual,expected:e.expected,operator:e.operator}]}); }
}
`;
  const check = `import { existsSync } from 'node:fs';
const scenario = ${JSON.stringify(scenario)};
const selected = process.argv.includes('--config');
if (selected && scenario === 'crash') throw new Error('Controlled check crash, not a regression.');
if (selected && scenario === 'slow') await new Promise(r => setTimeout(r, 10000));
if (selected) await import('/verification/selected.test.mjs');
else {
  await import('/work/lib/__tests__/existing.test.ts');
  if (existsSync('/work/lib/__tests__/normalize-address.test.ts')) await import('/work/lib/__tests__/normalize-address.test.ts');
}
let cases = globalThis.fixtureCases ?? [];
if (selected && scenario === 'wrong-case') cases[0].id = 'unrelated-test';
if (selected && scenario === 'wrong-assertion') cases[0].errors[0].actual = 'unrelated';
if (selected && scenario === 'skipped') cases[0] = {id:cases[0].id,state:'skip',errors:[]};
if (selected && scenario === 'no-tests') cases = [];
if (!selected && existsSync('/work/lib/__tests__/normalize-address.test.ts')) {
  if (scenario === 'final-no-tests') cases = [];
  if (scenario === 'final-skipped') cases = cases.map(c => ({...c,state:'skip'}));
}
const failed = cases.some(c => c.state === 'fail');
process.exitCode = failed ? 1 : 0;
if (selected && scenario === 'malformed') console.log('not a runner report');
else console.log(JSON.stringify({protocol:'factory-vitest-selection-v1',files:selected ? ['/verification/selected.test.mjs'] :
  ['/work/lib/__tests__/existing.test.ts', ...(existsSync('/work/lib/__tests__/normalize-address.test.ts') ? ['/work/lib/__tests__/normalize-address.test.ts'] : [])],cases,errors:selected && scenario === 'unrelated-error' ? [{name:'Error'}] : []}));
if (!selected && scenario === 'final-vitest' && existsSync('/work/lib/__tests__/normalize-address.test.ts')) process.exitCode = 3;
`;
  const lint = `import { existsSync } from 'node:fs';
console.log(JSON.stringify({fixture:true,lint:true}));
if (${JSON.stringify(scenario)} === 'final-lint' && existsSync('/work/lib/__tests__/normalize-address.test.ts')) process.exitCode = 4;
`;
  await writeFile(`${repo}/vendor/vitest.tgz`, tarball({
    'package.json': JSON.stringify({ name: 'vitest', version: '1.0.0', type: 'module', exports: './dist/index.js', bin: { vitest: './vitest.mjs' } }),
    'vitest.mjs': check, 'dist/index.js': index,
  }));
  await writeFile(`${repo}/vendor/eslint.tgz`, tarball({
    'package.json': JSON.stringify({ name: 'eslint', version: '1.0.0', type: 'module', bin: { eslint: './bin/eslint.js' } }), 'bin/eslint.js': lint,
  }));
  // Existing fixture preparation has a fixed diagnostic lock-generation operation.
  const logs = `${root}/qualification-lock`; await mkdir(logs, { mode: 0o700 });
  const inputs = `${root}/qualification-input`; await mkdir(`${inputs}/vendor`, { recursive: true, mode: 0o700 });
  for (const name of ['package.json', 'package-lock.json', 'vendor/vitest.tgz', 'vendor/eslint.tgz']) await copyFile(`${repo}/${name}`, `${inputs}/${name}`);
  const generated = await runPreparationSandbox({ inputDirectory: inputs, bunPath: `${root}/bun`, receiptDirectory: logs, fixture: true });
  await writeFile(`${repo}/bun.lock`, Buffer.from(generated.output.lock, 'base64'));
  for (const dir of ['convex', 'lib', 'lib/__tests__']) await mkdir(`${repo}/${dir}`, { mode: 0o700 });
  await writeFile(`${repo}/convex/syncHelpers.ts`, baseHelper);
  await writeFile(`${repo}/lib/__tests__/existing.test.ts`, `import { test, expect } from 'vitest';
import { normalizeAddress } from '../../convex/syncHelpers.ts';
test('existing abbreviation behavior', () => expect(normalizeAddress('100 Main Street #2')).toBe('100 MAIN ST 2'));
`);
  if (scenario === 'executable-base') {
    await writeFile(`${repo}/offline-script.sh`, '#!/bin/sh\nexit 0\n');
    await chmod(`${repo}/offline-script.sh`, 0o755);
  }
  fixture.git('add', '.'); fixture.git('commit', '-m', 'controlled qualification source and runner');
  return fixture;
}
