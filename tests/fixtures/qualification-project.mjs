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
export function candidateTest(scenario) {
  const assertion = "expect(normalizeAddress('100 Main Street # 2')).toBe('100 MAIN ST 2')";
  if (scenario === 'candidate-tautology') return draftTest.replace(assertion, 'expect(1).toBe(1)');
  if (scenario === 'candidate-unrelated') return draftTest.replace("toBe('100 MAIN ST 2')", "toBe('unrelated output')");
  if (scenario === 'candidate-empty') return draftTest.replace(assertion, '{}');
  if (scenario === 'candidate-skipped') return draftTest.replace("test('", "test.skip('");
  if (scenario === 'candidate-crash') return draftTest + "throw new Error('candidate crashed');\n";
  if (scenario === 'candidate-missing') return "import 'nonexistent-dependency';\n" + draftTest;
  if (scenario === 'candidate-mixed-empty') return draftTest + "test('empty companion', () => {});\n";
  if (scenario === 'candidate-valid-literal') return draftTest + "test('extra literal is not a source-string veto', () => expect(1).toBe(1));\n";
  return draftTest;
}
export async function qualificationProject(root, scenario, { stateDir } = {}) {
  const fixture = await dependencyFixture(root, { copyToolchain: true, ...(stateDir ? { stateDir } : {}) });
  const repo = fixture.repositoryPath;
  const manifest = JSON.parse(await readFile(`${repo}/package.json`, 'utf8'));
  await writeFile(`${repo}/package.json`, JSON.stringify({ ...manifest, type: 'module' }));
  const index = await readFile(new URL('./qualification-vitest.mjs', import.meta.url), 'utf8');
  const check = (await readFile(new URL('./qualification-runner.mjs', import.meta.url), 'utf8')).replace('SCENARIO', JSON.stringify(scenario));
  const lint = `import { existsSync } from 'node:fs';
console.log(JSON.stringify({fixture:true,lint:true}));
if (${JSON.stringify(scenario)} === 'final-lint' && existsSync('/work/lib/__tests__/normalize-address.test.ts')) process.exitCode = 4;
`;
  await writeFile(`${repo}/vendor/vitest.tgz`, tarball({
    'package.json': JSON.stringify({ name: 'vitest', version: scenario === 'unsupported-version' ? '4.0.18' : '4.0.17', type: 'module', exports: './dist/index.js', bin: { vitest: './vitest.mjs' } }),
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
