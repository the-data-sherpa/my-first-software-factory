// Fixed disposable owner diagnostics, never registered as an agent tool.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, copyFile, chmod, symlink, link, unlink, rename, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { admitWorkspace, prepareWorkspace } from './workspace.mjs';
import { admitDependencies, prepareDependencies, dependencyDirectory, verifyDependencyBundle, inspectDependencies, serializeDependencyError, prepareOwnerDependencies } from './dependencies.mjs';
import { createContainedExecution, verifyContainmentEnvelope } from './containment.mjs';
import { acquireOwner } from './storage.mjs';
import { scopeProcesses, waitForCleanup, livingProcesses } from './containment-process-fixtures.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { runPreparationSandbox } from './dependencies-process.mjs';
import { stopPreparationStartup } from './containment-startup-fixture.mjs';

const bunPath = '/home/cowen/.bun/bin/bun';
const scripts = (kind) => Object.fromEntries(['preinstall', 'install', 'postinstall'].map((phase) => [phase,
  `bun -e 'require("fs").writeFileSync("/tmp/work/${kind}-${phase}", "executed")'`]));
function tarball(files) {
  const blocks = [];
  for (const [path, content] of Object.entries(files)) {
    const data = Buffer.from(typeof content === 'string' ? content : ''); const header = Buffer.alloc(512);
    header.write(`package/${path}`, 0, 100); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124); header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header.write(typeof content === 'string' ? '0' : '2', 156);
    if (typeof content !== 'string') header.write(content.target, 157, 100);
    header.write('ustar\0', 257); header.write('00', 263);
    const sum = header.reduce((a, b) => a + b, 0); header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(blocks));
}
export async function dependencyFixture(root, { copyToolchain = false, frozenMismatch = false, checkSuffix = '' } = {}) {
  if (!/^\/tmp\/factory-dependencies-[A-Za-z0-9]+$/.test(root)) throw new Error('Disposable fixture required');
  const repositoryPath = `${root}/owner`; const stateDir = `${root}/private`; const logs = `${root}/fixture-log`;
  for (const path of [repositoryPath, stateDir, logs, `${repositoryPath}/vendor`]) await mkdir(path, { mode: 0o700 });
  const manifest = { name: 'root-fixture', version: '1.0.0', scripts: scripts('root'), trustedDependencies: ['vitest'],
    devDependencies: { vitest: 'file:vendor/vitest.tgz', eslint: 'file:vendor/eslint.tgz' } };
  const check = `import { writeFile, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
const writes = {};
for (const path of ['/work/no-write', '/work/node_modules/vitest/no-write', '/work/node_modules/vitest/vitest.mjs']) {
 try { await writeFile(path, 'unsafe'); writes[path] = 'writable'; } catch (error) { writes[path] = error.code; }
}
const network = await new Promise((resolve) => { const socket = createConnection({host:'127.0.0.1',port:9}); socket.on('error', e => resolve(e.code)); socket.on('connect', () => { socket.destroy(); resolve('connected'); }); });
console.log(JSON.stringify({ fixture: true, writes, network, argv: process.argv.slice(2), installed: JSON.parse(await readFile('/work/node_modules/vitest/package.json','utf8')).version }));
if (Object.values(writes).some(code => code !== 'EROFS') || network !== 'EPERM') process.exitCode = 1;
${checkSuffix}
`;
  await writeFile(`${repositoryPath}/package.json`, JSON.stringify(manifest), { mode: 0o600 });
  await writeFile(`${repositoryPath}/package-lock.json`, '{"fixture":"preserve npm bytes"}\n', { mode: 0o600 });
  await writeFile(`${repositoryPath}/vendor/vitest.tgz`, tarball({
    'package.json': JSON.stringify({ name: 'vitest', version: '1.0.0', type: 'module', scripts: scripts('dependency'), bin: { vitest: './vitest.mjs' } }),
    'vitest.mjs': check,
  }), { mode: 0o600 });
  await writeFile(`${repositoryPath}/vendor/eslint.tgz`, tarball({
    'package.json': JSON.stringify({ name: 'eslint', version: '1.0.0', type: 'module', bin: { eslint: './bin/eslint.js' } }),
    'bin/eslint.js': check,
  }), { mode: 0o600 });
  const generated = await runPreparationSandbox({ inputDirectory: repositoryPath, bunPath, receiptDirectory: logs, fixture: true });
  let lock = Buffer.from(generated.output.lock, 'base64').toString('utf8');
  if (frozenMismatch) lock = lock.replace(/  "workspaces": \{[\s\S]+?\n  \},\n/, '');
  await writeFile(`${repositoryPath}/bun.lock`, lock, { mode: 0o600 });
  // Synthetic poison config is committed source but is never admitted to preparation inputs.
  for (const path of ['.npmrc', '.env', 'bunfig.toml']) await writeFile(`${repositoryPath}/${path}`, 'FACTORY_SYNTHETIC_CREDENTIAL_DO_NOT_COPY', { mode: 0o600 });
  const git = (...args) => execFileSync('/usr/bin/git', ['-C', repositoryPath, ...args], {
    env: { PATH: '/usr/bin', HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Fixture', GIT_COMMITTER_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' }, stdio: 'pipe',
  });
  git('init', '--initial-branch=main', '--template='); git('add', '.'); git('commit', '-m', 'controlled dependency fixture');
  const workspaceIntent = await admitWorkspace({ stateDir, project: { id: 'fixture', repositoryPath }, runId: 'run_dependencies' });
  await prepareWorkspace(workspaceIntent);
  let selectedBun = bunPath;
  if (copyToolchain) { selectedBun = `${root}/bun`; await copyFile(bunPath, selectedBun); await chmod(selectedBun, 0o500); }
  const intent = await admitDependencies({ workspaceIntent, bunPath: selectedBun });
  // The fixture models the application's required durable intent-before-side-effect ordering.
  await writeFile(`${root}/saved-intent.json`, JSON.stringify(intent), { mode: 0o600 });
  return { generated, intent, workspaceIntent, repositoryPath, git };
}
export async function runDependencyDiagnostic(scenario, root) {
  if (!['prepare', 'reuse', 'integrity', 'frozen', 'unsupported', 'cancel', 'admit', 'startup-proof', 'startup-target'].includes(scenario)) throw new Error('Unknown dependency diagnostic');
  const f = await dependencyFixture(root, { copyToolchain: scenario === 'integrity', frozenMismatch: scenario === 'frozen' });
  const code = async (operation) => { try { await operation(); return 'unexpected-success'; } catch (error) { return error.code; } };
  if (scenario.startsWith('startup-')) {
    const envelope = await verifyContainmentEnvelope();
    const fault = stopPreparationStartup(root, scenario.slice('startup-'.length), envelope);
    const controller = new AbortController();
    const abort = () => controller.abort(); process.on('SIGUSR1', abort);
    try {
      const operation = code(() => prepareOwnerDependencies(f.intent, { signal: controller.signal }));
      const ready = await fault.ready;
      process.stdout.write(`${JSON.stringify(ready)}\n`);
      // Observe exit independently from close on a red watchdog, without changing drainage.
      const observation = setInterval(() => {
        if (controller.signal.aborted) void (async () => {
          await writeFile(`${root}/startup-observation.json`, JSON.stringify({ ...ready.events(),
            survivors: await scopeProcesses(envelope) }), { mode: 0o600 });
        })().catch(() => {});
      }, 50);
      try {
        const cancelled = await operation;
        const survivors = await livingProcesses(ready.observed); // Must already be dead at return.
        const release = await acquireOwner(f.workspaceIntent.stateDir); release();
        return { cancelled, survivors, closed: ready.events().closed, ownerReleased: true,
          failure: JSON.parse(await readFile(`${dependencyDirectory(f.intent)}/failure.json`, 'utf8')) };
      } finally { clearInterval(observation); }
    } finally { process.off('SIGUSR1', abort); fault.restore(); }
  }
  if (scenario === 'admit') return { before: await inspectDependencies(f.intent), intentPath: `${root}/saved-intent.json` };
  if (scenario === 'cancel') {
    const release = await acquireOwner(f.workspaceIntent.stateDir);
    const otherOwner = await code(() => prepareOwnerDependencies(f.intent)); release();
    const signal = new AbortController();
    const operation = code(() => prepareOwnerDependencies(f.intent, { signal: signal.signal }));
    const envelope = await verifyContainmentEnvelope(); let observed = [];
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      observed = await scopeProcesses(envelope);
      if (observed.length >= 2) break;
      await delay(1);
    }
    signal.abort(); const cancelled = await operation;
    const survivors = await waitForCleanup(observed);
    const inspection = await inspectDependencies(f.intent);
    const failure = JSON.parse(await readFile(`${dependencyDirectory(f.intent)}/failure.json`, 'utf8'));
    const again = await acquireOwner(f.workspaceIntent.stateDir); again();
    return { otherOwner, cancelled, observedChildren: observed.length, survivors, inspection, failure, ownerReleased: true };
  }
  if (scenario === 'unsupported') {
    const result = {}; const sourceManifest = JSON.parse(await readFile(`${f.repositoryPath}/package.json`, 'utf8'));
    const archive = await readFile(`${f.repositoryPath}/vendor/vitest.tgz`);
    const cases = {
      registry: { devDependencies: { vitest: '1.0.0' } },
      registryCredentials: { devDependencies: { vitest: 'https://fixture:synthetic@example.invalid/pkg.tgz' } },
      git: { devDependencies: { vitest: 'git+https://example.invalid/fixture.git' } },
      directory: { devDependencies: { vitest: 'file:../../escape' } },
      link: { devDependencies: { vitest: 'link:vendor/vitest' } },
      workspaces: { workspaces: ['vendor/*'] }, patches: { patchedDependencies: { vitest: 'patch.diff' } },
      publishConfig: { publishConfig: { registry: 'https://synthetic:credential@example.invalid' } },
      archiveTraversal: {}, archiveCredentials: {}, archiveLink: {},
    };
    let index = 0;
    for (const [name, change] of Object.entries(cases)) {
      await writeFile(`${f.repositoryPath}/package.json`, JSON.stringify({ ...sourceManifest, ...change }));
      const packageFiles = { 'package.json': JSON.stringify({ name: 'vitest', version: '1.0.0' }) };
      if (name === 'archiveTraversal') packageFiles['../../escape'] = 'unsafe';
      if (name === 'archiveCredentials') packageFiles['.npmrc'] = 'synthetic credential';
      if (name === 'archiveLink') packageFiles.escape = { target: '/etc/passwd' };
      await writeFile(`${f.repositoryPath}/vendor/vitest.tgz`, name.startsWith('archive') ? tarball(packageFiles) : archive);
      f.git('add', '.'); f.git('commit', '-m', `unsupported fixture ${name}`);
      const workspaceIntent = await admitWorkspace({ stateDir: f.workspaceIntent.stateDir,
        project: { id: 'fixture', repositoryPath: f.repositoryPath }, runId: `run_unsafe_${++index}` });
      await prepareWorkspace(workspaceIntent);
      result[name] = await code(() => admitDependencies({ workspaceIntent, bunPath }));
    }
    return result;
  }
  if (scenario === 'frozen') {
    const result = await code(() => prepareDependencies(f.intent));
    const directory = dependencyDirectory(f.intent);
    const before = await readdir(directory);
    const inspection = await inspectDependencies(f.intent);
    const failure = await readFile(`${directory}/failure.json`, 'utf8');
    const repeated = await code(() => prepareDependencies(f.intent));
    assert.deepEqual(await readdir(directory), before);
    return { code: result, inspection, repeated, failureRetained: Boolean(JSON.parse(failure).code), noRawDiagnostic: !failure.includes(root) && !failure.includes('not-the-saved-package') };
  }
  let missing;
  try { await verifyDependencyBundle(f.intent); } catch (error) { missing = serializeDependencyError(error); }
  const preparation = await prepareDependencies(f.intent);
  if (scenario === 'integrity') {
    const results = { missing };
    const failure = async (name, mutate, restore) => {
      await mutate();
      try { await verifyDependencyBundle(f.intent); results[name] = { code: 'unexpected-success' }; }
      catch (error) { results[name] = serializeDependencyError(error); }
      finally { await restore(); }
    };
    for (const [name, path] of [['manifest', 'package.json'], ['bunLock', 'bun.lock'], ['npmLock', 'package-lock.json'], ['archive', 'vendor/vitest.tgz']]) {
      const absolute = `${f.workspaceIntent.worktree}/${path}`; const original = await readFile(absolute);
      await failure(name, () => writeFile(absolute, 'changed'), () => writeFile(absolute, original));
    }
    const binary = `${root}/bun`; const originalBinary = await readFile(binary);
    await failure('toolchain', async () => { await chmod(binary, 0o700); await writeFile(binary, 'changed'); }, async () => { await writeFile(binary, originalBinary); await chmod(binary, 0o500); });
    const directory = dependencyDirectory(f.intent); const modules = `${directory}/bundle/node_modules`; const pkg = `${modules}/vitest`; const entry = `${pkg}/vitest.mjs`;
    await chmod(pkg, 0o700); await chmod(entry, 0o600);
    const original = await readFile(entry);
    await writeFile(entry, original); await chmod(entry, 0o500); await chmod(pkg, 0o500);
    await failure('fileBytes', async () => { await chmod(entry, 0o600); await writeFile(entry, 'changed'); await chmod(entry, 0o500); }, async () => { await chmod(entry, 0o600); await writeFile(entry, original); await chmod(entry, 0o500); });
    await failure('fileMode', () => chmod(entry, 0o600), () => chmod(entry, 0o500));
    await failure('extra', async () => { await chmod(pkg, 0o700); await writeFile(`${pkg}/extra`, 'extra'); await chmod(pkg, 0o500); }, async () => { await chmod(pkg, 0o700); await unlink(`${pkg}/extra`); await chmod(pkg, 0o500); });
    await failure('hardlink', () => link(entry, `${root}/alias`), () => unlink(`${root}/alias`));
    await failure('symlink', async () => { await chmod(pkg, 0o700); await rename(entry, `${root}/entry`); await symlink(`${root}/entry`, entry); await chmod(pkg, 0o500); }, async () => { await chmod(pkg, 0o700); await unlink(entry); await rename(`${root}/entry`, entry); await chmod(pkg, 0o500); });
    await failure('directoryLink', async () => { await chmod(modules, 0o700); await chmod(pkg, 0o700); await rename(pkg, `${root}/package`); await chmod(`${root}/package`, 0o500); await symlink(`${root}/package`, pkg); await chmod(modules, 0o500); }, async () => { await chmod(modules, 0o700); await unlink(pkg); await chmod(`${root}/package`, 0o700); await rename(`${root}/package`, pkg); await chmod(pkg, 0o500); await chmod(modules, 0o500); });
    const bin = `${modules}/.bin/vitest`;
    await failure('binLink', async () => { await chmod(`${modules}/.bin`, 0o700); await unlink(bin); await symlink('/runtime/node', bin); await chmod(`${modules}/.bin`, 0o500); }, async () => { await chmod(`${modules}/.bin`, 0o700); await unlink(bin); await symlink('../vitest/vitest.mjs', bin); await chmod(`${modules}/.bin`, 0o500); });
    const receipt = `${directory}/result.json`; const receiptBytes = await readFile(receipt);
    await failure('receipt', () => writeFile(receipt, '{}'), () => writeFile(receipt, receiptBytes));
    const proof = `${directory}/script-proof/result.json`; const proofBytes = await readFile(proof);
    await failure('suppressionProof', () => writeFile(proof, '{}'), () => writeFile(proof, proofBytes));
    await writeFile(`${f.workspaceIntent.worktree}/draft.mjs`, 'export const draft = true;');
    const handle = await verifyDependencyBundle(f.intent); results.draftAllowed = true;
    const receiptDirectory = `${root}/checks`; await mkdir(receiptDirectory, { mode: 0o700 });
    const tools = await createContainedExecution({ worktree: f.workspaceIntent.worktree, receiptDirectory, dependencyBundle: handle });
    try { await chmod(entry, 0o600); results.recheckAfterTamper = await code(() => tools.check('vitest')); }
    finally { await tools.close(); await chmod(entry, 0o500); }
    return results;
  }
  const lockfilesUnchanged = (await Promise.all(['bun.lock', 'package-lock.json'].map(async (name) =>
    (await readFile(`${f.repositoryPath}/${name}`)).equals(await readFile(`${f.workspaceIntent.worktree}/${name}`))))).every(Boolean);
  assert.equal(lockfilesUnchanged, true);
  if (scenario === 'reuse') {
    const receiptDirectory = `${root}/checks`; await mkdir(receiptDirectory, { mode: 0o700 });
    const options = { worktree: f.workspaceIntent.worktree, receiptDirectory };
    const code = async (operation) => { try { await operation(); return 'unexpected-success'; } catch (error) { return error.code; } };
    const forged = await code(() => createContainedExecution({ ...options, dependencyBundle: { prepared: true, intentId: f.intent.id } }));
    const tools = await createContainedExecution({ ...options, dependencyBundle: await verifyDependencyBundle(f.intent) });
    try {
      for (const path of ['package.json', 'bun.lock', 'package-lock.json', 'vendor/vitest.tgz']) {
        await assert.rejects(tools.write(path, 'dependency changes are not admitted'), { code: 'UNSAFE_PATH' });
      }
      const check = await tools.check('vitest');
      return { check, lint: await tools.check('lint'), boundary: tools.verification, forged,
        extraArgs: await code(() => tools.check('vitest', { argv: ['install'] })), noInstall: await code(() => tools.check('install')) };
    } finally { await tools.close(); }
  }
  return { backendPid: process.pid, bunVersion: preparation.bunVersion, preparation, positiveSentinels: f.generated.output.positiveSentinels,
    lockfilesUnchanged, directory: dependencyDirectory(f.intent) };
}
