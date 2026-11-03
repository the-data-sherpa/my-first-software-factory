// Only these factory-owned scripts may run in a positive control. Never copy package scripts here.
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { runPreparationSandbox } from './dependencies-process.mjs';
import { save } from './dependencies-files.mjs';

const expected = ['dependency-install', 'dependency-postinstall', 'dependency-preinstall', 'root-install', 'root-postinstall', 'root-preinstall'];
const scripts = (kind) => Object.fromEntries(['preinstall', 'install', 'postinstall'].map((phase) => [phase,
  `bun -e 'require("fs").writeFileSync("/tmp/work/${kind}-${phase}", "executed")'`]));
function archive() {
  const data = Buffer.from(JSON.stringify({ name: 'factory-sentinel', version: '1.0.0', scripts: scripts('dependency') }));
  const header = Buffer.alloc(512);
  header.write('package/package.json'); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124); header.write('00000000000\0', 136);
  header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
  header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `, 148);
  return gzipSync(Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512), Buffer.alloc(1024)]));
}
export async function proveScriptSuppression(destination, toolchain, signal) {
  const directory = `${destination}/script-proof`; const input = `${directory}/input`;
  await mkdir(directory, { mode: 0o700 }); await mkdir(input, { mode: 0o700 }); await mkdir(`${input}/vendor`, { mode: 0o700 });
  await writeFile(`${input}/package.json`, JSON.stringify({ name: 'factory-root-sentinel', version: '1.0.0', scripts: scripts('root'),
    trustedDependencies: ['factory-sentinel'], dependencies: { 'factory-sentinel': 'file:vendor/sentinel.tgz' } }), { mode: 0o400 });
  await writeFile(`${input}/package-lock.json`, '{"factory":"sentinel-only"}\n', { mode: 0o400 });
  await writeFile(`${input}/vendor/sentinel.tgz`, archive(), { mode: 0o400 });
  const result = await runPreparationSandbox({ inputDirectory: input, bunPath: toolchain.files[0].path, receiptDirectory: directory, signal, fixture: true });
  if (JSON.stringify(result.output.positiveSentinels) !== JSON.stringify(expected) || result.output.sentinels.length !== 0) {
    throw Object.assign(new Error('Script suppression verification failed.'), { code: 'DEPENDENCIES_SCRIPT_SUPPRESSION' });
  }
  const proof = { toolchainSha256: toolchain.files[0].sha256, bunVersion: result.output.bunVersion,
    positive: result.output.positiveSentinels, suppressed: result.output.sentinels, network: result.network, boundary: result.output.boundary, launch: result.launch };
  await save(`${directory}/result.json`, proof); return proof;
}
